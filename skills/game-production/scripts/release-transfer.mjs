import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resumableDownload } from './resumable-download.mjs';
const REPO = 'neurofoxpro/multimental';
const HASH = /^[a-f0-9]{64}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
function plainFile(file, max) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max)
    throw Error('Unsafe release transfer file');
  return stat;
}
function fileHash(file, max) {
  plainFile(file, max);
  return digest(fs.readFileSync(file));
}
function noLinks(file) {
  let current = path.resolve(file);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw Error('Release transfer symlink refused');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
export function releaseAssetIdentity(asset, repository, releaseId, expectedHash, maxBytes) {
  if (
    repository !== REPO ||
    !Number.isSafeInteger(releaseId) ||
    releaseId < 1 ||
    !Number.isSafeInteger(asset?.id) ||
    asset.id < 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(asset.name || '') ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    asset.size > maxBytes
  )
    throw Error('Invalid immutable release asset');
  const hash = /^sha256:([a-f0-9]{64})$/.exec(asset.digest || '')?.[1];
  if (!hash || (expectedHash !== undefined && (!HASH.test(expectedHash) || expectedHash !== hash)))
    throw Error('Release asset digest differs or is missing');
  const url = new URL(asset.browser_download_url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/' + REPO + '/releases/download/') ||
    !url.pathname.endsWith('/' + asset.name)
  )
    throw Error('Noncanonical release asset URL');
  return {
    id: REPO + ':' + releaseId + ':' + asset.id,
    sha256: hash,
    size: asset.size,
    url: url.href
  };
}
export async function releaseFetch(url, options, fetcher = fetch) {
  for (let redirects = 0; redirects <= 4; redirects++) {
    const u = new URL(url);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      ![
        'github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com'
      ].includes(u.hostname)
    )
      throw Error('Release redirect origin refused');
    const response = await fetcher(u.href, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 4) throw Error('Release redirect limit');
    url = new URL(location, u).href;
  }
  throw Error('Release redirect limit');
}
export async function downloadReleaseAsset({
  asset,
  repository,
  releaseId,
  file,
  leaseFile,
  expectedHash,
  maxBytes,
  legacyManifest = null,
  fetcher = fetch,
  transfer = resumableDownload
}) {
  const identity = releaseAssetIdentity(asset, repository, releaseId, expectedHash, maxBytes);
  if (
    !path.isAbsolute(file) ||
    !path.isAbsolute(leaseFile) ||
    path.basename(file) !== asset.name ||
    path.basename(leaseFile) !== 'update.lock' ||
    !samePath(path.dirname(file), path.join(path.dirname(leaseFile), 'releases', String(releaseId)))
  )
    throw Error('Release file outside owned installation directory');
  noLinks(file);
  noLinks(leaseFile);
  plainFile(leaseFile, 4096);
  const lockBytes = fs.readFileSync(leaseFile);
  if (lockBytes.length > 4096 || JSON.parse(lockBytes.toString('utf8')).pid !== process.pid)
    throw Error('Release updater lease is not owned');
  const lockHash = digest(lockBytes);
  const own = () => {
    if (fileHash(leaseFile, 4096) !== lockHash) throw Error('Release updater lease changed');
  };
  const validFinal = (candidate) =>
    plainFile(candidate, maxBytes).size === identity.size &&
    fileHash(candidate, maxBytes) === identity.sha256;
  if (fs.existsSync(file)) {
    if (!validFinal(file)) throw Error('Existing release file does not match immutable asset');
    return { status: 'verified', reused: true, bytes: identity.size, sha256: identity.sha256 };
  }
  // A separate owned transfer never truncates the legacy .part left by the old updater.
  const stage = file + '.verified-download',
    partial = stage + '.part',
    meta = partial + '.json',
    seedFile = stage + '.seed.json';
  for (const p of [stage, partial, meta, seedFile]) noLinks(p);
  for (const candidate of [stage, partial])
    if (fs.existsSync(candidate)) plainFile(candidate, identity.size);
  for (const candidate of [meta, seedFile])
    if (fs.existsSync(candidate)) plainFile(candidate, 4096);
  let seededBytes = 0;
  if (!fs.existsSync(stage) && legacyManifest && fs.existsSync(file + '.part')) {
    if (
      !samePath(legacyManifest.file, path.join(path.dirname(file), 'build-manifest.json')) ||
      !HASH.test(legacyManifest.sha256 || '') ||
      fileHash(legacyManifest.file, 100000) !== legacyManifest.sha256
    )
      throw Error('Legacy prefix manifest is not authenticated');
    const manifest = JSON.parse(fs.readFileSync(legacyManifest.file, 'utf8'));
    if (
      manifest.repository !== REPO ||
      manifest.package !== 'pro.neurofox.multimental.dev' ||
      manifest.sourceBranch !== 'dev' ||
      !/^[a-f0-9]{40}$/.test(manifest.commit || '') ||
      manifest.apk !== asset.name ||
      manifest.sha256 !== identity.sha256
    )
      throw Error('Legacy prefix belongs to another release manifest');
    noLinks(file + '.part');
    const bytes = plainFile(file + '.part', identity.size).size;
    if (bytes && !fs.existsSync(file + '.part.json') && !fs.existsSync(partial)) {
      const seed = {
        schemaVersion: 1,
        id: identity.id,
        sha256: identity.sha256,
        bytes,
        copiedPrefixHash: fileHash(file + '.part', identity.size),
        prefixAuthenticated: false,
        finalSha256Required: true
      };
      if (fs.existsSync(seedFile)) {
        if (JSON.stringify(JSON.parse(fs.readFileSync(seedFile, 'utf8'))) !== JSON.stringify(seed))
          throw Error('Transfer seed identity changed');
      } else fs.writeFileSync(seedFile, JSON.stringify(seed), { flag: 'wx' });
      fs.copyFileSync(file + '.part', partial, fs.constants.COPYFILE_EXCL);
      if (
        fileHash(partial, identity.size) !== seed.copiedPrefixHash ||
        fileHash(file + '.part', identity.size) !== seed.copiedPrefixHash
      )
        throw Error('Legacy prefix changed during protected copy');
    }
    if (fs.existsSync(seedFile) && fs.existsSync(partial)) {
      const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
      if (
        seed.id !== identity.id ||
        seed.sha256 !== identity.sha256 ||
        !Number.isSafeInteger(seed.bytes) ||
        seed.bytes < 1 ||
        seed.bytes > identity.size ||
        !HASH.test(seed.copiedPrefixHash || '')
      )
        throw Error('Invalid prefix seed receipt');
      if (!fs.existsSync(meta)) {
        if (
          plainFile(partial, identity.size).size !== seed.bytes ||
          fileHash(partial, identity.size) !== seed.copiedPrefixHash
        )
          throw Error('Unidentified partial is not the recorded copied prefix');
        fs.writeFileSync(meta, JSON.stringify({ id: identity.id, sha256: identity.sha256 }), {
          flag: 'wx'
        });
      }
      seededBytes = seed.bytes;
    }
  }
  own();
  const receiptFile = stage + '.receipt.json';
  const save = (value) => {
    noLinks(receiptFile);
    fs.writeFileSync(
      receiptFile,
      JSON.stringify(
        {
          schemaVersion: 1,
          id: identity.id,
          sha256: identity.sha256,
          size: identity.size,
          seededBytes,
          originalLegacyPartialPreserved: true,
          ...value
        },
        null,
        2
      )
    );
  };
  save({ status: 'running', observedAt: new Date().toISOString() });
  try {
    const result = await transfer({
      file: stage,
      id: identity.id,
      sha256: identity.sha256,
      maxBytes: identity.size,
      requestTimeoutMs: 90000,
      maxDurationMs: 360000,
      maxRequests: 8,
      resolveURL: async () => {
        own();
        return identity.url;
      },
      fetcher: (url, options) => releaseFetch(url, options, fetcher),
      progress: (state) => {
        own();
        save({ status: 'partial', observedAt: new Date().toISOString(), transfer: state });
        console.log('RELEASE_DOWNLOAD ' + JSON.stringify({ asset: asset.name, ...state }));
      }
    });
    own();
    if (!validFinal(stage)) throw Error('Completed release transfer size or SHA-256 mismatch');
    if (fs.existsSync(file)) {
      if (!validFinal(file)) throw Error('Release destination changed');
    } else fs.renameSync(stage, file);
    own();
    if (!validFinal(file)) throw Error('Published local release file failed readback');
    const done = {
      status: 'verified',
      observedAt: new Date().toISOString(),
      sha256: identity.sha256,
      bytes: identity.size,
      seededBytes,
      transfer: result
    };
    save(done);
    return done;
  } catch (error) {
    save({
      status: 'paused_or_failed',
      observedAt: new Date().toISOString(),
      error: error.message,
      resume: 'Repeat the same delivery; do not clear the identified partial.'
    });
    throw error;
  }
}

