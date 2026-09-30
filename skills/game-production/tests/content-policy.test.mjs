import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseContentJSON } from '../scripts/content-json.mjs';
import {
  validateCatalog,
  validateCard,
  validateArt,
  candidate,
  contentHash,
  compileRuntime,
  catalogMarkdown,
  contentOptions,
  cardSchema,
  hash
} from '../scripts/content-policy.mjs';
import { summarizeTrial } from '../scripts/content-report.mjs';
const base = () => parseContentJSON(fs.readFileSync('content/accepted/catalog.json', 'utf8'));
const proposed = () =>
  parseContentJSON(fs.readFileSync('content/candidates/copper-watch.json', 'utf8'));
test('accepted source has exact stable thirty IDs and generated artifacts match', () => {
  const b = base();
  assert.equal(validateCatalog(b).cards.length, 30);
  assert.equal(
    compileRuntime(b),
    fs.readFileSync('game/src/content_catalog.gd', 'utf8').replace(/\r\n/g, '\n')
  );
  assert.deepEqual(JSON.parse(fs.readFileSync('content/card.schema.json', 'utf8')), cardSchema());
  assert.equal(
    catalogMarkdown(b),
    fs.readFileSync('docs/production/CARD_CATALOG.ru.md', 'utf8').replace(/\r\n/g, '\n')
  );
});
for (const text of [
  '{"role":"fighter","role":"archer"}',
  '{"x":{"v":1,"v":2}}',
  '{"role":1,"r\\u006fle":2}',
  '[1,]',
  '{"x":1,}',
  '01',
  'true false',
  '{"x":1e9999}',
  '['.repeat(26) + '0' + ']'.repeat(26)
])
  test('strict data parser rejects ' + text.slice(0, 45), () =>
    assert.throws(() => parseContentJSON(text))
  );
test('quotes and program-like text roundtrip as data, without evaluation', () => {
  const value = { name: '"; OS.execute("no"); #', line: 'text with \\ and " escapes' };
  assert.deepEqual(parseContentJSON(JSON.stringify(value)), value);
  const b = base();
  b.cards[0].text.ru.name = value.name;
  assert.ok(compileRuntime(b).includes(JSON.stringify(value.name)));
  assert.ok(
    catalogMarkdown({
      ...b,
      cards: [
        {
          ...b.cards[0],
          text: { ru: { name: '<a>[link]|x' + String.fromCharCode(96) }, en: { name: 'safe' } }
        }
      ]
    }).includes('&lt;a&gt;')
  );
});
for (const change of [
  { id: 'c999' },
  { version: 0 },
  { slot: 1.5 },
  { cost: 0 },
  { cost: 9 },
  { attack: Infinity },
  { health: 1.5 },
  { role: 'poison-pulse' },
  { effect: 'execute_gdscript' },
  { unexpected: 'res://evil.gd' }
])
  test('card schema rejects ' + JSON.stringify(change), () =>
    assert.throws(() => validateCard({ ...base().cards[0], ...change }))
  );
test('missing translations, text controls, bidi and malformed Unicode are rejected', () => {
  for (const value of ['', ' x', 'x\ny', 'x\u202ey', '\ud800']) {
    const c = base().cards[0];
    c.text.ru.name = value;
    assert.throws(() => validateCard(c));
  }
  const c = base().cards[0];
  delete c.text.en;
  assert.throws(() => validateCard(c));
});
test('new candidate is isolated, append-only and requires its exact accepted base', () => {
  const b = base(),
    frozen = JSON.stringify(b),
    p = proposed(),
    prepared = candidate(p, b);
  assert.equal(prepared.candidateRows.length, 31);
  assert.equal(prepared.baseRows.length, 30);
  assert.equal(prepared.candidateDeck.filter((id) => id === 30).length, 2);
  assert.equal(prepared.candidateDeck.length, 15);
  assert.equal(JSON.stringify(b), frozen);
  for (const change of [{ baseHash: '0'.repeat(64) }, { operation: 'remove' }, { fromVersion: 1 }])
    assert.throws(() => candidate({ ...p, ...change }, b));
});
test('accepted count or unknown compatibility never changes through candidate command', () => {
  const b = base(),
    p = proposed();
  b.cards.push(p.card);
  assert.throws(() => validateCatalog(b));
  const x = base();
  x.compatibility = 'unlock-paid';
  assert.throws(() => validateCatalog(x));
});
test('same ID requires exactly next card version; slots and archived revision cannot be recycled', () => {
  const b = base(),
    c = JSON.parse(fs.readFileSync('content/candidates/storm-before-balance.json', 'utf8'));
  assert.equal(candidate(c, b).candidateRows.length, 30);
  for (const version of [1, 3])
    assert.throws(() => candidate({ ...c, card: { ...c.card, version } }, b));
  assert.throws(() => candidate({ ...c, trial: { replace: 'c014', copies: 2 } }, b));
  const p = proposed();
  assert.throws(() => candidate({ ...p, card: { ...p.card, slot: 0, id: 'c000' } }, b));
});
test('candidate costs and one/two-copy comparisons remain bounded', () => {
  const p = proposed();
  for (const copies of [0, 3, 1.5])
    assert.throws(() => candidate({ ...p, trial: { ...p.trial, copies } }, base()));
  assert.throws(() => candidate({ ...p, trial: { replace: 'c255', copies: 1 } }, base()));
});
test('canonical identity survives object field order and text line-ending formatting', () => {
  const b = base(),
    clone = Object.fromEntries(Object.entries(b).reverse());
  assert.equal(contentHash(b), contentHash(clone));
  assert.equal(
    contentHash(b),
    contentHash(parseContentJSON(JSON.stringify(b, null, 2).replaceAll('\n', '\r\n')))
  );
  clone.cards[0].cost = 2;
  assert.notEqual(contentHash(base()), contentHash(clone));
});
function artFixture() {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(128, 16);
  bytes.writeUInt32BE(128, 20);
  return {
    bytes,
    art: {
      kind: 'generated',
      path: 'game/assets/cards/sample.png',
      sha256: hash(bytes),
      source: 'Test fixture, not actual artwork',
      license: 'test-only',
      author: 'test',
      prompt: 'fixture metadata',
      generator: 'test model'
    }
  };
}
test('generated art requires exact bytes, attribution, license, prompt and generator', () => {
  const { bytes, art } = artFixture();
  validateArt(art, () => bytes);
  for (const change of [
    { prompt: '' },
    { generator: '' },
    { source: '' },
    { license: '' },
    { sha256: 'a'.repeat(64) },
    { path: '../../secret.png' },
    { path: 'game/assets/cards/code.svg' }
  ])
    assert.throws(() => validateArt({ ...art, ...change }, () => bytes));
  assert.throws(() => validateArt(art));
});
test('intentional no-art fallback is explicit, no phantom asset path allowed', () => {
  validateArt({ kind: 'none' });
  assert.throws(() => validateArt({ kind: 'none', path: 'ghost.png' }));
});
for (const args of [
  ['trial', '../x.json'],
  ['trial', 'content/candidates/x.json', '--count', '0'],
  ['trial', 'content/candidates/x.json', '--count', '65'],
  ['trial', 'content/candidates/x.json', '--seed', '-1'],
  ['trial', 'content/candidates/x.json', '--seed', '1', '--seed', '2'],
  ['add', 'content/candidates/x.json', '--count', '1'],
  ['build', '--force'],
  ['promote', 'anything']
])
  test('bounded content CLI ' + args.join(' '), () => assert.throws(() => contentOptions(args)));
