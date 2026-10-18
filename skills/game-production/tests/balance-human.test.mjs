import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeries, summarizeSeries } from '../scripts/balance-human-policy.mjs';

const C = 'a'.repeat(40),
  H = 'b'.repeat(64);
const fixture = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  kind: 'human-duration-series',
  releaseTag: 'v0.14.3-alpha.311.1',
  sourceCommit: C,
  installedVersion: '0.14.3-alpha.311.1',
  apkSha256: H,
  observedAt: '2026-09-30T12:00:00Z',
  matches: [
    {
      id: 'h1',
      releaseTag: 'v0.14.3-alpha.311.1',
      sourceCommit: C,
      startedAt: '2026-09-30T12:00:00Z',
      finishedAt: '2026-09-30T12:08:00Z',
      humanControlledPlayers: 1,
      mode: 'local',
      firstPlayer: 0,
      resultReason: 'five',
      interrupted: false,
      notes: ''
    },
    {
      id: 'h2',
      releaseTag: 'v0.14.3-alpha.311.1',
      sourceCommit: C,
      startedAt: '2026-09-30T12:10:00Z',
      finishedAt: '2026-09-30T12:22:00Z',
      humanControlledPlayers: 2,
      mode: 'lan',
      firstPlayer: 1,
      resultReason: 'empty',
      interrupted: false,
      notes: ''
    },
    {
      id: 'h3',
      releaseTag: 'v0.14.3-alpha.311.1',
      sourceCommit: C,
      startedAt: '2026-09-30T12:30:00Z',
      finishedAt: '2026-09-30T12:45:00Z',
      humanControlledPlayers: 2,
      mode: 'online',
      firstPlayer: 0,
      resultReason: 'limit',
      interrupted: false,
      notes: ''
    },
    {
      id: 'h4',
      releaseTag: 'v0.14.3-alpha.311.1',
      sourceCommit: C,
      startedAt: '2026-09-30T13:00:00Z',
      finishedAt: '2026-09-30T13:05:00Z',
      humanControlledPlayers: 1,
      mode: 'other',
      firstPlayer: 1,
      resultReason: 'disconnect',
      interrupted: true,
      notes: 'external interruption'
    }
  ]
});
test('valid human series derives duration only from timestamps', () => {
  const s = validateSeries(fixture());
  assert.deepEqual(
    s.matches.map((x) => x.durationSeconds),
    [480, 720, 900, 300]
  );
});
test('summary separates interrupted rows and never auto-accepts', () => {
  const r = summarizeSeries(fixture());
  assert.equal(r.usableMatches, 3);
  assert.equal(r.interruptedRows, 1);
  assert.equal(r.durationSeconds.median, 720);
  assert.equal(r.durationSeconds.p90, 900);
  assert.equal(r.within10Minutes, 1);
  assert.equal(r.between10And15Minutes, 1);
  assert.equal(r.hardLimitMatches, 1);
  assert.equal(r.over15Minutes, 0);
  assert.equal(r.byHumanControlledPlayers.one.count, 1);
  assert.equal(r.byHumanControlledPlayers.two.count, 2);
  assert.equal(r.humanAcceptance, 'pending');
  assert.equal(r.automaticPass, false);
});
for (const [name, change] of [
  ['duplicate id', (s) => (s.matches[1].id = 'h1')],
  ['wrong release', (s) => (s.matches[0].releaseTag = 'v0.1.0-alpha.1.1')],
  ['wrong source', (s) => (s.matches[0].sourceCommit = 'c'.repeat(40))],
  ['no human', (s) => (s.matches[0].humanControlledPlayers = 0)],
  ['bad mode', (s) => (s.matches[0].mode = 'headless')],
  ['bad first player', (s) => (s.matches[0].firstPlayer = 2)],
  ['bad reason', (s) => (s.matches[0].resultReason = 'ai')],
  ['bad interrupted flag', (s) => (s.matches[0].interrupted = 'false')],
  ['bad timestamp', (s) => (s.matches[0].finishedAt = 'x')],
  ['too short', (s) => (s.matches[0].finishedAt = '2026-09-30T12:00:10Z')],
  ['too long', (s) => (s.matches[0].finishedAt = '2026-09-30T14:30:01Z')]
])
  test('rejects ' + name, () => {
    const s = fixture();
    change(s);
    assert.throws(() => validateSeries(s));
  });
test('series identity is exact and bounded', () => {
  for (const change of [
    (s) => (s.repository = 'other/repo'),
    (s) => (s.releaseTag = 'dev'),
    (s) => (s.sourceCommit = 'dev'),
    (s) => (s.apkSha256 = 'bad'),
    (s) => (s.observedAt = 'never'),
    (s) => (s.matches = 'not-array')
  ]) {
    const s = fixture();
    change(s);
    assert.throws(() => validateSeries(s));
  }
});
