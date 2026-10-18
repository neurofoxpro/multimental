import { createHash } from 'node:crypto';
import { blockInterval, quantile, resumeShard, planRecord } from './balance-audit-policy.mjs';

export const DECKS = Array.from({ length: 10 }, (_, i) => 'mix' + i);
export const PATTERN = [0, 1, 3, 4, 7];
export const POLICY_PAIRS = {
  'greedy-greedy': { left: 'greedy', right: 'greedy' },
  'positional-positional': { left: 'positional', right: 'positional' },
  'greedy-positional': { left: 'greedy', right: 'positional' },
  'positional-greedy': { left: 'positional', right: 'greedy' }
};
export const PAIRS = Object.keys(POLICY_PAIRS);
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const HASH = /^[a-f0-9]{64}$/;

export function expectedDeck(index) {
  return PATTERN.flatMap((offset) => {
    const element = (index + offset) % 10;
    return [2 * element, 2 * element + 1, 20 + element];
  });
}
export function validatePlan(plan) {
  if (
    plan?.schemaVersion !== 1 ||
    plan.id !== 'mixed-competition-v1' ||
    plan.rules !== 'terrain-sweep-v3-balance1' ||
    plan.task !== 'BALANCE-01' ||
    plan.defaultCount !== 32 ||
    plan.defaultSeed !== 20260929 ||
    plan.shardSeeds !== 2 ||
    plan.maxCommands !== 240
  )
    throw Error('MIXED_BALANCE_UNKNOWN_PROTOCOL');
  if (
    plan.deckConstruction?.type !== 'cyclic-five-elements-v1' ||
    JSON.stringify(plan.deckConstruction.pattern) !== JSON.stringify(PATTERN) ||
    plan.deckConstruction.deckSize !== 15 ||
    plan.deckConstruction.copiesPerCard !== 1 ||
    plan.deckConstruction.equalCatalogCoverage !== true
  )
    throw Error('MIXED_BALANCE_DECK_PROTOCOL');
  if (JSON.stringify(Object.keys(plan.decks || {})) !== JSON.stringify(DECKS))
    throw Error('MIXED_BALANCE_DECK_NAMES');
  const counts = Array(30).fill(0);
  for (let i = 0; i < DECKS.length; i++) {
    const deck = plan.decks[DECKS[i]];
    if (
      JSON.stringify(deck) !== JSON.stringify(expectedDeck(i)) ||
      new Set(deck).size !== 15 ||
      deck.some((id) => !Number.isInteger(id) || id < 0 || id > 29)
    )
      throw Error('MIXED_BALANCE_DECK_CHANGED');
    for (const id of deck) counts[id]++;
  }
  if (counts.some((count) => count !== 5)) throw Error('MIXED_BALANCE_UNEQUAL_CATALOG_COVERAGE');
  const expectedPairs = PAIRS.map((id) => ({ id, ...POLICY_PAIRS[id] }));
  if (JSON.stringify(plan.policyPairs) !== JSON.stringify(expectedPairs))
    throw Error('MIXED_BALANCE_POLICY_PAIRS');
  const tolerance = plan.tolerances;
  if (
    !tolerance ||
    tolerance.minimumSeedBlocks !== 32 ||
    JSON.stringify(tolerance.firstMoverScore) !== '[0.45,0.55]' ||
    JSON.stringify(tolerance.deckScore) !== '[0.3,0.7]' ||
    tolerance.maxForcedLimitRate !== 0.01 ||
    tolerance.replayMismatches !== 0 ||
    tolerance.deterministicCycles !== 0 ||
    plan.uncertainty?.replicates !== 2000 ||
    plan.uncertainty?.confidence !== 0.95 ||
    plan.humanTiming?.measured !== false ||
    plan.humanTiming?.requiredSeparately !== true
  )
    throw Error('MIXED_BALANCE_THRESHOLDS_CHANGED');
  return plan;
}

export function argsFor(args) {
  const [mode = 'plan', ...rest] = args;
  if (!['plan', 'run'].includes(mode))
    throw Error('balance mixed plan|run [--seed N --count N --name LABEL]');
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = rest.slice(i, i + 2);
    if (
      mode === 'plan' ||
      !['--count', '--seed', '--name'].includes(key) ||
      !value ||
      value.startsWith('--') ||
      Object.hasOwn(values, key)
    )
      throw Error('MIXED_BALANCE_OPTIONS');
    values[key] = value;
  }
  const count = Number(values['--count'] || 32);
  const seed = Number(values['--seed'] || 20260929);
  const name = values['--name'] || null;
  if (
    !/^\d+$/.test(values['--count'] || '32') ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 64 ||
    !/^\d+$/.test(values['--seed'] || '20260929') ||
    !Number.isSafeInteger(seed) ||
    seed < 1 ||
    seed > 1000000000 ||
    (name && !/^[A-Za-z0-9_-]{1,100}$/.test(name))
  )
    throw Error('MIXED_BALANCE_BOUNDED_INPUT');
  return { mode, count, seed, name };
}

