import test from 'node:test';
import assert from 'node:assert/strict';
import { wlanAddress, waitWifiAddress } from '../scripts/network-readiness.mjs';
test('Wi-Fi switch-on is not the same as associated address', async () => {
  let time = 0;
  const r = await waitWifiAddress({
    probe: () => (time < 1000 ? '' : 'wlan0 inet 192.168.0.2/24'),
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    timeoutMs: 2000
  });
  assert.equal(r, '192.168.0.2');
  assert.equal(time, 1000);
});
test('unavailable Wi-Fi is bounded and never passed', async () => {
  let time = 0;
  await assert.rejects(
    () =>
      waitWifiAddress({
        probe: () => '',
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        timeoutMs: 500
      }),
    /deadline/
  );
  assert.equal(wlanAddress('state UP'), null);
});
