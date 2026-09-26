import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { adbPhysicalRows, selectSecond, signingDirectory } from '../scripts/fleet-policy.mjs';
import { probeOptions } from '../scripts/phone-fleet.mjs';
const rows = () => [
  { serial: 'PHONE-A', state: 'device' },
  { serial: 'PHONE-B', state: 'device' }
];
test('physical inventory excludes emulators and wireless addresses', () =>
  assert.deepEqual(
    adbPhysicalRows(
      'List of devices attached\nPHONE-A device product:x model:y\nemulator-5554 device\n192.168.1.2:5555 device\nPHONE-B unauthorized\n'
    ),
    [
      { serial: 'PHONE-A', state: 'device' },
      { serial: 'PHONE-B', state: 'unauthorized' }
    ]
  ));
test('duplicate ADB identity fails closed', () =>
  assert.throws(() => adbPhysicalRows('PHONE-A device\nPHONE-A offline')));
test('oversized inventory rejected', () => assert.throws(() => adbPhysicalRows('a'.repeat(65537))));
test('one explicitly additional device is selected', () =>
  assert.equal(selectSecond(rows(), 'PHONE-A'), 'PHONE-B'));
test('enumeration order does not swap primary and secondary', () =>
  assert.equal(selectSecond(rows().reverse(), 'PHONE-A'), 'PHONE-B'));
test('known binding is never silently replaced', () =>
  assert.throws(() => selectSecond(rows(), 'PHONE-A', 'PHONE-C')));
test('extra phone makes first-time selection ambiguous', () =>
  assert.throws(() =>
    selectSecond([...rows(), { serial: 'PHONE-C', state: 'device' }], 'PHONE-A')
  ));
test('existing binding survives extra unrelated device without selecting it', () =>
  assert.equal(
    selectSecond([...rows(), { serial: 'PHONE-C', state: 'device' }], 'PHONE-A', 'PHONE-B'),
    'PHONE-B'
  ));
for (const state of ['unauthorized', 'offline'])
  test('secondary ' + state + ' is not usable', () => {
    const r = rows();
    r[1].state = state;
    assert.throws(() => selectSecond(r, 'PHONE-A'));
  });
test('primary missing blocks writes', () =>
  assert.throws(() => selectSecond(rows().slice(1), 'PHONE-A')));
test('self pairing is rejected', () =>
  assert.throws(() => selectSecond(rows(), 'PHONE-A', 'PHONE-A')));
test('normal signing path remains per-work-directory', () =>
  assert.equal(
    signingDirectory({ workDir: path.resolve('work/installations') }),
    path.resolve('work/installations/private-signing')
  ));
test('shared signing proposal is exact adjacent existing identity only', () =>
  assert.equal(
    signingDirectory({
      workDir: path.resolve('work/installations/secondary'),
      sharedSigningDirectory: path.resolve('work/installations/private-signing'),
      expectedCertificate: 'a'.repeat(64)
    }),
    path.resolve('work/installations/private-signing')
  ));
for (const bad of [
  { workDir: path.resolve('work/other') },
  { sharedSigningDirectory: path.resolve('other/private-signing') },
  { expectedCertificate: '' }
])
  test('rejects forged shared-signing proposal ' + JSON.stringify(bad), () =>
    assert.throws(() =>
      signingDirectory({
        workDir: path.resolve('work/installations/secondary'),
        sharedSigningDirectory: path.resolve('work/installations/private-signing'),
        expectedCertificate: 'a'.repeat(64),
        ...bad
      })
    )
  );
test('live fleet only allows read-only probe', () => {
  assert.equal(probeOptions([]), 'probe');
  assert.equal(probeOptions(['probe']), 'probe');
});
for (const action of ['bind', 'deliver', 'test', 'delete', 'uninstall'])
  test('undeployed mutation blocked: ' + action, () => assert.throws(() => probeOptions([action])));
