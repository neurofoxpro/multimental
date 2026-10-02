import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptIssue } from '../scripts/task-acceptance.mjs';
import { taskBody } from '../scripts/issue-memory.mjs';
const SHA = 'a'.repeat(40),
  HASH = 'b'.repeat(64);
const task = {
  id: 'META-04',
  title: 'Rewards',
  kind: 'game',
  status: 'planned',
  source: 'owner',
  acceptance: ['retry safe'],
  evidence: []
};
const proof = {
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  taskId: task.id,
  sourceCommit: SHA,
  implementation: { pr: 1, head: SHA },
  acceptance: task.acceptance,
  verification: {
    status: 'passed',
    exitCode: 0,
    sourceDigest: HASH,
    sourceDigestAfter: HASH,
    logHash: HASH
  },
  observedAt: '2026-09-26T08:00:00Z',
  evidence: ['docs/production/rewards.md']
};
function fixture() {
  const state = {
    issue: {
      number: 35,
      user: { login: '4erk' },
      body: taskBody(task, SHA) + '\nKEEP AUTHOR NOTE',
      state: 'open'
    },
    reads: 0,
    writes: 0,
    records: 0,
    fail: '',
    changeAt: 0
  };
  const client = {
    api: async (method, endpoint, body) => {
      assert.equal(endpoint, '/issues/35');
      if (method === 'GET') {
        state.reads++;
        if (state.changeAt === state.reads) state.issue.body += '\nCONCURRENT AUTHOR EDIT';
        return structuredClone(state.issue);
      }
      assert.equal(method, 'PATCH');
      state.writes++;
      if (state.fail === 'before') throw Error('write unavailable');
      Object.assign(state.issue, body);
      if (state.fail === 'after') throw Error('reply lost');
      return structuredClone(state.issue);
    }
  };
  const options = {
    client,
    issue: 35,
    proof,
    reference: 'docs/production/evidence/rewards.json',
    proofHash: HASH,
    record: async () => {
      state.records++;
    }
  };
  return { state, options };
}
test('acceptance preserves author notes and changes only definition/status', async () => {
  const { state, options } = fixture();
  const result = await acceptIssue(options);
  assert.equal(state.issue.state, 'closed');
  assert.ok(state.issue.body.endsWith('KEEP AUTHOR NOTE'));
  assert.ok(state.issue.body.includes('"status": "verified"'));
  assert.equal(state.writes, 1);
  assert.equal(result.recoveredReply, false);
});
test('repeating acceptance is read-only for the Issue body', async () => {
  const { state, options } = fixture();
  await acceptIssue(options);
  const result = await acceptIssue(options);
  assert.equal(result.unchanged, true);
  assert.equal(state.writes, 1);
});
test('lost PATCH acknowledgement is resolved by readback, not another PATCH', async () => {
  const { state, options } = fixture();
  state.fail = 'after';
  const result = await acceptIssue(options);
  assert.equal(result.recoveredReply, true);
  assert.equal(state.writes, 1);
});
test('ambiguous write without applied outcome is not success and not repeated', async () => {
  const { state, options } = fixture();
  state.fail = 'before';
  await assert.rejects(acceptIssue(options), /write unavailable/);
  assert.equal(state.writes, 1);
  assert.equal(state.issue.state, 'open');
});
test('concurrent author edit before PATCH stops without overwriting', async () => {
  const { state, options } = fixture();
  state.changeAt = 2;
  await assert.rejects(acceptIssue(options), /ISSUE_CHANGED/);
  assert.equal(state.writes, 0);
  assert.ok(state.issue.body.endsWith('CONCURRENT AUTHOR EDIT'));
});
test('concurrent edit after PATCH makes readback unconfirmed', async () => {
  const { state, options } = fixture();
  state.changeAt = 3;
  await assert.rejects(acceptIssue(options), /READBACK_MISMATCH/);
  assert.equal(state.writes, 1);
});
test('changed criterion rejects the old proof before notes or writes', async () => {
  const { state, options } = fixture();
  state.issue.body = taskBody({ ...task, acceptance: ['new criterion'] }, SHA);
  await assert.rejects(acceptIssue(options), /CRITERIA_CHANGED/);
  assert.equal(state.writes + state.records, 0);
});
test('multiple definition blocks are not silently rewritten', async () => {
  const { state, options } = fixture();
  state.issue.body += '\n' + taskBody(task, SHA);
  await assert.rejects(acceptIssue(options), /DEFINITION_COUNT/);
  assert.equal(state.writes + state.records, 0);
});
test('untrusted author cannot create a managed acceptance target', async () => {
  const { state, options } = fixture();
  state.issue.user.login = 'untrusted';
  await assert.rejects(acceptIssue(options), /UNTRUSTED_ISSUE/);
  assert.equal(state.writes, 0);
});
test('failure to record evidence does not close the issue', async () => {
  const { state, options } = fixture();
  options.record = async () => {
    throw Error('record failed');
  };
  await assert.rejects(acceptIssue(options), /record failed/);
  assert.equal(state.writes, 0);
});
