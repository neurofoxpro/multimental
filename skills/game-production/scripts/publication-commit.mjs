import fs from 'node:fs';
import { writeJSON } from './lib.mjs';
import { commitRecoveryAction } from './effect-recovery-policy.mjs';

function optionalJSON(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 65536)
    throw Error('PUBLICATION_COMMIT_BAD_JOURNAL');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(file, value) {
  writeJSON(file, value);
}
function parentOf(runGit, head) {
  const parts = runGit(['rev-list', '--parents', '-n', '1', head]).trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== head) throw Error('PUBLICATION_COMMIT_NOT_SINGLE_PARENT');
  return parts[1];
}
function inspectCommitted(runGit, head) {
  return {
    parentOfHead: parentOf(runGit, head),
    headTree: runGit(['rev-parse', head + '^{tree}']),
    headMessage: runGit(['show', '-s', '--format=%s', head])
  };
}
export function ensurePublicationCommit({ file, branch, message, sourceDigest, runGit }) {
  if (
    typeof file !== 'string' ||
    !file ||
    typeof branch !== 'string' ||
    !branch ||
    typeof message !== 'string' ||
    !message ||
    !/^[a-f0-9]{64}$/.test(sourceDigest || '') ||
    typeof runGit !== 'function'
  )
    throw Error('PUBLICATION_COMMIT_INPUT');
  let journal = optionalJSON(file);
  let head = runGit(['rev-parse', 'HEAD']),
    dirty = !!runGit(['status', '--porcelain']);
  if (!journal && !dirty) return { head, reused: true, journal: false };
  if (!journal) {
    runGit(['add', '--all', '--', '.']);
    runGit(['diff', '--cached', '--check']);
    dirty = !!runGit(['status', '--porcelain']);
    if (!dirty) return { head, reused: true, journal: false };
    const expectedTree = runGit(['write-tree']);
    journal = {
      schemaVersion: 1,
      status: 'prepared',
      branch,
      message,
      sourceDigest,
      baseHead: head,
      expectedTree
    };
    save(file, journal);
  }
  if (
    journal.schemaVersion !== 1 ||
    !['prepared', 'committed'].includes(journal.status) ||
    journal.branch !== branch ||
    journal.message !== message ||
    journal.sourceDigest !== sourceDigest ||
    !/^[a-f0-9]{40}$/.test(journal.baseHead || '') ||
    !/^[a-f0-9]{40}$/.test(journal.expectedTree || '')
  )
    throw Error('PUBLICATION_COMMIT_JOURNAL_MISMATCH');
  head = runGit(['rev-parse', 'HEAD']);
  dirty = !!runGit(['status', '--porcelain']);
  if (journal.status === 'committed') {
    if (!/^[a-f0-9]{40}$/.test(journal.head || '') || head !== journal.head || dirty)
      throw Error('PUBLICATION_COMMIT_MOVED');
    const observed = inspectCommitted(runGit, head);
    commitRecoveryAction({
      journal: { ...journal, status: 'prepared' },
      head,
      dirty: false,
      message,
      ...observed
    });
    return { head, reused: true, recovered: true, journal: true };
  }
  let indexTree = null,
    observed = {};
  if (head === journal.baseHead) {
    if (dirty) {
      runGit(['add', '--all', '--', '.']);
      runGit(['diff', '--cached', '--check']);
      indexTree = runGit(['write-tree']);
    }
  } else observed = inspectCommitted(runGit, head);
  const decision = commitRecoveryAction({
    journal,
    head,
    dirty,
    tree: indexTree,
    message,
    ...observed
  });
  if (decision.action === 'commit_once') {
    runGit(['commit', '-m', message]);
    head = runGit(['rev-parse', 'HEAD']);
    const proof = inspectCommitted(runGit, head);
    commitRecoveryAction({ journal, head, dirty: false, message, ...proof });
  } else if (decision.action === 'reuse_committed_head') head = decision.head;
  journal = { ...journal, status: 'committed', head };
  save(file, journal);
  return {
    head,
    reused: decision.action === 'reuse_committed_head',
    recovered: decision.action === 'reuse_committed_head',
    journal: true
  };
}
export function clearPublicationCommit(file, expectedHead) {
  if (!fs.existsSync(file)) return false;
  const j = optionalJSON(file);
  if (j?.status !== 'committed' || j.head !== expectedHead)
    throw Error('PUBLICATION_COMMIT_CLEAR_MISMATCH');
  fs.unlinkSync(file);
  return true;
}
