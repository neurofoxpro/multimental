import test from 'node:test';
import assert from 'node:assert/strict';
import { settle } from '../scripts/flow.mjs';
const H = 'a'.repeat(40),
  B = 'b'.repeat(40),
  M = 'c'.repeat(40),
  R = 'neurofoxpro/multimental';
class Fake {
  constructor() {
    this.pr = {
      number: 93,
      state: 'open',
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      head: { sha: H, ref: 'feature/test', repo: { full_name: R } },
      base: { sha: B, ref: 'dev', repo: { full_name: R } },
      merged: false
    };
    this.runs = ['build.yml', 'production-control.yml', 'source-quality.yml'].map((f, i) => ({
      id: i + 1,
      path: '.github/workflows/' + f,
      head_sha: H,
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success'
    }));
    this.jobs = [{ name: 'Source seal ' + B + ' ' + H, conclusion: 'success' }];
    this.reviews = [];
    this.writes = [];
    this.pause = async () => {};
  }
  async list(e) {
    if (e.startsWith('/actions/runs?')) return structuredClone(this.runs);
    if (e === '/actions/runs/1/jobs') return structuredClone(this.jobs);
    if (e === '/pulls/93/reviews') return structuredClone(this.reviews);
    throw Error('Unexpected list ' + e);
  }
  async api(method, e, body) {
    if (method === 'GET') {
      if (e === '/pulls/93') return structuredClone(this.pr);
      if (e === '/git/ref/heads/dev') return { object: { sha: B } };
      if (e === '/commits/' + M) return { parents: [{ sha: B }, { sha: H }] };
      throw Error('Unexpected read ' + e);
    }
    this.writes.push({ method, e, body });
    if (method === 'POST' && e === '/pulls/93/reviews') {
      const r = { id: 9, state: 'COMMENTED', user: { login: 'venelsendrik' }, body: body.body };
      this.reviews.push(r);
      if (this.afterReview) this.afterReview(this);
      return r;
    }
    if (method === 'PUT' && e === '/pulls/93/merge') {
      assert.equal(body.sha, H);
      assert.equal(body.merge_method, 'merge');
      if (this.rejectMerge) throw Error('merge rejected');
      this.pr.merged = true;
      this.pr.state = 'closed';
      this.pr.merge_commit_sha = M;
      if (this.lostMergeReply) throw Error('timeout');
      return { merged: true, sha: M };
    }
    throw Error('Unexpected write ' + e);
  }
}
const run = (f) => settle(f, 93, H, { waitSeconds: 0 });
test('verified source merges once with a machine COMMENT review', async () => {
  const f = new Fake();
  const r = await run(f);
  assert.equal(r.status, 'merged');
  assert.equal(r.commit, M);
  assert.equal(r.productionAuthorized, false);
  assert.equal(r.device, 'pending');
  assert.equal(r.postMergeTestsRequired, true);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0].body.event, 'COMMENT');
});
test('repeating completed settle does not merge or review twice', async () => {
  const f = new Fake();
  await run(f);
  const n = f.writes.length;
  assert.equal((await run(f)).status, 'already_merged');
  assert.equal(f.writes.length, n);
});
test('lost merge reply is reconciled without a second PUT', async () => {
  const f = new Fake();
  f.lostMergeReply = true;
  assert.equal((await run(f)).status, 'merged');
  assert.equal(f.writes.filter((x) => x.method === 'PUT').length, 1);
});
test('explicit rejection is not mistaken for a merge', async () => {
  const f = new Fake();
  f.rejectMerge = true;
  await assert.rejects(run(f), /rejected/);
  assert.equal(f.pr.merged, false);
});
for (const [name, change] of [
  ['failed checks', (f) => (f.runs[0].conclusion = 'failure')],
  ['running checks', (f) => (f.runs[0].status = 'in_progress')],
  ['missing source seal', (f) => (f.jobs = [])],
  ['draft PR', (f) => (f.pr.draft = true)],
  ['unknown mergeability', (f) => (f.pr.mergeable = null)],
  [
    'changes requested',
    (f) => (f.reviews = [{ id: 1, state: 'CHANGES_REQUESTED', user: { login: 'r' } }])
  ]
])
  test('blocked ' + name + ' performs no writes', async () => {
    const f = new Fake();
    change(f);
    const r = await run(f);
    assert.equal(r.status, 'blocked');
    assert.equal(f.writes.length, 0);
  });
for (const [name, change] of [
  ['other head', (f) => (f.pr.head.sha = M)],
  ['main target', (f) => (f.pr.base.ref = 'main')],
  ['foreign head repository', (f) => (f.pr.head.repo.full_name = 'other/repo')],
  ['foreign base repository', (f) => (f.pr.base.repo.full_name = 'other/repo')],
  ['unscoped branch', (f) => (f.pr.head.ref = 'dev')]
])
  test('rejects ' + name + ' even for an already merged PR', async () => {
    const f = new Fake();
    f.pr.merged = true;
    f.pr.merge_commit_sha = M;
    change(f);
    await assert.rejects(run(f));
    assert.equal(f.writes.length, 0);
  });
for (const [name, change] of [
  ['new checks running', (f) => (f.runs[0].status = 'in_progress')],
  ['head moved', (f) => (f.pr.head.sha = M)],
  ['draft conversion', (f) => (f.pr.draft = true)],
  [
    'new change request',
    (f) => f.reviews.push({ id: 10, state: 'CHANGES_REQUESTED', user: { login: 'r' } })
  ]
])
  test('race after review: ' + name + ' stops before merge', async () => {
    const f = new Fake();
    f.afterReview = change;
    await assert.rejects(run(f));
    assert.equal(f.writes.filter((x) => x.method === 'PUT').length, 0);
  });
test('review already attached to the same head/base is reused', async () => {
  const f = new Fake();
  f.reviews = [
    {
      id: 7,
      user: { login: 'venelsendrik' },
      state: 'COMMENTED',
      body: '<!-- gameprod:auto-review:' + H + ':' + B + ' -->\nexisting'
    }
  ];
  assert.equal((await run(f)).status, 'merged');
  assert.equal(f.writes.filter((x) => x.method === 'POST').length, 0);
});
test('review posted before lost response is reused on recovery', async () => {
  const f = new Fake();
  f.afterReview = () => {
    throw Error('lost review response');
  };
  await assert.rejects(run(f));
  f.afterReview = null;
  assert.equal((await run(f)).status, 'merged');
  assert.equal(f.writes.filter((x) => x.method === 'POST').length, 1);
});
test('ambiguous post-merge readback does not report success', async () => {
  const f = new Fake();
  const api = f.api.bind(f);
  f.api = async (method, e, body) => {
    const r = await api(method, e, body);
    if (method === 'GET' && e === '/pulls/93' && r.merged) r.merge_commit_sha = B;
    return r;
  };
  await assert.rejects(run(f), /readback/);
});
test('time budget and identities are bounded', async () => {
  const f = new Fake();
  for (const [number, head, waitSeconds] of [
    [0, H, 0],
    [93, 'HEAD', 0],
    [93, H, -1],
    [93, H, 901],
    [93, H, NaN]
  ])
    await assert.rejects(settle(f, number, head, { waitSeconds }));
  assert.equal(f.writes.length, 0);
});
