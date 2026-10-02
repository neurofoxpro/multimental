import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suiteOptions,
  receiptName,
  assessDeviceStep,
  installationIdentity,
  completeSuite,
  PACKAGE
} from '../scripts/device-suite-policy.mjs';
const ID = '12345678-1234-4123-8123-123456789abc';
const now = Date.parse('2026-09-26T00:00:00Z');
const expected = () => ({
  runId: ID,
  target: 'phone',
  mode: 'ui',
  start: now,
  end: now + 4000,
  version: '0.5.1-alpha.128.1'
});
const receipt = () => ({
  runId: ID,
  target: 'phone',
  mode: 'ui',
  package: PACKAGE,
  status: 'passed',
  observedAt: new Date(now + 1000).toISOString(),
  lab: { version: '0.5.1-alpha.128.1' }
});
const evaluate = (r, p = { status: 0 }) => assessDeviceStep(p, r, expected());
test('strict options retain documented default suite', () =>
  assert.deepEqual(suiteOptions(['--config', 'station.local.json']), {
    config: 'station.local.json',
    target: 'emulator-A',
    suite: 'ui',
    modes: ['ui']
  }));
test('smoke ends in normal UI check and requires no radio', () =>
  assert.deepEqual(suiteOptions(['--config', 'c', '--suite', 'smoke', '--target', 'phone']).modes, [
    'close',
    'launch',
    'jni',
    'tutorial',
    'ui'
  ]));
for (const args of [
  [],
  ['--config'],
  ['--config', 'c', '--suite', 'typo'],
  ['--config', 'c', '--target', 'unknown'],
  ['--config', 'c', '--suite', 'hardware'],
  ['--config', 'c', '--suite', 'bluetooth'],
  ['--config', 'c', '--suite', 'ui', '--suite', 'ui'],
  ['--config', 'c', '--unexpected', 'x'],
  ['--config', 'c', '--suite'],
  ['--config', '--suite']
])
  test('reject invalid arguments ' + JSON.stringify(args), () =>
    assert.throws(() => suiteOptions(args))
  );
for (const suite of ['usb', 'bluetooth', 'hardware'])
  test('explicit radio suite ' + suite, () =>
    assert.ok(
      suiteOptions(['--config', 'c', '--target', 'phone', '--suite', suite]).modes.length > 0
    )
  );
test('unique step receipt binds run target mode', () =>
  assert.equal(receiptName(ID, 'phone', 'ui'), 'device-phone-ui-' + ID + '.json'));
for (const args of [
  ['../x', 'phone', 'ui'],
  [ID, '../phone', 'ui'],
  [ID, 'phone', '../ui'],
  ['', 'phone', 'ui']
])
  test('reject unsafe receipt identity ' + args.join(':'), () =>
    assert.throws(() => receiptName(...args))
  );
test('current successful evidence passes', () => assert.equal(evaluate(receipt()), 'passed'));
for (const [key, value] of [
  ['runId', '87654321-1234-4123-8123-123456789abc'],
  ['target', 'emulator-A'],
  ['mode', 'close'],
  ['package', 'other.dev'],
  ['status', 'failed'],
  ['observedAt', 'nonsense'],
  ['observedAt', new Date(now - 60000).toISOString()],
  ['observedAt', new Date(now + 60000).toISOString()]
])
  test('reject receipt mismatch ' + key + '=' + value, () =>
    assert.notEqual(evaluate({ ...receipt(), [key]: value }), 'passed')
  );
for (const process of [
  { status: 1 },
  { status: null },
  { status: 0, error: Error('timeout') },
  { status: 0, signal: 'SIGTERM' }
])
  test('exit and signal override forged passing receipt ' + JSON.stringify(process), () =>
    assert.equal(evaluate({ ...receipt(), exitCode: 0 }, process), 'process_failed')
  );
test('missing output cannot reuse an old passing file', () =>
  assert.notEqual(evaluate(null), 'passed'));
test('another app version fails', () =>
  assert.equal(evaluate({ ...receipt(), lab: { version: 'old' } }), 'wrong_app_version'));
const installation = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  package: PACKAGE,
  readyMarker: true,
  sourceCommit: 'a'.repeat(40),
  originalSha256: 'b'.repeat(64),
  installedSha256: 'c'.repeat(64),
  certificateSha256: 'd'.repeat(64),
  version: '0.5.1-alpha.128.1',
  versionCode: 22801
});
const observed = () => ({
  version: '0.5.1-alpha.128.1',
  versionCode: 22801,
  apkSha256: 'c'.repeat(64)
});
test('bind actual APK bytes to source and signing receipt without device ID', () => {
  const r = installationIdentity(
    { ...installation(), serial: 'private', password: 'private' },
    observed()
  );
  assert.equal(r.sourceCommit, 'a'.repeat(40));
  assert.equal('serial' in r, false);
  assert.equal('password' in r, false);
});
for (const [key, value] of [
  ['repository', 'wrong/repo'],
  ['package', 'production'],
  ['readyMarker', false],
  ['sourceCommit', 'dev'],
  ['installedSha256', ''],
  ['certificateSha256', ''],
  ['originalSha256', ''],
  ['versionCode', 1.5],
  ['versionCode', -1],
  ['version', '']
])
  test('reject invalid installation ' + key + '=' + value, () =>
    assert.throws(() => installationIdentity({ ...installation(), [key]: value }, observed()))
  );
for (const [key, value] of [
  ['version', 'old'],
  ['versionCode', 22802],
  ['apkSha256', 'e'.repeat(64)]
])
  test('same name is not proof of actual artifact ' + key, () =>
    assert.throws(() => installationIdentity(installation(), { ...observed(), [key]: value }))
  );
const rows = () => [
  { mode: 'close', status: 'passed', exitCode: 0 },
  { mode: 'launch', status: 'passed', exitCode: 0 }
];
const digest = 'e'.repeat(64);
const complete = (r, b = installation(), a = installation(), d = digest) =>
  completeSuite(r, ['close', 'launch'], b, a, digest, d);
test('all declared steps and identities required', () => assert.equal(complete(rows()), true));
test('empty suite never passes', () =>
  assert.equal(completeSuite([], [], {}, {}, digest, digest), false));
test('missing final step fails', () => assert.equal(complete(rows().slice(0, 1)), false));
test('duplicated old step fails', () => assert.equal(complete([rows()[0], rows()[0]]), false));
test('unexpected extra step fails', () => assert.equal(complete([...rows(), rows()[0]]), false));
test('failed process cannot be hidden by report status', () =>
  assert.equal(complete([{ ...rows()[0], exitCode: 1 }, rows()[1]]), false));
test('changed installation prevents qualification', () =>
  assert.equal(
    complete(rows(), installation(), { ...installation(), installedSha256: 'f'.repeat(64) }),
    false
  ));
test('source mutation during suite prevents qualification', () =>
  assert.equal(complete(rows(), installation(), installation(), 'f'.repeat(64)), false));
test('missing after-snapshot fails', () =>
  assert.equal(complete(rows(), installation(), null), false));
