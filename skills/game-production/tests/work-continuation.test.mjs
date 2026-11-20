import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyCoordination,
  transition,
  assertOwnership
} from '../scripts/collaboration-policy.mjs';
import {
  continuationObservation,
  continuationRequest,
  continuationDigest,
  continueInterrupted
} from '../scripts/work-continuation-policy.mjs';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  OP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SHA = '1'.repeat(40),
  HASH = '2'.repeat(64),
  NOW = 3600000;
function fixture() {
  let state = transition(
    emptyCoordination(),
    {
      id: ACTOR,
      kind: 'claim',
      owner: 'recovery-agent',
      task: 'AUTO-07',
      base: SHA,
      resources: ['area:automation']
    },
    0
  ).state;
  state = transition(
    state,
    {
      id: TARGET,
      kind: 'claim',
      owner: 'old-ui-agent',
      task: 'UX-07',
      base: SHA,
      resources: ['area:game-ui']
    },
    0
  ).state;
  const actor = state.claims[ACTOR],
    claim = state.claims[TARGET];
  const proof = {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    task: 'UX-07',
    claimDigest: continuationDigest(claim),
    observedAt: NOW,
    head: SHA,
    dev: SHA,
    branch: 'feature/preserved-ui',
    pr: 119,
    sourceDigest: HASH,
    bindingDigest: HASH,
    registeredWorktree: true,
    canonicalRemote: true,
    bindingMatches: true,
    cleanWorktree: true,
    openExactPull: true,
    canonicalDevPull: true,
    remoteBranchUnchanged: true,
    allRunsComplete: true,
    allWritersIdle: true,
    operatorSourceReleased: true,
    oldGuardChecksCurrentOwnership: true,
    taskStillOpen: true,
    openPullRequests: 1,
    activeRuns: 0,
    pendingLocks: 0,
    requestedChanges: 0,
    draft: false
  };
  const request = {
    id: OP,
    kind: 'continue_interrupted',
    owner: actor.owner,
    actorToken: ACTOR,
    actorFence: actor.fence,
    token: TARGET,
    fence: claim.fence,
    claimDigest: continuationDigest(claim),
    proof,
    proofDigest: continuationDigest(proof),
    nextOwner: 'new-ui-agent',
    base: SHA,
    intent: 'owner-requested-project-continuation'
  };
  return { state, actor, claim, proof, request };
}
test('explicit verified continuation fences old and operator claims atomically', () => {
  const f = fixture(),
    result = transition(f.state, f.request, NOW);
  assert.equal(result.result.status, 'continuation_transferred');
  assert.equal(Object.keys(result.state.claims).length, 1);
  assert.equal(result.state.claims[OP].owner, 'new-ui-agent');
  assert.equal(result.state.claims[OP].task, 'UX-07');
  assert.equal(result.state.claims[OP].fence, 3);
  assert.deepEqual(result.state.claims[OP].resources, f.claim.resources);
  assert.equal(result.result.previousHead, SHA);
  assert.equal(result.result.previousPr, 119);
  assert.throws(() => assertOwnership(result.state, f.claim));
  assert.throws(() => assertOwnership(result.state, f.actor));
  assert.equal(assertOwnership(result.state, result.result).owner, 'new-ui-agent');
  assert.equal(transition(result.state, f.request, NOW + 1).changed, false);
  assert.equal(Object.keys(f.state.claims).length, 2);
});
test('ordinary queue still cannot steal an expired claim', () => {
  const f = fixture();
  assert.throws(
    () =>
      transition(
        f.state,
        {
          id: OP,
          kind: 'claim',
          owner: 'new-ui-agent',
          task: 'UX-07',
          base: SHA,
          resources: ['area:game-ui']
        },
        NOW
      ),
    /RESOURCE_BUSY/
  );
});
for (const key of [
  'registeredWorktree',
  'canonicalRemote',
  'bindingMatches',
  'cleanWorktree',
  'openExactPull',
  'canonicalDevPull',
  'remoteBranchUnchanged',
  'allRunsComplete',
  'allWritersIdle',
  'operatorSourceReleased',
  'oldGuardChecksCurrentOwnership',
  'taskStillOpen'
])
  test('missing independent proof blocks ' + key, () => {
    const f = fixture();
    f.proof[key] = false;
    f.request.proofDigest = continuationDigest(f.proof);
    assert.throws(() => transition(f.state, f.request, NOW));
    assert.equal(Object.keys(f.state.claims).length, 2);
  });
for (const change of [
  { activeRuns: 1 },
  { pendingLocks: 1 },
  { requestedChanges: 1 },
  { openPullRequests: 0 },
  { openPullRequests: 2 },
  { draft: true },
  { observedAt: NOW - 120001 },
  { observedAt: NOW + 1 },
  { head: 'bad' },
  { dev: 'bad' },
  { sourceDigest: '' },
  { branch: 'main' }
])
  test('invalid observation never transfers ' + JSON.stringify(change), () => {
    const f = fixture();
    Object.assign(f.proof, change);
    f.request.proofDigest = continuationDigest(f.proof);
    assert.throws(() => transition(f.state, f.request, NOW));
  });
