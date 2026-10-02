import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubCoordination } from '../scripts/collaboration-store.mjs';
import { emptyCoordination } from '../scripts/collaboration-policy.mjs';
import { allowedEndpoint } from '../scripts/hub-client.mjs';
const H = 'a'.repeat(40);
const meta = {
  data: { repository: { nameWithOwner: 'neurofoxpro/multimental', ref: { target: { oid: H } } } }
};
function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) };
}
test('uninitialized branch is distinct from empty valid state', async () => {
  let calls = 0;
  const c = new GitHubCoordination('fake', async () =>
    ++calls === 1 ? response(meta) : response({}, 404)
  );
  const r = await c.read();
  assert.equal(r.head, H);
  assert.equal(r.state, null);
});
test('contents is read at exact immutable coordinator commit', async () => {
  const urls = [];
  const state = emptyCoordination();
  const c = new GitHubCoordination('fake', async (url) => {
    urls.push(url);
    return urls.length === 1
      ? response(meta)
      : response({
          type: 'file',
          path: '.gameprod/collaboration-state.json',
          encoding: 'base64',
          size: 100,
          content: Buffer.from(JSON.stringify(state)).toString('base64')
        });
  });
  assert.deepEqual((await c.read()).state, state);
  assert.ok(urls[1].endsWith('?ref=' + H));
});
for (const status of [401, 403, 500])
  test('metadata read error ' + status + ' is not treated as empty state', async () => {
    let calls = 0;
    const c = new GitHubCoordination('fake', async () =>
      ++calls === 1 ? response(meta) : response({}, status)
    );
    await assert.rejects(c.read());
  });
test('unexpected coordinator contents shape is rejected', async () => {
  let calls = 0;
  const c = new GitHubCoordination('fake', async () =>
    ++calls === 1
      ? response(meta)
      : response({ type: 'symlink', path: '.gameprod/collaboration-state.json' })
  );
  await assert.rejects(c.read());
});
test('managed labels and native dependencies have narrow write scope', () => {
  assert.equal(allowedEndpoint('POST', '/issues/103/dependencies/blocked_by'), true);
  assert.equal(allowedEndpoint('POST', '/issues/103/labels'), true);
  assert.equal(allowedEndpoint('DELETE', '/issues/103/labels/gp%3Astatus%3Aactive'), true);
  for (const route of [
    '/issues/103/labels/bug',
    '/issues/103/dependencies/blocked_by/1',
    '/git/refs/heads/dev',
    '/labels/bug'
  ])
    assert.equal(allowedEndpoint('DELETE', route), false);
});
