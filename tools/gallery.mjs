import { runtimeSucceeded } from './runtime-diagnostics.mjs';
import { managedReplacement } from '../skills/game-production/scripts/gallery-policy.mjs';
import {
  readmeGallery,
  replaceReadmeGallery
} from '../skills/game-production/scripts/gallery-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertCapture,
  assertManifest,
  sourceInputs,
  inputKey,
  safeFile,
  digest,
  pngSize
} from '../skills/game-production/scripts/gallery-policy.mjs';
import {
  findRoot,
  inside,
  readJSON,
  writeJSON,
  context
} from '../skills/game-production/scripts/lib.mjs';
import { acquireOperation } from '../skills/game-production/scripts/operation-lock.mjs';
import { applyBundle } from '../skills/game-production/scripts/apply.mjs';
import { verificationRuntime } from './godot-runtime.mjs';
import { prepareGodotProject } from './godot-preflight.mjs';
const CURRENT = 'docs/media/gallery/current.json';
const CAPTION = {
  menu: 'Главное меню',
  collection: 'Коллекция и колоды',
  card: 'Подробности карты',
  battle: 'Тактический бой',
  shop: 'Магазин паков',
  crafting: 'Создание карт',
  rewards: 'Награды и задания',
  connection: 'Подключение по LAN',
  rules: 'Карты и правила',
  settings: 'Звук'
};
function command(root, exe, args, timeout = 30000) {
  const r = spawnSync(exe, args, {
    cwd: root,
    shell: false,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16000000
  });
  if (r.error || r.status !== 0) throw Error('Gallery command failed: ' + exe + ' ' + args[0]);
  return r.stdout.trim();
}
function document(m) {
  let text = '# Multimental — актуальная галерея интерфейса\n\n';
  text +=
    'Это настоящая отрисовка исходного приложения в изолированном тестовом профиле, не нарисованные макеты и не фотографии установленного Android APK.\n\n';
  text += `Снято: ${m.capturedAt}. Базовый commit: ${m.captureBaseCommit}. Ключ точных входов отрисовки: ${m.inputKey}. Изменения в рабочем дереве при съёмке: ${m.captureWorktreeDirty ? 'были; их точные хеши перечислены в манифесте' : 'отсутствовали'}.\n\n`;
  text +=
    'Проверка: `scripts/chat.cmd gallery check`. Обновление: `scripts/chat.cmd gallery capture`, затем обычный `ship`. Манифест: [current.json](media/gallery/current.json).\n\n';
  text +=
    'Размеры здесь — логические viewport и пиксели PNG, не измеренные Android dp. CI меняет служебный build stamp; он исключён из ключа визуального кода и отдельно записан как реально показанный. Снимки сохраняют отрисованную служебную подпись, а не выдают её за установленный релиз.\n\n';
  text +=
    'Данные демонстрационные: открытая alpha-коллекция, один пак, три результата матча API-фикстуры. Для LAN подставлен адрес документационного примера; подключение не запускалось. Скриншоты не содержат рабочего стола, телефонных идентификаторов или личного профиля.\n\n';
  for (const page of Object.keys(CAPTION)) {
    text += `## ${CAPTION[page]}\n\n| Русский · 720×1280 | English · 720×1280 |\n|---|---|\n`;
    const cells = ['ru', 'en'].map((locale) => {
      const a = m.assets.find((x) => x.id === `${locale}-${page}-720x1280`);
      return `<img src="${a.path.slice('docs/'.length)}" width="320" alt="${CAPTION[page]} — ${locale}">`;
    });
    text += '| ' + cells.join(' | ') + ' |\n\n';
  }
  text += '## Альбомные контрольные виды · 1280×720\n\n';
  for (const a of m.assets.filter((a) => a.id.endsWith('1280x720')))
    text += `<img src="${a.path.slice('docs/'.length)}" width="640" alt="${a.id}">\n\n`;
  text +=
    'Галерея фиксирует и недостатки текущей версии. Наличие картинки не означает удобство, доступность для скринридера, исправленную навигацию или аппаратную приёмку.\n';
  return text;
}
function promote(root, record) {
  const inputs = sourceInputs(root),
    key = inputKey(inputs);
  if (
    (record?.captureStatus || record?.status) !== 'passed' ||
    record.inputKey !== key ||
    JSON.stringify(record.inputs) !== JSON.stringify(inputs)
  )
    throw Error('Capture source changed; render again');
  assertCapture(record.capture, record.nonce);
  const prefix = 'docs/media/gallery/' + key + '/' + record.nonce + '/';
  const assets = record.capture.images.map((image) => ({
    id: image.id,
    path: prefix + image.file,
    sha256: image.sha256
  }));
  const manifest = {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    capturedAt: record.capturedAt,
    captureBaseCommit: record.baseCommit,
    captureWorktreeDirty: record.dirty,
    sourceIdentity: 'canonical-render-inputs-excluding-ci-build-stamp',
    inputKey: key,
    inputs,
    nonce: record.nonce,
    capture: record.capture,
    assets
  };
  const sources = new Map();
  for (const image of record.capture.images) {
    const source = safeFile(root, '.gameprod/evidence/gallery/' + record.nonce + '/' + image.file);
    const bytes = fs.readFileSync(source),
      dimensions = pngSize(bytes);
    if (
      digest(bytes) !== image.sha256 ||
      dimensions.width !== image.width ||
      dimensions.height !== image.height ||
      bytes.length > 4000000
    )
      throw Error('Capture file changed');
    sources.set(prefix + image.file, { source, bytes });
  }
  assertManifest(manifest, inputs, (p) => sources.get(p).bytes);
  const head = command(root, 'git', ['rev-parse', 'HEAD']);
  const journal = inside(root, '.gameprod/evidence/gallery-promote.json');
  const prior = fs.existsSync(journal) ? readJSON(journal) : null;
  let remembered =
    prior && ['prepared', 'staged_not_github_published'].includes(prior.status)
      ? [...(prior.documents || []), ...(prior.documentsBefore || [])]
      : [];
  // Migrate the first locally generated observation only after exact reproduction,
  // not by trusting that every uncommitted document belongs to this adapter.
  if (
    prior?.status === 'staged_not_github_published' &&
    !prior.documents &&
    fs.existsSync(safeFile(root, CURRENT))
  ) {
    const previous = readJSON(safeFile(root, CURRENT));
    assertManifest(previous, previous.inputs, (p) => fs.readFileSync(safeFile(root, p)));
    if (
      prior.inputKey === previous.inputKey &&
      JSON.stringify(prior.assets) === JSON.stringify(previous.assets)
    ) {
      for (const f of [
        { path: CURRENT, content: JSON.stringify(previous, null, 2) + '\n' },
        { path: 'docs/SCREENSHOTS.ru.md', content: document(previous) }
      ]) {
        if (
          fs.existsSync(safeFile(root, f.path)) &&
          fs.readFileSync(safeFile(root, f.path), 'utf8') === f.content
        )
          remembered.push({ path: f.path, sha256: digest(f.content) });
      }
    }
  }
  const readmeBefore = fs.readFileSync(safeFile(root, 'README.md'), 'utf8');
  const readmeAfter = replaceReadmeGallery(readmeBefore, readmeGallery(manifest));
  const allFiles = [
    { path: CURRENT, content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: 'docs/SCREENSHOTS.ru.md', content: document(manifest) },
    { path: 'README.md', content: readmeAfter }
  ];
  const documentsBefore = allFiles
    .filter((f) => fs.existsSync(safeFile(root, f.path)))
    .map((f) => ({ path: f.path, sha256: digest(fs.readFileSync(safeFile(root, f.path))) }));
  const documents = allFiles.map((f) => ({ path: f.path, sha256: digest(f.content) }));
  const files = allFiles.filter(
    (f) =>
      !fs.existsSync(safeFile(root, f.path)) ||
      fs.readFileSync(safeFile(root, f.path), 'utf8') !== f.content
  );
  for (const file of files) {
    const target = safeFile(root, file.path);
    if (fs.existsSync(target)) {
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file.path], {
        cwd: root,
        shell: false,
        encoding: 'utf8',
        timeout: 10000
      });
      const diff = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', file.path], {
        cwd: root,
        shell: false,
        encoding: 'utf8',
        timeout: 10000
      });
      if (tracked.error || diff.error || ![0, 1].includes(diff.status))
        throw Error('Cannot inspect gallery document ownership');
      file.beforeSha256 = digest(fs.readFileSync(target));
      if (file.path === 'README.md') {
        file.expectedCurrentSha256 = file.beforeSha256;
        continue;
      }
      const known = [
        ...new Set(remembered.filter((f) => f.path === file.path).map((f) => f.sha256))
      ];
      const expected = managedReplacement(
        file.beforeSha256,
        tracked.status === 0 && diff.status === 0,
        known
      );
      if (expected) file.expectedCurrentSha256 = expected;
    }
  }
  const proof = {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    base: head,
    inputKey: key,
    assets,
    documentsBefore,
    documents
  };
  writeJSON(journal, { ...proof, status: 'prepared' });
  for (const [relative, item] of sources) {
    const target = safeFile(root, relative);
    if (fs.existsSync(target)) {
      if (digest(fs.readFileSync(target)) !== digest(item.bytes))
        throw Error('Immutable gallery destination differs');
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(item.source, target, fs.constants.COPYFILE_EXCL);
    }
  }
  if (head !== command(root, 'git', ['rev-parse', 'HEAD']) || key !== inputKey(sourceInputs(root)))
    throw Error('Source moved during gallery publication');
  if (files.length) applyBundle(root, { base: head, files });
  assertManifest(readJSON(inside(root, CURRENT)), sourceInputs(root), (p) =>
    fs.readFileSync(safeFile(root, p))
  );
  writeJSON(journal, { ...proof, status: 'staged_not_github_published' });
  return {
    status: 'captured_and_staged',
    images: assets.length,
    inputKey: key,
    gallery: 'docs/SCREENSHOTS.ru.md',
    manifest: CURRENT,
    installedApkCapture: false,
    next: 'review actual PNGs, then ship'
  };
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'check', ...extra] = args;
  if (!['check', 'capture', 'promote'].includes(mode) || extra.length)
    throw Error('gallery check|capture|promote');
  const root = findRoot(),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  if (mode === 'check') {
    const manifest = readJSON(safeFile(root, CURRENT));
    const readme = fs.readFileSync(safeFile(root, 'README.md'), 'utf8');
    if (replaceReadmeGallery(readme, readmeGallery(manifest)) !== readme)
      throw Error('README preview is stale');
    assertManifest(manifest, sourceInputs(root), (p) => fs.readFileSync(safeFile(root, p)));
    console.log(
      'MULTIMENTAL_GALLERY_CHECK_PASS images=' +
        manifest.assets.length +
        ' renderKey=' +
        manifest.inputKey
    );
    return;
  }
  if (process.env.GITHUB_ACTIONS === 'true')
    throw Error('Real rendering and staging are station operations');
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'gallery-' + mode
  });
  try {
    if (mode === 'promote') {
      const file = inside(root, '.gameprod/evidence/gallery-latest.json');
      const record = readJSON(file),
        result = promote(root, record);
      record.status = 'passed';
      delete record.error;
      writeJSON(file, record);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    command(root, process.execPath, ['scripts/format.mjs', 'write'], 60000);
    const nonce = randomBytes(16).toString('hex'),
      folder = safeFile(root, '.gameprod/evidence/gallery/' + nonce);
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    fs.mkdirSync(folder, { recursive: false });
    const inputs = sourceInputs(root),
      key = inputKey(inputs);
    const record = {
      schemaVersion: 1,
      status: 'running',
      nonce,
      capturedAt: new Date().toISOString(),
      baseCommit: command(root, 'git', ['rev-parse', 'HEAD']),
      dirty: !!command(root, 'git', ['status', '--porcelain']),
      inputKey: key,
      inputs
    };
    const save = () => writeJSON(inside(root, '.gameprod/evidence/gallery-latest.json'), record);
    save();
    try {
      let binary = process.env.GODOT_BIN;
      if (!binary && process.platform === 'win32') {
        const dir = path.join(path.dirname(root), 'tools/godot'),
          name = fs.readdirSync(dir).find((n) => /console\.exe$/i.test(n));
        if (!name) throw Error('Pinned Godot missing');
        binary = path.join(dir, name);
      }
      const exe = verificationRuntime(root, binary || 'godot');
      prepareGodotProject(root, exe);
      const run = spawnSync(
        exe,
        [
          '--path',
          'game',
          '--rendering-method',
          'gl_compatibility',
          '--audio-driver',
          'Dummy',
          '--resolution',
          '120x120',
          '--max-fps',
          '30',
          '--script',
          'res://tests/gallery_capture.gd',
          '--',
          nonce
        ],
        { cwd: root, shell: false, encoding: 'utf8', timeout: 120000, maxBuffer: 8000000 }
      );
      const text = (run.stdout || '') + (run.stderr || '');
      fs.writeFileSync(path.join(folder, 'capture.local.log'), text);
      const lines = text.split(/\r?\n/).filter((l) => l.startsWith('MULTIMENTAL_GALLERY_JSON '));
      if (
        run.error ||
        run.status !== 0 ||
        lines.length !== 1 ||
        !text.includes('MULTIMENTAL_GALLERY_PASS images=24') ||
        !runtimeSucceeded(run.status, text, 'MULTIMENTAL_GALLERY_PASS')
      )
        throw Error('Actual render failed: ' + text.slice(-2000));
      record.capture = JSON.parse(lines[0].slice('MULTIMENTAL_GALLERY_JSON '.length));
      assertCapture(record.capture, nonce);
      if (
        key !== inputKey(sourceInputs(root)) ||
        record.baseCommit !== command(root, 'git', ['rev-parse', 'HEAD'])
      )
        throw Error('Render sources changed during capture');
      record.captureStatus = 'passed';
      record.status = 'passed';
      record.logHash = digest(text);
      record.finishedAt = new Date().toISOString();
      save();
      console.log(JSON.stringify(promote(root, record), null, 2));
    } catch (error) {
      record.status = 'failed';
      record.error = error.message;
      save();
      throw error;
    }
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('GALLERY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
