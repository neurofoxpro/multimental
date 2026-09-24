import { readJSONHTTP } from '../skills/game-production/scripts/http-read.mjs';
import { claimUpdateLock } from '../skills/game-production/scripts/device-coordination.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, writeJSON, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { exec, install, validateConfig, isForeground } from './install-device.mjs';
import { updateDisposition } from '../skills/game-production/scripts/qualification-policy.mjs';
export function assetURL(url, repo) {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'github.com' ||
    !u.pathname.startsWith('/' + repo + '/releases/download/') ||
    u.username ||
    u.password
  )
    throw Error('Noncanonical asset URL');
  return u.href;
}
async function json(url) {
  return readJSONHTTP(url, {
    headers: { 'User-Agent': 'multimental-device-updater', Accept: 'application/vnd.github+json' }
  });
}
async function download(url, file, max) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw Error('Download returned ' + r.status);
  if (Number(r.headers.get('content-length') || 0) > max) throw Error('Oversized asset');
  const tmp = file + '.part';
  const fd = fs.openSync(tmp, 'w');
  let total = 0;
  try {
    for await (const chunk of r.body) {
      total += chunk.length;
      if (total > max) throw Error('Oversized stream');
      fs.writeSync(fd, chunk);
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
export async function update(c, { expectedCommit = null } = {}) {
  validateConfig(c);
  if (
    fs.existsSync(path.join(c.workDir, 'device-test.lock')) ||
    fs.existsSync(path.join(c.workDir, 'qualification.lock'))
  ) {
    console.log('DEVICE_UPDATE_DEFERRED_TEST');
    return { status: 'deferred_test' };
  }
  chooseDevice(exec(c.adb, ['devices', '-l']), c.serial);
  fs.mkdirSync(c.workDir, { recursive: true });
  if (isForeground(c) && !c.autoCloseForUpdate) {
    console.log('DEVICE_UPDATE_DEFERRED_FOREGROUND');
    return { status: 'deferred_foreground' };
  }
  const lock = path.join(c.workDir, 'update.lock');
  if (!claimUpdateLock(lock)) return { status: 'deferred_busy' };
  try {
    if (fs.existsSync(path.join(c.workDir, 'device-test.lock'))) {
      return { status: 'deferred_test' };
    }
    if (
      fs.existsSync(path.join(c.workDir, 'device-test.lock')) ||
      fs.existsSync(path.join(c.workDir, 'qualification.lock'))
    )
      return { status: 'deferred_test' };
    const api = 'https://api.github.com/repos/' + c.repository;
    const releases = await json(api + '/releases?per_page=20');
    const candidates = releases.filter(
      (r) =>
        r.prerelease &&
        !r.draft &&
        /^v\d+\.\d+\.\d+-(?:alpha|beta|rc)\./.test(r.tag_name) &&
        r.assets.some((a) => a.name === 'build-manifest.json')
    );
    if (!candidates.length) {
      console.log('NO_ELIGIBLE_PRERELEASE');
      return { status: 'no_release' };
    }
    const latest = candidates.sort(
      (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)
    )[0];
    const manifestAsset = latest.assets.find((a) => a.name === 'build-manifest.json');
    const dir = path.join(c.workDir, 'releases', String(latest.id));
    fs.mkdirSync(dir, { recursive: true });
    await download(
      assetURL(manifestAsset.browser_download_url, c.repository),
      path.join(dir, 'build-manifest.json'),
      100000
    );
    const m = readJSON(path.join(dir, 'build-manifest.json'));
    if (
      m.repository !== c.repository ||
      m.package !== c.package ||
      m.sourceBranch !== 'dev' ||
      !/^\d+$/.test(String(m.workflowRun))
    )
      throw Error('Invalid release provenance');
    if (expectedCommit && m.commit !== expectedCommit)
      return { status: 'awaiting_expected_release', expectedCommit, visibleCommit: m.commit };
    const run = await json(api + '/actions/runs/' + m.workflowRun);
    if (
      run.conclusion !== 'success' ||
      run.status !== 'completed' ||
      run.event !== 'push' ||
      run.head_branch !== 'dev' ||
      run.head_sha !== m.commit ||
      run.path !== '.github/workflows/build.yml' ||
      run.repository.full_name !== c.repository
    )
      throw Error('Release does not reference successful canonical dev build');
    const tag = await json(api + '/commits/' + encodeURIComponent(latest.tag_name));
    if (tag.sha !== m.commit) throw Error('Release tag/commit mismatch');
    const file = latest.assets.filter((a) => a.name === m.apk);
    if (file.length !== 1 || !m.apk?.match(/^[\w.-]+\.apk$/))
      throw Error('Expected exactly one matching APK');
    const prevFile = path.join(c.workDir, 'installed.local.json');
    if (fs.existsSync(prevFile)) {
      const prev = readJSON(prevFile);
      const pkg = exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'package', c.package], {
        allowFailure: true
      });
      const version = Number(pkg.match(/versionCode=(\d+)/)?.[1] || 0);
      if (prev.originalSha256 === m.sha256 && version === m.versionCode) {
        console.log('DEVICE_UPDATE_ALREADY_CURRENT');
        return { status: 'already_current', version: m.version };
      }
      const disposition = updateDisposition({
        currentCode: Math.max(version, prev.versionCode || 0),
        candidateCode: m.versionCode,
        currentHash: prev.originalSha256,
        candidateHash: m.sha256
      });
      if (disposition === 'newer_candidate_installed')
        return { status: disposition, installedVersion: prev.version, releaseVersion: m.version };
      if (disposition === 'same_version_conflict') throw Error('Same-version artifact conflict');
    }
    await download(
      assetURL(file[0].browser_download_url, c.repository),
      path.join(dir, m.apk),
      250 * 1024 * 1024
    );
    if (
      fs.existsSync(path.join(c.workDir, 'device-test.lock')) ||
      fs.existsSync(path.join(c.workDir, 'qualification.lock'))
    )
      return { status: 'deferred_test' };
    return await install(c, dir, m);
  } finally {
    fs.unlinkSync(lock);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let c;
  try {
    const a = process.argv.slice(2);
    if (!a.includes('--config')) throw Error('Explicit --config required');
    c = validateConfig(readJSON(a[a.indexOf('--config') + 1]));
    const result = await update(c);
    writeJSON(path.join(c.workDir, 'last-update-check.local.json'), {
      checkedAt: new Date().toISOString(),
      ...result
    });
  } catch (e) {
    if (c)
      writeJSON(path.join(c.workDir, 'last-update-check.local.json'), {
        checkedAt: new Date().toISOString(),
        status: 'blocked',
        error: e.message
      });
    console.error('UPDATE_BLOCKED: ' + e.message);
    process.exitCode = 1;
  }
}
