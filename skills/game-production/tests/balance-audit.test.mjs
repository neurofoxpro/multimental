import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DECKS,
  POLICIES,
  hash,
  validatePlan,
  argsFor,
  seedsFor,
  requests,
  validateShard,
  summarize,
  blockInterval,
  quantile,
  resumeShard
} from '../scripts/balance-audit-policy.mjs';
const plan = () => JSON.parse(fs.readFileSync('tools/balance-plan.json', 'utf8'));
const h = 'a'.repeat(64);
function part(request, winner = 'first') {
  const rows = [];
  for (const seed of request.seeds)
    for (const left of DECKS)
      for (const right of DECKS) {
        const first = seed % 2;
        rows.push({
          ok: true,
          seed,
          left,
          right,
          policy: request.policy,
          profile: request.profile,
          first,
          winner: winner === 'draw' ? 2 : first,
          reason: 'five',
          turns: 15,
          actions: 21,
          forcedLimit: false,
          cycle: {},
          opening: [0, 1].map((i) => ({
            hand: i === first ? 5 : 4,
            deck: i === first ? 10 : 11,
            coins: i === first ? 1 : 2
          })),
          openingPasses: 0,
          plays: { 0: 2 },
          initialHash: h,
          finalHash: h,
          journalHash: h,
          replayVerified: true,
          canonicalStart: true
        });
      }
  return {
    request,
    data: {
      schemaVersion: 1,
      ok: true,
      plan: 'standard-start-v1',
      rules: 'terrain-sweep-v3-balance1',
      rows,
      engine: { major: 4, minor: 7, patch: 2, status: 'stable' },
      limitsAreClockMinutes: false,
      sourceGameplayChanged: false
    }
  };
}
test('hashed seed blocks are deterministic, bounded, unique and prefix-stable', () => {
  const a = seedsFor(9001, 32);
  assert.equal(a.length, 32);
  assert.equal(new Set(a).size, 32);
  assert.deepEqual(a, seedsFor(9001, 32));
  assert.deepEqual(a.slice(0, 4), seedsFor(9001, 4));
  assert.ok(a.every((n) => Number.isInteger(n) && n > 0 && n < 2147483647));
  assert.notDeepEqual(a, seedsFor(9002, 32));
});
for (const args of [
  ['run', '--count', '0'],
  ['run', '--count', '65'],
  ['run', '--seed', '-1'],
  ['run', '--seed', '1.5'],
  ['run', '--profile', 'future'],
  ['run', '--name', '../../x'],
  ['run', '--count', '2', '--count', '3'],
  ['plan', '--force', 'yes'],
  ['unknown'],
  ['run', '--seed']
])
  test('bounded args ' + args.join(' '), () => assert.throws(() => argsFor(args)));
test('old CLI options remain explicit and profile before is historical only', () => {
  assert.equal(
    argsFor([
      'run',
      '--count',
      '40',
      '--seed',
      '9001',
      '--profile',
      'before',
      '--name',
      'old-label'
    ]).profile,
    'before'
  );
  assert.equal(argsFor([]).mode, 'plan');
});
test('registered thresholds cannot be weakened silently after seeing results', () => {
  const p = plan();
  validatePlan(p);
  p.tolerances.firstMoverScore = [0.1, 0.9];
  assert.throws(() => validatePlan(p));
});
test('49 ordered matchups per seed count mirrors once and reverse all distinct pairs', () => {
  const req = requests(plan(), seedsFor(9001, 32), 'current');
  assert.equal(req.length, 24);
  const p = part(req[0]);
  validateShard(p.data, p.request);
  assert.equal(p.data.rows.length, 196);
  assert.equal(p.data.rows.filter((r) => r.left === r.right).length, 28);
});
for (const change of [
  (p) => p.data.rows.pop(),
  (p) => (p.data.rows[1] = p.data.rows[0]),
  (p) => (p.data.rows[0].seed = 0),
  (p) => (p.data.rows[1].first = 1 - p.data.rows[1].first),
  (p) => (p.data.rows[0].opening[0].hand = 6),
  (p) => (p.data.rows[0].canonicalStart = false),
  (p) => (p.data.rows[0].replayVerified = false),
  (p) => (p.data.rows[0].forcedLimit = true),
  (p) => (p.data.engine.patch = 3),
  (p) => (p.data.rows[0].cycle = { firstCommand: 2, repeatCommand: 1, hash: h }),
  (p) => (p.data.rows[0].plays = { 30: 1 }),
  (p) => (p.data.rows[0].actions = 999)
])
  test('invalid/mixed experimental evidence rejected ' + change, () => {
    const p = part(requests(plan(), [42], 'current')[0]);
    change(p);
    assert.throws(() => validateShard(p.data, p.request));
  });
