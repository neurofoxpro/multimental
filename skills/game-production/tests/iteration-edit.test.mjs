import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentEdit } from '../scripts/apply.mjs';
const hash = 'a'.repeat(64);
const base = () => ({ exists: true, tracked: true, dirty: false, actualHash: hash });
test('clean tracked source preserves old edit contract', () => {
  assert.equal(assertCurrentEdit(base()), true);
});
test('new absent file preserves old create contract', () => {
  assert.equal(
    assertCurrentEdit({ exists: false, tracked: false, dirty: false, actualHash: null }),
    true
  );
});
test('untracked source remains denied without exact current hash', () => {
  assert.throws(() => assertCurrentEdit({ ...base(), tracked: false }));
});
test('dirty tracked source remains denied without exact current hash', () => {
  assert.throws(() => assertCurrentEdit({ ...base(), dirty: true }));
});
test('known draft can be iterated without intermediate Git commit', () => {
  assert.equal(assertCurrentEdit({ ...base(), tracked: false, expectedCurrentSha256: hash }), true);
});
test('known dirty source uses compare-and-swap semantics', () => {
  assert.equal(assertCurrentEdit({ ...base(), dirty: true, expectedCurrentSha256: hash }), true);
});
for (const value of ['b'.repeat(64), '', null, 'a'.repeat(63), true, '__proto__'])
  test('rejects incorrect current hash ' + String(value), () => {
    assert.throws(() => assertCurrentEdit({ ...base(), expectedCurrentSha256: value }));
  });
test('observed file removed before edit remains a conflict', () => {
  assert.throws(() =>
    assertCurrentEdit({
      exists: false,
      tracked: false,
      dirty: false,
      actualHash: null,
      expectedCurrentSha256: hash
    })
  );
});