export function seedsFor(base, count) {
  if (
    !Number.isInteger(base) ||
    base < 1 ||
    base > 1000000000 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 64
  )
    throw Error('MIXED_BALANCE_SEEDS');
  const seeds = Array.from(
    { length: count },
    (_, index) =>
      (createHash('sha256')
        .update('multimental-mixed-competition-v1:' + base + ':' + index)
        .digest()
        .readUInt32BE(0) %
        2147483646) +
      1
  );
  if (new Set(seeds).size !== seeds.length) throw Error('MIXED_BALANCE_SEED_COLLISION');
  return seeds;
}

export function requests(plan, seeds) {
  validatePlan(plan);
  const result = [];
  for (const policyPair of PAIRS)
    for (let i = 0; i < seeds.length; i += plan.shardSeeds)
      result.push({
        schemaVersion: 1,
        plan: plan.id,
        seeds: seeds.slice(i, i + plan.shardSeeds),
        policyPair,
        maxCommands: plan.maxCommands
      });
  return result;
}
export function validateShard(data, request) {
  const pair = POLICY_PAIRS[request.policyPair];
  if (
    data?.schemaVersion !== 1 ||
    data.ok !== true ||
    data.plan !== 'mixed-competition-v1' ||
    data.rules !== 'terrain-sweep-v3-balance1' ||
    data.sourceGameplayChanged !== false ||
    data.limitsAreClockMinutes !== false ||
    data.engine?.major !== 4 ||
    data.engine.minor !== 7 ||
    data.engine.patch !== 2 ||
    data.engine.status !== 'stable' ||
    !pair ||
    !Array.isArray(data.rows) ||
    data.rows.length !== 100 * request.seeds.length
  )
    throw Error('MIXED_BALANCE_SHARD_INCOMPLETE');
  const rows = new Map();
  const firstBySeed = new Map();
  for (const row of data.rows) {
    if (
      row.ok !== true ||
      row.replayVerified !== true ||
      row.canonicalStart !== true ||
      !request.seeds.includes(row.seed) ||
      !DECKS.includes(row.left) ||
      !DECKS.includes(row.right) ||
      row.policyPair !== request.policyPair ||
      row.leftPolicy !== pair.left ||
      row.rightPolicy !== pair.right ||
      ![0, 1].includes(row.first) ||
      ![0, 1, 2].includes(row.winner) ||
      !['five', 'empty', 'limit'].includes(row.reason) ||
      !Number.isInteger(row.turns) ||
      row.turns < 1 ||
      row.turns > 241 ||
      !Number.isInteger(row.actions) ||
      row.actions < 1 ||
      row.actions > 241 ||
      typeof row.forcedLimit !== 'boolean' ||
      row.forcedLimit !== (row.reason === 'limit') ||
      !HASH.test(row.initialHash || '') ||
      !HASH.test(row.finalHash || '') ||
      !HASH.test(row.journalHash || '')
    )
      throw Error('MIXED_BALANCE_BAD_ROW');
    if (
      !Array.isArray(row.opening) ||
      row.opening.length !== 2 ||
      row.opening.some(
        (player, i) =>
          player.hand !== (i === row.first ? 5 : 4) ||
          player.deck !== 15 - player.hand ||
          player.coins !== (i === row.first ? 1 : 2)
      )
    )
      throw Error('MIXED_BALANCE_PATCHED_OPENING');
    if (
      !row.cycle ||
      Array.isArray(row.cycle) ||
      typeof row.cycle !== 'object' ||
      (Object.keys(row.cycle).length &&
        (!Number.isInteger(row.cycle.firstCommand) ||
          !Number.isInteger(row.cycle.repeatCommand) ||
          row.cycle.firstCommand < 0 ||
          row.cycle.repeatCommand <= row.cycle.firstCommand ||
          row.cycle.repeatCommand >= request.maxCommands ||
          !HASH.test(row.cycle.hash || '')))
    )
      throw Error('MIXED_BALANCE_CYCLE_WITNESS');
    if (
      !row.plays ||
      typeof row.plays !== 'object' ||
      Array.isArray(row.plays) ||
      Object.entries(row.plays).some(
        ([id, count]) =>
          !/^\d{1,2}$/.test(id) ||
          Number(id) > 29 ||
          !Number.isInteger(count) ||
          count < 1 ||
          count > 241
      )
    )
      throw Error('MIXED_BALANCE_CARD_COUNTS');
    const key = [row.seed, row.left, row.right].join(':');
    if (rows.has(key)) throw Error('MIXED_BALANCE_DUPLICATE_MATCH');
    rows.set(key, row);
    if (firstBySeed.has(row.seed) && firstBySeed.get(row.seed) !== row.first)
      throw Error('MIXED_BALANCE_FIRST_SEAT_DRIFT');
    firstBySeed.set(row.seed, row.first);
  }
  for (const seed of request.seeds)
    for (const left of DECKS)
      for (const right of DECKS)
        if (!rows.has([seed, left, right].join(':'))) throw Error('MIXED_BALANCE_MISSING_MATCH');
  return data;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const score = (row, player) => (row.winner === 2 ? 0.5 : row.winner === player ? 1 : 0);

function intervalBySeed(rows, seeds, scorer) {
  return blockInterval(
    seeds.map((seed) => {
      const sample = rows.filter((row) => row.seed === seed);
      if (!sample.length) throw Error('MIXED_BALANCE_EMPTY_SEED_BLOCK');
      return mean(sample.map(scorer));
    })
  );
}

function screen(interval, band, minimumBlocks, blocks) {
  if (blocks < minimumBlocks) return 'inconclusive';
  if (interval.lower >= band[0] && interval.upper <= band[1]) return 'within_screen';
  if (interval.lower > band[1] || interval.upper < band[0]) return 'outside_screen';
  return 'inconclusive';
}

function deckScreen(interval, band, minimumBlocks, blocks) {
  if (blocks < minimumBlocks) return 'inconclusive';
  if (interval.lower > band[1]) return 'dominant';
  if (interval.upper < band[0]) return 'weak';
  if (interval.lower >= band[0] && interval.upper <= band[1]) return 'within_screen';
  return 'inconclusive';
}
export function summarize(plan, seeds, parts) {
  validatePlan(plan);
  const expectedRequests = requests(plan, seeds);
  if (parts.length !== expectedRequests.length) throw Error('MIXED_BALANCE_MISSING_SHARDS');
  const expected = new Map(
    expectedRequests.map((request) => [hash(JSON.stringify(request)), request])
  );
  const rows = [];
  for (const part of parts) {
    const key = hash(JSON.stringify(part.request));
    if (!expected.has(key)) throw Error('MIXED_BALANCE_UNEXPECTED_OR_DUPLICATE_SHARD');
    validateShard(part.data, expected.get(key));
    expected.delete(key);
    rows.push(...part.data.rows);
  }
  if (expected.size) throw Error('MIXED_BALANCE_MISSING_SHARDS');

  const policyPairs = PAIRS.map((id) => {
    const sample = rows.filter((row) => row.policyPair === id);
    const first = intervalBySeed(sample, seeds, (row) => score(row, row.first));
    return {
      id,
      ...POLICY_PAIRS[id],
      games: sample.length,
      firstMoverScore: first,
      firstMoverScreen: screen(
        first,
        plan.tolerances.firstMoverScore,
        plan.tolerances.minimumSeedBlocks,
        seeds.length
      ),
      turns: {
        median: quantile(
          sample.map((row) => row.turns),
          0.5
        ),
        p90: quantile(
          sample.map((row) => row.turns),
          0.9
        ),
        maximum: Math.max(...sample.map((row) => row.turns))
      },
      forcedLimits: sample.filter((row) => row.forcedLimit).length,
      deterministicCycles: sample.filter((row) => Object.keys(row.cycle).length).length
    };
  });

  const firstMoverScore = intervalBySeed(rows, seeds, (row) => score(row, row.first));
  const cross = rows.filter((row) => row.leftPolicy !== row.rightPolicy);
  const positionalPlayer = (row) => (row.leftPolicy === 'positional' ? 0 : 1);
  const positionalScore = intervalBySeed(cross, seeds, (row) => score(row, positionalPlayer(row)));
  const asFirst = cross.filter((row) => row.first === positionalPlayer(row));
  const asSecond = cross.filter((row) => row.first !== positionalPlayer(row));

  const decks = DECKS.map((deck) => {
    const sample = rows.filter(
      (row) => row.left !== row.right && (row.left === deck || row.right === deck)
    );
    const interval = intervalBySeed(sample, seeds, (row) => score(row, row.left === deck ? 0 : 1));
    return {
      deck,
      games: sample.length,
      score: interval,
      screen: deckScreen(
        interval,
        plan.tolerances.deckScore,
        plan.tolerances.minimumSeedBlocks,
        seeds.length
      )
    };
  });

  const forcedLimits = rows.filter((row) => row.forcedLimit).length;
  const forcedRate = forcedLimits / rows.length;
  const deterministicCycles = rows.filter((row) => Object.keys(row.cycle).length).length;
  const firstMoverScreen = screen(
    firstMoverScore,
    plan.tolerances.firstMoverScore,
    plan.tolerances.minimumSeedBlocks,
    seeds.length
  );
  const concerns = [
    ...(firstMoverScreen === 'outside_screen' ? ['first_mover'] : []),
    ...(forcedRate > plan.tolerances.maxForcedLimitRate ? ['simulator_cap'] : []),
    ...(deterministicCycles ? ['repeated_decision_state'] : []),
    ...decks
      .filter((deck) => ['dominant', 'weak'].includes(deck.screen))
      .map((deck) => deck.screen + ':' + deck.deck)
  ];
  const firstSeatCounts = seeds.reduce(
    (counts, seed) => {
      const row = rows.find((value) => value.seed === seed);
      counts[row.first]++;
      return counts;
    },
    [0, 0]
  );
  return {
    schemaVersion: 1,
    kind: 'mixed_deck_cross_policy_engineering_experiment',
    plan: plan.id,
    games: rows.length,
    seedBlocks: seeds.length,
    firstSeatCounts,
    firstMoverScore,
    firstMoverScreen,
    policyPairs,
    crossPolicy: {
      games: cross.length,
      positionalScore,
      positionalWhenFirst: intervalBySeed(asFirst, seeds, (row) =>
        score(row, positionalPlayer(row))
      ),
      positionalWhenSecond: intervalBySeed(asSecond, seeds, (row) =>
        score(row, positionalPlayer(row))
      ),
      threshold: 'descriptive_only'
    },
    decks,
    forcedLimits,
    forcedRate,
    deterministicCycles,
    allReplaysVerified: true,
    acceptedRulesChanged: false,
    humanDuration: {
      status: 'not_measured',
      targetMinutes: 10,
      maximumMinutes: 15
    },
    overall: concerns.length ? 'concerns_observed' : 'requires_human_validation',
    concerns,
    limits: plan.limits
  };
}

export { resumeShard, planRecord };
export function markdown(report) {
  const pct = (value) => (100 * value).toFixed(1) + '%';
  return (
    '# BALANCE-01: смешанные колоды и перекрёстные стратегии\n\n' +
    'Матчей: ' +
    report.games +
    '. Seed-блоков: ' +
    report.seedBlocks +
    '. Принятые карты и правила не менялись.\n\n' +
    '| Пара стратегий | Очки первого | 95% bootstrap | Ходы p50 / p90 | Лимиты | Циклы |\n' +
    '|---|---:|---|---:|---:|---:|\n' +
    report.policyPairs
      .map(
        (pair) =>
          '| ' +
          pair.id +
          ' | ' +
          pct(pair.firstMoverScore.mean) +
          ' | ' +
          pct(pair.firstMoverScore.lower) +
          ' - ' +
          pct(pair.firstMoverScore.upper) +
          ' | ' +
          pair.turns.median +
          ' / ' +
          pair.turns.p90 +
          ' | ' +
          pair.forcedLimits +
          ' | ' +
          pair.deterministicCycles +
          ' |'
      )
      .join('\n') +
    '\n\nОбщий первый ход: ' +
    pct(report.firstMoverScore.mean) +
    ' (' +
    pct(report.firstMoverScore.lower) +
    ' - ' +
    pct(report.firstMoverScore.upper) +
    '), экран: ' +
    report.firstMoverScreen +
    '.\n\nПерекрёстные greedy/positional: positional ' +
    pct(report.crossPolicy.positionalScore.mean) +
    ' (' +
    pct(report.crossPolicy.positionalScore.lower) +
    ' - ' +
    pct(report.crossPolicy.positionalScore.upper) +
    '). Когда positional ходит первым: ' +
    pct(report.crossPolicy.positionalWhenFirst.mean) +
    '; вторым: ' +
    pct(report.crossPolicy.positionalWhenSecond.mean) +
    '. Это описание именно эвристик, не рейтинг человеческого игрока.\n\n' +
    '## Смешанные колоды\n\n' +
    '| Колода | Очки против остальных | 95% bootstrap | Статус |\n' +
    '|---|---:|---|---|\n' +
    report.decks
      .map(
        (deck) =>
          '| ' +
          deck.deck +
          ' | ' +
          pct(deck.score.mean) +
          ' | ' +
          pct(deck.score.lower) +
          ' - ' +
          pct(deck.score.upper) +
          ' | ' +
          deck.screen +
          ' |'
      )
      .join('\n') +
    '\n\nКаждая из 30 принятых карт представлена ровно в пяти из десяти систематических колод. ' +
    'Это расширяет выборку, но не перебирает все легальные колоды. Компьютерные ходы не являются минутами человека. ' +
    'Итог: ' +
    report.overall +
    '.\n'
  );
}
