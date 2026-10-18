import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitRecoveryAction } from '../scripts/effect-recovery-policy.mjs';
import { ensureSignedCandidate } from '../scripts/signed-candidate.mjs';
import { publishAsset } from '../scripts/manual-review-policy.mjs';
import { confirmMerge } from '../scripts/command-retry.mjs';
import { confirmInstallEffect } from '../scripts/install-recovery-policy.mjs';
const A = 'a'.repeat(40),
  B = 'b'.repeat(40),
  TREE = 'c'.repeat(40),
  D = 'd'.repeat(64),
  H = 'e'.repeat(64);

test('recovery matrix: commit before/after effect never requests a second commit', () => {
  const journal = {
    status: 'prepared',
    baseHead: A,
    expectedTree: TREE,
    sourceDigest: D,
    message: 'change'
  };
  assert.equal(
    commitRecoveryAction({ journal, head: A, dirty: true, tree: TREE, message: 'change' }).action,
    'commit_once'
  );
  assert.equal(
    commitRecoveryAction({
      journal,
      head: B,
      dirty: false,
      message: 'change',
      parentOfHead: A,
      headTree: TREE,
      headMessage: 'change'
    }).action,
    'reuse_committed_head'
  );
  assert.throws(
    () =>
      commitRecoveryAction({
        journal,
        head: B,
        dirty: false,
        message: 'change',
        parentOfHead: 'f'.repeat(40),
        headTree: TREE,
        headMessage: 'change'
      }),
    /UNPROVEN/
  );
});

function publisher(effect) {
  const expected = { name: 'manual.apk', size: 10, sha256: H };
  let asset = null,
    journal = null,
    calls = 0;
  return {
    expected,
    calls: () => calls,
    adapter: {
      list: async () => (asset ? [asset] : []),
      load: async () => journal,
      save: async (v) => {
        journal = v;
      },
      immutable: async () => false,
      upload: async () => {
        calls++;
        if (effect)
          asset = {
            id: 7,
            name: expected.name,
            size: expected.size,
            state: 'uploaded',
            digest: 'sha256:' + H
          };
        throw Error(effect ? 'lost upload reply' : 'upload failed before effect');
      }
    }
  };
}
test('recovery matrix: upload before effect is not blindly repeated; after effect is reused', async () => {
  const before = publisher(false);
  await assert.rejects(publishAsset(before.adapter, before.expected));
  await assert.rejects(publishAsset(before.adapter, before.expected), /unconfirmed/);
  assert.equal(before.calls(), 1);
  const after = publisher(true);
  assert.equal((await publishAsset(after.adapter, after.expected)).recoveredReply, true);
  assert.equal((await publishAsset(after.adapter, after.expected)).reused, true);
  assert.equal(after.calls(), 1);
});

test('recovery matrix: merge write executes once and lost reply is recovered by readback', async () => {
  let writes = 0,
    merged = false;
  const r = await confirmMerge({
    expectedHead: A,
    write: async () => {
      writes++;
      merged = true;
      throw Error('lost');
    },
    read: async () => ({
      headRefOid: A,
      baseRefName: 'dev',
      state: merged ? 'MERGED' : 'OPEN',
      mergeCommit: merged ? { oid: B } : null
    }),
    wait: async () => {}
  });
  assert.equal(r.recoveredAfterWriteError, true);
  assert.equal(writes, 1);
  writes = 0;
  await assert.rejects(
    confirmMerge({
      expectedHead: A,
      write: async () => {
        writes++;
        throw Error('before');
      },
      read: async () => ({ headRefOid: A, baseRefName: 'dev', state: 'OPEN', mergeCommit: null }),
      attempts: 2,
      wait: async () => {}
    }),
    /not confirmed/
  );
  assert.equal(writes, 1);
});

test('recovery matrix: sign uses verified staging/final and never overwrites foreign bytes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-recovery-matrix-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const finalFile = path.join(dir, 'final.apk'),
    stagingFile = path.join(dir, 'stage.apk'),
    verify = (f) => fs.readFileSync(f, 'utf8') === 'good';
  let signs = 0;
  fs.writeFileSync(stagingFile, 'good');
  assert.equal(
    ensureSignedCandidate({
      finalFile,
      stagingFile,
      verify,
      sign: () => {
        signs++;
      }
    }).action,
    'promote_staging'
  );
  assert.equal(signs, 0);
  assert.equal(
    ensureSignedCandidate({
      finalFile,
      stagingFile,
      verify,
      sign: () => {
        signs++;
      }
    }).action,
    'reuse_final'
  );
  assert.equal(signs, 0);
  fs.writeFileSync(stagingFile, 'foreign');
  assert.throws(
    () =>
      ensureSignedCandidate({
        finalFile,
        stagingFile,
        verify,
        sign: () => {
          signs++;
        }
      }),
    /FOREIGN_STAGING/
  );
  assert.equal(signs, 0);
});

test('recovery matrix: install before/after effect performs at most one install per observation', async () => {
  let calls = 0,
    actual = { version: 9, hash: 'f'.repeat(64) };
  await assert.rejects(
    confirmInstallEffect({
      perform: async () => {
        calls++;
        throw Error('before');
      },
      observe: async () => actual,
      expectedHash: H,
      expectedVersion: 10
    })
  );
  assert.equal(calls, 1);
  calls = 0;
  actual = { version: 9, hash: 'f'.repeat(64) };
  const r = await confirmInstallEffect({
    perform: async () => {
      calls++;
      actual = { version: 10, hash: H };
      throw Error('lost');
    },
    observe: async () => actual,
    expectedHash: H,
    expectedVersion: 10
  });
  assert.equal(r.recoveredReply, true);
  assert.equal(calls, 1);
});
