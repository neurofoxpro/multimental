import { normalizeRepo } from './lib.mjs';
const SHA = /^[a-f0-9]{40}$/;
function commitProbe(cmd, root, commit) {
  const result = cmd(root, ['cat-file', '-e', commit + '^{commit}'], true);
  if (result.error || result.signal || !Number.isInteger(result.status))
    throw Error('RECOVERY_GIT_PROBE_UNKNOWN');
  return result.status;
}
/** Fetch objects only, never checkout/reset or replace the observed dev identity. */
export function ensureRecoveryCommit(cmd, root, commit) {
  if (!SHA.test(commit || '')) throw Error('RECOVERY_DEV_IDENTITY');
  const status = commitProbe(cmd, root, commit);
  if (status === 0) return commit;
  if (![1, 128].includes(status)) throw Error('RECOVERY_GIT_PROBE_UNKNOWN');
  if (normalizeRepo(cmd(root, ['remote', 'get-url', 'origin'])) !== 'neurofoxpro/multimental')
    throw Error('RECOVERY_FETCH_WRONG_ORIGIN');
  cmd(root, ['fetch', '--no-tags', 'origin', 'dev']);
  if (commitProbe(cmd, root, commit) !== 0) throw Error('RECOVERY_DEV_OBJECT_UNAVAILABLE');
  return commit;
}
/** Exit 1 is a proven non-ancestor; missing objects/timeouts are unknown, not false. */
export function recoveryAncestor(cmd, root, ancestor, descendant) {
  if (!SHA.test(ancestor || '') || !SHA.test(descendant || ''))
    throw Error('RECOVERY_ANCESTRY_IDENTITY');
  const result = cmd(root, ['merge-base', '--is-ancestor', ancestor, descendant], true);
  if (!result.error && !result.signal && [0, 1].includes(result.status)) return result.status === 0;
  throw Error('RECOVERY_ANCESTRY_UNKNOWN');
}
