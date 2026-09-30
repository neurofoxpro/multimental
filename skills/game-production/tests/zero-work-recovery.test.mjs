import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  transition,
  emptyCoordination,
  assertOwnership
} from '../scripts/collaboration-policy.mjs';
import {
  assertZeroWorkObservation,
  recoverZeroWork,
  zeroWorkDigest
} from '../scripts/zero-work-recovery-policy.mjs';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  H = 'a'.repeat(40),
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
      task: 'AUTO-08',
      base: H,
      resources: ['area:automation']
    },
    NOW - 3600000
  ).state;
  state = transition(
    state,
    {
      id: A,
      kind: 'claim',
      owner: 'new-chat',
      task: 'AUTO-09',
      base: H,
      resources: ['area:coordination']
    },
    NOW - 100
  ).state;
  const claim = state.claims[T],
    actor = state.claims[A],
    proof = {
      schemaVersion: 1,
      repository: 'neurofoxpro/multimental',
      task: claim.task,
      claimDigest: zeroWorkDigest(claim),
      observedAt: NOW,
      base: H,
      head: H,
      branch: 'feature/zero-work',
      remoteHead: null,
      remoteBranchState: 'absent',
      sourceDigest: D,
      bindingDigest: D,
      registeredWorktree: true,
      canonicalRemote: true,
      bindingMatches: true,
      cleanWorktree: true,
      baseEqualsHead: true,
      baseInsideDev: true,
      remoteBranchSafe: true,
      noCommitsBeyondBase: true,
      noPullRequests: true,
      allRunsComplete: true,
      allWritersIdle: true,
      taskStillOpen: true,
      pullRequests: 0,
      activeRuns: 0,
      pendingLocks: 0
    };
  const request = {
    id: X,
    kind: 'release_zero_work',
    owner: actor.owner,
    actorToken: A,
    actorFence: actor.fence,
    token: T,
    fence: claim.fence,
    claimDigest: zeroWorkDigest(claim),
    proof,
    proofDigest: zeroWorkDigest(proof)
  };
  return { state, claim, actor, proof, request };
}

test('zero-work recovery releases only exact empty expired claim', () => {
  const f = fixture(),
    prior = structuredClone(f.state),
    result = transition(f.state, f.request, NOW);
  assert.equal(result.result.status, 'released_zero_work');
  assert.equal(result.state.claims[T], undefined);
  assert.deepEqual(result.state.claims[A], prior.claims[A]);
  assert.deepEqual(f.state, prior);
  assert.throws(() =>
    assertOwnership(result.state, { token: T, owner: 'old-chat', task: 'AUTO-08', fence: 1 })
  );
});

test('same zero-work operation replays without touching replacement ownership', () => {
  const f = fixture(),
    first = transition(f.state, f.request, NOW),
    repeat = transition(first.state, f.request, NOW + 1000);
  assert.equal(repeat.changed, false);
  assert.deepEqual(repeat.result, first.result);
});

for (const key of [
  'registeredWorktree',
  'canonicalRemote',
  'bindingMatches',
  'cleanWorktree',
  'baseEqualsHead',
  'baseInsideDev',
  'remoteBranchSafe',
  'noCommitsBeyondBase',
  'noPullRequests',
  'allRunsComplete',
  'allWritersIdle',
  'taskStillOpen'
])
  test('zero-work proof requires ' + key, () => {
    const f = fixture();
    f.proof[key] = false;
    f.request.proofDigest = zeroWorkDigest(f.proof);
    assert.throws(() => transition(f.state, f.request, NOW), /ZERO_WORK_NOT_PROVEN/);
    assert.ok(f.state.claims[T]);
  });

for (const key of ['pullRequests', 'activeRuns', 'pendingLocks'])
  test('zero-work recovery blocks live state: ' + key, () => {
    const f = fixture();
    f.proof[key] = 1;
    f.request.proofDigest = zeroWorkDigest(f.proof);
    assert.throws(() => transition(f.state, f.request, NOW), /ZERO_WORK_LIVE_WORK/);
  });

test('local head must remain the original claim base', () => {
  const f = fixture();
  f.proof.head = 'b'.repeat(40);
  f.request.proofDigest = zeroWorkDigest(f.proof);
  assert.throws(() => transition(f.state, f.request, NOW), /ZERO_WORK_SOURCE_MOVED/);
});

test('remote branch may be absent or exact, never divergent', () => {
  const exact = fixture();
  exact.proof.remoteBranchState = 'exact_head';
  exact.proof.remoteHead = H;
  exact.request.proofDigest = zeroWorkDigest(exact.proof);
  assert.equal(transition(exact.state, exact.request, NOW).result.status, 'released_zero_work');

  const divergent = fixture();
  divergent.proof.remoteBranchState = 'exact_head';
  divergent.proof.remoteHead = 'b'.repeat(40);
  divergent.request.proofDigest = zeroWorkDigest(divergent.proof);
  assert.throws(
    () => transition(divergent.state, divergent.request, NOW),
    /ZERO_WORK_REMOTE_MOVED/
  );
});

test('heartbeat expiry alone never authorizes zero-work recovery', () => {
  const f = fixture();
  f.request.proof = {};
  f.request.proofDigest = zeroWorkDigest({});
  assert.throws(() => transition(f.state, f.request, NOW));
});

