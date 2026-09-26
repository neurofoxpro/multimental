import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{32}$/;
export const PAGES = [
  'menu',
  'collection',
  'card',
  'battle',
  'shop',
  'crafting',
  'rewards',
  'connection',
  'rules',
  'settings'
];
export const SOURCE_ROOTS = [
  'game/src',
  'game/project.godot',
  'game/icon.svg',
  'game/tests/gallery_capture.gd',
  'tools/gallery.mjs',
  'skills/game-production/scripts/gallery-policy.mjs'
];
export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function canonical(bytes, file) {
  return /\.(?:gd|mjs|json|godot|tscn|svg|cfg)$/.test(file)
    ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
    : bytes;
}
export function sourceInputs(root) {
  const rows = [];
  function visit(relative) {
    const full = safeFile(root, relative),
      info = fs.lstatSync(full);
    if (info.isSymbolicLink()) throw Error('Symlink input refused');
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(relative + '/' + name);
    } else if (
      info.isFile() &&
      !relative.endsWith('.gd.uid') &&
      !relative.endsWith('.import') &&
      relative !== 'game/src/build_info.gd'
    ) {
      rows.push({ path: relative, sha256: digest(canonical(fs.readFileSync(full), relative)) });
    }
  }
  SOURCE_ROOTS.forEach(visit);
  if (fs.existsSync(path.join(root, 'game/assets'))) visit('game/assets');
  return rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function inputKey(inputs) {
  return digest(JSON.stringify(inputs));
}
export function safeFile(root, relative) {
  if (
    typeof relative !== 'string' ||
    !/^[a-zA-Z0-9_.\/-]+$/.test(relative) ||
    relative.startsWith('/') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw Error('Unsafe gallery path');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw Error('Gallery symlink refused');
  }
  return current;
}
export function expectedCases() {
  return ['ru', 'en'].flatMap((locale) => [
    ...PAGES.map((page) => ({
      id: `${locale}-${page}-720x1280`,
      locale,
      page,
      width: 720,
      height: 1280
    })),
    ...['menu', 'battle'].map((page) => ({
      id: `${locale}-${page}-1280x720`,
      locale,
      page,
      width: 1280,
      height: 720
    }))
  ]);
}
export function pngSize(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 100 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString() !== 'IHDR'
  )
    throw Error('Invalid PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
export function assertCapture(report, nonce) {
  if (
    !NONCE.test(nonce || '') ||
    report?.schemaVersion !== 1 ||
    report.nonce !== nonce ||
    report.sourcePreview !== true ||
    report.installedApkCapture !== false ||
    report.personalProfileUntouched !== true ||
    typeof report.renderer !== 'string' ||
    !report.renderer ||
    report.renderer === 'headless'
  )
    throw Error('Unproven rendered fixture');
  const cases = expectedCases();
  if (
    !Array.isArray(report.images) ||
    report.images.length !== cases.length ||
    new Set(report.images.map((i) => i.id)).size !== cases.length ||
    new Set(report.images.map((i) => i.sha256)).size !== cases.length
  )
    throw Error('Incomplete gallery matrix');
  for (const expected of cases) {
    const image = report.images.find((i) => i.id === expected.id);
    if (
      !image ||
      Object.entries(expected).some(([key, value]) => image[key] !== value) ||
      image.file !== image.id + '.png' ||
      !HASH.test(image.sha256 || '') ||
      !Number.isInteger(image.sampledColors) ||
      image.sampledColors < 8
    )
      throw Error('Invalid or blank image record');
  }
  return true;
}
export function assertManifest(manifest, inputs, read) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.repository !== 'neurofoxpro/multimental' ||
    manifest.inputKey !== inputKey(inputs) ||
    JSON.stringify(manifest.inputs) !== JSON.stringify(inputs) ||
    !/^[a-f0-9]{40}$/.test(manifest.captureBaseCommit || '') ||
    typeof manifest.captureWorktreeDirty !== 'boolean' ||
    manifest.sourceIdentity !== 'canonical-render-inputs-excluding-ci-build-stamp'
  )
    throw Error('Stale or incomplete render source identity');
  assertCapture(manifest.capture, manifest.nonce);
  const prefix = 'docs/media/gallery/' + manifest.inputKey + '/' + manifest.nonce + '/';
  if (
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== expectedCases().length ||
    new Set(manifest.assets.map((a) => a.path)).size !== manifest.assets.length
  )
    throw Error('Missing or duplicate gallery assets');
  for (const image of manifest.capture.images) {
    const asset = manifest.assets.find((a) => a.id === image.id);
    if (!asset || asset.path !== prefix + image.file || asset.sha256 !== image.sha256)
      throw Error('Unexpected image target');
    const bytes = read(asset.path),
      size = pngSize(bytes);
    if (
      bytes.length > 4000000 ||
      digest(bytes) !== image.sha256 ||
      size.width !== image.width ||
      size.height !== image.height
    )
      throw Error('Screenshot bytes or dimensions changed');
  }
  return true;
}

export function managedReplacement(actual, cleanTracked, known) {
  if (
    !HASH.test(actual || '') ||
    typeof cleanTracked !== 'boolean' ||
    !Array.isArray(known) ||
    known.length > 2 ||
    known.some((h) => !HASH.test(h || ''))
  )
    throw Error('Invalid document ownership proof');
  if (cleanTracked) return null;
  if (!known.includes(actual))
    throw Error('Preserve unreviewed or concurrently edited gallery document');
  return actual;
}

export const README_START = '<!-- gameprod:gallery:start -->';
export const README_END = '<!-- gameprod:gallery:end -->';
export function readmeGallery(manifest) {
  const ids = ['ru-menu-720x1280', 'ru-battle-720x1280', 'ru-card-720x1280'];
  const images = ids.map((id) => {
    const a = manifest.assets.find((a) => a.id === id);
    if (!a || !/^docs\/media\/gallery\/[a-f0-9]{64}\/[a-f0-9]{32}\/[a-z0-9-]+\.png$/.test(a.path))
      throw Error('Invalid README preview');
    return `<img src="${a.path}" width="230" alt="${id}">`;
  });
  return (
    README_START +
    '\n## Актуальные экраны\n\n[Галерея 24 реальных состояний RU/EN](docs/SCREENSHOTS.ru.md) · [проверяемый манифест](docs/media/gallery/current.json). Это source-preview из изолированного профиля, не снимки установленного APK.\n\n' +
    images.join(' ') +
    '\n' +
    README_END
  );
}
export function replaceReadmeGallery(text, block) {
  if (
    typeof text !== 'string' ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
    typeof block !== 'string' ||
    text.split(README_START).length !== 2 ||
    text.split(README_END).length !== 2
  )
    throw Error('Unambiguous safe README gallery markers required');
  const start = text.indexOf(README_START),
    end = text.indexOf(README_END) + README_END.length;
  if (end < start || !block.startsWith(README_START) || !block.endsWith(README_END))
    throw Error('Invalid gallery block order');
  return text.slice(0, start) + block + text.slice(end);
}
