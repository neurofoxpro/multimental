import {
  installDisposition,
  confirmInstallEffect
} from '../skills/game-production/scripts/install-recovery-policy.mjs';
import { adbLines } from '../skills/game-production/scripts/android-text.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readJSON,
  writeJSON,
  sha,
  chooseDevice,
  verifyManifest
} from '../skills/game-production/scripts/lib.mjs';
import { waitReady } from './device-readiness.mjs';
import { launchApplication } from './device-launch.mjs';
export function exec(exe, args, { allowFailure = false, env = process.env, binary = false } = {}) {
  const r = spawnSync(exe, args, {
    shell: false,
    encoding: binary ? null : 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    env
  });
  if ((r.error || r.status !== 0) && !allowFailure)
    throw Error(
      path.basename(exe) + ' failed: ' + String(r.stderr || r.error || r.stdout || '').slice(0, 500)
    );
  return binary ? r.stdout : String(r.stdout || '');
}
export function validateConfig(c) {
  if (!c.allowedHost || os.hostname().toUpperCase() !== c.allowedHost.toUpperCase())
    throw Error('Unauthorized execution host');
  if (
    !/^[-\w.]+\/[-\w.]+$/.test(c.repository) ||
    !c.package?.endsWith('.dev') ||
    !c.serial ||
    !path.isAbsolute(c.workDir)
  )
    throw Error('Explicit local device configuration required');
  for (const k of ['adb', 'java', 'keytool', 'apksigner', 'aapt'])
    if (!fs.existsSync(c[k] || '')) throw Error('Missing local tool ' + k);
  return c;
}
export function isForeground(c) {
  const dump = exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'activity', 'activities'], {
    allowFailure: true
  });
  return dump
    .split(/\r?\n/)
    .some((l) => /mResumedActivity|topResumedActivity/.test(l) && l.includes(c.package + '/'));
}
function signer(c, input, output) {
  const dir = path.join(c.workDir, 'private-signing');
  fs.mkdirSync(dir, { recursive: true });
  const info = path.join(dir, 'identity.local.json'),
    key = path.join(dir, 'development.p12');
  let identity;
  if (fs.existsSync(info)) {
    identity = readJSON(info);
    if (!fs.existsSync(key))
      throw Error('Local signing key missing; never regenerate an update identity silently');
  } else {
    if (fs.existsSync(key)) throw Error('Signing identity metadata missing');
    identity = {
      password: crypto.randomBytes(32).toString('hex'),
      created: new Date().toISOString()
    };
    const env = { ...process.env, MULTIMENTAL_KEY_PASS: identity.password };
    exec(
      c.keytool,
      [
        '-genkeypair',
        '-noprompt',
        '-storetype',
        'PKCS12',
        '-keystore',
        key,
        '-alias',
        'multimental-local-dev',
        '-storepass:env',
        'MULTIMENTAL_KEY_PASS',
        '-keypass:env',
        'MULTIMENTAL_KEY_PASS',
        '-keyalg',
        'RSA',
        '-keysize',
        '3072',
        '-validity',
        '10000',
        '-dname',
        'CN=Multimental Local Development'
      ],
      { env }
    );
    writeJSON(info, identity);
  }
  exec(
    c.java,
    [
      '-jar',
      c.apksigner,
      'sign',
      '--ks',
      key,
      '--ks-key-alias',
      'multimental-local-dev',
      '--ks-pass',
      'env:MULTIMENTAL_KEY_PASS',
      '--key-pass',
      'env:MULTIMENTAL_KEY_PASS',
      '--out',
      output,
      input
    ],
    { env: { ...process.env, MULTIMENTAL_KEY_PASS: identity.password } }
  );
  const verify = exec(c.java, ['-jar', c.apksigner, 'verify', '--print-certs', output]);
  const cert = verify.match(/certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]?.toLowerCase();
  if (!cert) throw Error('No verified certificate');
  if (identity.certificate && identity.certificate !== cert)
    throw Error('Signing identity changed');
  if (!identity.certificate) {
    identity.certificate = cert;
    writeJSON(info, identity);
  }
  return cert;
}
function installedArtifact(c) {
  const dump = exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'package', c.package]);
  const version = Number(dump.match(/versionCode=(\d+)/)?.[1] || 0);
  if (!version) return { version: 0, hash: null };
  const paths = adbLines(exec(c.adb, ['-s', c.serial, 'shell', 'pm', 'path', c.package]));
  if (paths.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk$/.test(paths[0]))
    throw Error('Unexpected installed APK layout');
  const hash = exec(c.adb, ['-s', c.serial, 'shell', 'sha256sum', paths[0].slice(8)])
    .trim()
    .split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Missing actual APK hash');
  return { version, hash };
}
function existingSigned(c, out, m) {
  const identityFile = path.join(c.workDir, 'private-signing/identity.local.json');
  if (!fs.existsSync(out) || !fs.existsSync(identityFile)) return null;
  const identity = readJSON(identityFile);
  if (!/^[a-f0-9]{64}$/.test(identity.certificate || ''))
    throw Error('Persistent signing certificate is missing');
  const output = exec(c.java, ['-jar', c.apksigner, 'verify', '--print-certs', out]);
  const certificate = output
    .match(/certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]
    ?.toLowerCase();
  const badge = exec(c.aapt, ['dump', 'badging', out]).match(
    /package: name='([^']+)' versionCode='(\d+)'/
  );
  if (
    certificate !== identity.certificate ||
    !badge ||
    badge[1] !== c.package ||
    Number(badge[2]) !== m.versionCode
  )
    throw Error('Existing signed artifact identity changed');
  return {
    certificate,
    expectedCertificate: identity.certificate,
    signedHash: sha(fs.readFileSync(out))
  };
}
export async function install(c, dir, m, { deferForeground = true, forceReinstall = false } = {}) {
  validateConfig(c);
  if (m.repository !== c.repository || m.package !== c.package)
    throw Error('Artifact scope mismatch');
  const original = verifyManifest(dir, m);
  chooseDevice(exec(c.adb, ['devices', '-l']), c.serial);
  fs.mkdirSync(c.workDir, { recursive: true });
  const lock = path.join(c.workDir, 'install.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch {
    throw Error('Install already in progress; inspect stale locks manually');
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  fs.closeSync(fd);
  try {
    const badging = exec(c.aapt, ['dump', 'badging', original]);
    const pkg = badging.match(/package: name='([^']+)' versionCode='(\d+)'/);
    if (!pkg || pkg[1] !== c.package || Number(pkg[2]) !== m.versionCode)
      throw Error('APK identity differs from manifest');
    const permissions = exec(c.aapt, ['dump', 'permissions', original]);
    const grants = [...permissions.matchAll(/uses-permission(?:-sdk-\d+)?: name='([^']+)'/g)].map(
      (x) => x[1]
    );
    const allowed = c.allowedPermissions || [];
    if (grants.some((x) => !allowed.includes(x))) throw Error('Unexpected Android permission');
    const stampFile = path.join(c.workDir, 'installed.local.json');
    const previous = fs.existsSync(stampFile) ? readJSON(stampFile) : null;
    const observed = installedArtifact(c);
    const version = observed.version;
    if (version > m.versionCode || previous?.versionCode > m.versionCode)
      throw Error('Downgrade refused');
    const out = path.join(dir, 'local-development.apk');
    if (version > 0 && !fs.existsSync(path.join(c.workDir, 'private-signing/identity.local.json')))
      throw Error('Installed app signing identity missing; never generate a replacement');
    let cached = existingSigned(c, out, m);
    if (forceReinstall && !cached) {
      signer(c, original, out);
      cached = existingSigned(c, out, m);
    }
    const disposition = installDisposition({
      version,
      versionCode: m.versionCode,
      actualHash: observed.hash,
      originalHash: m.sha256,
      signedHash: cached?.signedHash,
      certificate: cached?.certificate,
      expectedCertificate: cached?.expectedCertificate,
      previous,
      force: forceReinstall
    });
    if (disposition === 'already_current') {
      console.log('DEVICE_UPDATE_ALREADY_CURRENT');
      return { status: 'already_current', versionCode: version };
    }
    if (deferForeground && !c.autoCloseForUpdate && isForeground(c))
      return { status: 'deferred_foreground' };
    const certificate = cached?.certificate || signer(c, original, out);
    const signedHash = cached?.signedHash || sha(fs.readFileSync(out));
    const journalFile = path.join(dir, 'install-operation.local.json');
    const operation = {
      schemaVersion: 1,
      repository: c.repository,
      package: c.package,
      sourceCommit: m.commit,
      originalSha256: m.sha256,
      installedSha256: signedHash,
      certificateSha256: certificate,
      versionCode: m.versionCode,
      disposition,
      phase: 'observed',
      updatedAt: new Date().toISOString()
    };
    const saveOperation = (phase) => {
      operation.phase = phase;
      operation.updatedAt = new Date().toISOString();
      writeJSON(journalFile, operation);
    };
    saveOperation('observed');
    if (disposition !== 'resume_launch') {
      if (c.autoCloseForUpdate || !deferForeground)
        exec(c.adb, ['-s', c.serial, 'shell', 'am', 'force-stop', c.package]);
      saveOperation('install_pending');
      operation.install = await confirmInstallEffect({
        perform: async () => exec(c.adb, ['-s', c.serial, 'install', '-r', out]),
        observe: async () => installedArtifact(c),
        expectedHash: signedHash,
        expectedVersion: m.versionCode
      });
    } else
      operation.install = {
        acknowledged: false,
        readback: true,
        recoveredPriorCompletion: true,
        installRepeated: false
      };
    saveOperation('installed_readback');
    exec(c.adb, ['-s', c.serial, 'shell', 'am', 'force-stop', c.package]);
    saveOperation('launch_pending');
    const launcher = launchApplication(c);
    const started = performance.now();
    const ready = await waitReady({
      pid: () => exec(c.adb, ['-s', c.serial, 'shell', 'pidof', c.package], { allowFailure: true }),
      log: (id) => {
        const logs = exec(c.adb, ['-s', c.serial, 'logcat', '-d', '--pid=' + id, '-t', '400'], {
          allowFailure: true
        });
        fs.writeFileSync(path.join(dir, 'app-logcat.local.txt'), logs);
        return logs;
      }
    });
    const actual = exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'package', c.package]);
    if (Number(actual.match(/versionCode=(\d+)/)?.[1]) !== m.versionCode)
      throw Error('Installed version mismatch');
    if (isForeground(c)) {
      const image = exec(c.adb, ['-s', c.serial, 'exec-out', 'screencap', '-p'], { binary: true });
      if (image?.length) fs.writeFileSync(path.join(dir, 'screenshot.local.png'), image);
    }
    const receipt = {
      schemaVersion: 1,
      status: 'installed_and_launched',
      repository: c.repository,
      sourceCommit: m.commit,
      version: m.version,
      versionCode: m.versionCode,
      package: c.package,
      originalSha256: m.sha256,
      installedSha256: signedHash,
      transformation: 're-signed with persistent private local development key; CI APK preserved',
      certificateSha256: certificate,
      installedAt: new Date().toISOString(),
      model: exec(c.adb, ['-s', c.serial, 'shell', 'getprop', 'ro.product.model']).trim(),
      readyMarker: true,
      readinessWaitMs: Math.round(performance.now() - started),
      launcher,
      installationReadback: operation.install,
      humanAcceptance: 'pending'
    };
    writeJSON(path.join(dir, 'device-receipt.json'), receipt);
    writeJSON(stampFile, receipt);
    saveOperation('complete');
    console.log('DEVICE_INSTALL_PASS ' + m.version + ' ' + signedHash);
    return receipt;
  } finally {
    fs.unlinkSync(lock);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  try {
    if (!a.includes('--config') || !a.includes('--dir'))
      throw Error('Usage: --config LOCAL_CONFIG --dir ARTIFACT_DIR');
    const config = a[a.indexOf('--config') + 1],
      dir = a[a.indexOf('--dir') + 1];
    await install(
      readJSON(config),
      path.resolve(dir),
      readJSON(path.join(dir, 'build-manifest.json'))
    );
  } catch (e) {
    console.error('DEVICE_BLOCKED: ' + e.message);
    process.exitCode = 1;
  }
}
