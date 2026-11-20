import test from 'node:test';
import assert from 'node:assert/strict';
import { tapTarget, suiteOptions, receiptName } from '../scripts/device-suite-policy.mjs';
const expected = () => ({ nonce: 'a'.repeat(48), stage: 'waiting_collection_save' });
const prompt = () => ({ ...expected(), status: 'running', tap: [400, 700] });
test('exact active tap target is copied', () => {
  const p = prompt(),
    r = tapTarget(p, expected());
  assert.deepEqual(r, [400, 700]);
  r[0] = 99;
  assert.equal(p.tap[0], 400);
});
for (const [name, mutate] of [
  ['wrong nonce', (p) => (p.nonce = 'b'.repeat(48))],
  ['old stage', (p) => (p.stage = 'waiting_collection_new')],
  ['completed success', (p) => (p.status = 'passed')],
  ['failed lab', (p) => (p.status = 'failed')],
  ['missing status', (p) => delete p.status],
  ['not an array', (p) => (p.tap = '400,700')],
  ['extra coordinate', (p) => p.tap.push(1)],
  ['negative', (p) => (p.tap[0] = -1)],
  ['too large', (p) => (p.tap[0] = 16385)],
  ['fractional', (p) => (p.tap[0] = 0.5)],
  ['nan', (p) => (p.tap[0] = NaN)],
  ['infinite', (p) => (p.tap[0] = Infinity)],
  ['string coordinate', (p) => (p.tap[0] = '400')],
  ['boolean coordinate', (p) => (p.tap[0] = true)]
])
  test('tap rejects ' + name, () => {
    const p = prompt();
    mutate(p);
    assert.throws(() => tapTarget(p, expected()));
  });
test('invalid expected identity cannot authorize a click', () => {
  assert.throws(() => tapTarget(prompt(), { nonce: '', stage: 'waiting_collection_save' }));
  assert.throws(() => tapTarget(prompt(), { nonce: 'a'.repeat(48), stage: '; execute' }));
});
test('new collection suite is explicit and bounded', () => {
  const r = suiteOptions([
    '--config',
    'local-config.json',
    '--target',
    'phone',
    '--suite',
    'collection'
  ]);
  assert.deepEqual(r.modes, ['collection']);
  assert.match(
    receiptName('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'phone', 'collection'),
    /collection/
  );
});
test('unknown collection spelling is not substituted by UI smoke', () =>
  assert.throws(() => suiteOptions(['--config', 'x', '--suite', 'collections'])));
