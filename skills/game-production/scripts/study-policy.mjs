import { createHash } from 'node:crypto';
const HOSTS = new Set([
  'docs.godotengine.org',
  'developer.android.com',
  'docs.github.com',
  'learn.microsoft.com'
]);
export const CHECKS = Object.freeze({
  dispatch: {
    argv: [
      '--test',
      '--test-reporter=tap',
      'skills/game-production/tests/dispatch-policy.test.mjs'
    ],
    nodeTests: true
  },
  study: {
    argv: ['--test', '--test-reporter=tap', 'skills/game-production/tests/study-policy.test.mjs'],
    nodeTests: true
  },
  menu: { argv: ['tools/test-profile.mjs', 'menu'], marker: 'MULTIMENTAL_MENU_LAYOUT_PASS' },
  inspector: {
    argv: ['tools/test-profile.mjs', 'inspector'],
    marker: 'MULTIMENTAL_CARD_INSPECTOR_PASS'
  },
  'ux-matrix': { argv: ['tools/ux-audit.mjs'], marker: 'measured_not_accessibility_certified' }
});
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Invalid research URL');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !HOSTS.has(url.hostname)
  )
    throw Error('Primary documentation HTTPS origin required');
  url.hash = '';
  return url.href;
}
export function validateStudy(value) {
  if (value?.schemaVersion !== 1 || !/^[A-Z]+-\d+$/.test(value.task || ''))
    throw Error('Study identity required');
  for (const key of ['question', 'hypothesis', 'control'])
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 5000)
      throw Error('Study needs ' + key);
  for (const key of ['readset', 'sources', 'checks', 'acceptance', 'limits'])
    if (
      !Array.isArray(value[key]) ||
      !value[key].length ||
      value[key].length > 30 ||
      value[key].some((x) => typeof x !== 'string' || !x || x.length > 5000)
    )
      throw Error('Bounded ' + key + ' required');
  if (
    value.sources.length > 12 ||
    new Set(value.sources.map(sourceUrl)).size !== value.sources.length
  )
    throw Error('Unique bounded sources required');
  if (
    new Set(value.checks).size !== value.checks.length ||
    value.checks.some((c) => !Object.hasOwn(CHECKS, c))
  )
    throw Error('Unknown or duplicate reviewed test adapter');
  if (
    new Set(value.readset).size !== value.readset.length ||
    value.readset.some(
      (p) =>
        !/^[a-zA-Z0-9_.\/-]+$/.test(p) ||
        p.startsWith('/') ||
        p.split('/').some((s) => !s || s === '.' || s === '..') ||
        /\.local\.|(?:^|\/)\.env|\.(?:p12|jks|keystore)$/.test(p)
    )
  )
    throw Error('Unsafe readset');
  return value;
}
export function stage(study, key, receipt, now = Date.now()) {
  validateStudy(study);
  if (!receipt || receipt.inputKey !== key || receipt.task !== study.task) return 'capture';
  const sources = receipt.sources;
  if (
    !Array.isArray(sources) ||
    sources.length !== study.sources.length ||
    sources.some(
      (s) =>
        !/^[a-f0-9]{64}$/.test(s.sha256 || '') ||
        !Number.isFinite(Date.parse(s.observedAt)) ||
        now < Date.parse(s.observedAt) ||
        now - Date.parse(s.observedAt) > 7 * 86400000
    )
  )
    return 'capture';
  if (
    new Set(sources.map((s) => s.url)).size !== sources.length ||
    study.sources.some((u) => !sources.some((s) => s.url === sourceUrl(u)))
  )
    return 'capture';
  const checks = receipt.checks;
  if (
    !Array.isArray(checks) ||
    checks.length !== study.checks.length ||
    new Set(checks.map((c) => c.id)).size !== checks.length ||
    study.checks.some(
      (id) =>
        !checks.some(
          (c) =>
            c.id === id &&
            c.status === 'passed' &&
            c.exitCode === 0 &&
            /^[a-f0-9]{64}$/.test(c.logHash || '')
        )
    )
  )
    return 'checks';
  return receipt.assessment?.inputKey === key &&
    ['supported', 'partial', 'rejected'].includes(receipt.assessment.verdict)
    ? 'complete'
    : 'analysis';
}
export function checkPassed(spec, result) {
  const text = (result.stdout || '') + (result.stderr || '');
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    /SCRIPT ERROR:|Parse Error:|^ERROR:|PRODUCTION_TEST_FAIL/m.test(text)
  )
    return false;
  if (spec.nodeTests) {
    const total = Number(text.match(/^# tests (\d+)$/m)?.[1]);
    return (
      total > 0 &&
      Number(text.match(/^# pass (\d+)$/m)?.[1]) === total &&
      /^# fail 0$/m.test(text) &&
      /^# skipped 0$/m.test(text)
    );
  }
  return typeof spec.marker === 'string' && text.includes(spec.marker);
}
export async function captureSource(url, fetcher = fetch, options = {}) {
  const maxBytes = options.maxBytes || 2000000;
  const observedAt = new Date().toISOString(),
    initial = sourceUrl(url);
  let current = initial;
  const signal = AbortSignal.timeout(options.timeout || 15000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(current, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': 'MultimentalStudy/1' }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 3) throw Error('Research redirect limit');
      current = sourceUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok || !response.body) throw Error('Research HTTP ' + response.status);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      await response.body.cancel();
      throw Error('Research body oversized');
    }
    const type = response.headers.get('content-type') || '';
    if (!/^(text\/html|text\/plain|application\/json)(?:;|$)/i.test(type)) {
      await response.body.cancel();
      throw Error('Research content type not supported');
    }
    const reader = response.body.getReader(),
      parts = [];
    let bytes = 0;
    try {
      while (true) {
        const row = await reader.read();
        if (row.done) break;
        bytes += row.value.byteLength;
        if (bytes > maxBytes) throw Error('Research streamed body oversized');
        parts.push(Buffer.from(row.value));
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (!bytes) throw Error('Empty research source');
    const body = Buffer.concat(parts);
    return {
      url: initial,
      finalUrl: current,
      observedAt,
      sha256: hash(body),
      bytes,
      contentType: type,
      downloadedNotReviewed: true
    };
  }
  throw Error('Research redirect limit');
}
export function assessment(value, key, receipt) {
  if (
    value?.schemaVersion !== 1 ||
    value.inputKey !== key ||
    !['supported', 'partial', 'rejected'].includes(value.verdict) ||
    typeof value.conclusion !== 'string' ||
    !value.conclusion.trim() ||
    value.conclusion.length > 20000 ||
    !Array.isArray(value.limitations) ||
    !value.limitations.length ||
    value.limitations.some((x) => typeof x !== 'string' || !x.trim())
  )
    throw Error('Explicit evidence-bound analysis required');
  if (
    !Array.isArray(value.sourceHashes) ||
    JSON.stringify([...value.sourceHashes].sort()) !==
      JSON.stringify(receipt.sources.map((s) => s.sha256).sort())
  )
    throw Error('Analysis sources do not match captured evidence');
  return { ...value, inputKey: key, independentHumanApproval: false };
}
