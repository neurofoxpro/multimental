import { createHash } from 'node:crypto';
export const ELEMENTS = [
  'fire',
  'water',
  'lightning',
  'air',
  'earth',
  'light',
  'dark',
  'mecha',
  'poison',
  'mystery'
];
export const ROLES = ['fighter', 'guard', 'lancer', 'archer', 'flanker'];
export const RULES = 'terrain-sweep-v3-balance1';
export const EFFECT = 'directional-sweep-v1';
export const ACCEPTED_COUNT = 30;
export const STARTER = [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 21, 23, 24];
export const hash = (x) => createHash('sha256').update(x).digest('hex');
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') +
    '}'
  );
}
export const contentHash = (value) => hash(canonical(value));
const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
const plain = (s, max) =>
  typeof s === 'string' &&
  s.length > 0 &&
  s.length <= max &&
  s === s.trim() &&
  s.isWellFormed() &&
  !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(s);
function object(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== [...keys].sort().join('|')
  )
    throw Error('CONTENT_FIELDS:' + label);
}
export function cardSchema() {
  const text = { type: 'string', minLength: 1, maxLength: 280 };
  const translated = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'description'],
    properties: { name: { ...text, maxLength: 48 }, description: text }
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Multimental versioned card data',
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'version',
      'slot',
      'element',
      'role',
      'cost',
      'attack',
      'health',
      'effect',
      'text',
      'art',
      'origin'
    ],
    properties: {
      id: { type: 'string', pattern: '^c[0-9]{3}$' },
      version: { type: 'integer', minimum: 1, maximum: 1000000 },
      slot: { type: 'integer', minimum: 0, maximum: 255 },
      element: { enum: ELEMENTS },
      role: { enum: ROLES },
      cost: { type: 'integer', minimum: 1, maximum: 8 },
      attack: { type: 'integer', minimum: 1, maximum: 12 },
      health: { type: 'integer', minimum: 1, maximum: 30 },
      effect: { const: EFFECT },
      text: {
        type: 'object',
        additionalProperties: false,
        required: ['ru', 'en'],
        properties: { ru: translated, en: translated }
      },
      origin: {
        type: 'object',
        additionalProperties: false,
        required: ['author', 'reference'],
        properties: { author: { ...text, maxLength: 120 }, reference: { ...text, maxLength: 240 } }
      },
      art: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: { kind: { const: 'none' } }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'kind',
              'path',
              'sha256',
              'source',
              'license',
              'author',
              'prompt',
              'generator'
            ],
            properties: {
              kind: { enum: ['owned', 'generated', 'third-party'] },
              path: { type: 'string', pattern: '^game/assets/cards/[a-z0-9_-]+[.](png|webp)$' },
              sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              source: { ...text, maxLength: 240 },
              license: { ...text, maxLength: 100 },
              author: { ...text, maxLength: 120 },
              prompt: { type: 'string', maxLength: 4000 },
              generator: { type: 'string', maxLength: 120 }
            }
          }
        ]
      }
    }
  };
}
export function validateArt(art, readAsset) {
  if (art?.kind === 'none') {
    object(art, ['kind'], 'art-none');
    return;
  }
  object(
    art,
    ['kind', 'path', 'sha256', 'source', 'license', 'author', 'prompt', 'generator'],
    'art'
  );
  if (
    !['owned', 'generated', 'third-party'].includes(art.kind) ||
    !/^game\/assets\/cards\/[a-z0-9_-]+\.(?:png|webp)$/.test(art.path || '') ||
    !/^([a-f0-9]{64})$/.test(art.sha256 || '') ||
    !plain(art.source, 240) ||
    !plain(art.author, 120) ||
    !plain(art.license, 100)
  )
    throw Error('CONTENT_ART_PROVENANCE');
  if (art.kind === 'generated') {
    if (!plain(art.prompt, 4000) || !plain(art.generator, 120))
      throw Error('CONTENT_GENERATION_PROVENANCE');
  } else if (art.prompt !== '' || art.generator !== '') throw Error('CONTENT_NON_GENERATED_ART');
  if (typeof readAsset !== 'function') throw Error('CONTENT_ART_BYTES_REQUIRED');
  const bytes = readAsset(art.path);
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 24 ||
    bytes.length > 4000000 ||
    hash(bytes) !== art.sha256
  )
    throw Error('CONTENT_ART_BYTES');
  if (art.path.endsWith('.png')) {
    if (
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.subarray(12, 16).toString() !== 'IHDR' ||
      bytes.readUInt32BE(16) < 1 ||
      bytes.readUInt32BE(16) > 4096 ||
      bytes.readUInt32BE(20) < 1 ||
      bytes.readUInt32BE(20) > 4096
    )
      throw Error('CONTENT_ART_PNG');
  } else if (
    bytes.subarray(0, 4).toString() !== 'RIFF' ||
    bytes.subarray(8, 12).toString() !== 'WEBP'
  )
    throw Error('CONTENT_ART_WEBP');
}
export function validateCard(card, readAsset) {
  object(
    card,
    [
      'id',
      'version',
      'slot',
      'element',
      'role',
      'cost',
      'attack',
      'health',
      'effect',
      'text',
      'art',
      'origin'
    ],
    'card'
  );
  if (
    !integer(card.slot, 0, 255) ||
    card.id !== 'c' + String(card.slot).padStart(3, '0') ||
    !integer(card.version, 1, 1000000)
  )
    throw Error('CONTENT_CARD_ID_VERSION');
  if (!ELEMENTS.includes(card.element) || !ROLES.includes(card.role) || card.effect !== EFFECT)
    throw Error('CONTENT_UNREVIEWED_EFFECT');
  for (const [key, max] of [
    ['cost', 8],
    ['attack', 12],
    ['health', 30]
  ])
    if (!integer(card[key], 1, max)) throw Error('CONTENT_STAT:' + key);
  object(card.text, ['ru', 'en'], 'translations');
  for (const locale of ['ru', 'en']) {
    object(card.text[locale], ['name', 'description'], locale);
    if (!plain(card.text[locale].name, 48) || !plain(card.text[locale].description, 280))
      throw Error('CONTENT_TEXT:' + locale);
  }
  object(card.origin, ['author', 'reference'], 'origin');
  if (!plain(card.origin.author, 120) || !plain(card.origin.reference, 240))
    throw Error('CONTENT_ORIGIN');
  validateArt(card.art, readAsset);
  return card;
}
export function validateCatalog(data, readAsset) {
  object(data, ['schemaVersion', 'id', 'version', 'rules', 'compatibility', 'cards'], 'catalog');
  if (
    data.schemaVersion !== 1 ||
    data.id !== 'multimental-alpha' ||
    !integer(data.version, 1, 1000000) ||
    data.rules !== RULES ||
    data.compatibility !== 'alpha-open-30x2-v1' ||
    !Array.isArray(data.cards) ||
    data.cards.length !== ACCEPTED_COUNT
  )
    throw Error('CONTENT_ACCEPTED_COMPATIBILITY_REVIEW_REQUIRED');
  for (const [i, c] of data.cards.entries()) {
    validateCard(c, readAsset);
    if (c.slot !== i) throw Error('CONTENT_ACCEPTED_ORDER');
  }
  return data;
}
export function runtimeRows(cards) {
  return cards.map((c) => ({
    id: c.slot,
    element: ELEMENTS.indexOf(c.element),
    ru: c.text.ru.name,
    en: c.text.en.name,
    cost: c.cost,
    attack: c.attack,
    health: c.health,
    role: ROLES.indexOf(c.role),
    kind: c.role
  }));
}
export function compileRuntime(catalog, readAsset) {
  validateCatalog(catalog, readAsset);
  const rows = runtimeRows(catalog.cards);
  return (
    'extends RefCounted\n## Generated by content build. Edit content/accepted/catalog.json, not this file.\nconst VERSION: int = ' +
    catalog.version +
    '\nconst CONTENT_HASH: String = ' +
    JSON.stringify(contentHash(catalog)) +
    '\nconst CARD_COUNT: int = ' +
    rows.length +
    '\nconst ROWS: Array[Dictionary] = [\n' +
    rows.map((r) => '    ' + JSON.stringify(r)).join(',\n') +
    '\n]\n\nstatic func card(id: int) -> Dictionary:\n    return ROWS[id].duplicate(true) if id >= 0 and id < CARD_COUNT else {}\n'
  );
}
export function candidate(data, accepted, readAsset) {
  validateCatalog(accepted, readAsset);
  object(
    data,
    ['schemaVersion', 'id', 'revision', 'baseHash', 'operation', 'fromVersion', 'card', 'trial'],
    'candidate'
  );
  if (
    data.schemaVersion !== 1 ||
    !/^[-a-z0-9]{3,64}$/.test(data.id || '') ||
    !integer(data.revision, 1, 1000000) ||
    data.baseHash !== contentHash(accepted)
  )
    throw Error('CONTENT_STALE_CANDIDATE');
  validateCard(data.card, readAsset);
  const card = data.card,
    prior = accepted.cards.find((c) => c.id === card.id);
  if (data.operation === 'add') {
    if (
      prior ||
      card.slot !== accepted.cards.length ||
      card.version !== 1 ||
      data.fromVersion !== 0
    )
      throw Error('CONTENT_APPEND_ID_REQUIRED');
  } else if (data.operation === 'revise') {
    if (
      !prior ||
      prior.slot !== card.slot ||
      prior.version !== data.fromVersion ||
      card.version !== prior.version + 1
    )
      throw Error('CONTENT_REVISION_REQUIRED');
  } else throw Error('CONTENT_UNKNOWN_OPERATION');
  object(data.trial, ['replace', 'copies'], 'trial');
  const reference = accepted.cards.find((c) => c.id === data.trial.replace);
  if (!reference || !integer(data.trial.copies, 1, 2) || (prior && reference.id !== card.id))
    throw Error('CONTENT_TRIAL_COMPARISON');
  const cards = structuredClone(accepted.cards);
  if (prior) cards[card.slot] = structuredClone(card);
  else cards.push(structuredClone(card));
  const baseDeck = STARTER.filter((id) => id !== reference.slot).slice(0, 15 - data.trial.copies);
  while (baseDeck.length < 15) baseDeck.push(reference.slot);
  const testDeck = baseDeck.map((id) => (id === reference.slot ? card.slot : id));
  return {
    schemaVersion: 1,
    id: data.id,
    revision: data.revision,
    hash: contentHash(data),
    acceptedHash: contentHash(accepted),
    status: 'candidate_not_accepted',
    operation: data.operation,
    reference: reference.id,
    testedCard: card.id,
    baseRows: runtimeRows(accepted.cards),
    candidateRows: runtimeRows(cards),
    baseDeck,
    candidateDeck: testDeck,
    cards
  };
}
export function contentOptions(args) {
  const [mode = 'check', ...rest] = args;
  if (!['check', 'build', 'add', 'trial'].includes(mode))
    throw Error('content check|build|add CANDIDATE.json|trial CANDIDATE.json [--seed N --count N]');
  if (['check', 'build'].includes(mode)) {
    if (rest.length) throw Error('No extra options');
    return { mode };
  }
  const file = rest.shift();
  if (!/^content\/candidates\/[a-z0-9-]+\.json$/.test(file || ''))
    throw Error('Explicit candidate JSON path required');
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = rest.slice(i, i + 2);
    if (
      mode !== 'trial' ||
      !['--seed', '--count'].includes(k) ||
      !/^\d+$/.test(v || '') ||
      Object.hasOwn(values, k)
    )
      throw Error('Invalid trial option');
    values[k] = Number(v);
  }
  const seed = values['--seed'] ?? 9001,
    count = values['--count'] ?? 8;
  if (!integer(seed, 1, 1000000000) || !integer(count, 1, 64))
    throw Error('Bounded trial range required');
  return { mode, file, seed, count };
}
const esc = (x) =>
  String(x)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll(String.fromCharCode(96), '&#96;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;');
