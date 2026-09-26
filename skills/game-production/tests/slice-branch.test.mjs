import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBranch } from '../scripts/slice-branch.mjs';
const binding = { task: 'AUTO-09', token: '7d454b24-9d2a-459f-87ee-7e81be94f96a', released: false };
test('next branch is deterministic, task-bound and not protected', () =>
  assert.equal(nextBranch(binding, 'cold-cache'), 'feature/auto-09-cold-cache-7d454b24'));
for (const suffix of ['', '../main', 'a;exit', '--force', 'x', 'MAIN', 'a'.repeat(32)])
  test('rejects branch suffix ' + suffix, () => assert.throws(() => nextBranch(binding, suffix)));
test('released task cannot allocate another branch', () =>
  assert.throws(() => nextBranch({ ...binding, released: true }, 'next')));
test('task and claim identities are mandatory', () => {
  assert.throws(() => nextBranch({ ...binding, task: 'x' }, 'next'));
  assert.throws(() => nextBranch({ ...binding, token: 'missing' }, 'next'));
});
