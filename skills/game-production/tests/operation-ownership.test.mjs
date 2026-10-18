import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireOperation } from '../scripts/operation-lock.mjs';
for (const field of ['pid', 'token', 'startedAt'])
  test('caller cannot override reserved lock ' + field, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-lock-'));
    try {
      const file = path.join(dir, 'ops.lock');
      assert.throws(() => acquireOperation(file, { [field]: 'override' }), /Reserved/);
      assert.equal(fs.existsSync(file), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test('task token stays metadata while operation keeps its own release identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-lock-'));
  try {
    const file = path.join(dir, 'ops.lock'),
      release = acquireOperation(file, { command: 'branch', claimToken: 'public-task-token' });
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(value.claimToken, 'public-task-token');
    assert.notEqual(value.token, value.claimToken);
    release();
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