export function catalogMarkdown(catalog, kind = 'accepted') {
  const header = kind === 'accepted' ? 'Принятый каталог' : 'Кандидат - не включён в игру';
  return (
    '# Multimental: ' +
    header +
    '\n\nИсточник: проверенные JSON-данные. Имена и описания - текст, а не исполняемые эффекты.\n\n| ID / версия | Русское имя | English | Стихия / роль | Цена / атака / HP | Иллюстрация |\n|---|---|---|---|---|---|\n' +
    catalog.cards
      .map(
        (c) =>
          '| ' +
          c.id +
          ' v' +
          c.version +
          ' | ' +
          esc(c.text.ru.name) +
          ' | ' +
          esc(c.text.en.name) +
          ' | ' +
          c.element +
          ' / ' +
          c.role +
          ' | ' +
          c.cost +
          ' / ' +
          c.attack +
          ' / ' +
          c.health +
          ' | ' +
          (c.art.kind === 'none'
            ? 'нет; штатное отображение'
            : esc(c.art.kind + '; ' + c.art.license)) +
          ' |'
      )
      .join('\n') +
    '\n\nТекущие 30×2 карты не отбираются. Новые ID и несовместимые правила требуют отдельного решения по коллекции, протоколу и повтору. Успешная симуляция не принимает кандидата автоматически.\n'
  );
}
