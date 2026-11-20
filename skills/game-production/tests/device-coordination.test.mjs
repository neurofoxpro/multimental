import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPathsGone } from '../scripts/device-coordination.mjs';
test('test coordinator waits for an already-running updater', async () => {
  let time = 0;
  const r = await waitForPathsGone(['update.lock'], {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    exists: () => time < 750,
    timeoutMs: 1000
  });
  assert.equal(r.waitedMs, 750);
});
test('no contention requires no polling delay', async () => {
  let calls = 0;
  const r = await waitForPathsGone(['update.lock'], {
    now: () => 0,
    sleep: async () => {
      calls++;
    },
    exists: () => false
  });
  assert.equal(r.waitedMs, 0);
  assert.equal(calls, 0);
});
test('live deployment is never deleted or bypassed after timeout', async () => {
  let time = 0;
  await assert.rejects(
    () =>
      waitForPathsGone(['update.lock'], {
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        exists: () => true,
        timeoutMs: 500
      }),
    /not interrupted/
  );
  assert.equal(time, 500);
});