test('renewed or fresh target invalidates zero-work proof', () => {
  const f = fixture();
  const renewed = transition(
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
  assert.throws(() => transition(renewed.state, f.request, NOW + 1), /ZERO_WORK_TARGET_MOVED/);

  const fresh = fixture();
  fresh.state.claims[T].expiresAt = NOW + 1000;
  fresh.request.claimDigest = fresh.proof.claimDigest = zeroWorkDigest(fresh.state.claims[T]);
  fresh.request.proofDigest = zeroWorkDigest(fresh.proof);
  assert.throws(() => transition(fresh.state, fresh.request, NOW), /ZERO_WORK_NOT_EXPIRED/);
});

test('stale or future zero-work observation is refused', () => {
  for (const observedAt of [NOW - 120001, NOW + 1]) {
    const f = fixture();
    f.proof.observedAt = observedAt;
    assert.throws(() => assertZeroWorkObservation(f.proof, f.claim, NOW), /STALE_PROOF/);
  }
});

test('zero-work recovery requires authorized coordination actor', () => {
  for (const mutate of [
    (f) => {
      f.request.actorToken = X;
    },
    (f) => {
      f.request.owner = 'other-chat';
    },
    (f) => {
      f.state.claims[A].resources = ['task:AUTO-09', 'area:economy'];
    },
    (f) => {
      f.request.actorFence = 999;
    }
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => transition(f.state, f.request, NOW), /ZERO_WORK_OPERATOR_NOT_AUTHORIZED/);
  }
});

function adapters() {
  const f = fixture(),
    state = {
      journal: null,
      releases: 0,
      reservations: 0,
      unlocks: 0,
      records: 0,
      observes: 0,
      event: null
    };
  const adapter = {
    now: () => NOW,
    load: async () => state.journal,
    save: async (_task, journal) => {
      state.journal = structuredClone(journal);
    },
    reconcile: async () => state.event,
    observe: async () => {
      state.observes++;
      return { ...f, proof: structuredClone(f.proof), claim: structuredClone(f.claim) };
    },
    reserve: async () => {
      state.reservations++;
      return async () => {
        state.unlocks++;
      };
    },
    request: async () => f.request,
    submit: async () => {
      state.releases++;
      const result = transition(f.state, f.request, NOW);
      state.event = result.result;
      return result.result;
    },
    preserved: async () => {},
    record: async () => {
      state.records++;
    }
  };
  return { f, state, adapter };
}

test('zero-work plan is read-only', async () => {
  const { adapter, state } = adapters();
  const result = await recoverZeroWork(adapter, { task: 'AUTO-08' });
  assert.equal(result.status, 'eligible_zero_work');
  assert.equal(state.reservations + state.releases + state.records, 0);
});

test('zero-work apply observes twice under reservation and records once', async () => {
  const { adapter, state } = adapters();
  const result = await recoverZeroWork(adapter, { task: 'AUTO-08', apply: true });
  assert.equal(result.status, 'completed');
  assert.equal(state.observes, 2);
  assert.equal(state.releases, 1);
  assert.equal(state.unlocks, 1);
  assert.equal(state.records, 1);
});

test('lost zero-work CAS reply is recovered without repeating release', async () => {
  const { adapter, state } = adapters(),
    submit = adapter.submit;
  adapter.submit = async () => {
    await submit();
    throw Error('lost reply');
  };
  const result = await recoverZeroWork(adapter, { task: 'AUTO-08', apply: true });
  assert.equal(result.status, 'completed');
  assert.equal(state.releases, 1);
  assert.equal(state.unlocks, 1);
});

test('unobserved CAS failure remains incomplete', async () => {
  const { adapter, state } = adapters();
  adapter.submit = async () => {
    throw Error('CAS conflict');
  };
  await assert.rejects(recoverZeroWork(adapter, { task: 'AUTO-08', apply: true }), /CAS conflict/);
  assert.equal(state.journal.status, 'prepared');
  assert.equal(state.unlocks, 1);
  assert.equal(state.records, 0);
});

test('source or binding movement during reservation prevents zero-work CAS', async () => {
  const { adapter, state } = adapters(),
    observe = adapter.observe;
  adapter.observe = async () => {
    const result = await observe();
    if (state.observes === 2) result.proof.bindingDigest = 'e'.repeat(64);
    return result;
  };
  await assert.rejects(
    recoverZeroWork(adapter, { task: 'AUTO-08', apply: true }),
    /ZERO_WORK_CHANGED_DURING_RESERVATION/
  );
  assert.equal(state.releases, 0);
  assert.equal(state.unlocks, 1);
});

test('replay never inspects or releases a replacement claim', async () => {
  const { adapter, state } = adapters();
  await recoverZeroWork(adapter, { task: 'AUTO-08', apply: true });
  adapter.observe = async () => {
    throw Error('replacement must not be inspected');
  };
  const result = await recoverZeroWork(adapter, { task: 'AUTO-08', apply: true });
  assert.equal(result.replayed, true);
  assert.equal(state.releases, 1);
});

test('record failure retains completed side effect for idempotent replay', async () => {
  const { adapter, state } = adapters();
  adapter.record = async () => {
    state.records++;
    if (state.records === 1) throw Error('memory offline');
  };
  await assert.rejects(
    recoverZeroWork(adapter, { task: 'AUTO-08', apply: true }),
    /memory offline/
  );
  await recoverZeroWork(adapter, { task: 'AUTO-08', apply: true });
  assert.equal(state.releases, 1);
  assert.equal(state.records, 2);
});

test('temporary root apply bundles are ignored by source publication', () => {
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(ignore, /^\/\*BUNDLE\*\.json$/m);
});
