import test from 'node:test';
import assert from 'node:assert/strict';
import { uiLabSpec, assertUiLab } from '../scripts/ui-lab-spec.mjs';
import { suiteOptions, receiptName } from '../scripts/device-suite-policy.mjs';
const good = () => ({
  test: 'real_card_inspector',
  status: 'passed',
  input_source: 'external_android_input_tap',
  personal_profile_untouched: true,
  checks: uiLabSpec('inspector').stages.map((name) => ({ name, ok: true }))
});
test('inspector has its own six explicit taps and cannot be mistaken for crafting', () => {
  assert.equal(uiLabSpec('inspector').stages.length, 6);
  assert.deepEqual(
    suiteOptions(['--config', 'local.json', '--target', 'phone', '--suite', 'inspector']).modes,
    ['inspector']
  );
  assert.match(
    receiptName('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'phone', 'inspector'),
    /inspector/
  );
  assert.equal(assertUiLab(good(), 'inspector'), true);
  assert.throws(() => assertUiLab(good(), 'crafting'));
});
for (const stage of uiLabSpec('inspector').stages)
  test('cannot omit actual stage ' + stage, () => {
    const proof = good();
    proof.checks = proof.checks.filter((c) => c.name !== stage);
    assert.throws(() => assertUiLab(proof, 'inspector'));
  });
test('inspector cannot claim success with a modified profile or simulated input', () => {
  let p = good();
  p.personal_profile_untouched = false;
  assert.throws(() => assertUiLab(p, 'inspector'));
  p = good();
  p.input_source = 'headless_signals';
  assert.throws(() => assertUiLab(p, 'inspector'));
});
