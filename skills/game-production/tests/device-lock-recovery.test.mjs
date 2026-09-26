import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  processState,
  orphanPlan,
  recoverOrphans,
  lockInventory
} from '../scripts/device-lock-recovery.mjs';
const NOW = Date.parse('2026-09-26T02:00:00Z');
const row = () => ({
  name: 'update.lock',
  hash: 'a'.repeat(64),
  value: { pid: 19288, time: '2026-09-26T01:00:00Z' }
});
function fixture(t, names = ['update.lock', 'install.lock']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-lock-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of names) fs.writeFileSync(path.join(dir, name), JSON.stringify(row().value));
  return dir;
}
const options = () => ({ mode: 'apply', now: () => NOW, state: () => 'absent' });
test('process probe sends only signal zero', () => {
  let args;
  assert.equal(
    processState(44, (...a) => {
      args = a;
    }),
    'alive'
  );
  assert.deepEqual(args, [44, 0]);
});
for (const code of ['EPERM', 'EACCES', 'EIO'])
  test('probe treats ' + code + ' as unknown', () =>
    assert.equal(
      processState(44, () => {
        throw Object.assign(Error(), { code });
      }),
      'unknown'
    )
  );
test('ESRCH is the only absence proof', () =>
  assert.equal(
    processState(44, () => {
      throw Object.assign(Error(), { code: 'ESRCH' });
    }),
    'absent'
  ));
for (const pid of [0, -1, NaN, 1.5, '123', null])
  test('invalid PID ' + String(pid) + ' never invokes OS', () =>
    assert.equal(
      processState(pid, () => {
        throw Error('called');
      }),
      'unknown'
    )
  );
test('live or reused PID cannot be reclaimed', () =>
  assert.throws(() => orphanPlan([row()], NOW, () => 'alive')));
test('permission-unknown PID cannot be reclaimed', () =>
  assert.throws(() => orphanPlan([row()], NOW, () => 'unknown')));
for (const [name, modify] of [
  ['path escape', (r) => (r.name = '../private.key')],
  ['unknown lock', (r) => (r.name = 'other.lock')],
  ['invalid hash', (r) => (r.hash = '')],
  ['fresh lock', (r) => (r.value.time = new Date(NOW - 1000).toISOString())],
  ['future lock', (r) => (r.value.time = new Date(NOW + 1).toISOString())],
  ['missing time', (r) => delete r.value.time],
  ['bad owner', (r) => (r.value.pid = -1)],
  ['null body', (r) => (r.value = null)]
])
  test('rejects ' + name, () => {
    const r = row();
    modify(r);
    assert.throws(() => orphanPlan([r], NOW, () => 'absent'));
  });
test('duplicate lock rejected', () =>
  assert.throws(() => orphanPlan([row(), row()], NOW, () => 'absent')));
test('plan is read-only', (t) => {
  const dir = fixture(t);
  const before = fs.readdirSync(dir);
  const r = recoverOrphans(dir, { ...options(), mode: 'plan' });
  assert.equal(r.status, 'planned');
  assert.deepEqual(fs.readdirSync(dir), before);
});
test('recovery archives exact bytes and repeat is a no-op', (t) => {
  const dir = fixture(t);
  const before = lockInventory(dir);
  const r = recoverOrphans(dir, options());
  assert.equal(r.status, 'recovered');
  assert.equal(r.archived.length, 2);
  assert.deepEqual(lockInventory(dir), []);
  for (const b of before) {
    assert.deepEqual(
      fs.readFileSync(path.join(path.dirname(r.receipt), b.name + '.original.json')),
      b.bytes
    );
    assert.deepEqual(
      fs.readFileSync(path.join(path.dirname(r.receipt), b.name + '.orphan.json')),
      b.bytes
    );
  }
  assert.equal(recoverOrphans(dir, options()).status, 'nothing_to_recover');
  assert.equal(fs.existsSync(path.join(dir, 'recovery.lock')), false);
});
test('alive owner preserves every original byte', (t) => {
  const dir = fixture(t);
  const before = lockInventory(dir);
  assert.throws(() => recoverOrphans(dir, { ...options(), state: () => 'alive' }));
  assert.deepEqual(lockInventory(dir), before);
});
test('malformed JSON is preserved', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'install.lock'), '{broken');
  assert.throws(() => recoverOrphans(dir, options()), /Malformed/);
  assert.equal(fs.readFileSync(path.join(dir, 'install.lock'), 'utf8'), '{broken');
});
test('oversized file is preserved', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'install.lock'), 'x'.repeat(5000));
  assert.throws(() => recoverOrphans(dir, options()), /Unsafe/);
  assert.equal(fs.statSync(path.join(dir, 'install.lock')).size, 5000);
});
test('directory masquerading as lock is preserved', (t) => {
  const dir = fixture(t, []);
  fs.mkdirSync(path.join(dir, 'install.lock'));
  assert.throws(() => recoverOrphans(dir, options()), /Unsafe/);
});
test('existing recovery lease is not removed', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'recovery.lock'), 'another recovery');
  assert.throws(() => recoverOrphans(dir, options()), /already active/);
  assert.equal(fs.readFileSync(path.join(dir, 'recovery.lock'), 'utf8'), 'another recovery');
});
test('changed bytes before move halt without erasing concurrent work', (t) => {
  const dir = fixture(t);
  assert.throws(
    () =>
      recoverOrphans(dir, {
        ...options(),
        beforeMove: (r) => {
          fs.writeFileSync(path.join(dir, r.name), 'concurrent');
        }
      }),
    /changed|Malformed/
  );
  assert.equal(fs.readFileSync(path.join(dir, 'install.lock'), 'utf8'), 'concurrent');
  assert.equal(fs.existsSync(path.join(dir, 'update.lock')), true);
});
test('PID reuse observed before move halts recovery', (t) => {
  const dir = fixture(t);
  let reused = false;
  assert.throws(
    () =>
      recoverOrphans(dir, {
        ...options(),
        state: () => (reused ? 'alive' : 'absent'),
        beforeMove: () => {
          reused = true;
        }
      }),
    /Owner alive/
  );
  assert.equal(lockInventory(dir).length, 2);
});
test('personal application data and signing bytes stay untouched', (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'private-signing'));
  fs.writeFileSync(path.join(dir, 'private-signing', 'identity.local.json'), 'protected');
  fs.writeFileSync(path.join(dir, 'installed.local.json'), 'receipt');
  recoverOrphans(dir, options());
  assert.equal(fs.readFileSync(path.join(dir, 'installed.local.json'), 'utf8'), 'receipt');
  assert.equal(
    fs.readFileSync(path.join(dir, 'private-signing', 'identity.local.json'), 'utf8'),
    'protected'
  );
});
test('read-only recovery cannot infer app installation', (t) => {
  const r = recoverOrphans(fixture(t), { ...options(), mode: 'plan' });
  assert.equal(r.installation, 'not_inferred');
});
