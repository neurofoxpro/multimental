import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryTransport } from '../scripts/primary-transport.mjs';
const c = {
  repository: 'neurofoxpro/multimental',
  package: 'pro.neurofox.multimental.dev',
  serial: 'PRIMARY123',
  workDir: 'private-installation-root'
};
function mock({ wireless = false, other = false, boot = '1', mdns = true } = {}) {
  let connected = wireless;
  const calls = [];
  const invoke = (args) => {
    calls.push(args);
    if (args[0] === 'devices')
      return (
        `${connected ? '192.168.1.2:37000' : 'PRIMARY123'} device` +
        (other ? '\n192.168.1.3:37100 device' : '')
      );
    if (args[0] === 'mdns')
      return mdns ? 'adb-PRIMARY123-q _adb-tls-connect._tcp 192.168.1.2:37000' : '';
    if (args[0] === 'connect') {
      connected = true;
      return 'connected';
    }
    if (args[3] === 'getprop') {
      if (args[4] === 'ro.serialno')
        return args[1] === '192.168.1.3:37100' ? 'OTHER123' : 'PRIMARY123';
      if (args[4] === 'ro.kernel.qemu') return '0';
      if (args[4] === 'sys.boot_completed') return boot;
    }
    throw Error('Unexpected command ' + args.join(' '));
  };
  return { invoke, calls };
}
test('wireless primary retains installation root and stored USB identity', () => {
  const m = mock({ wireless: true, other: true });
  const r = primaryTransport(c, { invoke: m.invoke });
  assert.equal(r.serial, '192.168.1.2:37000');
  assert.equal(r.physicalSerial, 'PRIMARY123');
  assert.equal(r.workDir, c.workDir);
  assert.equal(c.serial, 'PRIMARY123');
  assert.equal(
    m.calls.some((a) => a[0] === 'connect'),
    false
  );
});
test('same resolver accepts a derived local Wi-Fi configuration only with saved physical identity', () => {
  const m = mock({ wireless: true });
  const r = primaryTransport(
    { ...c, serial: '192.168.1.8:37890', physicalSerial: 'PRIMARY123' },
    { invoke: m.invoke }
  );
  assert.equal(r.serial, '192.168.1.2:37000');
  assert.throws(() =>
    primaryTransport({ ...c, serial: '192.168.1.8:37890' }, { invoke: m.invoke })
  );
});
test('emulators do not cause queries, pairing or a primary substitution', () => {
  let calls = 0;
  const r = primaryTransport(
    { ...c, serial: 'emulator-5556' },
    {
      invoke: () => {
        calls++;
        throw Error('not expected');
      }
    }
  );
  assert.equal(calls, 0);
  assert.equal(r.serial, 'emulator-5556');
});
test('known primary reconnect uses its advertised TLS endpoint, then verifies physical identity', () => {
  const calls = [];
  let connected = false;
  const m = mock({ wireless: true });
  const invoke = (args) => {
    calls.push(args);
    if (args[0] === 'devices' && !connected) return '';
    if (args[0] === 'connect') {
      connected = true;
      return 'connected';
    }
    return m.invoke(args);
  };
  assert.equal(primaryTransport(c, { invoke }).serial, '192.168.1.2:37000');
  assert.deepEqual(
    calls.find((a) => a[0] === 'connect'),
    ['connect', '192.168.1.2:37000']
  );
  assert.ok(calls.every((a) => !['pair', 'tcpip', 'kill-server', 'disconnect'].includes(a[0])));
});
test('an unrelated authorized phone is never installed over the primary', () => {
  const m = mock({ wireless: true });
  const invoke = (args) =>
    args[4] === 'ro.serialno' ? 'OTHER123' : args[0] === 'mdns' ? '' : m.invoke(args);
  assert.throws(() => primaryTransport(c, { invoke }), /unavailable/);
});
test('read-only mode does not reconnect, and unbooted devices do not qualify', () => {
  const m = mock({ boot: '0' });
  assert.throws(() => primaryTransport(c, { invoke: m.invoke, reconnect: false }));
  assert.equal(
    m.calls.some((a) => a[0] === 'mdns' || a[0] === 'connect'),
    false
  );
});
test('failed ADB inventory is not downgraded to a successful no-phone result', () => {
  assert.throws(
    () =>
      primaryTransport(c, {
        invoke: () => {
          throw Error('ADB unavailable');
        }
      }),
    /ADB unavailable/
  );
});
