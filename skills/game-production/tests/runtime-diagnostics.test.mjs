import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeSucceeded } from '../../../tools/runtime-diagnostics.mjs';
const M = 'MULTIMENTAL_MENU_LAYOUT_PASS';
test('accepts clean marked zero-exit run', () =>
  assert.equal(runtimeSucceeded(0, M + ' checks=233\r\n', M), true));
let negativeCase = 0;
for (const text of [
  'ERROR: failed\n' + M,
  M + '\nERROR: deferred invalid object',
  'SCRIPT ERROR: bad\n' + M,
  'Parse Error: missing\n' + M,
  'MENU_LAYOUT_FAIL bounds\n' + M,
  'PROFILE_FAILED 1\n' + M,
  'echo ' + M,
  M + '_OTHER',
  '',
  M + 'ed'
])
  test('rejects negative runtime fixture ' + ++negativeCase, () =>
    assert.equal(runtimeSucceeded(0, text, M), false)
  );
test('nonzero or absent exit cannot be green', () => {
  assert.equal(runtimeSucceeded(1, M, M), false);
  assert.equal(runtimeSucceeded(null, M, M), false);
});
test('rejects malformed marker', () => assert.equal(runtimeSucceeded(0, 'anything', '.*'), false));
