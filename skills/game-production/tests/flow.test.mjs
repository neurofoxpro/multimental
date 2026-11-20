import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePolicy } from '../scripts/flow.mjs';
const H = 'a'.repeat(40),
  B = 'b'.repeat(40),
  R = 'neurofoxpro/multimental';
const fixture = () => ({
  pr: {
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    head: { sha: H, ref: 'feature/test', repo: { full_name: R } },
    base: { sha: B, ref: 'dev', repo: { full_name: R } }
  },
  runs: ['build.yml', 'production-control.yml', 'source-quality.yml'].map((f, i) => ({
    id: i + 1,
    path: '.github/workflows/' + f,
    head_sha: H,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success'
  })),
  jobs: [{ name: 'Source seal ' + B + ' ' + H, conclusion: 'success' }],
  reviews: [],
  expected: { head: H, base: B }
});
const evaluate = (x) => mergePolicy(x.pr, x.runs, x.jobs, x.reviews, x.expected);
test('matching automatic evidence allows dev without claiming installation', () => {
  const r = evaluate(fixture());
  assert.equal(r.ok, true);
  assert.equal(r.device, 'independent_pending');
  assert.equal(r.productionAuthorized, false);
});
for (const [name, mutate] of [
  ['main target', (x) => (x.pr.base.ref = 'main')],
  ['fork', (x) => (x.pr.head.repo.full_name = 'other/repo')],
  ['draft', (x) => (x.pr.draft = true)],
  ['closed', (x) => (x.pr.state = 'closed')],
  ['unknown mergeability', (x) => (x.pr.mergeable = null)],
  ['changed head', (x) => (x.pr.head.sha = 'c'.repeat(40))],
  ['changed base', (x) => (x.pr.base.sha = 'c'.repeat(40))],
  ['empty expected head', (x) => (x.expected.head = '')],
  ['no tests', (x) => (x.runs = [])],
  ['no source seal', (x) => (x.jobs = [])],
  ['failed test', (x) => (x.runs[0].conclusion = 'failure')],
  ['still running', (x) => (x.runs[0].status = 'in_progress')],
  ['cancelled source quality', (x) => (x.runs[2].conclusion = 'cancelled')],
  [
    'requested changes',
    (x) => (x.reviews = [{ id: 1, state: 'CHANGES_REQUESTED', user: { login: 'reviewer' } }])
  ],
  [
    'new failure after old success',
    (x) => x.runs.push({ ...x.runs[0], id: 9, conclusion: 'failure' })
  ],
  ['stale source seal', (x) => (x.jobs[0].name = 'Source seal old ' + H)]
])
  test('merge rejects ' + name, () => {
    const f = fixture();
    mutate(f);
    assert.equal(evaluate(f).ok, false);
  });
test('comment review never dismisses change request', () => {
  const f = fixture();
  f.reviews = [
    { id: 1, state: 'CHANGES_REQUESTED', user: { login: 'r' } },
    { id: 2, state: 'COMMENTED', user: { login: 'r' } }
  ];
  assert.equal(evaluate(f).ok, false);
});
test('explicit dismissal clears change request', () => {
  const f = fixture();
  f.reviews = [
    { id: 1, state: 'CHANGES_REQUESTED', user: { login: 'r' } },
    { id: 2, state: 'DISMISSED', user: { login: 'r' } }
  ];
  assert.equal(evaluate(f).ok, true);
});
