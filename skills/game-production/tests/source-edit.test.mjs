import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha } from '../scripts/lib.mjs';
import { replaceSource } from '../scripts/source-edit.mjs';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-edit-'));
  fs.writeFileSync(path.join(root, 'source.mjs'), 'old');
  return { root, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('source write rejects stale input without modifying it', () => {
  const f = fixture();
  try {
    assert.throws(() => replaceSource(f.root, 'source.mjs', 'new', { expectedHash: sha('other') }));
    assert.equal(fs.readFileSync(path.join(f.root, 'source.mjs'), 'utf8'), 'old');
  } finally {
    f.close();
  }
});
test('Windows sharing violation fallback keeps a recovery journal', () => {
  const f = fixture();
  try {
    const r = replaceSource(f.root, 'source.mjs', 'new', {
      expectedHash: sha('old'),
      windows: true,
      retries: 0,
      rename: () => {
        throw Object.assign(Error('busy'), { code: 'EPERM' });
      }
    });
    assert.equal(r.status, 'verified');
    assert.equal(r.mode, 'journaled_windows_in_place');
    assert.equal(fs.readFileSync(path.join(f.root, 'source.mjs'), 'utf8'), 'new');
    const dirs = fs.readdirSync(path.join(f.root, '.gameprod/evidence/source-edits'));
    assert.equal(dirs.length, 1);
  } finally {
    f.close();
  }
});
test('non-sharing errors are never converted to a fallback', () => {
  const f = fixture();
  try {
    assert.throws(() =>
      replaceSource(f.root, 'source.mjs', 'new', {
        expectedHash: sha('old'),
        windows: true,
        retries: 0,
        rename: () => {
          throw Object.assign(Error('full'), { code: 'ENOSPC' });
        }
      })
    );
    assert.equal(fs.readFileSync(path.join(f.root, 'source.mjs'), 'utf8'), 'old');
  } finally {
    f.close();
  }
});
test('private paths and another active source operation are rejected', () => {
  const f = fixture();
  try {
    assert.throws(() => replaceSource(f.root, '.env', 'secret', { expectedHash: null }));
    fs.mkdirSync(path.join(f.root, '.gameprod/evidence'), { recursive: true });
    fs.writeFileSync(
      path.join(f.root, '.gameprod/evidence/ops.lock'),
      JSON.stringify({ pid: process.pid + 100 })
    );
    assert.throws(() => replaceSource(f.root, 'source.mjs', 'new', { expectedHash: sha('old') }));
  } finally {
    f.close();
  }
});
