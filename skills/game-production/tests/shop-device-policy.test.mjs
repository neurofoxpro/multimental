import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suiteOptions,
  receiptName,
  assessDeviceStep,
  tapTarget
} from '../scripts/device-suite-policy.mjs';
const id = '72f18320-1ad9-4b20-95e7-6fb00a0df3e9';
const nonce = 'a'.repeat(48);
test('shop is an explicit isolated single-mode suite', () => {
  const options = suiteOptions([
    '--config',
    'station.local.json',
    '--target',
    'phone',
    '--suite',
    'shop'
  ]);
  assert.deepEqual(options.modes, ['shop']);
  assert.equal(receiptName(id, 'phone', 'shop'), 'device-phone-shop-' + id + '.json');
});
test('shop tap sequence retains exact stage/nonce validation', () => {
  const expected = { nonce, stage: 'waiting_shop_buy' };
  assert.deepEqual(
    tapTarget({ ...expected, status: 'running', tap: [10, 20] }, expected),
    [10, 20]
  );
  assert.throws(() => tapTarget({ ...expected, status: 'passed', tap: [10, 20] }, expected));
  assert.throws(() =>
    tapTarget({ ...expected, nonce: 'b'.repeat(48), status: 'running', tap: [10, 20] }, expected)
  );
});
test('old or different shop APK cannot supply passing receipt', () => {
  const start = Date.parse('2026-09-26T04:00:00Z');
  const expected = {
    runId: id,
    target: 'phone',
    mode: 'shop',
    version: '0.9.0-alpha.1',
    start,
    end: start + 1000
  };
  const receipt = {
    status: 'passed',
    runId: id,
    target: 'phone',
    mode: 'shop',
    package: 'pro.neurofox.multimental.dev',
    observedAt: new Date(start).toISOString(),
    lab: { version: '0.8.0-alpha.1' }
  };
  assert.equal(assessDeviceStep({ status: 0 }, receipt, expected), 'wrong_app_version');
});
