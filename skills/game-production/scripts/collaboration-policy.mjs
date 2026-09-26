import { createHash } from 'node:crypto';
import { assertCompletedRelease } from './completed-recovery-policy.mjs';
export const COORD_BRANCH = 'coordination-state';
export const COORD_FILE = '.gameprod/collaboration-state.json';
export const COORD_REPO = 'neurofoxpro/multimental';
const ID = /^[A-Z]+-\d+$/;
const OWNER = /^[a-z][a-z0-9-]{2,47}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
export const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function emptyCoordination() {
  return { schemaVersion: 1, repository: COORD_REPO, revision: 0, claims: {}, events: [] };
}
export function resourceName(value) {
  return (
    typeof value === 'string' &&
    /^(task:[A-Z]+-\d+|area:[a-z][a-z0-9-]+|station:[a-zA-Z0-9-]+|integration:dev)$/.test(value) &&
    value.length <= 80
  );
}
export function validateCoordination(state) {
  if (
    state?.schemaVersion !== 1 ||
    state.repository !== COORD_REPO ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !state.claims ||
    typeof state.claims !== 'object' ||
    Array.isArray(state.claims) ||
    !Array.isArray(state.events) ||
    state.events.length > 256
  )
    throw Error('Invalid coordination state');
  const resources = new Set();
  if (Object.keys(state.claims).length > 64) throw Error('Too many active claims');
  for (const [token, claim] of Object.entries(state.claims)) {
    if (
      !UUID.test(token) ||
      token !== claim.token ||
      !ID.test(claim.task) ||
      !OWNER.test(claim.owner) ||
      !SHA.test(claim.base) ||
      !Number.isSafeInteger(claim.fence) ||
      claim.fence < 1 ||
      claim.fence > state.revision ||
      !Number.isFinite(claim.updatedAt) ||
      !Number.isFinite(claim.expiresAt) ||
      claim.expiresAt <= claim.updatedAt ||
      !Array.isArray(claim.resources) ||
      !claim.resources.includes('task:' + claim.task)
    )
      throw Error('Invalid active claim');
    for (const resource of claim.resources) {
      if (!resourceName(resource) || resources.has(resource))
        throw Error('Overlapping/invalid ownership');
      resources.add(resource);
    }
  }
  for (const event of state.events)
    if (
      !UUID.test(event.id) ||
      !/^[a-f0-9]{64}$/.test(event.hash) ||
      !Number.isSafeInteger(event.revision)
    )
      throw Error('Invalid coordination event');
  return state;
}
export function transition(state, request, now) {
  validateCoordination(state);
  if (
    !Number.isSafeInteger(now) ||
    !UUID.test(request?.id || '') ||
    !OWNER.test(request.owner || '') ||
    !['claim', 'renew', 'release', 'release_completed'].includes(request.kind)
  )
    throw Error('Invalid coordination command');
  const hash = digest(request),
    existing = state.events.find((e) => e.id === request.id);
  if (existing) {
    if (existing.hash !== hash) throw Error('Operation identity reused with different payload');
    return { state, result: existing.result, changed: false };
  }
  const next = structuredClone(state);
  let result;
  if (request.kind === 'claim') {
    if (
      !ID.test(request.task || '') ||
      !SHA.test(request.base || '') ||
      !Array.isArray(request.resources) ||
      request.resources.length > 8 ||
      request.resources.some((r) => !resourceName(r) || r.startsWith('task:'))
    )
      throw Error('Invalid requested scope');
    const resources = [...new Set(['task:' + request.task, ...request.resources])].sort();
    const conflict = Object.values(state.claims).find((c) =>
      c.resources.some((r) => resources.includes(r))
    );
    if (conflict)
      throw Error(
        'RESOURCE_BUSY ' +
          conflict.task +
          ' owner=' +
          conflict.owner +
          (conflict.expiresAt < now ? ' heartbeat_expired_not_released' : '')
      );
    if (Object.keys(next.claims).length >= 64) throw Error('Active claim limit');
    const claim = {
      token: request.id,
      task: request.task,
      owner: request.owner,
      base: request.base,
      resources,
      fence: state.revision + 1,
      updatedAt: now,
      expiresAt: now + 1800000
    };
    next.claims[claim.token] = claim;
    result = { status: 'claimed', ...claim };
  } else if (request.kind === 'release_completed') {
    const target = assertCompletedRelease(state, request, now);
    delete next.claims[target.token];
    result = {
      status: 'released_completed',
      token: target.token,
      task: target.task,
      owner: target.owner,
      fence: target.fence,
      operator: request.owner,
      proofDigest: request.proofDigest,
      head: request.proof.head,
      pr: request.proof.pr
    };
  } else {
    if (!UUID.test(request.token || '') || !Number.isSafeInteger(request.fence))
      throw Error('Exact token and fence required');
    const claim = next.claims[request.token];
    if (!claim || claim.owner !== request.owner || claim.fence !== request.fence)
      throw Error('STALE_OR_FOREIGN_CLAIM');
    if (request.kind === 'renew') {
      claim.updatedAt = now;
      claim.expiresAt = now + 1800000;
      result = { status: 'renewed', ...claim };
    } else {
      delete next.claims[request.token];
      result = {
        status: 'released',
        token: request.token,
        task: claim.task,
        owner: request.owner,
        fence: claim.fence
      };
    }
  }
  next.revision++;
  next.events.push({ id: request.id, hash, revision: next.revision, result });
  next.events = next.events.slice(-256);
  validateCoordination(next);
  return { state: next, result, changed: true };
}
export function assertOwnership(state, binding) {
  validateCoordination(state);
  const claim = state.claims[binding?.token];
  if (
    !claim ||
    claim.owner !== binding.owner ||
    claim.fence !== binding.fence ||
    claim.task !== binding.task
  )
    throw Error('Worktree ownership no longer valid');
  return claim;
}
