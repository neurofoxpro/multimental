import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{40}$/,
  HASH = /^[a-f0-9]{64}$/,
  REPO = 'neurofoxpro/multimental';

export const zeroWorkDigest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function assertZeroWorkObservation(proof, claim, now) {
  if (
    !claim ||
    !Number.isSafeInteger(now) ||
    proof?.schemaVersion !== 1 ||
    proof.repository !== REPO ||
    proof.task !== claim.task ||
    proof.claimDigest !== zeroWorkDigest(claim)
  )
    throw Error('ZERO_WORK_CLAIM_CHANGED');
  if (
    !Number.isSafeInteger(proof.observedAt) ||
    proof.observedAt > now ||
    now - proof.observedAt > 120000 ||
    claim.expiresAt >= now
  )
    throw Error('ZERO_WORK_NOT_EXPIRED_OR_STALE_PROOF');
  if (
    !SHA.test(proof.base || '') ||
    !SHA.test(proof.head || '') ||
    !/^(feature|fix|docs|test)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(proof.branch || '') ||
    proof.branch.includes('..')
  )
    throw Error('ZERO_WORK_SOURCE');
  if (proof.base !== claim.base || proof.head !== claim.base) throw Error('ZERO_WORK_SOURCE_MOVED');
  if (!['absent', 'exact_head'].includes(proof.remoteBranchState))
    throw Error('ZERO_WORK_REMOTE_STATE');
  if (
    (proof.remoteBranchState === 'absent' && proof.remoteHead !== null) ||
    (proof.remoteBranchState === 'exact_head' && proof.remoteHead !== proof.head)
  )
    throw Error('ZERO_WORK_REMOTE_MOVED');
  if (!HASH.test(proof.sourceDigest || '') || !HASH.test(proof.bindingDigest || ''))
    throw Error('ZERO_WORK_IDENTITIES');
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
    if (proof[key] !== true) throw Error('ZERO_WORK_NOT_PROVEN:' + key);
  if (proof.pullRequests !== 0 || proof.activeRuns !== 0 || proof.pendingLocks !== 0)
    throw Error('ZERO_WORK_LIVE_WORK');
  return true;
}

export function assertZeroWorkRelease(state, request, now) {
  const actor = state.claims[request.actorToken],
    target = state.claims[request.token];
  if (
    !actor ||
    actor.owner !== request.owner ||
    actor.fence !== request.actorFence ||
    actor.token === request.token ||
    !actor.resources.some((r) =>
      ['area:automation', 'area:coordination', 'area:workspaces'].includes(r)
    )
  )
    throw Error('ZERO_WORK_OPERATOR_NOT_AUTHORIZED');
  if (!target || target.fence !== request.fence || request.claimDigest !== zeroWorkDigest(target))
    throw Error('ZERO_WORK_TARGET_MOVED');
  if (request.proofDigest !== zeroWorkDigest(request.proof)) throw Error('ZERO_WORK_PROOF_CHANGED');
  assertZeroWorkObservation(request.proof, target, now);
  return target;
}

export async function recoverZeroWork(a, { task, apply = false }) {
  const previous = await a.load(task);
  if (previous) {
    if (previous.task !== task || !previous.request || previous.repository !== REPO)
      throw Error('ZERO_WORK_JOURNAL_IDENTITY');
    const found = await a.reconcile(previous.request);
    if (found) {
      const done = { ...previous, status: 'completed', result: found, replayed: true };
      if (apply) {
        await a.save(task, done);
        await a.record(done);
      }
      return done;
    }
    if (previous.status === 'completed') throw Error('ZERO_WORK_COMPLETION_MISSING_FROM_REMOTE');
  }
  const first = await a.observe(task);
  assertZeroWorkObservation(first.proof, first.claim, a.now());
  if (!apply)
    return {
      status: 'eligible_zero_work',
      proof: first.proof,
      automaticTakeover: false,
      sourceWrites: 0,
      phoneChanges: 0
    };
  const release = await a.reserve(first);
  try {
    const fresh = await a.observe(task);
    assertZeroWorkObservation(fresh.proof, fresh.claim, a.now());
    if (
      zeroWorkDigest(first.claim) !== zeroWorkDigest(fresh.claim) ||
      first.proof.head !== fresh.proof.head ||
      first.proof.base !== fresh.proof.base ||
      first.proof.remoteHead !== fresh.proof.remoteHead ||
      first.proof.remoteBranchState !== fresh.proof.remoteBranchState ||
      first.proof.sourceDigest !== fresh.proof.sourceDigest ||
      first.proof.bindingDigest !== fresh.proof.bindingDigest
    )
      throw Error('ZERO_WORK_CHANGED_DURING_RESERVATION');
    const request = await a.request(fresh);
    const prepared = {
      schemaVersion: 1,
      repository: REPO,
      task,
      status: 'prepared',
      request,
      proof: fresh.proof,
      createdAt: a.now(),
      sourceWrites: 0,
      phoneChanges: 0
    };
    await a.save(task, prepared);
    let result;
    try {
      result = await a.submit(request);
    } catch (error) {
      result = await a.reconcile(request);
      if (!result) throw error;
    }
    if (!result || result.status !== 'released_zero_work' || result.token !== fresh.claim.token)
      throw Error('ZERO_WORK_RESULT_MISMATCH');
    await a.preserved(fresh);
    const done = { ...prepared, status: 'completed', result, finishedAt: a.now(), replayed: false };
    await a.save(task, done);
    await a.record(done);
    return done;
  } finally {
    await release();
  }
}
