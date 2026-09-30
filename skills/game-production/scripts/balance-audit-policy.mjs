import { createHash } from 'node:crypto';
export const DECKS = ['starter', 'guard', 'lancer', 'archer', 'flanker', 'rush', 'elite'];
export const POLICIES = ['greedy', 'positional', 'random'];
export const hash = (x) => createHash('sha256').update(x).digest('hex');
const H = /^[a-f0-9]{64}$/;
export function validatePlan(p) {
  if (
    p?.schemaVersion !== 1 ||
    p.id !== 'standard-start-v1' ||
    p.rules !== 'terrain-sweep-v3-balance1' ||
    p.task !== 'BALANCE-01' ||
    JSON.stringify(p.decks) !== JSON.stringify(DECKS) ||
    JSON.stringify(p.policies) !== JSON.stringify(POLICIES) ||
    JSON.stringify(p.screenedPolicies) !== JSON.stringify(POLICIES.slice(0, 2)) ||
    p.maxCommands !== 240 ||
    p.shardSeeds !== 4
  )
    throw Error('BALANCE_UNKNOWN_PROTOCOL');
  const t = p.tolerances;
  if (
    !t ||
    t.minimumSeedBlocks !== 32 ||
    JSON.stringify(t.firstMoverScore) !== '[0.45,0.55]' ||
    t.maxForcedLimitRate !== 0.01 ||
    t.maxArchetypeScore !== 0.7 ||
    t.illegalCommands !== 0 ||
    t.replayMismatches !== 0 ||
    t.deterministicCycles !== 0 ||
    p.uncertainty?.replicates !== 2000 ||
    p.humanTiming?.measured !== false
  )
    throw Error('BALANCE_PROTOCOL_CHANGED_REQUIRES_NEW_VERSION');
  return p;
}
export function argsFor(args) {
  const [mode = 'plan', ...rest] = args;
  if (!['plan', 'run'].includes(mode))
    throw Error('balance plan|run [--seed N --count N --profile current|before --name LABEL]');
  const a = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = rest.slice(i, i + 2);
    if (
      mode === 'plan' ||
      !['--count', '--seed', '--profile', '--name'].includes(k) ||
      typeof v !== 'string' ||
      !v ||
      v.startsWith('--') ||
      Object.hasOwn(a, k)
    )
      throw Error('BALANCE_OPTIONS');
    a[k] = v;
  }
  const count = Number(a['--count'] || 32),
    seed = Number(a['--seed'] || 9001),
    profile = a['--profile'] || 'current',
    name = a['--name'] || null;
  if (
    !/^\d+$/.test(a['--count'] || '32') ||
    !/^\d+$/.test(a['--seed'] || '9001') ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 64 ||
    !Number.isSafeInteger(seed) ||
    seed < 1 ||
    seed > 1000000000 ||
    !['current', 'before'].includes(profile) ||
    (name && !/^[A-Za-z0-9_-]{1,100}$/.test(name))
  )
    throw Error('BALANCE_BOUNDED_INPUT');
  return { mode, count, seed, profile, name };
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
    throw Error('BALANCE_SEEDS');
  const seeds = Array.from(
    { length: count },
    (_, i) =>
      (createHash('sha256')
        .update('multimental-standard-start-v1:' + base + ':' + i)
        .digest()
        .readUInt32BE(0) %
        2147483646) +
      1
  );
  if (new Set(seeds).size !== seeds.length) throw Error('BALANCE_SEED_COLLISION');
  return seeds;
}
export function requests(plan, seeds, profile) {
  validatePlan(plan);
  if (!['current', 'before'].includes(profile)) throw Error('BALANCE_PROFILE');
  const r = [];
  for (const policy of POLICIES)
    for (let i = 0; i < seeds.length; i += plan.shardSeeds)
      r.push({
        schemaVersion: 1,
        plan: plan.id,
        seeds: seeds.slice(i, i + plan.shardSeeds),
        policy,
        profile,
        maxCommands: plan.maxCommands
      });
  return r;
}
export function validateShard(data, request) {
  if (
    data?.schemaVersion !== 1 ||
    data.ok !== true ||
    data.plan !== 'standard-start-v1' ||
    data.rules !== 'terrain-sweep-v3-balance1' ||
    data.sourceGameplayChanged !== false ||
    data.limitsAreClockMinutes !== false ||
    data.engine?.major !== 4 ||
    data.engine.minor !== 7 ||
    data.engine.patch !== 2 ||
    data.engine.status !== 'stable' ||
    !Array.isArray(data.rows) ||
    data.rows.length !== 49 * request.seeds.length
  )
    throw Error('BALANCE_SHARD_INCOMPLETE');
  const map = new Map();
  for (const r of data.rows) {
    if (
      r.ok !== true ||
      r.replayVerified !== true ||
      r.canonicalStart !== true ||
      !request.seeds.includes(r.seed) ||
      r.policy !== request.policy ||
      r.profile !== request.profile ||
      !DECKS.includes(r.left) ||
      !DECKS.includes(r.right) ||
      ![0, 1].includes(r.first) ||
      ![0, 1, 2].includes(r.winner) ||
      !['five', 'empty', 'limit'].includes(r.reason) ||
      !Number.isInteger(r.turns) ||
      r.turns < 1 ||
      r.turns > 241 ||
      !Number.isInteger(r.actions) ||
      r.actions < 1 ||
      r.actions > 241 ||
      typeof r.forcedLimit !== 'boolean' ||
      r.forcedLimit !== (r.reason === 'limit') ||
      !H.test(r.initialHash || '') ||
      !H.test(r.finalHash || '') ||
      !H.test(r.journalHash || '')
    )
      throw Error('BALANCE_BAD_ROW');
    if (
      !Array.isArray(r.opening) ||
      r.opening.length !== 2 ||
      r.opening.some(
        (p, i) =>
          p.hand !== (i === r.first ? 5 : 4) ||
          p.deck !== 15 - p.hand ||
          p.coins !== (i === r.first ? 1 : 2)
      )
    )
      throw Error('BALANCE_PATCHED_OPENING');
    if (
      !r.cycle ||
      Array.isArray(r.cycle) ||
      typeof r.cycle !== 'object' ||
      (Object.keys(r.cycle).length !== 0 &&
        (!Number.isInteger(r.cycle.firstCommand) ||
          !Number.isInteger(r.cycle.repeatCommand) ||
          r.cycle.firstCommand < 0 ||
          r.cycle.repeatCommand <= r.cycle.firstCommand ||
          r.cycle.repeatCommand >= request.maxCommands ||
          !H.test(r.cycle.hash || '')))
    )
      throw Error('BALANCE_CYCLE_WITNESS');
    if (
      !r.plays ||
      typeof r.plays !== 'object' ||
      Array.isArray(r.plays) ||
      Object.entries(r.plays).some(
        ([id, n]) =>
          !/^\d{1,2}$/.test(id) || Number(id) > 29 || !Number.isInteger(n) || n < 1 || n > 4
      )
    )
      throw Error('BALANCE_CARD_COUNTS');
    const key = [r.seed, r.left, r.right].join(':');
    if (map.has(key)) throw Error('BALANCE_DUPLICATE_MATCH');
    map.set(key, r);
  }
  for (const seed of request.seeds)
    for (const left of DECKS)
      for (const right of DECKS) {
        const a = map.get([seed, left, right].join(':')),
          b = map.get([seed, right, left].join(':'));
        if (!a || !b || a.first !== b.first) throw Error('BALANCE_UNPAIRED_MATCH');
      }
  return data;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
export function quantile(a, q) {
  if (!a.length || q < 0 || q > 1) throw Error('BALANCE_QUANTILE');
  const sorted = [...a].sort((x, y) => x - y);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
export function blockInterval(values) {
  if (!values.length || values.some((x) => !Number.isFinite(x) || x < 0 || x > 1))
    throw Error('BALANCE_BOOTSTRAP_INPUT');
  let state = 173071;
  const means = [];
  for (let n = 0; n < 2000; n++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      state = (state * 48271) % 2147483647;
      sum += values[state % values.length];
    }
    means.push(sum / values.length);
  }
  return {
    method: 'seed-block percentile bootstrap, descriptive only',
    blocks: values.length,
    mean: mean(values),
    lower: quantile(means, 0.025),
    upper: quantile(means, 0.975)
  };
}
const score = (r, player) => (r.winner === 2 ? 0.5 : r.winner === player ? 1 : 0);
export function summarize(plan, seeds, parts) {
  validatePlan(plan);
  if (parts.length !== Math.ceil(seeds.length / 4) * POLICIES.length)
    throw Error('BALANCE_MISSING_SHARDS');
  const req = requests(plan, seeds, parts[0]?.request.profile);
  const expected = new Map(req.map((r) => [hash(JSON.stringify(r)), r]));
  const rows = [];
  for (const part of parts) {
    const key = hash(JSON.stringify(part.request));
    if (!expected.has(key)) throw Error('BALANCE_UNEXPECTED_OR_DUPLICATE_SHARD');
    validateShard(part.data, expected.get(key));
    expected.delete(key);
    rows.push(...part.data.rows);
  }
  if (expected.size) throw Error('BALANCE_MISSING_SHARDS');
  const policies = POLICIES.map((policy) => {
    const sample = rows.filter((r) => r.policy === policy),
      blocks = seeds.map((s) =>
        mean(sample.filter((r) => r.seed === s).map((r) => score(r, r.first)))
      );
    const interval = blockInterval(blocks),
      mirror = sample.filter((r) => r.left === r.right),
      wins = sample.filter((r) => r.winner === r.first).length,
      draws = sample.filter((r) => r.winner === 2).length,
      capped = sample.filter((r) => r.forcedLimit).length,
      cycles = sample.filter((r) => Object.keys(r.cycle).length).length;
    const archetypes = DECKS.map((deck) => {
      const games = sample.filter(
        (r) => r.left !== r.right && (r.left === deck || r.right === deck)
      );
      return {
        deck,
        games: games.length,
        score: mean(games.map((r) => score(r, r.left === deck ? 0 : 1))),
        aboveScreen:
          mean(games.map((r) => score(r, r.left === deck ? 0 : 1))) >
          plan.tolerances.maxArchetypeScore
      };
    });
    let firstScreen = 'inconclusive';
    if (seeds.length >= plan.tolerances.minimumSeedBlocks) {
      if (interval.lower >= 0.45 && interval.upper <= 0.55) firstScreen = 'within_screen';
      else if (interval.lower > 0.55 || interval.upper < 0.45) firstScreen = 'outside_screen';
    }
    const forcedRate = capped / sample.length;
    return {
      policy,
      screened: plan.screenedPolicies.includes(policy),
      games: sample.length,
      firstWins: wins,
      draws,
      firstMoverScore: interval,
      firstMoverScreen: plan.screenedPolicies.includes(policy) ? firstScreen : 'diagnostic_only',
      mirrorScore: mean(mirror.map((r) => score(r, r.first))),
      turns: {
        median: quantile(
          sample.map((r) => r.turns),
          0.5
        ),
        p90: quantile(
          sample.map((r) => r.turns),
          0.9
        ),
        maximum: Math.max(...sample.map((r) => r.turns))
      },
      forcedLimits: capped,
      forcedRate,
      deterministicCycles: cycles,
      archetypes,
      screenConcerns: plan.screenedPolicies.includes(policy)
        ? [
            ...(firstScreen === 'outside_screen' ? ['first_mover'] : []),
            ...(forcedRate > plan.tolerances.maxForcedLimitRate ? ['simulator_cap'] : []),
            ...(cycles ? ['repeated_decision_state'] : []),
            ...archetypes.filter((a) => a.aboveScreen).map((a) => 'dominance:' + a.deck)
          ]
        : []
    };
  });
  const firstSeatCounts = seeds.reduce(
    (a, s) => {
      const r = rows.find((r) => r.seed === s);
      a[r.first]++;
      return a;
    },
    [0, 0]
  );
  return {
    schemaVersion: 1,
    kind: 'software_balance_audit_not_human_acceptance',
    plan: plan.id,
    games: rows.length,
    seedBlocks: seeds.length,
    firstSeatCounts,
    policies,
    allReplaysVerified: true,
    acceptedRulesChanged: false,
    humanDuration: { status: 'not_measured', targetMinutes: 10, maximumMinutes: 15 },
    overall: policies.some((p) => p.screenConcerns.length)
      ? 'concerns_observed'
      : 'requires_human_validation',
    limits: plan.limits
  };
}
export function resumeShard(prior, identity, readHash) {
  if (!prior) return 'run';
  if (prior.identity !== identity) throw Error('BALANCE_CHECKPOINT_IDENTITY');
  if (prior.status === 'passed') {
    if (
      !H.test(prior.resultHash || '') ||
      !H.test(prior.logHash || '') ||
      readHash('result.json') !== prior.resultHash ||
      readHash('run.log') !== prior.logHash
    )
      throw Error('BALANCE_CHECKPOINT_CORRUPT');
    return 'reuse';
  }
  if (['running', 'failed'].includes(prior.status)) return 'retry_pure_simulation';
  throw Error('BALANCE_CHECKPOINT_PHASE');
}
export function markdown(report) {
  const pct = (n) => (100 * n).toFixed(1) + '%';
  return (
    '# Проверка баланса на настоящем стартовом состоянии\n\nМатчей: ' +
    report.games +
    '. Блоков seed: ' +
    report.seedBlocks +
    '. Правила и карты не менялись.\n\n| Стратегия | Очки первого игрока (ничья = 0,5) | 95% bootstrap по seed | Ходы p50 / p90 | Лимит симулятора | Циклы |\n|---|---:|---|---:|---:|---:|\n' +
    report.policies
      .map(
        (p) =>
          '| ' +
          p.policy +
          ' | ' +
          pct(p.firstMoverScore.mean) +
          ' | ' +
          pct(p.firstMoverScore.lower) +
          ' - ' +
          pct(p.firstMoverScore.upper) +
          ' | ' +
          p.turns.median +
          ' / ' +
          p.turns.p90 +
          ' | ' +
          p.forcedLimits +
          ' | ' +
          p.deterministicCycles +
          ' |'
      )
      .join('\n') +
    '\n\n## Колоды: средние очки против остальных шести архетипов\n\n| Колода | Greedy | Positional | Random (диагностика) |\n|---|---:|---:|---:|\n' +
    DECKS.map(
      (d) =>
        '| ' +
        d +
        ' | ' +
        report.policies.map((p) => pct(p.archetypes.find((a) => a.deck === d).score)).join(' | ') +
        ' |'
    ).join('\n') +
    '\n\nЭто ограниченная проверка на эвристиках. Количество ходов не является минутами человека. Сравнение со старыми 61,8% некорректно без учёта иной инициализации и выборки. Итог: ' +
    report.overall +
    '. Человеческая проверка длительности остаётся открытой.\n'
  );
}

export function planRecord(previous, inputs, head) {
  if (!/^[a-f0-9]{40}$/.test(head || '')) throw Error('BALANCE_SOURCE_HEAD');
  const record = { ...inputs, sourceBase: previous?.sourceBase || head };
  if (
    !/^[a-f0-9]{40}$/.test(record.sourceBase) ||
    (previous && JSON.stringify(previous) !== JSON.stringify(record))
  )
    throw Error('BALANCE_PLAN_RECORD_CHANGED');
  return record;
}
