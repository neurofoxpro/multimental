import test from 'node:test';
import assert from 'node:assert/strict';
import { taskBody, readTask, syncMemory, memorySnapshot } from '../scripts/issue-memory.mjs';
import { HubClient, allowedEndpoint } from '../scripts/hub-client.mjs';
const task = {
  id: 'TASK-01',
  title: 'Проверка',
  source: 'owner',
  stage: 'P0',
  kind: 'game',
  status: 'planned',
  priority: 1,
  dependsOn: [],
  acceptance: ['Результат'],
  evidence: [],
  readset: [],
  requiredForBeta: true,
  requiredForPlay: true
};
const plan = { schemaVersion: 1, repository: 'neurofoxpro/multimental', tasks: [task] };
const H = 'a'.repeat(40);
class Fake {
  constructor() {
    this.rows = [];
    this.comments = [];
    this.writes = [];
    this.n = 1;
    this.pause = async () => {};
    this.fail = false;
  }
  async list(e) {
    return structuredClone(e.startsWith('/issues?') ? this.rows : this.comments);
  }
  async api(method, e, b) {
    this.writes.push({ method, e });
    if (e === '/issues') {
      const x = {
        number: this.n++,
        body: b.body,
        title: b.title,
        user: { login: 'venelsendrik' },
        state: 'open'
      };
      this.rows.push(x);
      if (this.fail) {
        this.fail = false;
        throw Error('unknown');
      }
      return x;
    }
    if (method === 'PATCH') {
      const x = this.rows.find((x) => e.endsWith('/' + x.number));
      Object.assign(x, b);
      return x;
    }
    const c = { id: this.n++, body: b.body, user: { login: 'venelsendrik' } };
    this.comments.push(c);
    return c;
  }
}
test('roundtrip preserves a task as data', () => {
  assert.deepEqual(
    readTask({ body: taskBody(task, H), user: { login: 'venelsendrik' }, number: 1 }).task,
    task
  );
});
test('untrusted issue author is not an authoritative task', () => {
  assert.equal(readTask({ body: taskBody(task, H), user: { login: 'stranger' } }), null);
});
test('duplicate task markers block snapshot', async () => {
  const f = new Fake();
  await syncMemory(f, plan, H);
  f.rows.push({ ...f.rows[1], number: 9 });
  await assert.rejects(memorySnapshot(f, plan), /DUPLICATE/);
});
test('sync twice makes no duplicate or extra write', async () => {
  const f = new Fake();
  await syncMemory(f, plan, H);
  const n = f.writes.length;
  await syncMemory(f, plan, H);
  assert.equal(f.writes.length, n);
});
test('existing human text is preserved', async () => {
  const f = new Fake();
  await syncMemory(f, plan, H);
  f.rows[1].body += '\nКомментарий';
  const before = f.rows[1].body;
  await syncMemory(f, plan, H);
  assert.equal(f.rows[1].body, before);
});
test('unknown create response is reconciled by readback', async () => {
  const f = new Fake();
  f.fail = true;
  await syncMemory(f, plan, H);
  assert.equal(f.rows.length, 2);
});
test('closed does not imply tested', async () => {
  const f = new Fake();
  await syncMemory(f, plan, H);
  f.rows[1].state = 'closed';
  assert.equal((await memorySnapshot(f, plan)).plan.tasks[0].status, 'planned');
});
test('writes cannot create refs or delete data', () => {
  assert.equal(allowedEndpoint('POST', '/git/refs'), false);
  assert.equal(allowedEndpoint('DELETE', '/issues/1'), false);
});
test('read redirects never carry credentials', async () => {
  let opts;
  const c = new HubClient('fake', {
    fetcher: async (u, o) => {
      opts = o;
      return { ok: true, status: 200, json: async () => [] };
    }
  });
  await c.api('GET', '/issues');
  assert.equal(opts.redirect, 'error');
});
test('authentication never printed in errors', async () => {
  const c = new HubClient('secret', {
    fetcher: async () => {
      throw Error('secret');
    }
  });
  await assert.rejects(c.api('GET', '/issues'), (e) => !e.message.includes('secret'));
});
