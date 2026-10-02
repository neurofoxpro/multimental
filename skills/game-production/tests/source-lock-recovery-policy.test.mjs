import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planRecovery,
  validateRow,
  assertSameRow,
  processState,
  barrierDetails,
  LOCK_COMMANDS
} from '../scripts/source-lock-recovery-policy.mjs';
const h = 'a'.repeat(64),
  t = 'b'.repeat(32),
  now = Date.parse('2026-09-30T00:00:00Z');
const row = (id = 'worktree:short-workflow.lock', command = 'ship', extra = {}) => ({
  id,
  sha256: h,
  inode: '1',
  device: '2',
  value: { pid: 42, token: t, startedAt: '2026-09-29T23:58:00Z', command, ...extra }
});
const absent = () => 'absent';
test('all declared lock ids have explicit command allowlists', () => {
  for (const [id, cmd] of Object.entries(LOCK_COMMANDS)) {
    assert.ok(id.includes(':'));
    assert.ok(cmd.length);
    assert.equal(new Set(cmd).size, cmd.length);
  }
});
test('stale proven lock plans', () =>
  assert.equal(planRecovery([row()], { now, state: absent }).length, 1));
test('fresh lock blocks', () =>
  assert.throws(() =>
    validateRow(
      { ...row(), value: { ...row().value, startedAt: '2026-09-29T23:59:50Z' } },
      { now, state: absent }
    )
  ));
test('live and unknown owners block', () => {
  assert.throws(() => validateRow(row(), { now, state: () => 'alive' }));
  assert.throws(() => validateRow(row(), { now, state: () => 'unknown' }));
});
test('invalid owner identity blocks', () => {
  for (const pid of [0, -1, 1.5, true])
    assert.throws(() =>
      validateRow({ ...row(), value: { ...row().value, pid } }, { now, state: absent })
    );
  assert.throws(() =>
    validateRow({ ...row(), value: { ...row().value, token: 'x' } }, { now, state: absent })
  );
});
test('unknown path or command blocks', () => {
  assert.throws(() => validateRow(row('worktree:other.lock', 'ship'), { now, state: absent }));
  assert.throws(() =>
    validateRow(row('worktree:short-workflow.lock', 'accept'), { now, state: absent })
  );
});
test('duplicate inventory blocks', () =>
  assert.throws(() => planRecovery([row(), row()], { now, state: absent })));
test('barrier is recoverable only on known path and proven dead', () => {
  const r = row('worktree:short-workflow.lock', barrierDetails().command);
  assert.equal(validateRow(r, { now, state: absent }).barrier, true);
  assert.throws(() => validateRow(r, { now, state: () => 'alive' }));
});
test('second read binds bytes/stat/owner identity', () => {
  const a = row();
  assert.equal(assertSameRow(a, structuredClone(a)), true);
  for (const mutate of [
    (r) => (r.sha256 = 'c'.repeat(64)),
    (r) => (r.inode = '9'),
    (r) => (r.value.pid = 43),
    (r) => (r.value.command = 'accept'),
    (r) => (r.value.startedAt = '2026-09-28T00:00:00Z')
  ]) {
    const b = structuredClone(a);
    mutate(b);
    assert.throws(() => assertSameRow(a, b));
  }
});
test('process state distinguishes ESRCH from permission uncertainty', () => {
  assert.equal(
    processState(2, () => {
      const e = Error();
      e.code = 'ESRCH';
      throw e;
    }),
    'absent'
  );
  assert.equal(
    processState(2, () => {
      const e = Error();
      e.code = 'EPERM';
      throw e;
    }),
    'unknown'
  );
  assert.equal(
    processState(2, () => {}),
    'alive'
  );
});
test('ops lock legacy commands are exact not regex-open', () => {
  const valid = row('worktree:ops.lock', 'publish');
  assert.equal(validateRow(valid, { now, state: absent }).value.command, 'publish');
  assert.throws(() =>
    validateRow(row('worktree:ops.lock', 'publish-evil'), { now, state: absent })
  );
});
