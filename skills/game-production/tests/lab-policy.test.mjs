import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adbRows,
  describeDevice,
  publicInventory,
  selectLabTarget,
  primaryTlsCandidates,
  labOptions,
  canReuseSuite,
  restoreManual
} from '../scripts/lab-policy.mjs';
const facts = { serial: 'PRIMARY123', qemu: '', boot: '1', model: 'phone' };
const phone = (serial = '192.168.1.2:37890', kind = 'wifi') =>
  describeDevice({ serial, kind, state: 'device' }, facts, 'PRIMARY123');
const emulator = (slot) =>
  describeDevice(
    { serial: slot === 'A' ? 'emulator-5554' : 'emulator-5556', state: 'device', kind: 'emulator' },
    { qemu: '1', avd: 'Multimental_Test_' + slot, boot: '1', model: 'AVD' },
    'PRIMARY123'
  );
test('USB and TLS transports of the same physical phone count once', () => {
  const rows = [phone('PRIMARY123', 'usb'), phone()];
  const pub = publicInventory(rows);
  assert.equal(pub.physicalDevices, 1);
  assert.equal(pub.devices.length, 1);
  assert.deepEqual(pub.devices[0].transports, ['usb', 'wifi']);
  assert.equal(JSON.stringify(pub).includes('PRIMARY123'), false);
  assert.equal(selectLabTarget(rows, 'phone').serial, '192.168.1.2:37890');
});
test('software testing defaults to emulator even with a ready personal phone', () => {
  const r = selectLabTarget([phone()]);
  assert.equal(r.target, 'emulator-A');
  assert.equal(r.boot, true);
});
test('availability preference falls back while explicit phone never substitutes', () => {
  assert.equal(selectLabTarget([], 'available').target, 'emulator-A');
  assert.throws(() => selectLabTarget([], 'phone'));
  assert.equal(selectLabTarget([phone()], 'available').target, 'phone');
});
test('offline occupied AVD is preserved while the other assigned slot is used', () => {
  const rows = adbRows('emulator-5554 offline');
  assert.equal(selectLabTarget(rows).target, 'emulator-B');
  assert.throws(() => selectLabTarget(rows, 'emulator-A'));
});
test('already booted assigned emulator reuses the exact instance', () => {
  const r = selectLabTarget([emulator('B')]);
  assert.equal(r.target, 'emulator-B');
  assert.equal(r.boot, false);
});
test('unrecognized virtual machine is not an approved target', () => {
  const r = describeDevice(
    { serial: 'emulator-5554', kind: 'emulator', state: 'device' },
    { qemu: '1', avd: 'Personal_AVD', boot: '1' },
    'PRIMARY123'
  );
  assert.equal(r.ready, false);
  assert.equal(selectLabTarget([r]).target, 'emulator-B');
});
test('physical matching never relies on model or endpoint alone', () => {
  const r = describeDevice(
    { serial: '192.168.1.3:37890', kind: 'wifi', state: 'device' },
    { ...facts, serial: 'OTHER123' },
    'PRIMARY123'
  );
  assert.equal(r.primaryMatch, false);
  assert.throws(() => selectLabTarget([r], 'phone'));
});
test('ADB device state alone is not boot completion', () => {
  const r = describeDevice(
    { serial: 'PRIMARY123', kind: 'usb', state: 'device' },
    { ...facts, boot: '0' },
    'PRIMARY123'
  );
  assert.equal(r.ready, false);
});
test('duplicate rows, shell metacharacters and oversized inventories rejected', () => {
  for (const input of ['aa device\naa device', 'a;sh device', 'x'.repeat(65537)])
    assert.throws(() => adbRows(input));
  assert.equal(
    adbRows('List of devices attached\nPRIMARY123 device model:X\nemulator-5554 offline').length,
    2
  );
});
test('only known-primary private TLS-connect services are reconnect candidates', () => {
  const text = [
    'adb-PRIMARY123-a _adb-tls-connect._tcp 192.168.1.2:37000',
    'adb-OTHER123-a _adb-tls-connect._tcp 192.168.1.3:37000',
    'adb-PRIMARY123-p _adb-tls-pairing._tcp 192.168.1.2:38000',
    'adb-PRIMARY123-b _adb-tls-connect._tcp 8.8.8.8:37000',
    'adb-PRIMARY123-c _adb-tls-connect._tcp 127.0.0.1:37000'
  ].join('\n');
  assert.deepEqual(primaryTlsCandidates(text, 'PRIMARY123'), ['192.168.1.2:37000']);
});
test('unbounded or malformed TLS endpoint set is not contacted', () => {
  assert.deepEqual(
    primaryTlsCandidates('adb-PRIMARY123-a _adb-tls-connect._tcp 192.168.1.2:99999', 'PRIMARY123'),
    []
  );
  assert.throws(() => primaryTlsCandidates('x', ''));
});
for (const args of [
  ['test', '--target', 'unknown'],
  ['test', '--commit', 'dev'],
  ['test', '--suite', 'bluetooth'],
  ['test', '--target', 'phone', '--target', 'auto'],
  ['deliver', '--target', 'emulator-A'],
  ['probe', '--force'],
  ['resume', 'anything']
])
  test('invalid lab request ' + args.join(' '), () => assert.throws(() => labOptions(args)));
