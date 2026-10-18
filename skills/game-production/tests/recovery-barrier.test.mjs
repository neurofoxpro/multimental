import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireRecoverableBarrier,
  inspectRecoverableBarrier
} from '../scripts/recovery-barrier.mjs';
const now = () => Date.parse('2026-09-30T00:00:00Z'),
  dead = () => 'absent';
function f(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-barrier-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return { d, file: path.join(d, 'r.lock'), archive: path.join(d, 'a') };
}
function stale(file, command = 'recover') {
  fs.writeFileSync(
    file,
    JSON.stringify({ pid: 77, token: 'a'.repeat(32), startedAt: '2026-09-29T23:00:00Z', command })
  );
}
test('fresh acquire and release leaves no barrier', (t) => {
  const x = f(t),
    r = acquireRecoverableBarrier(x.file, {
      command: 'recover',
      archiveRoot: x.archive,
      now,
      state: dead
    });
  r.lease.release();
  assert.equal(fs.existsSync(x.file), false);
});
test('proven stale barrier archives exact bytes then reacquires', (t) => {
  const x = f(t);
  stale(x.file);
  const before = fs.readFileSync(x.file);
  const r = acquireRecoverableBarrier(x.file, {
    command: 'recover',
    archiveRoot: x.archive,
    now,
    state: dead
  });
  assert.ok(r.recovered);
  assert.deepEqual(fs.readFileSync(r.recovered.archived), before);
  r.lease.release();
});
test('live unknown fresh wrong-command malformed barrier preserved', (t) => {
  for (const setup of [
    () => stale(x.file),
    () => stale(x.file),
    () =>
      fs.writeFileSync(
        x.file,
        JSON.stringify({
          pid: 77,
          token: 'a'.repeat(32),
          startedAt: '2026-09-29T23:59:50Z',
          command: 'recover'
        })
      ),
    () => stale(x.file, 'other'),
    () => fs.writeFileSync(x.file, 'broken')
  ]) {
  }
  const x = f(t);
  stale(x.file);
  assert.throws(() =>
    acquireRecoverableBarrier(x.file, {
      command: 'recover',
      archiveRoot: x.archive,
      now,
      state: () => 'alive'
    })
  );
  assert.ok(fs.existsSync(x.file));
});
test('wrong command is not reclaimed', (t) => {
  const x = f(t);
  stale(x.file, 'other');
  assert.throws(() => inspectRecoverableBarrier(x.file, { command: 'recover', now, state: dead }));
  assert.ok(fs.existsSync(x.file));
});
test('fresh stale-shaped file is preserved', (t) => {
  const x = f(t);
  fs.writeFileSync(
    x.file,
    JSON.stringify({
      pid: 77,
      token: 'a'.repeat(32),
      startedAt: '2026-09-29T23:59:50Z',
      command: 'recover'
    })
  );
  assert.throws(() =>
    acquireRecoverableBarrier(x.file, {
      command: 'recover',
      archiveRoot: x.archive,
      now,
      state: dead
    })
  );
});