test('short trial defaults pin both seed and sample count', () =>
  assert.deepEqual(contentOptions(['trial', 'content/candidates/copper-watch.json']), {
    mode: 'trial',
    file: 'content/candidates/copper-watch.json',
    seed: 9001,
    count: 8
  }));
function report() {
  const rows = [];
  for (const rival of ['starter', 'guard', 'lancer', 'archer', 'flanker', 'rush', 'elite'])
    for (const policy of ['greedy', 'positional'])
      for (const subject of [0, 1])
        for (const condition of ['control', 'candidate'])
          rows.push({
            rival,
            policy,
            seed: 42,
            subject,
            condition,
            ok: true,
            replayVerified: true,
            first: 0,
            winner: subject,
            won: true,
            draw: false,
            turns: 10,
            watchedPlays: 1,
            forcedLimit: false,
            finalHash: 'a'.repeat(64),
            journalHash: 'b'.repeat(64)
          });
  return {
    schemaVersion: 1,
    ok: true,
    acceptedCatalogueChanged: false,
    rules: 'terrain-sweep-v3-balance1',
    seedStart: 42,
    count: 1,
    rows,
    replaysVerified: 56,
    rivals: ['starter', 'guard', 'lancer', 'archer', 'flanker', 'rush', 'elite'],
    policies: ['greedy', 'positional']
  };
}
test('paired simulation output is complete by seed, role, policy and side', () => {
  const r = report(),
    s = summarizeTrial(r, { seed: 42, count: 1 });
  assert.equal(s.games, 56);
  assert.equal(s.groups.length, 14);
  assert.equal(s.automaticBalanceApproval, false);
  for (const change of [
    (x) => x.rows.pop(),
    (x) => (x.rows[1] = x.rows[0]),
    (x) => (x.rows[0].first = 1),
    (x) => (x.rows[0].seed = 43),
    (x) => (x.rows[0].replayVerified = false),
    (x) => (x.acceptedCatalogueChanged = true)
  ]) {
    const bad = report();
    change(bad);
    assert.throws(() => summarizeTrial(bad, { seed: 42, count: 1 }));
  }
});

import { trialResume, assertTrialEngine } from '../scripts/content-report.mjs';
test('pure trial resume reuses proven output, retries only incomplete exact inputs and preserves unknown state', () => {
  const h = 'a'.repeat(64),
    e = { key: h, sourceDigest: h, engineHash: h, seed: 42, count: 1 };
  assert.equal(
    trialResume(null, e, () => null),
    'run'
  );
  assert.equal(
    trialResume({ ...e, status: 'running' }, e, () => null),
    'retry_pure_simulation'
  );
  assert.equal(
    trialResume({ ...e, status: 'passed', resultHash: h, logHash: h }, e, () => h),
    'reuse'
  );
  assert.throws(() =>
    trialResume({ ...e, status: 'passed', resultHash: h, logHash: h }, e, () => null)
  );
  assert.throws(() => trialResume({ ...e, status: 'running', seed: 43 }, e, () => null));
  assert.throws(() => trialResume({ ...e, status: 'invented' }, e, () => null));
});
test('engine identity uses structured version, not CLI versus display-string spelling', () => {
  assertTrialEngine({
    major: 4,
    minor: 7,
    patch: 2,
    status: 'stable',
    hash: 'ed1daf0bf',
    string: '4.7.2-stable (official)'
  });
  for (const change of [{ minor: 8 }, { patch: 3 }, { status: 'dev' }, { hash: '' }])
    assert.throws(() =>
      assertTrialEngine({
        major: 4,
        minor: 7,
        patch: 2,
        status: 'stable',
        hash: 'ed1daf0bf',
        ...change
      })
    );
});
