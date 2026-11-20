import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { suiteOptions, receiptName, assessDeviceStep } from '../scripts/device-suite-policy.mjs';
const runId = 'e8a80113-d62f-493d-8418-56c0ac959ace';
for (const target of ['phone', 'emulator-A', 'emulator-B']) {
  test('profile disk suite is available offline on ' + target, () => {
    const plan = suiteOptions([
      '--config',
      'station.local.json',
      '--target',
      target,
      '--suite',
      'profile'
    ]);
    assert.deepEqual(plan.modes, ['profile']);
    assert.equal(
      receiptName(runId, target, 'profile'),
      'device-' + target + '-profile-' + runId + '.json'
    );
  });
}
test('profile test cannot inherit a different app version receipt', () => {
  const expected = {
    runId,
    target: 'phone',
    mode: 'profile',
    start: 1000,
    end: 2000,
    version: 'new'
  };
  const receipt = {
    runId,
    target: 'phone',
    mode: 'profile',
    package: 'pro.neurofox.multimental.dev',
    status: 'passed',
    observedAt: new Date(1500).toISOString(),
    lab: { version: 'old' }
  };
  assert.equal(assessDeviceStep({ status: 0 }, receipt, expected), 'wrong_app_version');
});
test('persistent profile code does not replace legacy user files or change game rules', () => {
  const code = fs.readFileSync(
    fileURLToPath(new URL('../../../game/src/profile_store.gd', import.meta.url)),
    'utf8'
  );
  assert.ok(code.includes('file.flush()'));
  assert.ok(code.includes('WRITE_UNCERTAIN_REOPEN'));
  assert.equal(/DirAccess\.remove|OS\.|HTTP|JavaClassWrapper/.test(code), false);
});
