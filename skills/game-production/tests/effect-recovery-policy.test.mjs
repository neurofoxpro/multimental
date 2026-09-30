import test from 'node:test';
import assert from 'node:assert/strict';
import { commitRecoveryAction, signRecoveryAction } from '../scripts/effect-recovery-policy.mjs';
const base = 'a'.repeat(40),
  head = 'b'.repeat(40),
  tree = 'c'.repeat(40),
  digest = 'd'.repeat(64),
  msg = 'feat: AUTO-07';
const j = {
  status: 'prepared',
  baseHead: base,
  sourceDigest: digest,
  expectedTree: tree,
  message: msg
};
test('first dirty publication prepares one commit', () =>
  assert.equal(
    commitRecoveryAction({ journal: null, head: base, dirty: true }).action,
    'prepare_and_commit'
  ));
test('clean publication reuses existing head without dummy commit', () =>
  assert.equal(
    commitRecoveryAction({ journal: null, head: base, dirty: false }).action,
    'reuse_clean_head'
  ));
test('crash before commit resumes exact staged tree once', () =>
  assert.equal(
    commitRecoveryAction({ journal: j, head: base, dirty: true, tree, message: msg }).action,
    'commit_once'
  ));
test('crash after commit reuses exact direct descendant', () =>
  assert.equal(
    commitRecoveryAction({
      journal: j,
      head,
      dirty: false,
      message: msg,
      parentOfHead: base,
      headTree: tree,
      headMessage: msg
    }).action,
    'reuse_committed_head'
  ));
test('foreign descendant or dirty post-commit state blocks', () => {
  assert.throws(() =>
    commitRecoveryAction({
      journal: j,
      head,
      dirty: false,
      message: msg,
      parentOfHead: 'e'.repeat(40),
      headTree: tree,
      headMessage: msg
    })
  );
  assert.throws(() =>
    commitRecoveryAction({
      journal: j,
      head,
      dirty: true,
      message: msg,
      parentOfHead: base,
      headTree: tree,
      headMessage: msg
    })
  );
});
test('sign starts once only when no candidate exists', () =>
  assert.equal(
    signRecoveryAction({
      finalExists: false,
      finalValid: false,
      stagingExists: false,
      stagingValid: false
    }).action,
    'sign_once'
  ));
test('verified staging promotes without signing twice', () =>
  assert.equal(
    signRecoveryAction({
      finalExists: false,
      finalValid: false,
      stagingExists: true,
      stagingValid: true
    }).action,
    'promote_staging'
  ));
test('verified final is reused after lost acknowledgement', () =>
  assert.equal(
    signRecoveryAction({
      finalExists: true,
      finalValid: true,
      stagingExists: true,
      stagingValid: true
    }).action,
    'reuse_final'
  ));
test('foreign staging/final bytes block overwrite', () => {
  assert.throws(() =>
    signRecoveryAction({
      finalExists: true,
      finalValid: false,
      stagingExists: false,
      stagingValid: false
    })
  );
  assert.throws(() =>
    signRecoveryAction({
      finalExists: false,
      finalValid: false,
      stagingExists: true,
      stagingValid: false
    })
  );
});

test('valid final does not hide foreign staging', () => {
  assert.throws(
    () =>
      signRecoveryAction({
        finalExists: true,
        finalValid: true,
        stagingExists: true,
        stagingValid: false
      }),
    /FOREIGN_STAGING/
  );
});
