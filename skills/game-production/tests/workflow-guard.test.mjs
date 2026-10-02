import fs from 'node:fs';
import os from 'node:os';
import { acquireOperation } from '../scripts/operation-lock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  workflowChildEnvironment,
  assertWorkflowPermit,
  assertSourceWorkflow
} from '../scripts/workflow-guard.mjs';
const root = path.resolve('fixture-workflow'),
  token = 'a'.repeat(32);
const lock = { command: 'ship', repository: 'neurofoxpro/multimental', pid: 1234, token };
test('unlocked source does not need a workflow token', () =>
  assert.equal(assertWorkflowPermit(null, root, {}), true));
test('the real parent can provide its scoped child environment', () => {
  const env = workflowChildEnvironment(root, lock, { EXISTING: 'kept' }, 1234);
  assert.equal(env.EXISTING, 'kept');
  assert.equal(
    assertWorkflowPermit(lock, root, env, () => true),
    true
  );
});
for (const [name, change] of [
  ['no environment', () => ({})],
  ['other token', (env) => ({ ...env, MULTIMENTAL_WORKFLOW_TOKEN: 'foreign' })],
  ['other root', (env) => ({ ...env, MULTIMENTAL_WORKFLOW_ROOT: path.resolve('other') })],
  ['other PID', (env) => ({ ...env, MULTIMENTAL_WORKFLOW_PID: '999' })]
])
  test('concurrent writer refused: ' + name, () => {
    const env = workflowChildEnvironment(root, lock, {}, 1234);
    assert.throws(() => assertWorkflowPermit(lock, root, change(env), () => true), /WRITER_ACTIVE/);
  });
test('a dead or unknown parent is not an inherited write grant', () => {
  const env = workflowChildEnvironment(root, lock, {}, 1234);
  assert.throws(() => assertWorkflowPermit(lock, root, env, () => false), /OWNER_NOT_LIVE/);
  assert.throws(() => assertWorkflowPermit(lock, root, env, () => null), /OWNER_NOT_LIVE/);
});
test('foreign operation and malformed PID are not accepted as workflow lease', () => {
  assert.throws(() => workflowChildEnvironment(root, lock, {}, 999), /NOT_OWNED/);
  assert.throws(() => assertWorkflowPermit({ ...lock, pid: 0 }, root, {}), /INVALID/);
  assert.throws(
    () => assertWorkflowPermit({ ...lock, repository: 'other/repo' }, root, {}),
    /INVALID/
  );
});

test('real existing operation lease authorizes only its scoped child', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-workflow-guard-'));
  const folder = path.join(dir, '.gameprod/evidence');
  const file = path.join(folder, 'short-workflow.lock');
  const release = acquireOperation(file, {
    command: 'ship',
    repository: 'neurofoxpro/multimental'
  });
  try {
    const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(actual.token.length, 32);
    const env = workflowChildEnvironment(dir, actual, {});
    assert.equal(assertSourceWorkflow(dir, env), true);
    assert.throws(() => assertSourceWorkflow(dir, {}), /WRITER_ACTIVE/);
  } finally {
    release();
    fs.rmdirSync(folder);
    fs.rmdirSync(path.dirname(folder));
    fs.rmdirSync(dir);
  }
});
