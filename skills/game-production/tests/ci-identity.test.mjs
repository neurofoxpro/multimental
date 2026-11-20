import test from 'node:test';
import assert from 'node:assert/strict';
import { sealSource } from '../../../tools/ci-identity.mjs';
const B = 'b'.repeat(40),
  H = 'a'.repeat(40),
  M = 'c'.repeat(40),
  repo = 'neurofoxpro/multimental';
const fixture = () => ({
  event: {
    number: 92,
    pull_request: {
      number: 92,
      base: { ref: 'dev', sha: B, repo: { full_name: repo } },
      head: { sha: H, repo: { full_name: repo } }
    }
  },
  env: {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: repo,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_SHA: M
  },
  actual: M,
  parents: [B, H]
});
const run = (f) => sealSource(f.event, f.env, f.actual, f.parents);
test('binds source seal to exact merge checkout', () => {
  const r = run(fixture());
  assert.equal(r.head, H);
  assert.equal(r.base, B);
  assert.equal(r.checkout, M);
  assert.equal(r.publicationAuthorized, false);
});
for (const [name, change] of [
  ['wrong repository', (f) => (f.env.GITHUB_REPOSITORY = 'other/repo')],
  ['not CI', (f) => (f.env.GITHUB_ACTIONS = 'false')],
  ['push event', (f) => (f.env.GITHUB_EVENT_NAME = 'push')],
  ['manual event', (f) => (f.env.GITHUB_EVENT_NAME = 'workflow_dispatch')],
  ['missing PR', (f) => delete f.event.pull_request],
  ['target repo', (f) => (f.event.pull_request.base.repo.full_name = 'other/repo')],
  ['target branch', (f) => (f.event.pull_request.base.ref = 'release')],
  ['missing PR number', (f) => delete f.event.number],
  ['fractional PR', (f) => (f.event.number = 1.2)],
  ['mismatched PR', (f) => (f.event.pull_request.number = 93)],
  ['bad head', (f) => (f.event.pull_request.head.sha = 'HEAD')],
  ['bad base', (f) => (f.event.pull_request.base.sha = 'dev')],
  ['moved checkout', (f) => (f.actual = 'd'.repeat(40))],
  ['different event sha', (f) => (f.env.GITHUB_SHA = 'd'.repeat(40))],
  ['no parents', (f) => (f.parents = [])],
  ['one parent', (f) => (f.parents = [B])],
  ['reversed parents', (f) => (f.parents = [H, B])],
  ['old base parent', (f) => (f.parents[0] = 'd'.repeat(40))],
  ['old head parent', (f) => (f.parents[1] = 'd'.repeat(40))],
  ['octopus merge', (f) => f.parents.push(M)]
])
  test('rejects ' + name, () => {
    const f = fixture();
    change(f);
    assert.throws(() => run(f));
  });
test('read-only tests can identify a fork without allowing merge', () => {
  const f = fixture();
  f.event.pull_request.head.repo.full_name = 'contributor/fork';
  const r = run(f);
  assert.equal(r.sourceRepository, 'contributor/fork');
  assert.equal(r.publicationAuthorized, false);
});
test('main target can be tested but this grants no approval', () => {
  const f = fixture();
  f.event.pull_request.base.ref = 'main';
  assert.equal(run(f).publicationAuthorized, false);
});
