import test from 'node:test';
import assert from 'node:assert/strict';
import { publicInstall, nextCommand, renderHandoff } from '../scripts/handoff-lib.mjs';
test('handoff cannot publish station secrets', () =>
  assert.deepEqual(
    publicInstall({
      version: '1',
      sourceCommit: 'x',
      serial: 'secret',
      password: 'private',
      token: 'token'
    }),
    { version: '1', sourceCommit: 'x' }
  ));
test('handoff chooses exact-head missing stages, never starts a project again', () => {
  const p = { number: 14, state: 'OPEN', isDraft: true, baseRefName: 'dev' };
  assert.equal(nextCommand({ dirty: true }).command, 'audit');
  assert.equal(
    nextCommand({ head: 'b', dirty: false, pr: p, candidate: { head: 'a' } }).command,
    'candidate'
  );
  assert.equal(
    nextCommand({ head: 'b', pr: p, candidate: { head: 'b' }, qualification: { status: 'failed' } })
      .command,
    'qualify --physical'
  );
  assert.equal(
    nextCommand({
      head: 'b',
      pr: p,
      candidate: { head: 'b' },
      qualification: { status: 'passed', candidateHead: 'b' }
    }).command,
    'integrate 14'
  );
});
test('handoff preserves actual version and unfinished implementation', () => {
  const h = {
    observedAt: 'date',
    branch: 'feature/a',
    head: 'x',
    dirty: false,
    pr: null,
    installed: { version: '0.1.2', sourceCommit: 'old' },
    next: { command: 'resume', why: 'Read' },
    remaining: [{ id: 'META-01', version: '0.4.0', text: 'Коллекция', status: 'planned' }],
    manual: [{ text: 'Интерес игры' }]
  };
  const r = renderHandoff(h);
  for (const expected of ['VENEL-SENDRIK', '0.1.2', 'META-01', 'Нереализованный код не переносить'])
    assert.ok(r.includes(expected));
});
