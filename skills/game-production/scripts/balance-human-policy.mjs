const REPO = 'neurofoxpro/multimental';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const RELEASE = /^v\d+\.\d+\.\d+-alpha\.\d+\.\d+$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MODES = new Set(['local', 'lan', 'bluetooth', 'online', 'other']);
const REASONS = new Set(['five', 'empty', 'timeout', 'limit', 'resigned', 'disconnect', 'other']);

const finiteTime = (value) => {
  const n = Date.parse(value);
  if (!Number.isFinite(n)) throw Error('HUMAN_DURATION_TIME');
  return n;
};
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
};
const stats = (rows) => {
  const seconds = rows.map((r) => r.durationSeconds);
  if (!seconds.length)
    return { count: 0, min: null, median: null, p90: null, max: null, mean: null };
  return {
    count: seconds.length,
    min: Math.min(...seconds),
    median: quantile(seconds, 0.5),
    p90: quantile(seconds, 0.9),
    max: Math.max(...seconds),
    mean: seconds.reduce((a, b) => a + b, 0) / seconds.length
  };
};

export function validateSeries(series) {
  if (
    series?.schemaVersion !== 1 ||
    series.repository !== REPO ||
    series.kind !== 'human-duration-series' ||
    !RELEASE.test(series.releaseTag || '') ||
    !SHA.test(series.sourceCommit || '') ||
    typeof series.installedVersion !== 'string' ||
    !series.installedVersion ||
    (series.apkSha256 !== null && series.apkSha256 !== undefined && !HASH.test(series.apkSha256)) ||
    !Number.isFinite(Date.parse(series.observedAt || '')) ||
    !Array.isArray(series.matches)
  )
    throw Error('HUMAN_DURATION_SERIES');
  const seen = new Set();
  const rows = series.matches.map((row) => {
    if (
      !ID.test(row?.id || '') ||
      seen.has(row.id) ||
      row.releaseTag !== series.releaseTag ||
      row.sourceCommit !== series.sourceCommit ||
      ![1, 2].includes(row.humanControlledPlayers) ||
      !MODES.has(row.mode) ||
      ![0, 1].includes(row.firstPlayer) ||
      !REASONS.has(row.resultReason) ||
      typeof row.interrupted !== 'boolean' ||
      typeof (row.notes ?? '') !== 'string' ||
      String(row.notes ?? '').length > 2000
    )
      throw Error('HUMAN_DURATION_ROW');
    seen.add(row.id);
    const started = finiteTime(row.startedAt);
    const finished = finiteTime(row.finishedAt);
    const durationSeconds = (finished - started) / 1000;
    if (!(durationSeconds >= 30 && durationSeconds <= 7200)) throw Error('HUMAN_DURATION_RANGE');
    return { ...row, notes: row.notes ?? '', durationSeconds };
  });
  return { ...series, matches: rows };
}

export function summarizeSeries(input) {
  const series = validateSeries(input);
  const usable = series.matches.filter((r) => !r.interrupted);
  const interrupted = series.matches.filter((r) => r.interrupted);
  const reasons = {};
  for (const r of usable) reasons[r.resultReason] = (reasons[r.resultReason] || 0) + 1;
  const summary = {
    schemaVersion: 1,
    repository: REPO,
    kind: 'human-duration-summary',
    releaseTag: series.releaseTag,
    sourceCommit: series.sourceCommit,
    installedVersion: series.installedVersion,
    apkSha256: series.apkSha256 ?? null,
    observedAt: series.observedAt,
    totalRows: series.matches.length,
    usableMatches: usable.length,
    interruptedRows: interrupted.length,
    durationSeconds: stats(usable),
    within10Minutes: usable.filter((r) => r.durationSeconds <= 600).length,
    between10And15Minutes: usable.filter((r) => r.durationSeconds > 600 && r.durationSeconds < 900)
      .length,
    hardLimitMatches: usable.filter((r) => ['timeout', 'limit'].includes(r.resultReason)).length,
    over15Minutes: usable.filter((r) => r.durationSeconds > 900).length,
    resultReasons: reasons,
    byHumanControlledPlayers: {
      one: stats(usable.filter((r) => r.humanControlledPlayers === 1)),
      two: stats(usable.filter((r) => r.humanControlledPlayers === 2))
    },
    durations: usable.map((r) => ({
      id: r.id,
      seconds: r.durationSeconds,
      resultReason: r.resultReason,
      mode: r.mode,
      humanControlledPlayers: r.humanControlledPlayers
    })),
    interrupted: interrupted.map((r) => ({
      id: r.id,
      seconds: r.durationSeconds,
      resultReason: r.resultReason,
      notes: r.notes
    })),
    humanAcceptance: 'pending',
    automaticPass: false
  };
  return summary;
}
