import test from 'node:test';
import assert from 'node:assert/strict';
import { HubClient } from '../scripts/hub-client.mjs';
const response = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value
});
test('read retries a transient transport failure without changing URL or method', async () => {
  let calls = 0;
  const waits = [],
    seen = [];
  const client = new HubClient('test', {
    pause: async (ms) => waits.push(ms),
    fetcher: async (url, options) => {
      seen.push([url, options.method]);
      if (++calls === 1) throw Error('stale socket');
      return response({ ok: true });
    }
  });
  assert.deepEqual(await client.api('GET', '/releases'), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(waits, [500]);
});
test('read transport retries are bounded even if every connection fails', async () => {
  let calls = 0;
  const client = new HubClient('test', {
    pause: async () => {},
    fetcher: async () => {
      calls++;
      throw Error('private request detail must not leak');
    }
  });
  await assert.rejects(client.api('GET', '/issues'), (e) => e.message === 'HUB_READ_UNAVAILABLE');
  assert.equal(calls, 3);
});
test('mixed HTTP and socket failures share one total read retry budget', async () => {
  let calls = 0;
  const client = new HubClient('test', {
    pause: async () => {},
    fetcher: async () => {
      calls++;
      if (calls === 1) return response({}, 503);
      throw Error('socket');
    }
  });
  await assert.rejects(client.api('GET', '/issues'), /HUB_READ_UNAVAILABLE/);
  assert.equal(calls, 3);
});
test('unknown write result is never automatically repeated', async () => {
  let calls = 0;
  const client = new HubClient('test', {
    pause: async () => {
      throw Error('write must not retry');
    },
    fetcher: async () => {
      calls++;
      throw Error('lost reply');
    }
  });
  await assert.rejects(
    client.api('POST', '/issues/29/comments', { body: 'fixture' }),
    /HUB_WRITE_UNKNOWN_READBACK_REQUIRED/
  );
  assert.equal(calls, 1);
});
test('authorization failure is not retried as a transport problem', async () => {
  let calls = 0;
  const client = new HubClient('test', {
    pause: async () => {},
    fetcher: async () => {
      calls++;
      return response({}, 403);
    }
  });
  await assert.rejects(client.api('GET', '/issues'), /HUB_HTTP_403/);
  assert.equal(calls, 1);
});
test('partial read JSON retries without accepting truncated data', async () => {
  let calls = 0;
  const client = new HubClient('test', {
    pause: async () => {},
    fetcher: async () => {
      calls++;
      return calls === 1
        ? {
            ok: true,
            status: 200,
            json: async () => {
              throw Error('truncated');
            }
          }
        : response({ complete: true });
    }
  });
  assert.deepEqual(await client.api('GET', '/issues/29'), { complete: true });
  assert.equal(calls, 2);
});
test('partial write JSON remains ambiguous and requires caller readback', async () => {
  let calls = 0;
  const client = new HubClient('test', {
    pause: async () => {},
    fetcher: async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw Error('truncated reply');
        }
      };
    }
  });
  await assert.rejects(
    client.api('PATCH', '/issues/35', { state: 'closed' }),
    /HUB_WRITE_UNKNOWN_READBACK_REQUIRED/
  );
  assert.equal(calls, 1);
});
