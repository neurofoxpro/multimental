import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSignedCandidate } from '../scripts/signed-candidate.mjs';
function fx(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sign-recover-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return { final: path.join(d, 'final.apk'), staging: path.join(d, 'stage.apk') };
}
const verify = (file) => fs.readFileSync(file, 'utf8') === 'signed-good';
test('fresh signing happens once then final is reusable', (t) => {
  const x = fx(t);
  let signs = 0;
  const first = ensureSignedCandidate({
    finalFile: x.final,
    stagingFile: x.staging,
    verify,
    sign: (f) => {
      signs++;
      fs.writeFileSync(f, 'signed-good');
    }
  });
  assert.equal(first.action, 'sign_once');
  assert.equal(signs, 1);
  const second = ensureSignedCandidate({
    finalFile: x.final,
    stagingFile: x.staging,
    verify,
    sign: () => {
      signs++;
    }
  });
  assert.equal(second.action, 'reuse_final');
  assert.equal(signs, 1);
});
test('lost sign acknowledgement reuses verified staging without signing twice', (t) => {
  const x = fx(t);
  fs.writeFileSync(x.staging, 'signed-good');
  let signs = 0;
  const r = ensureSignedCandidate({
    finalFile: x.final,
    stagingFile: x.staging,
    verify,
    sign: () => {
      signs++;
    }
  });
  assert.equal(r.action, 'promote_staging');
  assert.equal(signs, 0);
  assert.equal(verify(x.final), true);
});
test('lost promotion acknowledgement reuses verified final', (t) => {
  const x = fx(t);
  fs.writeFileSync(x.staging, 'signed-good');
  fs.writeFileSync(x.final, 'signed-good');
  let signs = 0;
  const r = ensureSignedCandidate({
    finalFile: x.final,
    stagingFile: x.staging,
    verify,
    sign: () => {
      signs++;
    }
  });
  assert.equal(r.action, 'reuse_final');
  assert.equal(signs, 0);
});
test('foreign staging blocks even when final is valid', (t) => {
  const x = fx(t);
  fs.writeFileSync(x.staging, 'foreign');
  fs.writeFileSync(x.final, 'signed-good');
  assert.throws(
    () =>
      ensureSignedCandidate({
        finalFile: x.final,
        stagingFile: x.staging,
        verify,
        sign: () => {
          throw Error('must not sign');
        }
      }),
    /FOREIGN_STAGING/
  );
});
test('foreign final blocks without overwrite', (t) => {
  const x = fx(t);
  fs.writeFileSync(x.final, 'foreign');
  assert.throws(
    () =>
      ensureSignedCandidate({
        finalFile: x.final,
        stagingFile: x.staging,
        verify,
        sign: () => {
          throw Error('must not sign');
        }
      }),
    /FOREIGN_FINAL/
  );
  assert.equal(fs.readFileSync(x.final, 'utf8'), 'foreign');
});
test('partial invalid result after signing is preserved and rejected', (t) => {
  const x = fx(t);
  assert.throws(
    () =>
      ensureSignedCandidate({
        finalFile: x.final,
        stagingFile: x.staging,
        verify,
        sign: (f) => fs.writeFileSync(f, 'partial')
      }),
    /NOT_VERIFIED/
  );
  assert.equal(fs.readFileSync(x.staging, 'utf8'), 'partial');
  assert.equal(fs.existsSync(x.final), false);
});
