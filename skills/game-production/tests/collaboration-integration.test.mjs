import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { enrollTasks } from '../../../tools/enroll-tasks.mjs';
import { desiredMetadata } from '../../../tools/issue-graph.mjs';
import { requiresOwnership, validateBinding } from '../scripts/collaboration-guard.mjs';
import { emptyCoordination, transition } from '../scripts/collaboration-policy.mjs';
const task = (id = 'TASK-01') => ({
  id,
  title: 'Task',
  source: 'owner',
  stage: 'P0',
  kind: 'game',
  status: 'planned',
  priority: 1,
  dependsOn: [],
  acceptance: ['test'],
  evidence: [],
  readset: [],
  requiredForBeta: true,
  requiredForPlay: true
});
const seed = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  updatedAt: '2026-09-26',
  tasks: [task()]
});
test('enrollment is add-only and repeatable', () => {
  const a = seed(),
    t = task('TASK-02');
  const b = enrollTasks(a, [t]);
  assert.equal(a.tasks.length, 1);
  assert.equal(b.tasks.length, 2);
  assert.deepEqual(enrollTasks(b, [t]), b);
});
test('existing task definitions cannot be overwritten by enrollment', () =>
  assert.throws(() => enrollTasks(seed(), [{ ...task(), title: 'Other' }])));
test('preverified new work cannot enter registry', () =>
  assert.throws(() =>
    enrollTasks(seed(), [{ ...task('TASK-02'), status: 'verified', evidence: ['docs/test.md'] }])
  ));
test('missing dependencies and duplicate IDs fail enrollment', () => {
  assert.throws(() => enrollTasks(seed(), [{ ...task('TASK-02'), dependsOn: ['MISSING-01'] }]));
  assert.throws(() => enrollTasks(seed(), [task('TASK-02'), task('TASK-02')]));
});
const snapshot = () => ({
  source: 'github-issues',
  missing: [],
  records: [
    { issue: 31, task: task() },
    { issue: 32, task: { ...task('TASK-02'), dependsOn: ['TASK-01'], priority: 25 } }
  ]
});
const config = { taskResources: {}, kindResources: { game: ['area:game-core'] } };
test('labels encode ready/blocked and native dependency numbers', () => {
  const m = desiredMetadata(snapshot(), [], config);
  assert.equal(m[0].status, 'ready');
  assert.equal(m[1].status, 'blocked');
  assert.deepEqual(m[1].dependencies, [31]);
  assert.ok(m[1].labels.includes('gp:priority:p2'));
});
test('current claim projects active label but does not change definition', () => {
  const s = snapshot();
  assert.equal(desiredMetadata(s, [{ task: 'TASK-01' }], config)[0].status, 'active');
  assert.equal(s.records[0].task.status, 'planned');
});
test('incomplete primary snapshot cannot generate labels', () => {
  const s = snapshot();
  s.missing = ['TASK-01'];
  assert.throws(() => desiredMetadata(s, [], config));
});
for (const op of ['apply', 'check', 'audit', 'publish', 'begin', 'device-suite', 'delivery'])
  test('mutating ' + op + ' requires ownership', () => assert.equal(requiresOwnership(op), true));
for (const op of ['resume', 'task', 'inspect', 'collab', 'device-status'])
  test('read/start ' + op + ' remains accessible for recovery', () =>
    assert.equal(requiresOwnership(op), false)
  );
test('worktree cannot switch branch, release or reuse stale ownership', () => {
  const q = {
    id: randomUUID(),
    kind: 'claim',
    task: 'TASK-01',
    owner: 'test-chat',
    base: 'a'.repeat(40),
    resources: ['area:game-core']
  };
  const a = transition(emptyCoordination(), q, 1);
  const b = { ...a.result, branch: 'feature/task-test' };
  assert.equal(validateBinding(a.state, b, b.branch).owner, q.owner);
  assert.throws(() => validateBinding(a.state, b, 'dev'));
  assert.throws(() => validateBinding(a.state, { ...b, released: true }, b.branch));
  assert.throws(() => validateBinding(emptyCoordination(), b, b.branch));
});
