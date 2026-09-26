import test from 'node:test';
import assert from 'node:assert/strict';
import { stableFormat } from '../../../tools/format-stability.mjs';
test('already formatted input needs only one confirmation', async () => {
  let calls = 0;
  assert.equal(
    await stableFormat(
      'a',
      {},
      {
        format: async (s) => {
          calls++;
          return s;
        }
      }
    ),
    'a'
  );
  assert.equal(calls, 1);
});
test('two-changing-pass formatter reaches a verified fixed point', async () => {
  let calls = 0;
  const format = async (s) => {
    calls++;
    return s === 'a' ? 'b' : 'c';
  };
  assert.equal(await stableFormat('a', {}, { format }), 'c');
  assert.equal(calls, 3);
});
test('oscillation is an error, never a falsely formatted file', async () => {
  await assert.rejects(
    stableFormat('a', {}, { format: async (s) => (s === 'a' ? 'b' : 'a') }),
    /OSCILLATION/
  );
});
test('non-convergence is bounded', async () => {
  let calls = 0;
  await assert.rejects(
    stableFormat(
      'a',
      {},
      {
        maxPasses: 3,
        format: async (s) => {
          calls++;
          return s + '!';
        }
      }
    ),
    /DID_NOT_CONVERGE/
  );
  assert.equal(calls, 3);
});
test('bad formatter output and unbounded options are rejected', async () => {
  await assert.rejects(stableFormat('a', {}, { format: async () => null }), /INVALID_OUTPUT/);
  await assert.rejects(stableFormat('a', {}, { maxPasses: 999 }), /STABILITY_INPUT/);
});
