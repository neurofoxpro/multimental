const RIVALS = ['starter', 'guard', 'lancer', 'archer', 'flanker', 'rush', 'elite'];
const POLICIES = ['greedy', 'positional'];
export function summarizeTrial(report, request) {
  if (
    report?.schemaVersion !== 1 ||
    report.ok !== true ||
    report.acceptedCatalogueChanged !== false ||
    report.rules !== 'terrain-sweep-v3-balance1' ||
    report.seedStart !== request.seed ||
    report.count !== request.count ||
    !Array.isArray(report.rows) ||
    report.rows.length !== 56 * request.count ||
    report.replaysVerified !== report.rows.length ||
    JSON.stringify(report.rivals) !== JSON.stringify(RIVALS) ||
    JSON.stringify(report.policies) !== JSON.stringify(POLICIES)
  )
    throw Error('CONTENT_TRIAL_INCOMPLETE');
  const map = new Map();
  for (const row of report.rows) {
    if (
      !RIVALS.includes(row.rival) ||
      !POLICIES.includes(row.policy) ||
      !['control', 'candidate'].includes(row.condition) ||
      ![0, 1].includes(row.subject) ||
      ![0, 1].includes(row.first) ||
      !Number.isInteger(row.seed) ||
      row.seed < request.seed ||
      row.seed >= request.seed + request.count ||
      row.ok !== true ||
      row.replayVerified !== true ||
      ![0, 1, 2].includes(row.winner) ||
      row.won !== (row.winner === row.subject) ||
      row.draw !== (row.winner === 2) ||
      !Number.isInteger(row.turns) ||
      row.turns < 1 ||
      !Number.isInteger(row.watchedPlays) ||
      row.watchedPlays < 0 ||
      typeof row.forcedLimit !== 'boolean' ||
      !/^([a-f0-9]{64})$/.test(row.finalHash || '') ||
      !/^([a-f0-9]{64})$/.test(row.journalHash || '')
    )
      throw Error('CONTENT_TRIAL_BAD_ROW');
    const key = [row.rival, row.policy, row.seed, row.subject, row.condition].join(':');
    if (map.has(key)) throw Error('CONTENT_TRIAL_DUPLICATE');
    map.set(key, row);
  }
  const groups = [];
  for (const rival of RIVALS)
    for (const policy of POLICIES) {
      const control = [],
        candidate = [];
      for (let n = 0; n < request.count; n++)
        for (const side of [0, 1]) {
          const prefix = [rival, policy, request.seed + n, side].join(':');
          const a = map.get(prefix + ':control'),
            b = map.get(prefix + ':candidate');
          if (!a || !b || a.first !== b.first) throw Error('CONTENT_TRIAL_UNPAIRED');
          control.push(a);
          candidate.push(b);
        }
      const measure = (rows) => ({
        games: rows.length,
        wins: rows.filter((r) => r.won).length,
        draws: rows.filter((r) => r.draw).length,
        winRate: rows.filter((r) => r.won).length / rows.length,
        meanTurns: rows.reduce((n, r) => n + r.turns, 0) / rows.length,
        forcedLimits: rows.filter((r) => r.forcedLimit).length,
        watchedPlays: rows.reduce((n, r) => n + r.watchedPlays, 0)
      });
      const a = measure(control),
        b = measure(candidate);
      groups.push({
        rival,
        policy,
        control: a,
        candidate: b,
        winRateDifference: b.winRate - a.winRate
      });
    }
  return {
    games: report.rows.length,
    replaysVerified: report.replaysVerified,
    groups,
    acceptedCatalogueChanged: false,
    automaticBalanceApproval: false,
    limits: [
      'Two heuristic policies, not human skill or optimal play',
      'Paired seeds and both seats, but only seven sampled archetype decks',
      'Turns and 180-command cap are not measured minutes',
      'Win differences are sample observations, not a balance pass threshold',
      'Candidates never grant inventory or alter saved profiles'
    ]
  };
}
export function trialMarkdown(candidate, summary) {
  return (
    '# Эксперимент ' +
    candidate.id +
    ' v' +
    candidate.revision +
    '\n\nКандидат: ' +
    candidate.testedCard +
    ' вместо ' +
    candidate.reference +
    '. Матчей: ' +
    summary.games +
    '; повторов проверено: ' +
    summary.replaysVerified +
    '. Статус: не принят в игру.\n\n| Колода соперника | Политика | Контроль: победы | Кандидат: победы | Разница, п.п. | Ходы: контроль / кандидат | Применения карты-кандидата |\n|---|---|---:|---:|---:|---:|---:|\n' +
    summary.groups
      .map(
        (g) =>
          '| ' +
          g.rival +
          ' | ' +
          g.policy +
          ' | ' +
          g.control.wins +
          '/' +
          g.control.games +
          ' | ' +
          g.candidate.wins +
          '/' +
          g.candidate.games +
          ' | ' +
          (100 * g.winRateDifference).toFixed(1) +
          ' | ' +
          g.control.meanTurns.toFixed(1) +
          ' / ' +
          g.candidate.meanTurns.toFixed(1) +
          ' | ' +
          g.candidate.watchedPlays +
          ' |'
      )
      .join('\n') +
    '\n\nЭто ограниченный парный эксперимент на одинаковых seed и обоих местах игрока. Частота побед не означает окончательный баланс; ходы не равны минутам. Ограниченные партии учитываются явно. Каталог принятой игры и сохранения не менялись.\n'
  );
}

export function trialResume(prior, expected, readHash) {
  if (!prior) return 'run';
  for (const key of ['key', 'sourceDigest', 'engineHash', 'seed', 'count'])
    if (prior[key] !== expected[key]) throw Error('CONTENT_CHECKPOINT_IDENTITY');
  if (prior.status === 'passed') {
    if (
      !/^[a-f0-9]{64}$/.test(prior.resultHash || '') ||
      !/^[a-f0-9]{64}$/.test(prior.logHash || '') ||
      readHash('results.json') !== prior.resultHash ||
      readHash('run.log') !== prior.logHash
    )
      throw Error('CONTENT_CHECKPOINT_PROOF');
    return 'reuse';
  }
  if (['running', 'failed'].includes(prior.status)) return 'retry_pure_simulation';
  throw Error('CONTENT_CHECKPOINT_PHASE');
}
export function assertTrialEngine(value) {
  if (
    value?.major !== 4 ||
    value.minor !== 7 ||
    value.patch !== 2 ||
    value.status !== 'stable' ||
    typeof value.hash !== 'string' ||
    !value.hash
  )
    throw Error('CONTENT_UNPINNED_SIMULATION_ENGINE');
}