export function updateOptions(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i],
      value = args[i + 1];
    if (
      !['--config', '--commit'].includes(name) ||
      Object.hasOwn(values, name) ||
      typeof value !== 'string' ||
      !value ||
      value.startsWith('--')
    )
      throw Error('Unknown, duplicate or incomplete updater option');
    values[name] = value;
  }
  if (!values['--config'] || (values['--commit'] && !/^[a-f0-9]{40}$/.test(values['--commit'])))
    throw Error('Explicit config and exact optional commit required');
  return { config: values['--config'], expectedCommit: values['--commit'] || null };
}
export function releaseCandidate(releases, expectedCommit = null) {
  if (
    !Array.isArray(releases) ||
    releases.length > 100 ||
    (expectedCommit !== null && !/^[a-f0-9]{40}$/.test(expectedCommit))
  )
    throw Error('Bounded release list and exact commit required');
  const candidates = releases.filter(
    (r) =>
      r?.prerelease === true &&
      r.draft === false &&
      /^v\d+\.\d+\.\d+-(?:alpha|beta|rc)\./.test(r.tag_name || '') &&
      Array.isArray(r.assets) &&
      r.assets.some((a) => a.name === 'build-manifest.json')
  );
  for (const c of candidates)
    if (
      c.assets.filter((a) => a.name === 'build-manifest.json').length !== 1 ||
      !Number.isSafeInteger(c.id) ||
      c.id < 1 ||
      !Number.isFinite(Date.parse(c.published_at))
    )
      throw Error('Ambiguous or invalid release metadata');
  return (
    candidates
      .filter((c) => !expectedCommit || c.target_commitish === expectedCommit)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || b.id - a.id)[0] ||
    null
  );
}
