import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSONHTTP } from '../scripts/http-read.mjs';
const url = 'https://api.github.com/repos/example/game/releases';
test('transient GET connection and 503 recover with bounded attempts', async () => {
  let count = 0;
  const waits = [];
  const r = await readJSONHTTP(url, {
    fetcher: async () => {
      count++;
      if (count === 1) throw new TypeError('fetch failed');
      if (count === 2) return new Response('', { status: 503 });
      return new Response('{"ok":true}');
    },
    sleep: async (ms) => waits.push(ms)
  });
  assert.equal(r.ok, true);
  assert.equal(count, 3);
  assert.deepEqual(waits, [750, 1500]);
});
test('permission and rate limits are not retried or weakened', async () => {
  for (const code of [401, 403, 429]) {
    let count = 0;
    await assert.rejects(
      () =>
        readJSONHTTP(url, {
          fetcher: async () => {
            count++;
            return new Response('', { status: code, headers: { 'retry-after': '60' } });
          },
          sleep: async () => {}
        }),
      new RegExp(String(code))
    );
    assert.equal(count, 1);
  }
});
test('invalid JSON and oversized metadata fail, rather than succeeding or retrying', async () => {
  await assert.rejects(() => readJSONHTTP(url, { fetcher: async () => new Response('bad') }));
  await assert.rejects(
    () => readJSONHTTP(url, { fetcher: async () => new Response('{"large":1234}'), maxBytes: 4 }),
    /too large/
  );
});
test('unsafe protocol and embedded credentials are rejected before fetch', async () => {
  for (const bad of ['http://api.github.com/x', 'https://token@api.github.com/x'])
    await assert.rejects(
      () =>
        readJSONHTTP(bad, {
          fetcher: async () => {
            throw Error('should not fetch');
          }
        }),
      /HTTPS/
    );
});
