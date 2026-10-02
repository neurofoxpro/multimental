import { createHash } from 'node:crypto';
const REPO = 'neurofoxpro/multimental';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const OWNER = /^[a-z][a-z0-9-]{2,47}$/;
export const continuationDigest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function continuationObservation(proof, claim, now) {
  if (
    !claim ||
    proof?.schemaVersion !== 1 ||
    proof.repository !== REPO ||
    proof.task !== claim.task ||
    proof.claimDigest !== continuationDigest(claim)
  )
    throw Error('CONTINUATION_TARGET_CHANGED');
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(proof.observedAt) ||
    proof.observedAt > now ||
    now - proof.observedAt > 120000 ||
    claim.expiresAt >= now
  )
    throw Error('CONTINUATION_REQUIRES_FRESH_PROOF_OF_INTERRUPTED_SLICE');
  if (
    !SHA.test(proof.head || '') ||
    !SHA.test(proof.dev || '') ||
    !HASH.test(proof.sourceDigest || '') ||
    !HASH.test(proof.bindingDigest || '') ||
    !/^feature\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(proof.branch || '') ||
    proof.branch.includes('..') ||
    !Number.isSafeInteger(proof.pr) ||
    proof.pr < 1
  )
    throw Error('CONTINUATION_SOURCE_IDENTITY');
  if (
    !claim.resources.every(
      (r) =>
        r === 'task:' + claim.task ||
        [
          'area:game-ui',
          'area:game-core',
          'area:automation',
          'area:economy',
          'area:ux-research'
        ].includes(r)
    )
  )
    throw Error('CONTINUATION_HARDWARE_OR_UNKNOWN_RESOURCE_OUTSIDE_SCOPE');
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
    if (proof[key] !== true) throw Error('CONTINUATION_NOT_PROVEN:' + key);
  if (
    proof.openPullRequests !== 1 ||
    proof.activeRuns !== 0 ||
    proof.pendingLocks !== 0 ||
    proof.requestedChanges !== 0 ||
    proof.draft !== false
  )
    throw Error('CONTINUATION_LIVE_WORK_OR_REVIEW_REQUIRES_SEPARATE_ATTENTION');
  return true;
}
export function continuationRequest(state, request, now) {
  const actor = state.claims[request.actorToken],
    target = state.claims[request.token];
  if (
    !actor ||
    actor.token === request.token ||
    actor.owner !== request.owner ||
    actor.fence !== request.actorFence ||
    !actor.resources.some((r) =>
      ['area:automation', 'area:coordination', 'area:workspaces'].includes(r)
    )
  )
    throw Error('CONTINUATION_OPERATOR_NOT_AUTHORIZED');
  if (
    request.intent !== 'owner-requested-project-continuation' ||
    !OWNER.test(request.nextOwner || '') ||
    request.nextOwner === request.owner ||
    request.nextOwner === target?.owner ||
    Object.values(state.claims).some((c) => c.owner === request.nextOwner)
  )
    throw Error('CONTINUATION_EXPLICIT_NEW_OWNER_REQUIRED');
  if (
    !target ||
    target.fence !== request.fence ||
    request.proofDigest !== continuationDigest(request.proof) ||
    request.claimDigest !== continuationDigest(target) ||
    request.base !== request.proof.dev
  )
    throw Error('CONTINUATION_EXACT_TARGET_REQUIRED');
  continuationObservation(request.proof, target, now);
  return { actor, target };
}
export async function continueInterrupted(a, { task, nextOwner, apply = false }) {
  const old = await a.load();
  if (old) {
    if (old.repository !== REPO || old.task !== task || old.nextOwner !== nextOwner || !old.request)
      throw Error('CONTINUATION_JOURNAL_MISMATCH');
    const actual = await a.reconcile(old.request);
    if (actual) {
      const done = { ...old, status: 'transferred', result: actual, replayed: true };
      if (apply) {
        await a.save(done);
        await a.finish(done);
      }
      return done;
    }
    if (old.status === 'transferred') throw Error('CONTINUATION_RECORDED_REMOTE_EVENT_MISSING');
  }
  const first = await a.observe();
  continuationObservation(first.proof, first.claim, a.now());
  if (!apply)
    return {
      status: 'eligible_for_explicit_continuation',
      proof: first.proof,
      nextOwner,
      automaticSteal: false
    };
  const release = await a.reserve(first);
  let done;
  try {
    const fresh = await a.observe();
    continuationObservation(fresh.proof, fresh.claim, a.now());
    if (
      continuationDigest(first.claim) !== continuationDigest(fresh.claim) ||
      first.proof.head !== fresh.proof.head ||
      first.proof.sourceDigest !== fresh.proof.sourceDigest ||
      first.proof.bindingDigest !== fresh.proof.bindingDigest ||
      first.proof.dev !== fresh.proof.dev
    )
      throw Error('CONTINUATION_CHANGED_DURING_RESERVATION');
    const request = await a.request(fresh);
    const prepared = {
      schemaVersion: 1,
      repository: REPO,
      task,
      nextOwner,
      status: 'prepared',
      request,
      proof: fresh.proof,
      createdAt: a.now(),
      sourceWrites: 0,
      phoneChanges: 0
    };
    await a.save(prepared);
    let result;
    try {
      result = await a.submit(request);
    } catch (error) {
      result = await a.reconcile(request);
      if (!result) throw error;
    }
    if (
      result?.status !== 'continuation_transferred' ||
      result.token !== request.id ||
      result.task !== task ||
      result.owner !== nextOwner ||
      result.previousToken !== fresh.claim.token
    )
      throw Error('CONTINUATION_READBACK_MISMATCH');
    await a.preserved(fresh);
    done = { ...prepared, status: 'transferred', result, finishedAt: a.now(), replayed: false };
    await a.save(done);
  } finally {
    await release();
  }
  await a.finish(done);
  return done;
}
