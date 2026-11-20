import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shipStatePath,
  shortOptions,
  revisedCheckpoint
} from '../scripts/short-workflow-state.mjs';
const A = 'a'.repeat(40),
  B = 'b'.repeat(40),
  D = 'd'.repeat(64),
  E = 'e'.repeat(64);
const repo = 'neurofoxpro/multimental';
function fixture() {
  const task = { id: 'AUTO-06', kind: 'automation', blockedBy: [] };
  const binding = { branch: 'feature/one', task: task.id, owner: 'one', token: 'token' };
  const current = { repository: repo, branch: binding.branch, head: A, dirty: true, binding };
  const journal = {
    schemaVersion: 1,
    repository: repo,
    task: task.id,
    branch: binding.branch,
    owner: binding.owner,
    token: binding.token,
    head: A,
    pr: 1,
    phase: 'ci',
    sourceDigest: D
  };
  const pr = {
    number: 1,
    state: 'open',
    draft: false,
    head: { sha: A, ref: binding.branch, repo: { full_name: repo } },
    base: { ref: 'dev', repo: { full_name: repo } },
    merged_at: null
  };
  const options = { sourceDigest: E, descendant: true, at: '2026-09-26T08:00:00Z' };
  return { journal, current, task, pr, options };
}
test('each feature increment owns its own deterministic checkpoint path', () => {
  assert.equal(shipStatePath('feature/one'), shipStatePath('feature/one'));
  assert.notEqual(shipStatePath('feature/one'), shipStatePath('feature/two'));
  assert.match(shipStatePath('feature/one'), /^\.gameprod\/evidence\/ships\/[a-f0-9]{64}\.json$/);
  for (const branch of ['main', 'dev', '../else', 'feature/../else'])
    assert.throws(() => shipStatePath(branch));
});
test('short options accept one explicit revision and reject shell-like/unknown flags', () => {
  assert.deepEqual(shortOptions(['ship', 'AUTO-06', '--revise']), {
    mode: 'ship',
    rest: ['AUTO-06'],
    revise: true
  });
  assert.deepEqual(shortOptions(['ship', '--revise']), { mode: 'ship', rest: [], revise: true });
  for (const args of [
    ['ship', '--revise', '--revise'],
    ['focus', '--revise'],
    ['ship', '--skip'],
    ['ship', 'AUTO-06;bad'],
    ['accept', 'AUTO-06'],
    ['ship', 'AUTO-06', 'OTHER-01']
  ])
    assert.throws(() => shortOptions(args));
});
test('explicit revision preserves old PR identity as history and restarts full checks', () => {
  const f = fixture(),
    prior = structuredClone(f.journal);
  const next = revisedCheckpoint(f.journal, f.current, f.task, f.pr, f.options);
  assert.equal(next.phase, 'checking');
  assert.equal(next.revises.pr, 1);
  assert.equal(next.head, undefined);
  assert.deepEqual(f.journal, prior);
});
for (const [name, change] of [
  [
    'already merged',
    (f) => {
      f.pr.merged_at = 'now';
      f.pr.merge_commit_sha = B;
      f.pr.state = 'closed';
    }
  ],
  [
    'closed unmerged',
    (f) => {
      f.pr.state = 'closed';
    }
  ],
  [
    'foreign claim',
    (f) => {
      f.journal.token = 'other';
    }
  ],
  [
    'unchanged source',
    (f) => {
      f.options.sourceDigest = D;
    }
  ],
  [
    'unknown publication',
    (f) => {
      f.journal.phase = 'publish_pending';
    }
  ],
  [
    'different remote head',
    (f) => {
      f.pr.head.sha = B;
    }
  ],
  [
    'rewritten ancestry',
    (f) => {
      f.options.descendant = false;
    }
  ],
  [
    'completed release',
    (f) => {
      f.journal.phase = 'complete';
    }
  ]
])
  test('revision refuses ' + name, () => {
    const f = fixture();
    change(f);
    assert.throws(() => revisedCheckpoint(f.journal, f.current, f.task, f.pr, f.options));
  });
