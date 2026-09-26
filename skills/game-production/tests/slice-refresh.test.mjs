import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshPlan } from '../scripts/slice-refresh.mjs';
const fixture = () => ({
  head: 'a'.repeat(40),
  target: 'b'.repeat(40),
  ancestor: true,
  dirty: ['game/tests/new.gd'],
  incoming: ['game/src/main.gd']
});
test('nonoverlapping dirty draft remains preserved by fast-forward plan', () => {
  const r = refreshPlan(fixture());
  assert.equal(r.status, 'fast_forward');
  assert.deepEqual(r.preserve, ['game/tests/new.gd']);
});
test('matching source yields no-op and no invented merge', () => {
  const f = fixture();
  f.target = f.head;
  assert.equal(refreshPlan(f).status, 'already_current');
});
for (const [name, change] of [
  ['divergence', (f) => (f.ancestor = false)],
  ['missing head', (f) => (f.head = '')],
  ['same file', (f) => (f.incoming = f.dirty)],
  ['case collision', (f) => (f.incoming = ['GAME/TESTS/NEW.GD'])],
  ['directory collision', (f) => (f.incoming = ['game/tests'])],
  ['inverse collision', (f) => (f.dirty = ['game'])],
  ['traversal', (f) => (f.dirty = ['../file'])],
  ['absolute', (f) => (f.dirty = ['/tmp/file'])],
  ['Git internals', (f) => (f.dirty = ['.git/config'])],
  ['Windows absolute', (f) => (f.dirty = ['C:/file'])],
  ['invalid target', (f) => (f.target = 'main')]
])
  test('refresh refuses ' + name, () => {
    const f = fixture();
    change(f);
    assert.throws(() => refreshPlan(f));
  });
test('local paths are deduplicated and output independent of input', () => {
  const f = fixture();
  f.dirty.push('game/tests/new.gd');
  const r = refreshPlan(f);
  f.dirty.push('other');
  assert.deepEqual(r.preserve, ['game/tests/new.gd']);
});
