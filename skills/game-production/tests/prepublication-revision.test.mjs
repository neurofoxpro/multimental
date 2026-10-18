import test from 'node:test';
import assert from 'node:assert/strict';
import { unpublishedRevision } from '../scripts/short-workflow-state.mjs';
const base = () => {
  const task = { id: 'CONTENT-03', kind: 'automation', blockedBy: [] };
  const current = {
    repository: 'neurofoxpro/multimental',
    head: 'a'.repeat(40),
    branch: 'feature/content-example',
    dirty: true,
    binding: { owner: 'worker', token: 'token', task: task.id, branch: 'feature/content-example' }
  };
  const journal = {
    schemaVersion: 1,
    repository: current.repository,
    task: task.id,
    branch: current.branch,
    owner: 'worker',
    token: 'token',
    phase: 'publish_pending',
    sourceDigest: 'b'.repeat(64)
  };
  const proof = {
    sourceDigest: 'c'.repeat(64),
    at: '2026-09-27T16:40:00Z',
    remoteAbsent: true,
    pulls: []
  };
  return { task, current, journal, proof };
};
test('failed local publish may be explicitly revised only with proved absence of remote side effects', () => {
  const f = base(),
    r = unpublishedRevision(f.journal, f.current, f.task, f.proof);
  assert.equal(r.phase, 'checking');
  assert.equal(r.revises.sourceDigest, f.journal.sourceDigest);
  assert.equal(r.revises.remoteBranchAbsent, true);
  assert.equal(f.journal.phase, 'publish_pending');
});
for (const change of [
  { head: 'd'.repeat(40) },
  { pr: 123 },
  { merge: 'd'.repeat(40) },
  { phase: 'release' },
  { phase: 'ci' },
  { owner: 'other' },
  { token: 'other' },
  { branch: 'feature/other' }
])
  test('prior identity or remote publication is not reset ' + JSON.stringify(change), () => {
    const f = base();
    assert.throws(() =>
      unpublishedRevision({ ...f.journal, ...change }, f.current, f.task, f.proof)
    );
  });
for (const change of [
  { remoteAbsent: false },
  { remoteAbsent: null },
  { pulls: [{ number: 1 }] },
  { pulls: null },
  { sourceDigest: 'b'.repeat(64) },
  { at: 'not-time' }
])
  test('unknown remote effect/new-input proof fails closed ' + JSON.stringify(change), () => {
    const f = base();
    assert.throws(() =>
      unpublishedRevision(f.journal, f.current, f.task, { ...f.proof, ...change })
    );
  });
