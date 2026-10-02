import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverSourceLocks } from '../scripts/source-lock-recovery.mjs';
import { acquireRecoverableBarrier } from '../scripts/recovery-barrier.mjs';
const old = '2026-09-29T23:00:00Z',
  now = () => Date.parse('2026-09-30T00:00:00Z');
function f() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-src-recovery-')),
    evidence = path.join(d, 'evidence'),
    workspace = path.join(d, 'workspace');
  fs.mkdirSync(evidence, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const targets = [
    { id: 'worktree:short-workflow.lock', file: path.join(evidence, 'short-workflow.lock') },
    { id: 'worktree:task-accept.lock', file: path.join(evidence, 'task-accept.lock') },
    {
      id: 'workspace:collaboration-dev-integration.lock',
      file: path.join(workspace, 'collaboration-dev-integration.lock')
    }
  ];
  return {
    d,
    evidence,
    workspace,
    targets,
    recovery: path.join(evidence, 'source-recovery.lock'),
    archive: path.join(evidence, 'source-recovery'),
    close: () => fs.rmSync(d, { recursive: true, force: true })
  };
}
const dead = () => 'absent',
  live = () => 'alive';
const put = (file, command, pid = 777, format = true) =>
  fs.writeFileSync(
    file,
    format
      ? JSON.stringify({ pid, token: 'a'.repeat(32), startedAt: old, command })
      : '{ "command":"' +
          command +
          '", "startedAt":"' +
          old +
          '", "token":"' +
          'a'.repeat(32) +
          '", "pid":' +
          pid +
          ' }'
  );
test('dead stale lock archived by exact original bytes and barriers leave clean', () => {
  const x = f();
  try {
    put(x.targets[0].file, 'ship', 777, false);
    const original = fs.readFileSync(x.targets[0].file);
    const r = recoverSourceLocks(x.targets, {
      mode: 'apply',
      now,
      state: dead,
      recoveryFile: x.recovery,
      archiveRoot: x.archive
    });
    assert.equal(r.status, 'recovered');
    assert.equal(fs.existsSync(x.targets[0].file), false);
    assert.equal(fs.existsSync(x.recovery), false);
    const run = path.dirname(r.receipt);
    const backup = fs.readdirSync(run).find((n) => n.endsWith('.original.json'));
    assert.deepEqual(fs.readFileSync(path.join(run, backup)), original);
  } finally {
    x.close();
  }
});
test('one live recognized lock blocks all mutation', () => {
  const x = f();
  try {
    put(x.targets[0].file, 'ship', 1);
    put(x.targets[1].file, 'accept', 2);
    assert.throws(() =>
      recoverSourceLocks(x.targets, {
        mode: 'apply',
        now,
        state: (pid) => (pid === 1 ? 'absent' : 'alive'),
        recoveryFile: x.recovery,
        archiveRoot: x.archive
      })
    );
    assert.equal(fs.existsSync(x.targets[0].file), true);
    assert.equal(fs.existsSync(x.archive), false);
  } finally {
    x.close();
  }
});
test('changed lock before rename aborts and preserves changed bytes', () => {
  const x = f();
  try {
    put(x.targets[0].file, 'ship');
    assert.throws(() =>
      recoverSourceLocks(x.targets, {
        mode: 'apply',
        now,
        state: dead,
        recoveryFile: x.recovery,
        archiveRoot: x.archive,
        beforeMove: (_r, t) => put(t.file, 'ship', 778)
      })
    );
    assert.equal(JSON.parse(fs.readFileSync(x.targets[0].file)).pid, 778);
  } finally {
    x.close();
  }
});
test('concurrent writer after rename is preserved, never overwritten', () => {
  const x = f();
  try {
    put(x.targets[0].file, 'ship');
    assert.throws(() =>
      recoverSourceLocks(x.targets, {
        mode: 'apply',
        now,
        state: dead,
        recoveryFile: x.recovery,
        archiveRoot: x.archive,
        afterMove: (_r, t) => put(t.file, 'ship', 999)
      })
    );
    assert.equal(JSON.parse(fs.readFileSync(x.targets[0].file)).pid, 999);
  } finally {
    x.close();
  }
});
test('stale recovery barrier self-heals, live barrier blocks', () => {
  const x = f();
  try {
    put(x.recovery, 'production-source-recovery', 700);
    const b = acquireRecoverableBarrier(x.recovery, {
      command: 'production-source-recovery',
      now,
      state: dead,
      archiveRoot: x.archive
    });
    b.lease.release();
    assert.equal(fs.existsSync(x.recovery), false);
    put(x.recovery, 'production-source-recovery', 701);
    assert.throws(() =>
      acquireRecoverableBarrier(x.recovery, {
        command: 'production-source-recovery',
        now,
        state: live,
        archiveRoot: x.archive
      })
    );
    assert.equal(fs.existsSync(x.recovery), true);
  } finally {
    x.close();
  }
});
test('stale per-lock recovery barrier is itself recoverable', () => {
  const x = f();
  try {
    put(x.targets[0].file, 'production-source-recovery-barrier');
    const r = recoverSourceLocks(x.targets, {
      mode: 'apply',
      now,
      state: dead,
      recoveryFile: x.recovery,
      archiveRoot: x.archive
    });
    assert.equal(r.status, 'recovered');
    assert.equal(fs.existsSync(x.targets[0].file), false);
  } finally {
    x.close();
  }
});
test('plan is read-only', () => {
  const x = f();
  try {
    put(x.targets[0].file, 'ship');
    const before = fs.readFileSync(x.targets[0].file);
    const r = recoverSourceLocks(x.targets, {
      mode: 'plan',
      now,
      state: dead,
      recoveryFile: x.recovery,
      archiveRoot: x.archive
    });
    assert.equal(r.status, 'planned');
    assert.deepEqual(fs.readFileSync(x.targets[0].file), before);
    assert.equal(fs.existsSync(x.archive), false);
  } finally {
    x.close();
  }
});

test('stale self barrier alone is visible in plan and repairable', () => {
  const x = f();
  try {
    put(x.recovery, 'production-source-recovery', 702);
    const p = recoverSourceLocks(x.targets, {
      mode: 'plan',
      now,
      state: dead,
      recoveryFile: x.recovery,
      archiveRoot: x.archive
    });
    assert.equal(p.status, 'planned');
    assert.ok(p.selfBarrier);
    const r = recoverSourceLocks(x.targets, {
      mode: 'apply',
      now,
      state: dead,
      recoveryFile: x.recovery,
      archiveRoot: x.archive
    });
    assert.equal(r.status, 'recovered');
    assert.equal(r.selfBarrierRecovered, true);
    assert.equal(fs.existsSync(x.recovery), false);
  } finally {
    x.close();
  }
});
