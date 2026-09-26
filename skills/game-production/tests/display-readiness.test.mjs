import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDisplay } from '../../../scripts/device-launch.mjs';
test('sleeping unlocked device is woken without replacing its lock credentials', () => {
  const calls = [];
  const report = prepareDisplay(
    {},
    {
      invoke: (a) => {
        calls.push(a);
        return a[0] === 'dumpsys' && a[1] === 'power' ? 'mWakefulness=Asleep' : 'showing=false';
      },
      wait: () => {}
    }
  );
  assert.equal(report.wakeRequested, true);
  assert.equal(report.credentialBypass, false);
  assert.ok(calls.some((a) => a[0] === 'input' && a[2] === 'KEYCODE_WAKEUP'));
  assert.ok(calls.every((a) => !a.includes('text')));
});
test('dismiss-keyguard is asked only once and Android must actually release it', () => {
  let reads = 0;
  const calls = [];
  const result = prepareDisplay(
    {},
    {
      invoke: (a) => {
        calls.push(a);
        if (a[0] === 'dumpsys' && a[1] === 'window')
          return ++reads === 1 ? 'showing=true' : 'showing=false';
        return 'mWakefulness=Awake';
      },
      wait: () => {}
    }
  );
  assert.equal(result.dismissRequested, true);
  assert.equal(calls.filter((a) => a[0] === 'wm').length, 1);
});
test('a credential-locked device is a bounded explicit blocker, never a passing launch', () => {
  const calls = [];
  assert.throws(
    () =>
      prepareDisplay(
        {},
        {
          invoke: (a) => {
            calls.push(a);
            return a[1] === 'power' ? 'mWakefulness=Awake' : 'showing=true';
          },
          wait: () => {},
          attempts: 2
        }
      ),
    /user unlock/
  );
  assert.equal(calls.filter((a) => a[0] === 'wm').length, 1);
  assert.ok(calls.every((a) => !a.includes('text') && !a.includes('swipe')));
});
test('already awake unlocked device does not receive unnecessary input', () => {
  const calls = [];
  prepareDisplay(
    {},
    {
      invoke: (a) => {
        calls.push(a);
        return a[1] === 'power' ? 'mWakefulness=Awake' : 'showing=false';
      }
    }
  );
  assert.equal(calls.length, 2);
});
