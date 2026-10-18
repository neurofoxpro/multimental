import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitDelivery } from '../scripts/delivery-policy.mjs';
const sha = 'a'.repeat(40);
const good = { sourceCommit: sha, readyMarker: true, observedVersionMatches: true };
test('already installed expected build is idempotent', async () => {
  let attempts = 0;
  const r = await awaitDelivery({
    expectedCommit: sha,
    current: () => good,
    attempt: () => {
      attempts++;
    }
  });
  assert.equal(r.alreadyInstalled, true);
  assert.equal(attempts, 0);
});
test('stale release listing is waited out automatically', async () => {
  let time = 0,
    count = 0;
  const r = await awaitDelivery({
    expectedCommit: sha,
    current: () =>
      count >= 2
        ? good
        : { sourceCommit: 'b'.repeat(40), readyMarker: true, observedVersionMatches: true },
    attempt: () => {
      count++;
      return { status: count >= 2 ? 'installed_and_launched' : 'awaiting_expected_release' };
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    intervalMs: 100,
    timeoutMs: 1000
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.attempts.length, 2);
  assert.equal(time, 100);
});
test('command exit success is not installation evidence', async () => {
  let time = 0;
  await assert.rejects(
    () =>
      awaitDelivery({
        expectedCommit: sha,
        current: () => ({ ...good, observedVersionMatches: false }),
        attempt: () => ({ status: 'already_current' }),
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        intervalMs: 100,
        timeoutMs: 200
      }),
    /bounded deadline/
  );
});
test('security or integrity failure is not retried', async () => {
  let count = 0;
  await assert.rejects(
    () =>
      awaitDelivery({
        expectedCommit: sha,
        current: () => null,
        attempt: () => {
          count++;
          throw Error('Signature mismatch');
        }
      }),
    /Signature mismatch/
  );
  assert.equal(count, 1);
});
test('wrong source commit cannot satisfy delivery', async () => {
  let time = 0;
  await assert.rejects(
    () =>
      awaitDelivery({
        expectedCommit: sha,
        current: () => ({ ...good, sourceCommit: 'b'.repeat(40) }),
        attempt: () => ({ status: 'installed_and_launched' }),
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        intervalMs: 100,
        timeoutMs: 200
      }),
    /bounded deadline/
  );
});
