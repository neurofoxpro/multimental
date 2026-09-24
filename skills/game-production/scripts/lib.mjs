import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
export const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
export function inside(root, rel) {
  if (
    typeof rel !== 'string' ||
    !rel ||
    rel.includes('\0') ||
    path.isAbsolute(rel) ||
    path.win32.isAbsolute(rel)
  )
    throw Error('Relative path required');
  const base = path.resolve(root),
    full = path.resolve(base, rel),
    r = path.relative(base, full);
  if (r === '..' || r.startsWith('..' + path.sep)) throw Error('Path escapes workspace');
  // Check existing ancestors as well as the final target. A nonexistent leaf
  // below a junction/symlink must not escape the repository on a write.
  const parts = r.split(path.sep).filter(Boolean);
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw Error('Symlink input refused');
  }
  let existing = full;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw Error('Missing workspace ancestor');
    existing = parent;
  }
  const realBase = fs.realpathSync(base),
    realExisting = fs.realpathSync(existing),
    rr = path.relative(realBase, realExisting);
  if (rr === '..' || rr.startsWith('..' + path.sep) || path.isAbsolute(rr))
    throw Error('Symlink escapes workspace');
  return full;
}
export function findRoot(start = process.cwd()) {
  let p = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(p, '.gameprod/project.json'))) return p;
    const parent = path.dirname(p);
    if (parent === p) throw Error('Missing explicit production profile');
    p = parent;
  }
}
export function normalizeRepo(remote) {
  const m = remote
    .trim()
    .replace(/\.git$/, '')
    .match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+)$/);
  if (!m) throw Error('Unsupported Git remote');
  return m[1];
}
export function profile(p) {
  if (
    p.schemaVersion !== 1 ||
    !/^[-\w.]+\/[-\w.]+$/.test(p.repository || '') ||
    !Array.isArray(p.authorizedHosts) ||
    !p.authorizedHosts.length
  )
    throw Error('Explicit repository and hosts required');
  for (const [k, s] of Object.entries(p.steps || {}))
    if (
      !Array.isArray(s.command) ||
      !s.command.length ||
      s.command.some((v) => typeof v !== 'string') ||
      !Number.isFinite(s.timeoutSeconds) ||
      s.timeoutSeconds <= 0
    )
      throw Error('Invalid step ' + k);
  if (!p.gates || !p.inputs?.length) throw Error('Gates and inputs required');
  return p;
}
export function context(root, p, { hostname = os.hostname(), env = process.env } = {}) {
  profile(p);
  if (env.GITHUB_ACTIONS === 'true') {
    if (env.GITHUB_REPOSITORY !== p.repository) throw Error('Wrong CI repository');
  } else if (!p.authorizedHosts.some((x) => x.toUpperCase() === hostname.toUpperCase()))
    throw Error('Unauthorized host');
  const r = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    timeout: 10000
  });
  if (r.status === 0) {
    if (normalizeRepo(r.stdout) !== p.repository) throw Error('Wrong Git origin');
  } else {
    const s = readJSON(inside(root, '.gameprod/source.json'));
    if (s.repository !== p.repository || !/^[a-f0-9]{40}$/.test(s.commit))
      throw Error('Wrong source snapshot');
  }
  return true;
}
export function fingerprint(root, p) {
  const files = [];
  function walk(rel) {
    const full = inside(root, rel);
    if (!fs.existsSync(full)) throw Error('Missing input ' + rel);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw Error('Symlink input refused');
    if (stat.isDirectory()) {
      for (const n of fs.readdirSync(full).sort()) {
        if (
          ['.godot', 'node_modules', '.git'].includes(n) ||
          (p.generatedSuffixes || []).some((s) => n.endsWith(s))
        )
          continue;
        walk(path.posix.join(rel, n));
      }
    } else files.push([rel, sha(fs.readFileSync(full))]);
  }
  p.inputs.forEach(walk);
  return sha(JSON.stringify(files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))));
}
export function receipt(root, p, name) {
  try {
    const r = readJSON(inside(root, '.gameprod/evidence/' + name.replaceAll(':', '-') + '.json'));
    if (r.step !== name || r.exitCode !== 0 || r.status !== 'passed')
      return { ok: false, reason: 'failed' };
    if (
      r.sourceChanged === true ||
      (r.sourceDigestAfter !== undefined && r.sourceDigestAfter !== r.sourceDigest)
    )
      return { ok: false, reason: 'source_changed_during_step' };
    const expected = (p.steps?.[name]?.outputs || []).slice().sort(),
      actual = (r.outputs || []).map((x) => x.path).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      return { ok: false, reason: 'missing_or_unexpected_output' };
    if (r.sourceDigest !== fingerprint(root, p)) return { ok: false, reason: 'stale_source' };
    if (sha(fs.readFileSync(inside(root, r.log))) !== r.logHash)
      return { ok: false, reason: 'changed_log' };
    for (const a of r.outputs || [])
      if (sha(fs.readFileSync(inside(root, a.path))) !== a.sha256)
        return { ok: false, reason: 'changed_output' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' ? 'not_run' : e.message };
  }
}
export function gate(root, p, id) {
  const g = p.gates[id];
  if (!g) throw Error('Unknown gate');
  if (g.manual) return { ok: false, reason: 'manual_acceptance_required' };
  if (!g.steps?.length) return { ok: false, reason: 'no_verification_steps' };
  const checks = g.steps.map((n) => ({ step: n, ...receipt(root, p, n) }));
  return { ok: checks.every((x) => x.ok), checks };
}
export function chooseDevice(text, serial) {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.match(/^(\S+)\s+(device|unauthorized|offline)(?:\s|$)/))
    .filter(Boolean);
  if (serial) {
    const r = rows.find((x) => x[1] === serial);
    if (!r || r[2] !== 'device') throw Error('Selected phone unavailable or unauthorized');
    return serial;
  }
  if (rows.length !== 1 || rows[0][2] !== 'device')
    throw Error('Expected exactly one authorized phone');
  return rows[0][1];
}
export function verifyManifest(dir, m) {
  if (
    m.schemaVersion !== 1 ||
    !m.repository ||
    !m.commit?.match(/^[a-f0-9]{40}$/) ||
    !m.apk ||
    path.basename(m.apk) !== m.apk ||
    !m.sha256?.match(/^[a-f0-9]{64}$/) ||
    !Number.isSafeInteger(m.versionCode) ||
    m.versionCode < 1
  )
    throw Error('Invalid artifact manifest');
  const apk = inside(dir, m.apk);
  if (sha(fs.readFileSync(apk)) !== m.sha256) throw Error('APK checksum mismatch');
  return apk;
}
