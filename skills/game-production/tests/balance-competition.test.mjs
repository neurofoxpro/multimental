import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DECKS,
  PAIRS,
  expectedDeck,
  validatePlan,
  argsFor,
  seedsFor,
  requests,
  validateShard,
  summarize
} from '../scripts/balance-competition-policy.mjs';

const H = 'a'.repeat(64);
const plan = () => JSON.parse(fs.readFileSync('tools/balance-mixed-plan.json', 'utf8'));

test('registered mixed decks cover all accepted cards equally', () => {
  const p = validatePlan(plan());
  const counts = Array(30).fill(0);
  for (let i = 0; i < DECKS.length; i++) {
    assert.deepEqual(p.decks[DECKS[i]], expectedDeck(i));
    assert.equal(new Set(p.decks[DECKS[i]]).size, 15);
    for (const id of p.decks[DECKS[i]]) counts[id]++;
  }
  assert.deepEqual(counts, Array(30).fill(5));
});
test('mixed seeds and shard matrix are deterministic and bounded', () => {
  const seeds = seedsFor(20260929, 32);
  assert.equal(seeds.length, 32);
  assert.equal(new Set(seeds).size, 32);
  assert.deepEqual(seeds, seedsFor(20260929, 32));
  assert.deepEqual(seeds.slice(0, 4), seedsFor(20260929, 4));
  const req = requests(plan(), seeds);
  assert.equal(req.length, 64);
  assert.deepEqual([...new Set(req.map((x) => x.policyPair))], PAIRS);
  assert.ok(req.every((x) => x.seeds.length === 2 && x.maxCommands === 240));
});

for (const args of [
  ['unknown'],
  ['plan', '--count', '32'],
  ['run', '--count', '0'],
  ['run', '--count', '65'],
  ['run', '--seed', '0'],
  ['run', '--name', '../escape'],
  ['run', '--count', '2', '--count', '3']
])
  test('mixed CLI rejects unsafe args ' + args.join(' '), () => assert.throws(() => argsFor(args)));

function row(seed, left, right, policyPair) {
  const pair = Object.fromEntries(
    plan().policyPairs.map((item) => [item.id, { left: item.left, right: item.right }])
  )[policyPair];
  const first = seed % 2;
  return {
    ok: true,
    seed,
    left,
    right,
    policyPair,
    leftPolicy: pair.left,
    rightPolicy: pair.right,
    first,
    winner: 2,
    reason: 'empty',
    turns: 12,
    actions: 12,
    forcedLimit: false,
    cycle: {},
    opening: [0, 1].map((player) => ({
      hand: player === first ? 5 : 4,
      deck: player === first ? 10 : 11,
      coins: player === first ? 1 : 2
    })),
    plays: {},
    initialHash: H,
    finalHash: H,
    journalHash: H,
    replayVerified: true,
    canonicalStart: true
  };
}

function part(request) {
  return {
    request,
    data: {
      schemaVersion: 1,
      ok: true,
      plan: 'mixed-competition-v1',
      rules: 'terrain-sweep-v3-balance1',
      sourceGameplayChanged: false,
      limitsAreClockMinutes: false,
      engine: { major: 4, minor: 7, patch: 2, status: 'stable' },
      rows: request.seeds.flatMap((seed) =>
        DECKS.flatMap((left) => DECKS.map((right) => row(seed, left, right, request.policyPair)))
      )
    }
  };
}

test('one mixed shard is exact ordered 10x10 per seed and rejects corruption', () => {
  const request = requests(plan(), [42, 43])[0];
  const valid = part(request);
  assert.equal(validateShard(valid.data, request).rows.length, 200);
  const bad = structuredClone(valid);
  bad.data.rows[0].leftPolicy = 'random';
  assert.throws(() => validateShard(bad.data, request), /BAD_ROW/);
  const duplicate = structuredClone(valid);
  duplicate.data.rows[1] = structuredClone(duplicate.data.rows[0]);
  assert.throws(() => validateShard(duplicate.data, request), /DUPLICATE/);
});

test('full synthetic draw matrix reports neutral screens without claiming human balance', () => {
  const p = plan();
  const seeds = seedsFor(20260929, 32);
  const parts = requests(p, seeds).map(part);
  const report = summarize(p, seeds, parts);
  assert.equal(report.games, 12800);
  assert.equal(report.firstMoverScore.mean, 0.5);
  assert.equal(report.firstMoverScreen, 'within_screen');
  assert.equal(report.crossPolicy.positionalScore.mean, 0.5);
  assert.equal(report.crossPolicy.positionalWhenFirst.mean, 0.5);
  assert.equal(report.crossPolicy.positionalWhenSecond.mean, 0.5);
  assert.ok(report.decks.every((deck) => deck.score.mean === 0.5));
  assert.ok(report.decks.every((deck) => deck.screen === 'within_screen'));
  assert.equal(report.humanDuration.status, 'not_measured');
  assert.equal(report.acceptedRulesChanged, false);
  assert.equal(report.overall, 'requires_human_validation');
});

test('wiring keeps standard protocol separate and registers mixed regression', () => {
  const runner = fs.readFileSync('skills/game-production/scripts/balance-audit.mjs', 'utf8');
  const native = fs.readFileSync('game/tests/balance_audit_test.gd', 'utf8');
  assert.match(runner, /args\[0\] === 'mixed'/);
  assert.match(runner, /balance-competition\.mjs/);
  assert.match(native, /balance_competition\.gd/);
  assert.ok(fs.existsSync('tools/balance-mixed-plan.json'));
  assert.ok(fs.existsSync('game/tests/support/balance_competition.gd'));
});