test('known default and pinned test options', () => {
  assert.deepEqual(labOptions(['test']), {
    mode: 'test',
    target: 'auto',
    suite: 'handoff',
    commit: null
  });
  assert.equal(
    labOptions(['test', '--target', 'phone', '--commit', 'a'.repeat(40)]).target,
    'phone'
  );
});
test('suite reuse requires same source, actual APK and intact individual receipts', () => {
  const actual = { version: 'x' },
    h = 'a'.repeat(64),
    record = {
      status: 'passed',
      sourceHash: h,
      installation: actual,
      proofs: [{ path: '.gameprod/evidence/real.json', sha256: h }]
    };
  assert.equal(
    canReuseSuite(record, actual, h, () => h),
    true
  );
  assert.equal(
    canReuseSuite(record, { version: 'y' }, h, () => h),
    false
  );
  assert.equal(
    canReuseSuite(record, actual, h, () => null),
    false
  );
  assert.equal(
    canReuseSuite(record, actual, 'b'.repeat(64), () => h),
    false
  );
});
test('normal handoff checks request and profile before and after cold restart', async () => {
  const order = [],
    profiles = ['a'.repeat(64), null];
  const result = await restoreManual({
    requestExists: async () => {
      order.push('request');
      return false;
    },
    snapshot: async () => {
      order.push('snapshot');
      return profiles;
    },
    stop: async () => {
      order.push('stop');
    },
    launch: async () => {
      order.push('launch');
      return { ready: true };
    },
    foreground: async () => {
      order.push('foreground');
      return true;
    }
  });
  assert.deepEqual(order, [
    'request',
    'snapshot',
    'stop',
    'launch',
    'request',
    'snapshot',
    'foreground'
  ]);
  assert.equal(result.deletedData, false);
});
test('pending request is never erased or restarted', async () => {
  let stopped = false;
  await assert.rejects(
    restoreManual({
      requestExists: async () => true,
      stop: async () => {
        stopped = true;
      }
    })
  );
  assert.equal(stopped, false);
});
test('handoff fails on changed profile or missing foreground', async () => {
  let reads = 0;
  const a = {
    requestExists: async () => false,
    snapshot: async () => [++reads === 1 ? 'a'.repeat(64) : 'b'.repeat(64), null],
    stop: async () => {},
    launch: async () => ({}),
    foreground: async () => true
  };
  await assert.rejects(restoreManual(a), /profile changed/);
  await assert.rejects(
    restoreManual({ ...a, snapshot: async () => [null, null], foreground: async () => false }),
    /not foreground/
  );
});

import { suiteOptions, receiptName } from '../scripts/device-suite-policy.mjs';
test('handoff stays within one suite and restore is last and unique', () => {
  const p = suiteOptions([
    '--config',
    'local.json',
    '--target',
    'emulator-B',
    '--suite',
    'handoff',
    '--finish',
    'normal'
  ]);
  assert.equal(p.modes.at(-1), 'restore');
  assert.equal(p.modes.filter((m) => m === 'restore').length, 1);
  assert.equal(new Set(p.modes).size, p.modes.length);
  assert.match(
    receiptName('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'emulator-B', 'restore'),
    /restore/
  );
});
test('optional normal finish preserves old suite behavior and appends restore only when requested', () => {
  assert.deepEqual(suiteOptions(['--config', 'x', '--suite', 'ui']).modes, ['ui']);
  assert.deepEqual(suiteOptions(['--config', 'x', '--suite', 'ui', '--finish', 'normal']).modes, [
    'ui',
    'restore'
  ]);
  assert.throws(() => suiteOptions(['--config', 'x', '--finish', 'delete']));
});

import { adbLines } from '../scripts/android-text.mjs';
test('actual Windows ADB CRCRLF output recognizes an already booted virtual device', () => {
  const avd = adbLines('Multimental_Test_B\r\r\nOK\r\r\n').find((s) => s !== 'OK');
  const row = describeDevice(
    { serial: 'emulator-5556', state: 'device', kind: 'emulator' },
    { qemu: '1', boot: '1', avd, model: 'AVD' },
    'PRIMARY123'
  );
  assert.equal(row.ready, true);
  assert.equal(selectLabTarget([row]).target, 'emulator-B');
  assert.equal(publicInventory([row]).devices.length, 1);
});

import { LAB_SUITES } from '../scripts/lab-policy.mjs';
test('every advertised software suite has a runnable device-suite route', () => {
  for (const suite of LAB_SUITES) {
    const p = suiteOptions([
      '--config',
      'x',
      '--target',
      'emulator-A',
      '--suite',
      suite,
      '--finish',
      'normal'
    ]);
    assert.equal(p.suite, suite);
    assert.equal(p.modes.at(-1), 'restore');
  }
});
