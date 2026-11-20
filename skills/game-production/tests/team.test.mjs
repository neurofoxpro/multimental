import test from 'node:test';
import assert from 'node:assert/strict';
import { teamSummary } from '../scripts/team-policy.mjs';
const fixture = () => ({
  snapshot: {
    source: 'github-issues',
    missing: [],
    records: [
      { task: { id: 'UX-11', title: 'UI' }, issue: 139 },
      { task: { id: 'AUTO-07', title: 'automation' }, issue: 44 }
    ]
  },
  claims: [
    { token: 'a', task: 'UX-11', owner: 'ui', resources: ['area:ui'], expiresAt: 1 },
    { token: 'b', task: 'AUTO-07', owner: 'tools', resources: ['area:automation'], expiresAt: 9999 }
  ],
  locals: [
    {
      token: 'a',
      branch: 'feature/ui',
      head: 'a'.repeat(40),
      dirtyPaths: ['game/src/main.gd'],
      locks: []
    },
    { token: 'b', branch: 'feature/auto', head: 'b'.repeat(40), dirtyPaths: [], locks: [] }
  ],
  pulls: [],
  dispatch: { ready: [], waves: [] },
  now: 100
});
test('expired heartbeat never discards an uncommitted parallel chat result', () => {
  const r = teamSummary(fixture());
  assert.equal(r.workers[0].heartbeatExpired, true);
  assert.equal(r.workers[0].localState, 'draft_preserved');
  assert.equal(r.workers[0].automaticTakeover, false);
  assert.equal(r.agentsStarted, 0);
  assert.equal(r.chatTranscriptsRead, false);
});
test('overlapping edits reported even across otherwise different resource groups', () => {
  const f = fixture();
  f.locals[1].dirtyPaths = ['game/src/main.gd'];
  const r = teamSummary(f);
  assert.deepEqual(r.overlaps[0].paths, ['game/src/main.gd']);
  assert.equal(r.claimsChanged, false);
});
test('missing or ambiguous worktree binding is preserved as unresolved', () => {
  const f = fixture();
  f.locals.push(f.locals[0]);
  assert.equal(teamSummary(f).workers[0].localState, 'unresolved_preserve');
  f.locals = [];
  assert.equal(teamSummary(f).workers[0].localState, 'unresolved_preserve');
});
test('remote open/merged facts stay distinct from local draft', () => {
  const f = fixture();
  f.pulls = [
    {
      number: 5,
      state: 'closed',
      merged_at: '2026-09-27',
      merge_commit_sha: 'c'.repeat(40),
      head: { ref: 'feature/auto', sha: 'b'.repeat(40) },
      html_url: 'repo/pr/5'
    }
  ];
  const r = teamSummary(f);
  assert.equal(r.workers[1].lastMergedPR, 5);
  assert.equal(r.workers[1].openPRs.length, 0);
  assert.equal(r.recentMerged[0].merge, 'c'.repeat(40));
});
test('incomplete snapshots fail rather than choosing work from stale memory', () => {
  const f = fixture();
  f.snapshot.missing = ['UX-11'];
  assert.throws(() => teamSummary(f));
  f.snapshot.missing = [];
  f.snapshot.source = 'cached';
  assert.throws(() => teamSummary(f));
});
