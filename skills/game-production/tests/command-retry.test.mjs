import test from 'node:test';
import assert from 'node:assert/strict';
import { readOnlyCommand, executeWithReadRetry, confirmMerge } from '../scripts/command-retry.mjs';
const fail = { status: 1, stderr: 'Post https://api.github.com/graphql: TLS handshake timeout' };
test('only positive allowlisted read commands retry', () => {
  assert.equal(readOnlyCommand('gh', ['pr', 'view', '1']), true);
  assert.equal(readOnlyCommand('gh.exe', ['api', 'repos/org/repo']), true);
  for (const a of [
    ['pr', 'merge', '1'],
    ['api', 'repos/org/repo', '-X', 'POST'],
    ['api', 'repos/org/repo', '--method=PUT'],
    ['api', 'graphql'],
    ['api', 'repos/org/repo', '-fbody=x']
  ])
    assert.equal(readOnlyCommand('gh', a), false);
});
test('read timeout retries boundedly and can recover', () => {
  let n = 0;
  const waits = [];
  const r = executeWithReadRetry('gh', ['pr', 'view', '1'], {
    invoke: () => (++n < 3 ? fail : { status: 0, stdout: 'ok' }),
    wait: (x) => waits.push(x)
  });
  assert.equal(r.status, 0);
  assert.equal(n, 3);
  assert.deepEqual(waits, [1000, 4000]);
});
test('writes and authorization failures are not retried', () => {
  let n = 0;
  executeWithReadRetry('gh', ['pr', 'merge', '1'], {
    invoke: () => {
      n++;
      return fail;
    },
    wait: () => {}
  });
  assert.equal(n, 1);
  n = 0;
  executeWithReadRetry('gh', ['pr', 'view', '1'], {
    invoke: () => {
      n++;
      return { status: 1, stderr: 'HTTP 403 rate limit exceeded' };
    },
    wait: () => {}
  });
  assert.equal(n, 1);
});
test('ambiguous merge is confirmed by exact readback without repeating mutation', async () => {
  let writes = 0;
  const head = 'a'.repeat(40),
    commit = 'b'.repeat(40);
  const r = await confirmMerge({
    expectedHead: head,
    write: async () => {
      writes++;
      throw Error('TLS timeout');
    },
    read: async () => ({
      headRefOid: head,
      baseRefName: 'dev',
      state: 'MERGED',
      mergeCommit: { oid: commit }
    }),
    wait: async () => {}
  });
  assert.equal(writes, 1);
  assert.equal(r.mergeCommit.oid, commit);
  assert.equal(r.recoveredAfterWriteError, true);
});
test('merge confirmation rejects a different head or main base', async () => {
  await assert.rejects(
    () =>
      confirmMerge({
        expectedHead: 'a'.repeat(40),
        write: async () => {},
        read: async () => ({
          headRefOid: 'a'.repeat(40),
          baseRefName: 'main',
          state: 'MERGED',
          mergeCommit: { oid: 'b'.repeat(40) }
        }),
        wait: async () => {}
      }),
    /MERGE_SCOPE/
  );
});
