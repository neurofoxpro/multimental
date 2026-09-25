import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertScope, validateBundle, REPOSITORY, BRANCH } from '../../../scripts/reconcile-projections.mjs';
const env = () => ({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_ACTOR: '4erk',
  GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/' + BRANCH, GITHUB_SHA: 'a'.repeat(40) });
const bundle = () => ({ schemaVersion: 1, repository: REPOSITORY, branch: BRANCH, source: 'a'.repeat(40),
  files: [{ path: 'docs/ROADMAP.ru.md', content: 'ok', sha256: crypto.createHash('sha256').update('ok').digest('hex') }] });
test('reconciliation accepts only explicitly scoped owner push', () => { assert.doesNotThrow(() => assertScope(env())); });
for (const [key, value] of [['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REPOSITORY', 'other/repo'],
  ['GITHUB_REF', 'refs/heads/main'], ['GITHUB_REF', 'refs/heads/dev'], ['GITHUB_ACTOR', 'outsider'], ['GITHUB_SHA', 'bad']]) {
  test('reconciliation denies ' + key + '=' + value, () => { const e = env(); e[key] = value; assert.throws(() => assertScope(e)); });
}
test('projection bundle validates exact source and file hash', () => {
  assert.equal(validateBundle(bundle(), 'a'.repeat(40)).files.length, 1);
  assert.throws(() => validateBundle(bundle(), 'b'.repeat(40)));
});
for (const file of ['.github/workflows/build.yml', 'game/src/main.gd', '../secrets', 'C:\\key', '.env']) {
  test('projection writer cannot change ' + file, () => { const b = bundle(); b.files[0].path = file; assert.throws(() => validateBundle(b, b.source)); });
}
test('projection bundle rejects tampering, duplicates and excessive size', () => {
  let b = bundle(); b.files[0].content = 'tampered'; assert.throws(() => validateBundle(b, b.source));
  b = bundle(); b.files.push(b.files[0]); assert.throws(() => validateBundle(b, b.source));
  b = bundle(); b.files[0].content = 'a'.repeat(2000001); b.files[0].sha256 = crypto.createHash('sha256').update(b.files[0].content).digest('hex');
  assert.throws(() => validateBundle(b, b.source));
});