test('renewed source, changed token/fence and unsupported hardware are preserved', () => {
  const f = fixture();
  for (const change of [
    { actorFence: 99 },
    { token: OP },
    { fence: 99 },
    { intent: 'automatic-timeout' },
    { nextOwner: 'old-ui-agent' },
    { nextOwner: 'recovery-agent' },
    { proofDigest: '3'.repeat(64) },
    { base: '4'.repeat(40) }
  ])
    assert.throws(() => continuationRequest(f.state, { ...f.request, ...change }, NOW));
  f.state.claims[TARGET].expiresAt = NOW + 100;
  assert.throws(() => continuationRequest(f.state, f.request, NOW));
  const g = fixture();
  g.claim.resources = ['area:devices', 'task:UX-07'];
  g.proof.claimDigest = continuationDigest(g.claim);
  assert.throws(() => continuationObservation(g.proof, g.claim, NOW));
});
function adapter(f, settings = {}) {
  let saved = null,
    remote = null,
    submitted = 0,
    finished = 0,
    released = 0,
    observed = 0;
  const a = {
    now: () => NOW,
    load: async () => saved,
    save: async (value) => {
      saved = structuredClone(value);
    },
    reconcile: async () => remote,
    observe: async () => {
      observed++;
      const value = {
        proof: structuredClone(f.proof),
        claim: structuredClone(f.claim),
        actor: f.actor
      };
      if (settings.changeOnSecond && observed > 1) value.proof.head = '5'.repeat(40);
      return value;
    },
    reserve: async () => () => {
      released++;
    },
    request: async () => f.request,
    submit: async (request) => {
      submitted++;
      if (settings.beforeCommitFailure) throw Error('offline before CAS');
      remote = transition(f.state, request, NOW).result;
      if (settings.lostReply) throw Error('lost CAS reply');
      return remote;
    },
    preserved: async () => {},
    finish: async () => {
      finished++;
      if (settings.finishFailOnce && finished === 1)
        throw Error('comment interrupted after transfer');
    }
  };
  return { a, counts: () => ({ submitted, finished, released, observed }), saved: () => saved };
}
test('plan never changes coordination or touches source', async () => {
  const b = adapter(fixture());
  const result = await continueInterrupted(b.a, { task: 'UX-07', nextOwner: 'new-ui-agent' });
  assert.equal(result.status, 'eligible_for_explicit_continuation');
  assert.equal(b.counts().submitted, 0);
  assert.equal(b.saved(), null);
});
test('lost CAS acknowledgement reconciles and repeat never submits again', async () => {
  const b = adapter(fixture(), { lostReply: true });
  const first = await continueInterrupted(b.a, {
    task: 'UX-07',
    nextOwner: 'new-ui-agent',
    apply: true
  });
  assert.equal(first.status, 'transferred');
  const second = await continueInterrupted(b.a, {
    task: 'UX-07',
    nextOwner: 'new-ui-agent',
    apply: true
  });
  assert.equal(second.replayed, true);
  assert.equal(b.counts().submitted, 1);
  assert.equal(b.counts().released, 1);
});
test('interrupted comment/worktree stage resumes after exact remote readback', async () => {
  const b = adapter(fixture(), { finishFailOnce: true });
  await assert.rejects(
    continueInterrupted(b.a, { task: 'UX-07', nextOwner: 'new-ui-agent', apply: true })
  );
  assert.equal(b.saved().status, 'transferred');
  const result = await continueInterrupted(b.a, {
    task: 'UX-07',
    nextOwner: 'new-ui-agent',
    apply: true
  });
  assert.equal(result.replayed, true);
  assert.equal(b.counts().submitted, 1);
  assert.equal(b.counts().finished, 2);
});
test('reservation race and precommit failure preserve old owners', async () => {
  const b = adapter(fixture(), { changeOnSecond: true });
  await assert.rejects(
    continueInterrupted(b.a, { task: 'UX-07', nextOwner: 'new-ui-agent', apply: true }),
    /CHANGED_DURING_RESERVATION/
  );
  assert.equal(b.counts().submitted, 0);
  assert.equal(b.counts().released, 1);
  const c = adapter(fixture(), { beforeCommitFailure: true });
  await assert.rejects(
    continueInterrupted(c.a, { task: 'UX-07', nextOwner: 'new-ui-agent', apply: true })
  );
  assert.equal(c.saved().status, 'prepared');
  assert.equal(c.counts().finished, 0);
  assert.equal(c.counts().released, 1);
});
