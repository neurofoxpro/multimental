import test from 'node:test';
import assert from 'node:assert/strict';
import { provenBranchOrphan } from '../scripts/branch-recovery.mjs';
const fixture = () => ({
  lock: {
    command: 'owned-next-branch',
    pid: 123,
    token: 'token',
    startedAt: '2026-09-26T00:00:00Z'
  },
  binding: { token: 'token', branch: 'feature/x', released: false },
  journal: { status: 'completed', token: 'token', to: 'feature/x', head: 'a'.repeat(40) },
  observed: {
    branch: 'feature/x',
    head: 'a'.repeat(40),
    process: 'absent',
    now: Date.parse('2026-09-26T00:01:00Z')
  }
});
const check = (x) => provenBranchOrphan(x.lock, x.binding, x.journal, x.observed);
test('only completed owned branch transition with absent process is recoverable', () =>
  assert.equal(check(fixture()), true));
for (const [name, change] of [
  ['live owner', (x) => (x.observed.process = 'alive')],
  ['unknown owner', (x) => (x.observed.process = 'unknown')],
  ['different token', (x) => (x.lock.token = 'new')],
  ['incomplete journal', (x) => (x.journal.status = 'prepared')],
  ['different command', (x) => (x.lock.command = 'verify')],
  ['changed branch', (x) => (x.observed.branch = 'dev')],
  ['changed commit', (x) => (x.observed.head = 'b'.repeat(40))],
  ['released owner', (x) => (x.binding.released = true)],
  ['recent lock', (x) => (x.observed.now -= 50000)],
  ['malformed time', (x) => (x.lock.startedAt = 'never')]
])
  test('recovery preserves ' + name, () => {
    const x = fixture();
    change(x);
    assert.throws(() => check(x));
  });
