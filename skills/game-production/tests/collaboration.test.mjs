import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  emptyCoordination,
  transition,
  assertOwnership,
  validateCoordination
} from '../scripts/collaboration-policy.mjs';
import { coordinate, GitHubCoordination } from '../scripts/collaboration-store.mjs';
const H = 'a'.repeat(40),
  clock = 1790400000000;
const claim = (task = 'AUTO-09', owner = 'chat-alpha', resources = ['area:automation']) => ({
  id: randomUUID(),
  kind: 'claim',
  task,
  owner,
  base: H,
  resources
});
const apply = (state, req) => transition(state, req, clock);
function memoryStore() {
  let snap = { head: H, state: emptyCoordination() };
  return {
    read: async () => structuredClone(snap),
    compareAndSwap: async (head, state) => {
      if (head !== snap.head) throw Error('CAS conflict');
      snap = { head: state.revision.toString(16).padStart(40, '0'), state: structuredClone(state) };
    },
    snapshot: () => snap
  };
}
test('claim owns task and area without changing input', () => {
  const s = emptyCoordination(),
    q = claim(),
    r = apply(s, q);
  assert.equal(Object.keys(s.claims).length, 0);
  assert.equal(r.result.fence, 1);
  assert.equal(assertOwnership(r.state, r.result).task, q.task);
});
test('same operation is idempotent', () => {
  const q = claim(),
    a = apply(emptyCoordination(), q);
  const b = apply(a.state, q);
  assert.equal(b.changed, false);
  assert.deepEqual(b.result, a.result);
});
test('conflicting idempotency content refused', () => {
  const q = claim(),
    a = apply(emptyCoordination(), q);
  assert.throws(() => apply(a.state, { ...q, owner: 'other-chat' }));
});
test('different tasks and nonoverlapping areas can coexist', () => {
  const a = apply(emptyCoordination(), claim());
  const b = apply(a.state, claim('UX-06', 'chat-beta', ['area:ux-research']));
  assert.equal(Object.keys(b.state.claims).length, 2);
});
test('same task cannot be taken by another chat', () => {
  const a = apply(emptyCoordination(), claim());
  assert.throws(() => apply(a.state, claim('AUTO-09', 'chat-beta', [])), /RESOURCE_BUSY/);
});
test('different task with same resource is serialized', () => {
  const a = apply(emptyCoordination(), claim());
  assert.throws(() => apply(a.state, claim('AUTO-10')), /RESOURCE_BUSY/);
});
test('expired heartbeat does not transfer physical ownership', () => {
  const a = apply(emptyCoordination(), claim());
  assert.throws(
    () => transition(a.state, claim('AUTO-10'), clock + 4000000),
    /expired_not_released/
  );
});
test('own heartbeat extends evidence without changing fence', () => {
  const a = apply(emptyCoordination(), claim()),
    q = { id: randomUUID(), kind: 'renew', ...a.result };
  delete q.status;
  q.id = randomUUID();
  q.kind = 'renew';
  const b = transition(a.state, q, clock + 1000);
  assert.equal(b.result.fence, a.result.fence);
  assert.equal(b.result.updatedAt, clock + 1000);
});
test('release is exact and repeatable but cannot authorize further work', () => {
  const a = apply(emptyCoordination(), claim()),
    q = {
      id: randomUUID(),
      kind: 'release',
      owner: a.result.owner,
      token: a.result.token,
      fence: a.result.fence
    };
  const b = apply(a.state, q);
  assert.equal(Object.keys(b.state.claims).length, 0);
  assert.equal(apply(b.state, q).changed, false);
  assert.throws(() => assertOwnership(b.state, a.result));
});
for (const [field, value] of [
  ['owner', 'wrong-chat'],
  ['fence', 999],
  ['token', randomUUID()]
])
  test('cannot release changed ' + field, () => {
    const a = apply(emptyCoordination(), claim());
    assert.throws(() =>
      apply(a.state, {
        id: randomUUID(),
        kind: 'release',
        owner: a.result.owner,
        token: a.result.token,
        fence: a.result.fence,
        [field]: value
      })
    );
  });
for (const [field, value] of [
  ['id', 'bad'],
  ['owner', '../escape'],
  ['task', 'x;exit'],
  ['base', 'dev'],
  ['resources', ['integration:main']],
  ['resources', ['task:OTHER-01']],
  ['kind', 'steal']
])
  test('invalid request ' + field, () =>
    assert.throws(() => apply(emptyCoordination(), { ...claim(), [field]: value }))
  );
test('duplicate resource in corrupt state is rejected', () => {
  const a = apply(emptyCoordination(), claim()),
    b = claim('UX-06', 'chat-beta', ['area:ux-research']);
  const c = apply(a.state, b);
  c.state.claims[b.id].resources.push('area:automation');
  assert.throws(() => validateCoordination(c.state));
});
test('simultaneous claims for same resource produce one winner', async () => {
  const store = memoryStore();
  const r = await Promise.allSettled([
    coordinate(store, claim(), { pause: async () => {} }),
    coordinate(store, claim('AUTO-10', 'chat-beta'), { pause: async () => {} })
  ]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(Object.keys(store.snapshot().state.claims).length, 1);
});
test('simultaneous independent claims both survive CAS retry', async () => {
  const store = memoryStore();
  await Promise.all([
    coordinate(store, claim(), { pause: async () => {} }),
    coordinate(store, claim('UX-06', 'chat-beta', ['area:ux-research']), { pause: async () => {} })
  ]);
  assert.equal(Object.keys(store.snapshot().state.claims).length, 2);
});
test('lost successful reply is read back without repeating mutation', async () => {
  const s = memoryStore(),
    original = s.compareAndSwap;
  let calls = 0;
  s.compareAndSwap = async (...a) => {
    calls++;
    await original(...a);
    throw Error('lost reply');
  };
  const r = await coordinate(s, claim());
  assert.equal(calls, 1);
  assert.equal(r.recoveredReply, true);
});
test('failed unchanged write is not blindly retried', async () => {
  const s = memoryStore();
  let calls = 0;
  s.compareAndSwap = async () => {
    calls++;
    throw Error('forbidden');
  };
  await assert.rejects(coordinate(s, claim()), /forbidden/);
  assert.equal(calls, 1);
});
test('coordination read failure does not authorize work', async () => {
  await assert.rejects(
    coordinate(
      {
        read: async () => {
          throw Error('offline');
        }
      },
      claim()
    ),
    /offline/
  );
});
test('exact fixed branch/path and expected head in mutation', async () => {
  let request;
  const c = new GitHubCoordination('fake', async (url, options) => {
    request = { url, ...options };
    return {
      ok: true,
      json: async () => ({ data: { createCommitOnBranch: { commit: { oid: H } } } })
    };
  });
  await c.compareAndSwap(H, emptyCoordination(), randomUUID());
  const input = JSON.parse(request.body).variables.input;
  assert.equal(input.branch.branchName, 'coordination-state');
  assert.equal(input.expectedHeadOid, H);
  assert.equal(input.fileChanges.additions[0].path, '.gameprod/collaboration-state.json');
  assert.equal(request.redirect, 'error');
});
test('replayed historical claim cannot regain released resource', () => {
  const q = claim(),
    a = apply(emptyCoordination(), q);
  const b = apply(a.state, {
    id: randomUUID(),
    kind: 'release',
    owner: q.owner,
    token: q.id,
    fence: 1
  });
  const replay = apply(b.state, q);
  assert.equal(replay.changed, false);
  assert.throws(() => assertOwnership(b.state, replay.result));
});
