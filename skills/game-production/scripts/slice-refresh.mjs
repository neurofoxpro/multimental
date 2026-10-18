import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inside, readJSON, writeJSON, sha } from './lib.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { assertOwnership } from './collaboration-policy.mjs';
const SHA = /^[a-f0-9]{40}$/;
function validPath(p) {
  return (
    typeof p === 'string' &&
    /^[A-Za-z0-9_.\/-]+$/.test(p) &&
    !p.startsWith('/') &&
    !p.split('/').some((s) => !s || s === '..' || s === '.') &&
    !p.toLowerCase().startsWith('.git/')
  );
}
export function refreshPlan({ head, target, ancestor, dirty, incoming }) {
  if (
    !SHA.test(head || '') ||
    !SHA.test(target || '') ||
    !Array.isArray(dirty) ||
    !Array.isArray(incoming) ||
    [...dirty, ...incoming].some((p) => !validPath(p))
  )
    throw Error('Invalid refresh inventory');
  if (!ancestor)
    throw Error('Owned branch diverged: a reviewed merge is required, not reset/rebase');
  for (const local of dirty)
    for (const remote of incoming) {
      const a = local.toLowerCase(),
        b = remote.toLowerCase();
      if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/'))
        throw Error('Dirty source intersects incoming dev: ' + local);
    }
  return {
    head,
    target,
    status: head === target ? 'already_current' : 'fast_forward',
    preserve: [...new Set(dirty)].sort()
  };
}
export async function refreshSlice(root, store, hub) {
  const binding = readJSON(inside(root, '.gameprod/agent.local.json'));
  assertOwnership((await store.read()).state, binding);
  const git = (...args) => {
    const r = spawnSync('git', args, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 6000000
    });
    if (r.error || r.status !== 0) throw Error('Refresh git failed: ' + args[0]);
    return r.stdout.trim();
  };
  const branch = git('branch', '--show-current');
  if (branch !== binding.branch || !/^(feature|fix|docs|test)\//.test(branch))
    throw Error('Wrong owned feature branch');
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'refresh-owned-slice',
    claimToken: binding.token
  });
  const record = inside(root, '.gameprod/evidence/slice-refresh.json');
  try {
    const target = (await hub.api('GET', '/git/ref/heads/dev')).object.sha;
    if (!SHA.test(target || '')) throw Error('Missing live dev');
    git('fetch', 'origin', 'dev');
    const head = git('rev-parse', 'HEAD');
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', head, target], {
      cwd: root,
      shell: false,
      timeout: 15000
    });
    if (ancestor.error || ![0, 1].includes(ancestor.status)) throw Error('Cannot prove ancestry');
    if (git('diff', '--name-only', '--diff-filter=U')) throw Error('Unresolved working tree');
    const names = (s) => s.split('\0').filter(Boolean);
    const dirty = [
      ...names(git('diff', '--name-only', '-z', 'HEAD')),
      ...names(git('ls-files', '--others', '--exclude-standard', '-z'))
    ];
    const plan = refreshPlan({
      head,
      target,
      ancestor: ancestor.status === 0,
      dirty,
      incoming: names(git('diff', '--name-only', '-z', head, target))
    });
    const identity = (p) => {
      const file = inside(root, p);
      if (!fs.existsSync(file)) return { path: p, hash: null };
      const st = fs.lstatSync(file);
      if (st.isSymbolicLink() || !st.isFile() || st.size > 16000000)
        throw Error('Unsafe local source');
      return { path: p, hash: sha(fs.readFileSync(file)) };
    };
    const preserved = plan.preserve.map(identity);
    writeJSON(record, { status: 'prepared', branch, claimToken: binding.token, plan, preserved });
    assertOwnership((await store.read()).state, binding);
    if (
      git('rev-parse', 'HEAD') !== head ||
      git('branch', '--show-current') !== branch ||
      JSON.stringify(plan.preserve.map(identity)) !== JSON.stringify(preserved)
    )
      throw Error('Concurrent source change');
    if (plan.status !== 'already_current') git('merge', '--ff-only', '--no-autostash', target);
    if (
      git('rev-parse', 'HEAD') !== target ||
      git('branch', '--show-current') !== branch ||
      JSON.stringify(plan.preserve.map(identity)) !== JSON.stringify(preserved)
    )
      throw Error('Refresh readback failed: inspect journal; no automatic rollback');
    const result = {
      status: plan.status,
      branch,
      from: head,
      to: target,
      preservedFiles: preserved.length,
      sourceWrites: 'git-fast-forward-only',
      requiresFreshVerification: true
    };
    writeJSON(record, { ...result, preserved });
    return result;
  } finally {
    release();
  }
}
