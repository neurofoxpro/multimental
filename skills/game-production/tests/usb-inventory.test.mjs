import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsb } from '../scripts/usb-inventory-policy.mjs';
import { probeOptions } from '../scripts/phone-fleet.mjs';
const fixture = () => ({
  schemaVersion: 1,
  scope: 'present-windows-usb-interfaces',
  identifiersRedacted: true,
  readOnly: true,
  groupingUnavailable: 0,
  interfaces: [
    { group: 'usb-group-1', interface: 'ADB', status: 'OK' },
    { group: 'usb-group-1', interface: 'MTP', status: 'OK' }
  ]
});
test('two interfaces of one container are not two authorized phones', () => {
  const r = summarizeUsb(fixture(), ['device']);
  assert.equal(r.containerGroups.length, 1);
  assert.equal(r.adbUsb.ready, 1);
  assert.equal(r.secondPhoneConfirmed, false);
});
test('output cannot leak extra instance identifiers', () => {
  const f = fixture();
  f.interfaces[0].instanceId = 'private-serial';
  f.secret = 'private';
  assert.equal(JSON.stringify(summarizeUsb(f, ['device'])).includes('private'), false);
});
test('permission failures and absent devices remain explicit', () => {
  const f = fixture();
  f.interfaces = [];
  f.groupingUnavailable = 2;
  const r = summarizeUsb(f, ['device', 'unauthorized']);
  assert.equal(r.groupingUnavailable, 2);
  assert.equal(r.adbUsb.unauthorized, 1);
  assert.equal(r.secondPhoneConfirmed, false);
});
for (const [name, change] of [
  ['nonreadonly', (f) => (f.readOnly = false)],
  ['wrong scope', (f) => (f.scope = 'all-devices')],
  ['unknown type', (f) => (f.interfaces[0].interface = 'execute')],
  ['private group', (f) => (f.interfaces[0].group = 'private-serial')],
  ['missing array', (f) => delete f.interfaces],
  ['oversized', (f) => (f.interfaces = Array(65).fill(f.interfaces[0]))],
  ['invalid count', (f) => (f.groupingUnavailable = -1)]
])
  test('rejects ' + name, () => {
    const f = fixture();
    change(f);
    assert.throws(() => summarizeUsb(f, []));
  });
test('fleet CLI remains read-only with explicit mode', () => {
  assert.equal(probeOptions(['usb']), 'usb');
  assert.equal(probeOptions([]), 'probe');
  assert.throws(() => probeOptions(['bind']));
  assert.throws(() => probeOptions(['usb', '--execute']));
});
