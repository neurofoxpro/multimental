import test from 'node:test';
import assert from 'node:assert/strict';
import { testFailureSummary } from '../../../tools/test-failure-summary.mjs';
test('middle-of-log import failure remains visible ahead of successful tail', () => {
  const text =
    'ok 1 - before\n'.repeat(3000) +
    "# Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'prettier'\nnot ok 22 - missing test\n  error: 'test failed'\n" +
    'ok 30 - later\n'.repeat(3000) +
    '# tests 99\n# pass 98\n# fail 1\n';
  const result = testFailureSummary(text);
  assert.ok(result.includes('Cannot find package'));
  assert.ok(result.includes('not ok 22'));
  assert.ok(result.includes('# fail 1'));
  assert.ok(result.length <= 12000);
});
test('failure excerpts remain bounded even with thousands of failures', () => {
  assert.ok(testFailureSummary('not ok repeated\n'.repeat(4000), 1024).length <= 1024);
});
test('missing marker and crash fallback preserve readable tail', () => {
  assert.ok(testFailureSummary('process stopped without marker').includes('without marker'));
});
test('bad summary inputs never become false success', () => {
  for (const limit of [0, 100, NaN, 1e9]) assert.throws(() => testFailureSummary('test', limit));
  assert.throws(() => testFailureSummary(null));
});
