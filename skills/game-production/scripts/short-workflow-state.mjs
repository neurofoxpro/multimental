import { createHash } from 'node:crypto';
import { allowedBranch } from './hub-client.mjs';
import { assertTaskContext, assertPull, REPO } from './short-workflow-core.mjs';
export function shipStatePath(branch) {
  if (!allowedBranch(branch)) throw Error('SHIP_CHECKPOINT_BRANCH');
  return '.gameprod/evidence/ships/' + createHash('sha256').update(branch).digest('hex') + '.json';
}
export function shortOptions(args) {
  if (!Array.isArray(args) || args.some((x) => typeof x !== 'string')) throw Error('SHORT_OPTIONS');
  const [mode, ...values] = args;
  if (!['focus', 'ship', 'accept'].includes(mode)) throw Error('SHORT_MODE');
  let revise = false;
  const rest = values.filter((x) => {
    if (mode === 'ship' && x === '--revise') {
      if (revise) throw Error('DUPLICATE_REVISE');
      revise = true;
      return false;
    }
    return true;
  });
  if (
    rest.length > (mode === 'accept' ? 2 : 1) ||
    (rest[0] && !/^[A-Z]+-\d+$/.test(rest[0])) ||
    (mode === 'accept' && rest.length !== 2)
  )
    throw Error('focus [TASK] | ship [TASK] [--revise] | accept TASK PROOF.json');
  return { mode, rest, revise };
}
export function revisedCheckpoint(journal, current, task, pr, { sourceDigest, descendant, at }) {
  assertTaskContext(current, task);
  if (
    !journal ||
    journal.schemaVersion !== 1 ||
    journal.repository !== REPO ||
    journal.phase !== 'ci' ||
    journal.branch !== current.branch ||
    journal.task !== task.id ||
    journal.token !== current.binding.token ||
    journal.owner !== current.binding.owner
  )
    throw Error('SHIP_REVISION_CONTEXT');
  assertPull(pr, journal.branch, journal.head);
  if (pr.merged_at || pr.state !== 'open' || pr.number !== journal.pr || descendant !== true)
    throw Error('SHIP_REVISION_NOT_OPEN_ANCESTRAL_PR');
  if (
    !/^[a-f0-9]{64}$/.test(sourceDigest || '') ||
    sourceDigest === journal.sourceDigest ||
    !Number.isFinite(Date.parse(at))
  )
    throw Error('SHIP_REVISION_REQUIRES_NEW_SOURCE');
  return {
    schemaVersion: 1,
    repository: REPO,
    task: task.id,
    branch: current.branch,
    owner: current.binding.owner,
    token: current.binding.token,
    phase: 'checking',
    startedAt: at,
    revises: { head: journal.head, pr: journal.pr, sourceDigest: journal.sourceDigest },
    productionAuthorized: false
  };
}
