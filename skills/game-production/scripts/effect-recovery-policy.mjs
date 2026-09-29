const SHA = /^[a-f0-9]{40}$/,
  HASH = /^[a-f0-9]{64}$/;
export function commitRecoveryAction({
  journal,
  head,
  dirty,
  tree,
  message,
  parentOfHead,
  headTree,
  headMessage
}) {
  if (!SHA.test(head || '') || typeof dirty !== 'boolean') throw Error('COMMIT_RECOVERY_INPUT');
  if (!journal) {
    return dirty ? { action: 'prepare_and_commit' } : { action: 'reuse_clean_head', head };
  }
  if (
    journal.status !== 'prepared' ||
    !SHA.test(journal.baseHead || '') ||
    !HASH.test(journal.sourceDigest || '') ||
    !/^[a-f0-9]{40}$/.test(journal.expectedTree || '') ||
    typeof journal.message !== 'string' ||
    !journal.message
  )
    throw Error('COMMIT_RECOVERY_JOURNAL');
  if (message !== journal.message) throw Error('COMMIT_RECOVERY_MESSAGE_CHANGED');
  if (head === journal.baseHead) {
    if (!dirty) throw Error('COMMIT_RECOVERY_MISSING_STAGED_EFFECT');
    if (tree !== journal.expectedTree) throw Error('COMMIT_RECOVERY_TREE_CHANGED');
    return { action: 'commit_once' };
  }
  if (dirty) throw Error('COMMIT_RECOVERY_DIRTY_AFTER_COMMIT');
  if (
    parentOfHead !== journal.baseHead ||
    headTree !== journal.expectedTree ||
    headMessage !== journal.message
  )
    throw Error('COMMIT_RECOVERY_UNPROVEN_DESCENDANT');
  return { action: 'reuse_committed_head', head };
}
export function signRecoveryAction({ finalExists, finalValid, stagingExists, stagingValid }) {
  for (const v of [finalExists, finalValid, stagingExists, stagingValid])
    if (typeof v !== 'boolean') throw Error('SIGN_RECOVERY_INPUT');
  if (finalExists && !finalValid) throw Error('SIGN_RECOVERY_FOREIGN_FINAL');
  if (stagingExists && !stagingValid) throw Error('SIGN_RECOVERY_FOREIGN_STAGING');
  if (finalExists) return { action: 'reuse_final' };
  if (stagingExists) return { action: 'promote_staging' };
  return { action: 'sign_once' };
}
