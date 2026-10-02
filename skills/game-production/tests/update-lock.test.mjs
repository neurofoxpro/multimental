import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimUpdateLock } from '../scripts/device-coordination.mjs';
test('a concurrent updater is deferred without deleting its lock', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-update-lock-')),
    file = path.join(d, 'update.lock');
  try {
    assert.equal(claimUpdateLock(file), true);
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(claimUpdateLock(file), null);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
test('unexpected file system failure is not converted to busy', () =>
  assert.throws(() =>
    claimUpdateLock(path.join(os.tmpdir(), 'missing-' + Date.now(), 'update.lock'))
  ));
