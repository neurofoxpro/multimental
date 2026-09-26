import { createHash } from 'node:crypto';
const SHA = /^[a-f0-9]{40}$/,
  HASH = /^[a-f0-9]{64}$/;
const REPO = 'neurofoxpro/multimental';
export const recoveryDigest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assertCompletedObservation(proof, claim, now) {
  if (
    !claim ||
    !Number.isSafeInteger(now) ||
    proof?.schemaVersion !== 1 ||
    proof.repository !== REPO ||
    proof.task !== claim.task ||
    proof.claimDigest !== recoveryDigest(claim)
  )
    throw Error('RECOVERY_CLAIM_CHANGED');
  if (
    !Number.isSafeInteger(proof.observedAt) ||
    proof.observedAt > now ||
    now - proof.observedAt > 120000 ||
    claim.expiresAt >= now
  )
    throw Error('RECOVERY_NOT_EXPIRED_OR_STALE_PROOF');
  if (
    !SHA.test(proof.head || '') ||
    !SHA.test(proof.merge || '') ||
    !/^(feature|fix|docs|test)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(proof.branch || '') ||
    proof.branch.includes('..')
  )
    throw Error('RECOVERY_SOURCE');
  if (
    !Number.isSafeInteger(proof.pr) ||
    proof.pr < 1 ||
    !HASH.test(proof.sourceDigest || '') ||
    !HASH.test(proof.bindingDigest || '')
  )
    throw Error('RECOVERY_IDENTITIES');
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
    if (proof[key] !== true) throw Error('RECOVERY_NOT_PROVEN:' + key);
  if (proof.openPullRequests !== 0 || proof.activeRuns !== 0 || proof.pendingLocks !== 0)
    throw Error('RECOVERY_LIVE_WORK');
  return true;
}
export function assertCompletedRelease(state, request, now) {
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
    throw Error('RECOVERY_OPERATOR_NOT_AUTHORIZED');
  if (!target || target.fence !== request.fence || request.claimDigest !== recoveryDigest(target))
    throw Error('RECOVERY_TARGET_MOVED');
  if (request.proofDigest !== recoveryDigest(request.proof)) throw Error('RECOVERY_PROOF_CHANGED');
  assertCompletedObservation(request.proof, target, now);
  return target;
}
export async function recoverCompleted(a, { task, apply = false }) {
  const previous = await a.load(task);
  if (previous) {
    if (previous.task !== task || !previous.request || previous.repository !== REPO)
      throw Error('RECOVERY_JOURNAL_IDENTITY');
    const found = await a.reconcile(previous.request);
    if (found) {
      const done = { ...previous, status: 'completed', result: found, replayed: true };
      if (apply) {
        await a.save(task, done);
        await a.record(done);
      }
      return done;
    }
    if (previous.status === 'completed') throw Error('RECOVERY_COMPLETION_MISSING_FROM_REMOTE');
  }
  const first = await a.observe(task);
  assertCompletedObservation(first.proof, first.claim, a.now());
  if (!apply)
    return { status: 'eligible', proof: first.proof, automaticTakeover: false, sourceWrites: 0 };
  const release = await a.reserve(first);
  try {
    const fresh = await a.observe(task);
    assertCompletedObservation(fresh.proof, fresh.claim, a.now());
    if (
      recoveryDigest(first.claim) !== recoveryDigest(fresh.claim) ||
      first.proof.head !== fresh.proof.head ||
      first.proof.sourceDigest !== fresh.proof.sourceDigest ||
      first.proof.bindingDigest !== fresh.proof.bindingDigest
    )
      throw Error('RECOVERY_CHANGED_DURING_RESERVATION');
    const request = await a.request(fresh);
    const prepared = {
      schemaVersion: 1,
      repository: REPO,
      task,
      status: 'prepared',
      request,
      proof: fresh.proof,
      createdAt: a.now(),
      sourceWrites: 0
    };
    await a.save(task, prepared);
    let result;
    try {
      result = await a.submit(request);
    } catch (error) {
      result = await a.reconcile(request);
      if (!result) throw error;
    }
    if (
      !result ||
      !['released_completed'].includes(result.status) ||
      result.token !== fresh.claim.token
    )
      throw Error('RECOVERY_RESULT_MISMATCH');
    await a.preserved(fresh);
    const done = { ...prepared, status: 'completed', result, finishedAt: a.now(), replayed: false };
    await a.save(task, done);
    await a.record(done);
    return done;
  } finally {
    await release();
  }
}
