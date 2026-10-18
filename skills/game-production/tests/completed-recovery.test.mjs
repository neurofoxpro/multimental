import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transition,
  emptyCoordination,
  assertOwnership
} from '../scripts/collaboration-policy.mjs';
import {
  assertCompletedObservation,
  recoveryDigest,
  recoverCompleted
} from '../scripts/completed-recovery-policy.mjs';
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  H = 'a'.repeat(40),
  M = 'b'.repeat(40),
  D = 'd'.repeat(64),
  NOW = 1790000000000;
function fixture() {
  let state = emptyCoordination();
  state = transition(
    state,
    {
      id: T,
      kind: 'claim',
      owner: 'old-chat',
      task: 'QA-02',
      base: H,
      resources: ['area:devices']
    },
    NOW - 3600000
  ).state;
  state = transition(
    state,
    {
      id: A,
      kind: 'claim',
      owner: 'new-chat',
      task: 'AUTO-11',
      base: H,
      resources: ['area:automation']
    },
    NOW - 100
  ).state;
  const claim = state.claims[T],
    actor = state.claims[A];
  const proof = {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    task: claim.task,
    claimDigest: recoveryDigest(claim),
    observedAt: NOW,
    head: H,
    merge: M,
    pr: 116,
    branch: 'feature/complete',
    sourceDigest: D,
    bindingDigest: D,
    registeredWorktree: true,
    canonicalRemote: true,
    bindingMatches: true,
    cleanWorktree: true,
    mergedExactHead: true,
    canonicalDevMerge: true,
    mergeParentsMatch: true,
    sourceInsideDev: true,
    allRunsComplete: true,
    allWritersIdle: true,
    openPullRequests: 0,
    activeRuns: 0,
    pendingLocks: 0
  };
  const request = {
    id: X,
    kind: 'release_completed',
    owner: actor.owner,
    actorToken: A,
    actorFence: actor.fence,
    token: T,
    fence: claim.fence,
    claimDigest: recoveryDigest(claim),
    proof,
    proofDigest: recoveryDigest(proof)
  };
  return { state, claim, actor, proof, request };
}
test('completed recovery removes only exact completed claim and preserves source-free other ownership', () => {
  const f = fixture(),
    prior = structuredClone(f.state),
    r = transition(f.state, f.request, NOW);
  assert.equal(r.result.status, 'released_completed');
  assert.equal(r.state.claims[T], undefined);
  assert.deepEqual(r.state.claims[A], prior.claims[A]);
  assert.deepEqual(f.state, prior);
  assert.equal(r.result.operator, 'new-chat');
  assert.throws(() =>
    assertOwnership(r.state, { token: T, owner: 'old-chat', task: 'QA-02', fence: 1 })
  );
});
test('same completed operation replays without a second release', () => {
  const f = fixture(),
    r = transition(f.state, f.request, NOW);
  const repeat = transition(r.state, f.request, NOW + 1000);
  assert.equal(repeat.changed, false);
  assert.deepEqual(repeat.result, r.result);
});
test('a recorded operation ID with altered proof cannot be reused', () => {
  const f = fixture(),
    r = transition(f.state, f.request, NOW);
  assert.throws(
    () => transition(r.state, { ...f.request, proofDigest: 'e'.repeat(64) }, NOW + 1),
    /identity reused/
  );
});
for (const key of [
  'registeredWorktree',
  'canonicalRemote',
  'bindingMatches',
  'cleanWorktree',
  'mergedExactHead',
  'canonicalDevMerge',
  'mergeParentsMatch',
  'sourceInsideDev',
  'allRunsComplete',
  'allWritersIdle'
])
  test('incomplete observation stops: ' + key, () => {
    const f = fixture();
    f.proof[key] = false;
    f.request.proofDigest = recoveryDigest(f.proof);
    assert.throws(() => transition(f.state, f.request, NOW), /RECOVERY_NOT_PROVEN/);
    assert.ok(f.state.claims[T]);
  });
for (const key of ['openPullRequests', 'activeRuns', 'pendingLocks'])
  test('live work cannot be claimed away: ' + key, () => {
    const f = fixture();
    f.proof[key] = 1;
    f.request.proofDigest = recoveryDigest(f.proof);
    assert.throws(() => transition(f.state, f.request, NOW), /LIVE_WORK/);
  });
