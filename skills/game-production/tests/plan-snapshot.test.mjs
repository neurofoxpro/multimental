import test from 'node:test';
import assert from 'node:assert/strict';
import { proposedSnapshot } from '../scripts/plan-snapshot.mjs';
const task = () => ({
  id: 'TASK-01',
  title: 'Example',
  source: 'owner',
  stage: 'P0',
  status: 'planned',
  kind: 'game',
  priority: 1,
  dependsOn: [],
  acceptance: ['Real test'],
  evidence: [],
  readset: [],
  requiredForPlay: true,
  requiredForBeta: true
});
const seed = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  updatedAt: '2026-09-25',
  tasks: [task()]
});
const snapshot = () => ({
  repository: 'neurofoxpro/multimental',
  source: 'github-issues',
  missing: [],
  observedAt: '2026-09-26T00:00:00Z',
  records: [{ issue: 31, bodySha256: 'a'.repeat(64), task: task() }]
});
test('unchanged snapshot does not churn dates', () => {
  const a = seed();
  const result = proposedSnapshot(a, snapshot());
  assert.deepEqual(result.plan, a);
  assert.equal(result.changes.length, 0);
  assert.equal(result.publicationAuthorized, false);
});
test('primary verified state carries evidence without changing original', () => {
  const a = seed(),
    b = snapshot();
  b.records[0].task.status = 'verified';
  b.records[0].task.evidence = ['docs/test.md'];
  const r = proposedSnapshot(a, b);
  assert.equal(a.tasks[0].status, 'planned');
  assert.equal(r.plan.tasks[0].status, 'verified');
  assert.equal(r.changes[0].issue, 31);
  assert.equal(r.plan.updatedAt, '2026-09-26');
});
test('second application is idempotent', () => {
  const b = snapshot();
  b.records[0].task.title = 'Changed';
  const a = proposedSnapshot(seed(), b);
  assert.equal(proposedSnapshot(a.plan, b).changes.length, 0);
});
for (const [name, change] of [
  ['other repo', (b) => (b.repository = 'other/repo')],
  ['incomplete source', (b) => (b.source = 'github-issues-partial-migration')],
  ['missing task', (b) => (b.missing = ['TASK-01'])],
  ['invalid time', (b) => (b.observedAt = 'never')],
  ['empty records', (b) => (b.records = [])],
  ['duplicate', (b) => b.records.push(structuredClone(b.records[0]))],
  ['missing hash', (b) => (b.records[0].bodySha256 = '')],
  ['noninteger issue', (b) => (b.records[0].issue = 1.5)],
  ['absent evidence', (b) => (b.records[0].task.status = 'verified')],
  ['path escape', (b) => (b.records[0].task.readset = ['../key'])],
  [
    'scope removal',
    (b) => {
      b.records[0].task.requiredForPlay = false;
      b.records[0].task.disposition = 'changed';
    }
  ],
  [
    'unapproved extra task',
    (b) => {
      const t = structuredClone(b.records[0]);
      t.task.id = 'TASK-02';
      b.records.push(t);
    }
  ],
  ['missing dependency', (b) => (b.records[0].task.dependsOn = ['GONE-01'])]
])
  test('rejects ' + name, () => {
    const b = snapshot();
    change(b);
    assert.throws(() => proposedSnapshot(seed(), b));
  });
test('two task IDs cannot refer to one Issue', () => {
  const a = seed(),
    b = snapshot();
  const second = task();
  second.id = 'TASK-02';
  a.tasks.push(second);
  b.records.push({ ...b.records[0], task: second });
  assert.throws(() => proposedSnapshot(a, b), /same Issue/);
});
test('returned plan does not alias the primary definitions', () => {
  const b = snapshot();
  const result = proposedSnapshot(seed(), b);
  result.plan.tasks[0].acceptance.push('New');
  assert.equal(b.records[0].task.acceptance.length, 1);
});
