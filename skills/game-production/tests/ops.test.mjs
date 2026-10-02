import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, featureBranch, readyTasks, assertMerge } from '../scripts/policy.mjs';
import { safePath } from '../scripts/apply.mjs';
test('docs-only classification never skips unknown or runtime files', () => {
  assert.equal(classify(['docs/a.md', '.gameprod/state.json']).needsApk, false);
  for (const x of [
    'game/src/main.gd',
    'scripts/test.mjs',
    'game/export_presets.cfg',
    'package.json',
    '.github/workflows/build.yml'
  ])
    assert.equal(classify([x]).needsApk, true);
  assert.equal(classify([]).needsApk, true);
});
test('main and malformed branches not writable by ops', () => {
  assert.equal(featureBranch('feature/ops-v2'), true);
  for (const b of ['main', 'dev', 'feature/../dev', '--delete', 'feature/'])
    assert.equal(featureBranch(b), false);
});
test('unmet manual task does not block independent engineering work', () => {
  assert.deepEqual(
    readyTasks([
      { id: 'm', manual: true, status: 'pending' },
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'pending', dependsOn: ['m'] },
      { id: 'd', status: 'deferred' }
    ]).map((x) => x.id),
    ['a']
  );
});
test('dev integration rejects wrong head, main or failed/missing checks', () => {
  const p = {
    baseRefName: 'dev',
    headRefName: 'feature/a',
    headRefOid: 'abc',
    state: 'OPEN',
    isDraft: false
  };
  assert.equal(assertMerge(p, 'abc', [{ state: 'SUCCESS' }]), true);
  assert.throws(() => assertMerge({ ...p, baseRefName: 'main' }, 'abc', [{ state: 'SUCCESS' }]));
  assert.throws(() => assertMerge(p, 'new', [{ state: 'SUCCESS' }]));
  assert.throws(() => assertMerge(p, 'abc', []));
  assert.throws(() => assertMerge(p, 'abc', [{ state: 'FAILURE' }]));
});
test('bundle paths reject escapes and private files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-path-'));
  try {
    for (const f of ['../x', '.git/config', '.env', 'a.local.json', 'x.p12', 'a//b'])
      assert.throws(() => safePath(root, f));
    assert.equal(safePath(root, 'game/a.gd'), path.join(root, 'game/a.gd'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
