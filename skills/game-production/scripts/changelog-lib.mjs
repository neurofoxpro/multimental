import fs from 'node:fs';
import path from 'node:path';
const KINDS = Object.freeze({
  added: 'Добавлено',
  changed: 'Изменено',
  fixed: 'Исправлено',
  security: 'Безопасность',
  deprecated: 'Устаревает',
  removed: 'Удалено'
});
const SCOPES = new Set(['game', 'ui', 'network', 'automation', 'tests', 'docs']);
export function baseVersion(value) {
  if (typeof value !== 'string' || value.trim() !== value)
    throw Error('Некорректная SemVer-версия');
  const m = String(value).match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/
  );
  if (!m) throw Error('Некорректная SemVer-версия');
  return m.slice(1, 4).join('.');
}
export function validateChange(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('Запись должна быть объектом');
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(x.id || '')) throw Error('Недопустимый ID изменения');
  if (baseVersion(x.version) !== x.version)
    throw Error('В записи нужна базовая версия без номера alpha');
  if (!Object.hasOwn(KINDS, x.kind) || !SCOPES.has(x.scope))
    throw Error('Недопустимая категория/область');
  if (
    typeof x.text !== 'string' ||
    x.text.length < 12 ||
    x.text.length > 1200 ||
    !/[А-Яа-яЁё]/.test(x.text) ||
    /[\r\n\x00-\x1f]/.test(x.text)
  )
    throw Error('Нужен однострочный русский текст изменения');
  if (
    /<\/?(?:script|iframe)|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----/i.test(x.text)
  )
    throw Error('Небезопасный текст');
  if (typeof x.breaking !== 'boolean') throw Error('Явно укажите breaking');
  if (
    x.references !== undefined &&
    (!Array.isArray(x.references) ||
      x.references.some(
        (r) => typeof r !== 'string' || !/^(?:\d+|[a-zA-Z0-9_./-]+)$/.test(r) || r.includes('..')
      ))
  )
    throw Error('Некорректные ссылки');
  return x;
}
export function validateChanges(changes) {
  const seen = new Set();
  for (const x of changes) {
    validateChange(x);
    if (seen.has(x.id)) throw Error('Повтор ID изменения ' + x.id);
    seen.add(x.id);
  }
  return changes;
}
export function readChanges(root) {
  const dir = path.join(root, 'changes/fragments');
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  return validateChanges(
    names.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8').replace(/^\uFEFF/, '')))
  );
}
function escaped(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function descending(a, b) {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
}
function sections(changes) {
  const lines = [];
  for (const [kind, label] of Object.entries(KINDS)) {
    const rows = changes
      .filter((x) => x.kind === kind)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!rows.length) continue;
    lines.push('### ' + label, '');
    for (const x of rows)
      lines.push('- ' + (x.breaking ? '**Несовместимое изменение.** ' : '') + escaped(x.text));
    lines.push('');
  }
  return lines;
}
export function renderChangelog(changes, { currentVersion, repository }) {
  validateChanges(changes);
  const current = baseVersion(currentVersion);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Нужен репозиторий');
  const versions = [...new Set(changes.map((x) => x.version))].sort(descending);
  const out = [
    '# История изменений Multimental',
    '',
    'Этот файл генерируется из changes/fragments. Записи описывают изменения для человека, а не сырой Git log.',
    'Базовые версии обозначают серии разработки, не факт выпуска stable. Точный номер alpha, commit и проверки опубликованы в GitHub Release.',
    '',
    'Порядок разделов основан на Keep a Changelog; совместимость — по согласованному SemVer.',
    ''
  ];
  for (const version of versions) {
    out.push(
      '## ' +
        version +
        (version === current ? ' — текущая серия разработки' : ' — предыдущая серия alpha'),
      '',
      ...sections(changes.filter((x) => x.version === version))
    );
  }
  out.push(
    '## Проверки и ограничения',
    '',
    'Автоматические проверки и установка привязаны к конкретному APK; их результаты не выводятся из списка изменений.',
    'Ручная приёмка: docs/MANUAL_TESTS.ru.md. Полный план: docs/ROADMAP.ru.md.',
    ''
  );
  return out.join('\n');
}
export function renderReleaseNotes(
  changes,
  { version, repository, commit, manifest, baseChanges = [] }
) {
  const base = baseVersion(version);
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw Error('Нужен точный commit/репозиторий');
  validateChanges(changes);
  const previous = new Map(validateChanges(baseChanges).map((x) => [x.id, JSON.stringify(x)]));
  const selected = changes.filter(
    (x) => x.version === base && previous.get(x.id) !== JSON.stringify(x)
  );
  const out = [
    '# Multimental ' + version,
    '',
    'Предварительная версия для проверки. Не stable и не публикация Google Play.',
    ''
  ];
  if (selected.length) out.push(...sections(selected));
  else
    out.push(
      '## Пересборка',
      '',
      'Новых записей изменений относительно предыдущей публикации нет. Бинарник пересобран из указанного коммита.',
      ''
    );
  out.push(
    '## Происхождение и проверки',
    '',
    '- Репозиторий: ' + repository + '.',
    '- Коммит: ' + commit + '.',
    '- SHA-256 исходного APK: ' + manifest.sha256 + '.',
    '- Проверки кода/сборки: https://github.com/' +
      repository +
      '/actions/runs/' +
      manifest.workflowRun +
      '.',
    '- Версия Android-пакета: ' + manifest.versionCode + '.',
    ''
  );
  out.push(
    '## Установка и известные ограничения',
    '',
    'На разрешённой тестовой станции APK проверяется и переподписывается постоянным приватным dev-ключом. Исходный и установленный SHA-256 различаются и фиксируются отдельно.',
    'Публикация релиза сама по себе не доказывает установку на конкретный телефон или ручную приёмку. Результат доставки фиксирует production-квитанция.',
    'Известные ограничения этой серии берутся из docs/MANUAL_TESTS.ru.md и roadmap; отложенные механики не считаются готовыми.',
    '',
    '## Ручная проверка',
    '',
    'https://github.com/' + repository + '/blob/' + commit + '/docs/MANUAL_TESTS.ru.md',
    ''
  );
  return out.join('\n');
}
