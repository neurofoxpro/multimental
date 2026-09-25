import { replaceSource } from './source-edit.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { context, readJSON, inside, sha, writeJSON, findRoot } from './lib.mjs';
export function assertCurrentEdit({ exists, tracked, dirty, actualHash, expectedCurrentSha256 }) {
  const explicit = expectedCurrentSha256 !== undefined;
  if (
    explicit &&
    (!/^[a-f0-9]{64}$/.test(expectedCurrentSha256) ||
      !exists ||
      expectedCurrentSha256 !== actualHash)
  )
    throw Error('Current-hash mismatch; preserve changed work');
  if (exists && (!tracked || dirty) && !explicit)
    throw Error('Uncommitted source requires exact expectedCurrentSha256');
  return true;
}
export function safePath(root, p) {
  if (
    !/^[\w./-]+$/.test(p) ||
    p.split('/').some((x) => !x || x === '.' || x === '..') ||
    /^\.git(?:\/|$)/i.test(p) ||
    /\.local\.|(?:^|\/)\.env|\.(?:p12|jks|keystore)$/i.test(p)
  )
    throw Error('Unsafe change path');
  let cur = root;
  for (const part of p.split('/')) {
    cur = path.join(cur, part);
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) throw Error('Symlink refused');
  }
  return inside(root, p);
}
export function assertEditLease(root) {
  const file = inside(root, '.gameprod/evidence/ops.lock');
  if (fs.existsSync(file)) {
    const lock = readJSON(file);
    if (lock.pid !== process.pid)
      throw Error('Production operation active; wait before editing source');
  }
}
export function applyBundle(root, b) {
  assertEditLease(root);
  const p = readJSON(inside(root, '.gameprod/project.json'));
  context(root, p);
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0) throw Error('Git failed: ' + args[0]);
    return r.stdout.trim();
  };
  if (git(['rev-parse', 'HEAD']) !== b.base) throw Error('Stale bundle base');
  if (!/^(feature|fix|docs|test)\//.test(git(['branch', '--show-current'])))
    throw Error('Feature branch required');
  if (!Array.isArray(b.files) || !b.files.length) throw Error('Empty bundle');
  const seen = new Set();
  const plan = [];
  for (const f of b.files) {
    const target = safePath(root, f.path);
    if (seen.has(f.path)) throw Error('Duplicate change');
    seen.add(f.path);
    const old = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    const original = spawnSync('git', ['show', 'HEAD:' + f.path], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000
    });
    const difference =
      old !== null && original.status === 0
        ? spawnSync('git', ['diff', '--quiet', 'HEAD', '--', f.path], { cwd: root, timeout: 15000 })
        : { status: 0 };
    if (![0, 1].includes(difference.status)) throw Error('Cannot inspect source difference');
    assertCurrentEdit({
      exists: old !== null,
      tracked: original.status === 0,
      dirty: difference.status === 1,
      actualHash: old === null ? null : sha(old),
      expectedCurrentSha256: f.expectedCurrentSha256
    });
    if (f.beforeSha256 && old !== null && sha(old) !== f.beforeSha256)
      throw Error('Before-hash mismatch: ' + f.path);
    let content = f.content;
    if (f.edits) {
      if (old === null) throw Error('Edit target absent');
      content = old;
      for (const e of f.edits) {
        const count = content.split(e.from).length - 1;
        if (!e.from || count !== (e.count ?? 1)) throw Error('Edit occurrence mismatch: ' + f.path);
        content = content.split(e.from).join(e.to);
      }
    }
    if (typeof content !== 'string') throw Error('Text content required');
    plan.push({ path: f.path, target, old, content });
  }
  const journal = inside(root, '.gameprod/evidence/last-apply.json');
  writeJSON(journal, {
    status: 'prepared',
    base: b.base,
    files: plan.map((x) => ({
      path: x.path,
      before: x.old === null ? null : sha(x.old),
      after: sha(x.content)
    }))
  });
  for (const f of plan) {
    if ((fs.existsSync(f.target) ? fs.readFileSync(f.target, 'utf8') : null) !== f.old)
      throw Error('Concurrent edit before write');
    fs.mkdirSync(path.dirname(f.target), { recursive: true });
    replaceSource(root, f.path, f.content, { expectedHash: f.old === null ? null : sha(f.old) });
  }
  writeJSON(journal, { status: 'applied', base: b.base, files: plan.map((x) => x.path) });
  console.log('BUNDLE_APPLIED ' + plan.length);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyBundle(findRoot(), readJSON(process.argv[2]));
}
