import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlan, cleanupMutation, runCleanup, removableName } from '../scripts/branches.mjs';
const H = 'a'.repeat(40),
  D = 'b'.repeat(40),
  repo = 'neurofoxpro/multimental';
const refs = () => [
  { name: 'feature/done', oid: H },
  { name: 'dev', oid: D },
  { name: 'main', oid: D }
];
const prs = () => [
  {
    number: 5,
    state: 'MERGED',
    baseRefName: 'dev',
    headRefName: 'feature/done',
    headRefOid: H,
    headRepository: { nameWithOwner: repo }
  }
];
const plan = () => cleanupPlan(refs(), prs(), [], [H, D], D);
test('only exact merged branch is eligible', () => {
  assert.deepEqual(plan().remove, [{ name: 'feature/done', oid: H, pr: 5 }]);
  assert.equal(plan().keep.length, 2);
});
for (const name of [
  'main',
  'dev',
  'release/1.0',
  'feature/../x',
  'feature/end.lock',
  'feature/',
  'feature/with space',
  'feature/x:main',
  'refs/heads/feature/x'
])
  test('protected or unsafe name ' + name, () => assert.equal(removableName(name), false));
for (const [name, update] of [
  ['unmerged', (p) => (p.state = 'CLOSED')],
  ['main target', (p) => (p.baseRefName = 'main')],
  ['tip changed', (p) => (p.headRefOid = D)],
  ['foreign repo', (p) => (p.headRepository.nameWithOwner = 'other/repo')]
])
  test('rejects ' + name, () => {
    const p = prs();
    update(p[0]);
    assert.equal(cleanupPlan(refs(), p, [], [H], D).remove.length, 0);
  });
test('active worktree is preserved', () =>
  assert.equal(cleanupPlan(refs(), prs(), ['feature/done'], [H], D).remove.length, 0));
test('unfinished Actions branch is preserved through active set', () =>
  assert.equal(
    cleanupPlan(refs(), prs(), ['feature/done'], [H], D).keep[0].reason,
    'active_worktree'
  ));
test('open PR for same branch prevents cleanup', () => {
  const p = prs();
  p.push({ ...p[0], state: 'OPEN', number: 6 });
  assert.equal(cleanupPlan(refs(), p, [], [H], D).remove.length, 0);
});
test('ancestry is mandatory', () =>
  assert.equal(cleanupPlan(refs(), prs(), [], [], D).remove.length, 0));
test('mutation is non-forced compare-and-delete with a dev guard', () => {
  const m = cleanupMutation(plan(), 'R_id');
  assert.deepEqual(m.refUpdates, [
    { name: 'refs/heads/dev', beforeOid: D, afterOid: D, force: false },
    { name: 'refs/heads/feature/done', beforeOid: H, afterOid: '0'.repeat(40), force: false }
  ]);
});
test('forged removal of dev is rejected', () => {
  const p = plan();
  p.remove[0].name = 'dev';
  assert.throws(() => cleanupMutation(p, 'R_id'));
});
test('duplicate deletion rejected', () => {
  const p = plan();
  p.remove.push({ ...p.remove[0] });
  assert.throws(() => cleanupMutation(p, 'R_id'));
});
test('empty mutation is rejected', () => {
  const p = plan();
  p.remove = [];
  assert.throws(() => cleanupMutation(p, 'R_id'));
});
test('successful cleanup requires readback', async () => {
  const records = [];
  const r = await runCleanup(plan(), 'R_id', {
    mutate: async () => {},
    readRefs: async () => [{ name: 'dev', oid: D }],
    record: async (x) => records.push(x)
  });
  assert.equal(r.status, 'deleted');
  assert.equal(r.readback, true);
  assert.equal(records[0].status, 'prepared');
  assert.equal(records.at(-1).status, 'deleted');
});
test('lost response is resolved by readback without retrying mutation', async () => {
  let calls = 0;
  const r = await runCleanup(plan(), 'R_id', {
    mutate: async () => {
      calls++;
      throw Error('timeout');
    },
    readRefs: async () => [],
    record: async () => {}
  });
  assert.equal(calls, 1);
  assert.equal(r.recoveredUnknownResponse, true);
});
test('concurrently advanced branch is not reported deleted', async () => {
  let calls = 0;
  await assert.rejects(
    runCleanup(plan(), 'R_id', {
      mutate: async () => {
        calls++;
        throw Error('beforeOid mismatch');
      },
      readRefs: async () => [{ name: 'feature/done', oid: D }],
      record: async () => {}
    })
  );
  assert.equal(calls, 1);
});
test('unconfirmed deletion is not success', async () => {
  await assert.rejects(
    runCleanup(plan(), 'R_id', {
      mutate: async () => {},
      readRefs: async () => refs(),
      record: async () => {}
    }),
    /not confirmed/
  );
});
test('unavailable readback cannot become a passing receipt', async () => {
  const records = [];
  await assert.rejects(
    runCleanup(plan(), 'R_id', {
      mutate: async () => {},
      readRefs: async () => {
        throw Error('offline');
      },
      record: async (x) => records.push(x)
    })
  );
  assert.equal(
    records.some((x) => x.status === 'deleted'),
    false
  );
});
