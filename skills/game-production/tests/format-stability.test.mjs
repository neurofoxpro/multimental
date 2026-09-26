import test from 'node:test';
import assert from 'node:assert/strict';
import * as prettier from 'prettier';
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
test('real chained map/object regression is stable after preparation', async () => {
  const text =
    "const history = comments.slice(-3).map(c => ({id:c.id,author:c.user?.login,updatedAt:c.updated_at,excerpt:String(c.body||'').slice(0,1200),truncated:String(c.body||'').length>1200}));";
  const options = { parser: 'babel', singleQuote: true, printWidth: 90 };
  const result = await stableFormat(text, options);
  assert.equal(await prettier.format(result, options), result);
  assert.equal(await stableFormat(result, options), result);
});
