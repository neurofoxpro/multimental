import test from 'node:test';
import assert from 'node:assert/strict';
import { proposedSnapshot, synchronizePlan } from '../scripts/plan-snapshot.mjs';
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
test('unchanged snapshot does not churn dates or authorize publication', () => {
  const a = seed();
  const r = proposedSnapshot(a, snapshot());
  assert.deepEqual(r.plan, a);
  assert.equal(r.changes.length, 0);
  assert.equal(r.publicationAuthorized, false);
});
test('primary verified state carries evidence without mutating input', () => {
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
  ['duplicate task', (b) => b.records.push(structuredClone(b.records[0]))],
  ['missing hash', (b) => (b.records[0].bodySha256 = '')],
  ['fractional issue', (b) => (b.records[0].issue = 1.5)],
  ['absent evidence', (b) => (b.records[0].task.status = 'verified')],
  ['unsafe path', (b) => (b.records[0].task.readset = ['../key'])],
  [
    'scope removal',
    (b) => {
      b.records[0].task.requiredForPlay = false;
      b.records[0].task.disposition = 'changed';
    }
  ],
  [
    'extra task',
    (b) => {
      const t = structuredClone(b.records[0]);
      t.task.id = 'TASK-02';
      t.issue = 32;
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
test('two IDs cannot refer to one Issue', () => {
  const a = seed(),
    b = snapshot(),
    second = task();
  second.id = 'TASK-02';
  a.tasks.push(second);
  b.records.push({ ...b.records[0], task: second });
  assert.throws(() => proposedSnapshot(a, b), /same Issue/);
});
test('returned plan does not alias Issue definitions', () => {
  const b = snapshot(),
    r = proposedSnapshot(seed(), b);
  r.plan.tasks[0].acceptance.push('extra');
  assert.equal(b.records[0].task.acceptance.length, 1);
});
function ports() {
  const calls = [];
  return {
    calls,
    validateReferences: async () => calls.push('references'),
    apply: async () => calls.push('apply'),
    render: async () => calls.push('render'),
    record: async () => calls.push('record')
  };
}
function changed() {
  const s = snapshot();
  s.records[0].task.title = 'Updated';
  return s;
}
test('apply/render/record are ordered after reference validation', async () => {
  const p = ports();
  const r = await synchronizePlan(seed(), changed(), p);
  assert.deepEqual(p.calls, ['references', 'apply', 'render', 'record']);
  assert.equal(r.changed.length, 1);
  assert.equal(r.publicationAuthorized, false);
});
test('no-op does not rewrite source but still verifies derived documents', async () => {
  const p = ports();
  await synchronizePlan(seed(), snapshot(), p);
  assert.deepEqual(p.calls, ['references', 'render', 'record']);
});
test('missing evidence file stops before any write', async () => {
  const p = ports();
  p.validateReferences = async () => {
    throw Error('missing');
  };
  await assert.rejects(synchronizePlan(seed(), changed(), p), /missing/);
  assert.deepEqual(p.calls, []);
});
test('CAS conflict stops render and success receipt', async () => {
  const p = ports();
  p.apply = async () => {
    throw Error('changed source');
  };
  await assert.rejects(synchronizePlan(seed(), changed(), p), /changed/);
  assert.deepEqual(p.calls, ['references']);
});
test('failed render cannot be reported as completed', async () => {
  const p = ports();
  p.render = async () => {
    throw Error('interrupted');
  };
  await assert.rejects(synchronizePlan(seed(), changed(), p), /interrupted/);
  assert.deepEqual(p.calls, ['references', 'apply']);
});
test('resume after applied source safely repairs missing projections', async () => {
  const s = changed(),
    a = proposedSnapshot(seed(), s).plan,
    p = ports();
  await synchronizePlan(a, s, p);
  assert.deepEqual(p.calls, ['references', 'render', 'record']);
});
test('record failure does not cause source rollback or second write', async () => {
  const p = ports();
  p.record = async () => {
    throw Error('disk full');
  };
  await assert.rejects(synchronizePlan(seed(), changed(), p), /disk full/);
  assert.deepEqual(p.calls, ['references', 'apply', 'render']);
});
test('invalid primary graph never calls ports', async () => {
  const p = ports(),
    s = changed();
  s.records[0].task.dependsOn = ['TASK-01'];
  await assert.rejects(synchronizePlan(seed(), s, p));
  assert.deepEqual(p.calls, []);
});
