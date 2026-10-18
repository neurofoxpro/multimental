import assert from 'node:assert/strict';
import * as prettier from 'prettier';
import { stableFormat } from './format-stability.mjs';
const text =
  "const history = comments.slice(-3).map(c => ({id:c.id,author:c.user?.login,updatedAt:c.updated_at,excerpt:String(c.body||'').slice(0,1200),truncated:String(c.body||'').length>1200}));";
const options = { parser: 'babel', singleQuote: true, printWidth: 90 };
const result = await stableFormat(text, options, { format: prettier.format });
assert.equal(await prettier.format(result, options), result);
assert.equal(await stableFormat(result, options, { format: prettier.format }), result);
console.log('FORMAT_INTEGRATION_PASS actual_locked_prettier=true');
