import test from 'node:test';
import assert from 'node:assert/strict';
import { uiLabSpec, assertUiLab } from '../scripts/ui-lab-spec.mjs';
import { suiteOptions, receiptName } from '../scripts/device-suite-policy.mjs';
function report(mode) {
  const s = uiLabSpec(mode);
  return {
    status: 'passed',
    test: s.test,
    input_source: 'external_android_input_tap',
    personal_profile_untouched: true,
    checks: s.stages.map((name) => ({ name, ok: true }))
  };
}
for (const mode of ['collection', 'shop', 'crafting', 'inspector', 'rewards'])
  test('strict physical contract ' + mode, () => {
    assert.equal(assertUiLab(report(mode), mode), true);
    const s = uiLabSpec(mode);
    s.stages.length = 0;
    assert.ok(uiLabSpec(mode).stages.length);
  });
for (const [name, change] of [
  ['false check', (r) => (r.checks[0].ok = false)],
  ['missing stage', (r) => r.checks.shift()],
  ['duplicate stage', (r) => r.checks.push(r.checks[0])],
  ['wrong test', (r) => (r.test = 'other')],
  ['simulated input', (r) => (r.input_source = 'fake')],
  ['modified personal profile', (r) => (r.personal_profile_untouched = false)],
  ['no checks', (r) => (r.checks = [])],
  ['failed overall', (r) => (r.status = 'failed')]
])
  test('rejects ' + name, () => {
    const r = report('crafting');
    change(r);
    assert.throws(() => assertUiLab(r, 'crafting'));
  });
test('unknown names never inherit a fixture', () => {
  assert.equal(uiLabSpec('__proto__'), null);
  assert.equal(uiLabSpec('unknown'), null);
  assert.throws(() => assertUiLab({}, 'unknown'));
});
test('crafting uses explicit unique device receipt', () => {
  assert.deepEqual(
    suiteOptions(['--config', 'local.json', '--target', 'phone', '--suite', 'crafting']).modes,
    ['crafting']
  );
  assert.match(
    receiptName('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'phone', 'crafting'),
    /crafting/
  );
});
