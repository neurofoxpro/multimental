import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureRecoveryCommit, recoveryAncestor } from '../scripts/recovery-git.mjs';
const H = 'a'.repeat(40),
  B = 'b'.repeat(40);
function fixture(probes = [0], origin = 'https://github.com/neurofoxpro/multimental.git') {
  const calls = [];
  const cmd = (_root, args) => {
    calls.push(args);
    if (args[0] === 'cat-file') {
      const next = probes.shift();
      return typeof next === 'number' ? { status: next } : next;
    }
    if (args[0] === 'remote') return origin;
    if (args[0] === 'fetch') return '';
    throw Error('Unexpected Git command');
  };
  return { cmd, calls };
}
test('warm recovery uses exact existing commit without fetch', () => {
  const f = fixture();
  assert.equal(ensureRecoveryCommit(f.cmd, '.', H), H);
  assert.equal(f.calls.length, 1);
});
test('cold recovery fetches canonical dev once then reprobes the same SHA', () => {
  const f = fixture([128, 0]);
  assert.equal(ensureRecoveryCommit(f.cmd, '.', H), H);
  assert.deepEqual(f.calls, [
    ['cat-file', '-e', H + '^{commit}'],
    ['remote', 'get-url', 'origin'],
    ['fetch', '--no-tags', 'origin', 'dev'],
    ['cat-file', '-e', H + '^{commit}']
  ]);
});
test('failed fetch preserves the failure and does not qualify source', () => {
  const f = fixture([128]);
  const cmd = (root, args) => {
    if (args[0] === 'fetch') throw Error('fetch unavailable');
    return f.cmd(root, args);
  };
  assert.throws(() => ensureRecoveryCommit(cmd, '.', H), /fetch unavailable/);
});
test('foreign origin is rejected before network mutation', () => {
  const f = fixture([128], 'https://github.com/other/repository.git');
  assert.throws(() => ensureRecoveryCommit(f.cmd, '.', H), /WRONG_ORIGIN/);
  assert.ok(!f.calls.some((a) => a[0] === 'fetch'));
});
test('still missing exact commit after fetch never substitutes another head', () => {
  const f = fixture([128, 128]);
  assert.throws(() => ensureRecoveryCommit(f.cmd, '.', H), /OBJECT_UNAVAILABLE/);
  assert.equal(f.calls.filter((a) => a[0] === 'fetch').length, 1);
});
for (const bad of [
  { status: null },
  { status: 0, error: new Error('spawn failed') },
  { status: 0, signal: 'SIGTERM' },
  { status: 2 }
])
  test('unknown object probe fails closed: ' + JSON.stringify(bad), () => {
    const f = fixture([bad]);
    assert.throws(() => ensureRecoveryCommit(f.cmd, '.', H), /PROBE_UNKNOWN/);
    assert.equal(f.calls.length, 1);
  });
test('invalid remote commit identity cannot become a Git argument', () => {
  const f = fixture();
  for (const value of ['dev', '--help', null])
    assert.throws(() => ensureRecoveryCommit(f.cmd, '.', value), /DEV_IDENTITY/);
  assert.equal(f.calls.length, 0);
});
for (const status of [0, 1])
  test('ancestry distinguishes known exit ' + status, () => {
    assert.equal(
      recoveryAncestor(() => ({ status }), '.', B, H),
      status === 0
    );
  });
for (const result of [
  { status: 128 },
  { status: null },
  { status: 0, error: new Error('spawn') },
  { status: 0, signal: 'SIGTERM' }
])
  test('unknown ancestry never reports ordinary non-ancestor: ' + JSON.stringify(result), () => {
    assert.throws(() => recoveryAncestor(() => result, '.', B, H), /ANCESTRY_UNKNOWN/);
  });
test('ancestry accepts only exact commit hashes', () => {
  assert.throws(() => recoveryAncestor(() => ({ status: 0 }), '.', 'dev', H), /ANCESTRY_IDENTITY/);
});
test('cold local Git fixture fetches missing dev objects without changing working HEAD or files', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-recovery-git-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const upstream = path.join(temporary, 'upstream'),
    local = path.join(temporary, 'local');
  fs.mkdirSync(upstream);
  const git = (cwd, args, optional = false) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
    if (!optional && (r.error || r.status !== 0))
      throw Error('Fixture Git failed: ' + args[0] + ' ' + r.stderr);
    return optional ? r : r.stdout.trim();
  };
  git(upstream, ['init', '--initial-branch=dev']);
  git(upstream, ['config', 'user.name', 'Recovery Fixture']);
  git(upstream, ['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(upstream, 'source.txt'), 'one');
  git(upstream, ['add', 'source.txt']);
  git(upstream, ['commit', '-m', 'base']);
  git(temporary, ['clone', '--no-local', upstream, local]);
  const before = git(local, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(upstream, 'source.txt'), 'two');
  git(upstream, ['add', 'source.txt']);
  git(upstream, ['commit', '-m', 'next dev']);
  const next = git(upstream, ['rev-parse', 'HEAD']);
  assert.notEqual(git(local, ['cat-file', '-e', next + '^{commit}'], true).status, 0);
  // Only the origin allowlist read is adapted; the isolated Git fetch/object graph is real.
  const cmd = (cwd, args, optional) =>
    args[0] === 'remote'
      ? 'https://github.com/neurofoxpro/multimental.git'
      : git(cwd, args, optional);
  assert.equal(ensureRecoveryCommit(cmd, local, next), next);
  assert.equal(recoveryAncestor(cmd, local, before, next), true);
  assert.equal(git(local, ['rev-parse', 'HEAD']), before);
  assert.equal(fs.readFileSync(path.join(local, 'source.txt'), 'utf8'), 'one');
  assert.equal(git(local, ['status', '--porcelain']), '');
});