test('summary cannot silently combine a partial or duplicated batch', () => {
  const p = plan(),
    seeds = seedsFor(9001, 1),
    parts = requests(p, seeds, 'current').map((r) => part(r));
  assert.throws(() => summarize(p, seeds, parts.slice(1)));
  assert.throws(() => summarize(p, seeds, [parts[0], parts[0], parts[2]]));
});
test('first-turn screen uses seed blocks and diagnoses instead of claiming balance acceptance', () => {
  const p = plan(),
    seeds = seedsFor(9001, 32),
    parts = requests(p, seeds, 'current').map((r) => part(r));
  const s = summarize(p, seeds, parts);
  assert.equal(s.games, 4704);
  assert.equal(s.seedBlocks, 32);
  assert.equal(s.policies[0].firstMoverScore.blocks, 32);
  assert.equal(s.policies[0].firstMoverScreen, 'outside_screen');
  assert.equal(s.policies[2].firstMoverScreen, 'diagnostic_only');
  assert.equal(s.overall, 'concerns_observed');
  assert.equal(s.humanDuration.status, 'not_measured');
  assert.equal(s.acceptedRulesChanged, false);
});
test('small trial never calls a statistical screen passed', () => {
  const p = plan(),
    seeds = seedsFor(9001, 1);
  const s = summarize(
    p,
    seeds,
    requests(p, seeds, 'current').map((r) => part(r, 'draw'))
  );
  assert.equal(s.policies[0].firstMoverScreen, 'inconclusive');
  assert.equal(s.policies[0].firstMoverScore.mean, 0.5);
});
test('draws contribute half points, not discarded or counted as losses twice', () => {
  const p = plan(),
    seeds = seedsFor(9001, 32),
    s = summarize(
      p,
      seeds,
      requests(p, seeds, 'current').map((r) => part(r, 'draw'))
    );
  assert.equal(s.policies[0].firstMoverScore.mean, 0.5);
  assert.equal(s.policies[0].draws, 1568);
  assert.equal(s.policies[0].archetypes[0].games, 384);
  assert.equal(s.policies[0].archetypes[0].score, 0.5);
});
test('bootstrap is bounded, repeatable and uses supplied cluster values', () => {
  assert.deepEqual(blockInterval([0, 1, 0.5]), blockInterval([0, 1, 0.5]));
  const r = blockInterval([0.5, 0.5]);
  assert.equal(r.lower, 0.5);
  assert.equal(r.upper, 0.5);
  assert.throws(() => blockInterval([]));
  assert.throws(() => blockInterval([2]));
  assert.equal(quantile([4, 2, 1, 3], 0.5), 2);
});
test('only exact preserved shard bytes may be reused after interruption', () => {
  const e = { status: 'passed', identity: h, resultHash: h, logHash: h };
  assert.equal(
    resumeShard(null, h, () => null),
    'run'
  );
  assert.equal(
    resumeShard(e, h, () => h),
    'reuse'
  );
  assert.equal(
    resumeShard({ status: 'running', identity: h }, h, () => null),
    'retry_pure_simulation'
  );
  assert.throws(() => resumeShard(e, h, () => null));
  assert.throws(() => resumeShard(e, 'b'.repeat(64), () => h));
  assert.throws(() => resumeShard({ status: 'unknown', identity: h }, h, () => h));
});
test('new default CLI cannot route to a fabricated post-start draw', () => {
  const cli = fs.readFileSync('tools/balance.mjs', 'utf8');
  assert.ok(cli.includes('balance-audit.mjs'));
  const old = fs.readFileSync('tools/balance_lab.gd', 'utf8');
  assert.ok(old.includes('start_with_decks'));
  assert.ok(!/\.hand\s*=|\.deck\s*=|\.hand\.append/.test(old));
});

import { planRecord } from '../scripts/balance-audit-policy.mjs';
test('a commit-only HEAD change does not erase or rerun byte-identical research', () => {
  const input = { schemaVersion: 1, key: h, sourceDigest: h };
  const original = planRecord(null, input, 'a'.repeat(40));
  assert.deepEqual(planRecord(original, input, 'b'.repeat(40)), original);
  assert.equal(original.sourceBase, 'a'.repeat(40));
  assert.throws(() => planRecord(original, { ...input, key: 'c'.repeat(64) }, 'b'.repeat(40)));
  assert.throws(() => planRecord(original, input, 'dev'));
});