test('heartbeat expiry alone is insufficient without proof', () => {
  const f = fixture();
  f.request.proof = {};
  f.request.proofDigest = recoveryDigest({});
  assert.throws(() => transition(f.state, f.request, NOW));
});
test('a renewed claim invalidates even a previously valid recovery proof', () => {
  const f = fixture();
  const r = transition(
    f.state,
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'renew',
      owner: 'old-chat',
      token: T,
      fence: 1
    },
    NOW
  );
  assert.throws(() => transition(r.state, f.request, NOW + 1), /TARGET_MOVED/);
});
test('fresh heartbeat cannot be recovered even with fully restamped facts', () => {
  const f = fixture();
  f.state.claims[T].expiresAt = NOW + 1000;
  f.request.claimDigest = f.proof.claimDigest = recoveryDigest(f.state.claims[T]);
  f.request.proofDigest = recoveryDigest(f.proof);
  assert.throws(() => transition(f.state, f.request, NOW), /NOT_EXPIRED/);
});
test('stale or future observation cannot authorize recovery', () => {
  for (const time of [NOW - 120001, NOW + 1]) {
    const f = fixture();
    f.proof.observedAt = time;
    assert.throws(() => assertCompletedObservation(f.proof, f.claim, NOW), /STALE_PROOF/);
  }
});
test('unknown actor, foreign actor and insufficient area are refused', () => {
  for (const mutate of [
    (f) => {
      f.request.actorToken = X;
    },
    (f) => {
      f.request.owner = 'other-chat';
    },
    (f) => {
      f.state.claims[A].resources = ['task:AUTO-11', 'area:economy'];
    },
    (f) => {
      f.request.actorFence = 999;
    }
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => transition(f.state, f.request, NOW), /OPERATOR_NOT_AUTHORIZED/);
  }
});
function adapters() {
  const f = fixture(),
    s = {
      journal: null,
      released: 0,
      reserved: 0,
      unlocked: 0,
      records: 0,
      observes: 0,
      event: null
    };
  const a = {
    now: () => NOW,
    load: async () => s.journal,
    save: async (_task, j) => {
      s.journal = structuredClone(j);
    },
    reconcile: async () => s.event,
    observe: async () => {
      s.observes++;
      return { ...f, proof: structuredClone(f.proof), claim: structuredClone(f.claim) };
    },
    reserve: async () => {
      s.reserved++;
      return async () => {
        s.unlocked++;
      };
    },
    request: async () => f.request,
    submit: async () => {
      s.released++;
      const r = transition(f.state, f.request, NOW);
      s.event = r.result;
      return r.result;
    },
    preserved: async () => {},
    record: async () => {
      s.records++;
    }
  };
  return { f, s, a };
}
test('read-only plan has no CAS or reservation side effects', async () => {
  const { a, s } = adapters();
  assert.equal((await recoverCompleted(a, { task: 'QA-02' })).status, 'eligible');
  assert.equal(s.reserved + s.released + s.records, 0);
});
test('real sequence observes again under reservation then records completed result', async () => {
  const { a, s } = adapters();
  const r = await recoverCompleted(a, { task: 'QA-02', apply: true });
  assert.equal(r.status, 'completed');
  assert.equal(s.observes, 2);
  assert.equal(s.released, 1);
  assert.equal(s.unlocked, 1);
  assert.equal(s.records, 1);
});
test('lost CAS reply is recovered without repeating the mutation', async () => {
  const { a, s } = adapters(),
    submit = a.submit;
  a.submit = async () => {
    await submit();
    throw Error('lost reply');
  };
  const r = await recoverCompleted(a, { task: 'QA-02', apply: true });
  assert.equal(r.status, 'completed');
  assert.equal(s.released, 1);
  assert.equal(s.unlocked, 1);
});
test('CAS failure with no observed event does not report release', async () => {
  const { a, s } = adapters();
  a.submit = async () => {
    throw Error('CAS conflict');
  };
  await assert.rejects(recoverCompleted(a, { task: 'QA-02', apply: true }), /CAS conflict/);
  assert.equal(s.journal.status, 'prepared');
  assert.equal(s.unlocked, 1);
  assert.equal(s.records, 0);
});
test('source moving during reservation prevents CAS', async () => {
  const { a, s } = adapters(),
    observe = a.observe;
  a.observe = async () => {
    const r = await observe();
    if (s.observes === 2) r.proof.sourceDigest = 'f'.repeat(64);
    return r;
  };
  await assert.rejects(recoverCompleted(a, { task: 'QA-02', apply: true }), /CHANGED_DURING/);
  assert.equal(s.released, 0);
  assert.equal(s.unlocked, 1);
});
test('repeated completion reads event and never releases a replacement claim', async () => {
  const { a, s } = adapters();
  await recoverCompleted(a, { task: 'QA-02', apply: true });
  a.observe = async () => {
    throw Error('must not inspect or release replacement');
  };
  const r = await recoverCompleted(a, { task: 'QA-02', apply: true });
  assert.equal(r.replayed, true);
  assert.equal(s.released, 1);
});
test('record failure preserves completed side effect for idempotent recovery', async () => {
  const { a, s } = adapters();
  a.record = async () => {
    s.records++;
    if (s.records === 1) throw Error('memory offline');
  };
  await assert.rejects(recoverCompleted(a, { task: 'QA-02', apply: true }), /memory offline/);
  await recoverCompleted(a, { task: 'QA-02', apply: true });
  assert.equal(s.released, 1);
  assert.equal(s.records, 2);
});
