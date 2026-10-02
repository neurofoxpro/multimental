import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findRoot,
  readJSON,
  writeJSON,
  inside,
  context,
  fingerprint,
  gate,
  normalizeRepo
} from './lib.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { waitForPathsGone } from './device-coordination.mjs';
import { primaryTransport } from './primary-transport.mjs';
import { adbLines } from './android-text.mjs';
import { apkPayload } from './apk-payload.mjs';
import { checkedRelease, assetState } from './manual-review-policy.mjs';
import { validateConfig } from '../../../scripts/install-device.mjs';
import { waitReady } from '../../../scripts/device-readiness.mjs';
import { launchApplication } from '../../../scripts/device-launch.mjs';
import { runLauncher } from './launcher.mjs';
import {
  REPO,
  PACKAGE,
  HONOR_REQUEST,
  sha,
  knownPhones,
  targetConfig,
  assertKnownPhoneConfig,
  readyOptions,
  ensureReviewedInstall,
  fleetSummary
} from './known-phone-policy.mjs';
const HASH = /^[a-f0-9]{64}$/;
function bytes(file, max = 250 * 1024 * 1024) {
  let p = path.resolve(file);
  while (true) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error('FLEET_SYMLINK');
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  const s = fs.statSync(file);
  if (!s.isFile() || s.size > max) throw Error('FLEET_FILE_SIZE');
  return fs.readFileSync(file);
}
const json = (file) => JSON.parse(bytes(file, 1048576));
function call(exe, args, { cwd, timeout = 20000, optional = false } = {}) {
  const r = spawnSync(exe, args, {
    cwd,
    shell: false,
    encoding: 'utf8',
    timeout,
    maxBuffer: 3000000
  });
  if (r.error || r.status !== 0) {
    if (optional) return null;
    throw Error('FLEET_COMMAND_FAILED ' + path.basename(exe) + ' ' + args[0]);
  }
  return (r.stdout || '').trim();
}
function actualIdentity(c) {
  const get = (name) => call(c.adb, ['-s', c.serial, 'shell', 'getprop', name], { timeout: 10000 });
  if (
    get('ro.serialno') !== c.physicalSerial ||
    get('ro.kernel.qemu') === '1' ||
    get('sys.boot_completed') !== '1'
  )
    throw Error('FLEET_PHYSICAL_IDENTITY_CHANGED');
  const model = get('ro.product.model'),
    brand = get('ro.product.brand');
  if (c.fleetAlias === 'phone-B' && (model !== 'BRC-NX1' || brand.toUpperCase() !== 'HONOR'))
    throw Error('FLEET_HONOR_IDENTITY_CHANGED');
  return { model, brand };
}
function signedCertificate(c, file) {
  const out = call(c.java, ['-jar', c.apksigner, 'verify', '--print-certs', file], {
      timeout: 30000
    }),
    certificate = out.match(/certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
  if (!HASH.test(certificate || '')) throw Error('FLEET_APK_SIGNATURE_UNPROVEN');
  return certificate;
}
function badge(c, file) {
  const out = call(c.aapt, ['dump', 'badging', file]),
    m = out.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  if (!m || m[1] !== PACKAGE) throw Error('FLEET_APK_PACKAGE');
  return { versionCode: Number(m[2]), version: m[3] };
}
export function resolveKnownPhone(station, honor, alias, reconnect) {
  const target = targetConfig(station, honor, alias),
    live = primaryTransport(target, { reconnect });
  assertKnownPhoneConfig(live, station, honor);
  return { c: live, identity: actualIdentity(live) };
}
export function reviewedPhoneArtifact(root, station, commit) {
  const list = JSON.parse(
    call('gh', ['api', 'repos/' + REPO + '/releases?per_page=100'], { cwd: root })
  );
  const matches = list.filter((r) => r.target_commitish === commit && !r.draft && r.prerelease);
  if (matches.length !== 1) throw Error('FLEET_EXACT_RELEASE_REQUIRED');
  const release = checkedRelease(matches[0], commit);
  const dir = inside(station.workDir, 'manual-review/' + release.id);
  if (!fs.existsSync(dir)) throw Error('FLEET_RUN_REVIEW_READY_FIRST');
  const cert = json(inside(station.workDir, 'installed.local.json')).certificateSha256;
  if (!HASH.test(cert || '')) throw Error('FLEET_ESTABLISHED_PRIMARY_CERTIFICATE_REQUIRED');
  const files = fs.readdirSync(dir).filter((n) => /^MANUAL_REVIEW-[a-f0-9]{20}\.json$/.test(n));
  if (files.length > 20) throw Error('FLEET_PACKET_LIMIT');
  const packets = [];
  for (const name of files) {
    const data = bytes(path.join(dir, name), 1048576),
      p = JSON.parse(data);
    const remote = assetState(release.assets, { name, size: data.length, sha256: sha(data) });
    if (!remote) continue;
    if (
      p.repository === REPO &&
      p.status === 'ready_for_human_review' &&
      p.sourceCommit === commit &&
      p.manualApk?.certificateSha256 === cert
    )
      packets.push(p);
  }
  if (!packets.length) throw Error('FLEET_NO_PUBLISHED_COMPATIBLE_MANUAL_PACKET');
  packets.sort((a, b) => Date.parse(b.preparedAt) - Date.parse(a.preparedAt));
  const packet = packets[0],
    a = packet.manualApk;
  if (
    !/^multimental-[0-9A-Za-z._-]+-manual-[a-f0-9]{12}\.apk$/.test(a.name || '') ||
    !HASH.test(a.payloadSha256 || '') ||
    !HASH.test(a.originalSha256 || '')
  )
    throw Error('FLEET_MANUAL_METADATA');
  const remote = assetState(release.assets, { name: a.name, size: a.size, sha256: a.sha256 });
  if (
    !remote ||
    remote.browser_download_url !== packet.links.apk ||
    packet.links.release !== release.html_url
  )
    throw Error('FLEET_MANUAL_NOT_PUBLISHED');
  const file = path.join(dir, a.name),
    raw = bytes(file);
  if (
    raw.length !== a.size ||
    sha(raw) !== a.sha256 ||
    apkPayload(raw).sha256 !== a.payloadSha256 ||
    signedCertificate(station, file) !== cert
  )
    throw Error('FLEET_MANUAL_BYTES_OR_SIGNATURE_CHANGED');
  const android = badge(station, file);
  if (android.version !== packet.version) throw Error('FLEET_MANUAL_VERSION_CHANGED');
  const permissions = [
    ...call(station.aapt, ['dump', 'permissions', file]).matchAll(
      /uses-permission(?:-sdk-\d+)?: name='([^']+)'/g
    )
  ].map((x) => x[1]);
  if (
    !Array.isArray(station.allowedPermissions) ||
    permissions.some((p) => !station.allowedPermissions.includes(p))
  )
    throw Error('FLEET_UNREVIEWED_PERMISSIONS');
  return { file, packet, release, expected: { ...android, sha256: a.sha256, certificate: cert } };
}
export async function main(args = process.argv.slice(2)) {
  const opt = readyOptions(args),
    root = findRoot(),
    workspace = path.dirname(root),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  if (project.repository !== REPO || process.env.GITHUB_ACTIONS === 'true')
    throw Error('FLEET_AUTHORIZED_STATION_ONLY');
  if (normalizeRepo(call('git', ['remote', 'get-url', 'origin'], { cwd: root })) !== REPO)
    throw Error('FLEET_WRONG_ORIGIN');
  await guardWorktree(root, 'fleet', [opt.mode]);
  const stationFile = inside(workspace, 'station.local.json'),
    stationRaw = bytes(stationFile, 1048576),
    station = validateConfig(JSON.parse(stationRaw));
  const requestFile = inside(workspace, HONOR_REQUEST),
    honorRaw = fs.existsSync(requestFile) ? bytes(requestFile, 1048576) : null,
    honor = honorRaw ? JSON.parse(honorRaw) : null;
  const known = knownPhones(station, honor);
  const resolve = (alias, reconnect) => resolveKnownPhone(station, honor, alias, reconnect);
  if (opt.mode === 'known') {
    const phones = opt.targets.map((alias) => {
      try {
        const { c, identity } = resolve(alias, false);
        return {
          alias,
          registered: true,
          status: 'available',
          ...identity,
          transport: c.serial.includes(':') || c.serial.includes('_tcp') ? 'wifi' : 'usb'
        };
      } catch (e) {
        return {
          alias,
          registered: known.some((p) => p.alias === alias),
          status: 'unavailable',
          reason: e.message
        };
      }
    });
    console.log(
      JSON.stringify(
        {
          status: 'observed',
          observedAt: new Date().toISOString(),
          phones,
          reconnectAttempted: false,
          deviceChanges: false
        },
        null,
        2
      )
    );
    return;
  }
  if (!gate(root, project, 'verified').ok) throw Error('FLEET_VERIFY_SOURCE_FIRST');
  const codeHash = fingerprint(root, project),
    runId = randomUUID(),
    folder = inside(root, '.gameprod/evidence/fleet/' + runId);
  fs.mkdirSync(folder, { recursive: true });
  const sourceLock = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'fleet-ready',
    runId
  });
  const results = [];
  const save = () =>
    writeJSON(path.join(folder, 'report.json'), {
      schemaVersion: 1,
      runId,
      commit: opt.commit,
      sourceDigest: codeHash,
      phones: results
    });
  try {
    const shared = reviewedPhoneArtifact(root, station, opt.commit);
    for (const alias of opt.targets) {
      let selected;
      try {
        selected = resolve(alias, true);
      } catch (e) {
        results.push({ alias, status: 'unavailable', reason: e.message });
        save();
        continue;
      }
      const { c, identity } = selected,
        slot = known.find((p) => p.alias === alias),
        locks = [];
      let originalProfile = null;
      let row = {
        alias,
        status: 'running',
        ...identity,
        transport: c.serial.includes(':') || c.serial.includes('_tcp') ? 'wifi' : 'usb',
        identityKey: sha(slot.physicalSerial)
      };
      results.push(row);
      save();
      const adb = (...a) => call(c.adb, ['-s', c.serial, ...a], { timeout: 12000 });
      const foreground = () =>
        adb('shell', 'dumpsys', 'activity', 'activities')
          .split(/[\r\n]+/)
          .some((s) => /mResumedActivity|topResumedActivity/.test(s) && s.includes(PACKAGE + '/'));
      const assertLive = () => {
        actualIdentity(c);
        if (
          fingerprint(root, project) !== codeHash ||
          !bytes(stationFile).equals(stationRaw) ||
          (honorRaw && !bytes(requestFile).equals(honorRaw))
        )
          throw Error('FLEET_INPUTS_CHANGED');
      };
      function installed() {
        assertLive();
        const dump = adb('shell', 'dumpsys', 'package', PACKAGE),
          versionCode = Number(dump.match(/versionCode=(\d+)/)?.[1] || 0);
        if (!versionCode) return { versionCode: 0, sha256: null, certificate: null };
        const p = adbLines(adb('shell', 'pm', 'path', PACKAGE));
        if (p.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk$/.test(p[0]))
          throw Error('FLEET_UNSUPPORTED_INSTALLED_LAYOUT');
        const remote = p[0].slice(8),
          digest = adb('shell', 'sha256sum', remote).split(/\s+/)[0];
        if (!HASH.test(digest)) throw Error('FLEET_INSTALLED_HASH');
        let certificate;
        if (digest === shared.expected.sha256) certificate = shared.expected.certificate;
        else {
          const local = path.join(folder, alias + '-' + digest + '.local.apk');
          if (!fs.existsSync(local))
            call(c.adb, ['-s', c.serial, 'pull', remote, local], { timeout: 120000 });
          if (sha(bytes(local)) !== digest) throw Error('FLEET_INSTALLED_DOWNLOAD_CHANGED');
          certificate = signedCertificate(c, local);
        }
        return { versionCode, sha256: digest, certificate };
      }
      function profile() {
        const list = adbLines(adb('shell', 'run-as', PACKAGE, 'ls', '-a', 'files'));
        if (list.includes('automation-request.json'))
          throw Error('FLEET_PENDING_DIAGNOSTIC_PRESERVED');
        const out = {};
        let names = [];
        if (list.includes('profile'))
          names = adbLines(adb('shell', 'run-as', PACKAGE, 'ls', '-a', 'files/profile'));
        for (const n of ['a.json', 'b.json']) {
          if (!names.includes(n)) {
            out[n] = null;
            continue;
          }
          const value = adb('shell', 'run-as', PACKAGE, 'sha256sum', 'files/profile/' + n).split(
            /\s+/
          )[0];
          if (!HASH.test(value)) throw Error('FLEET_PROFILE_HASH_UNAVAILABLE');
          out[n] = value;
        }
        return out;
      }
      try {
        fs.mkdirSync(c.workDir, { recursive: true });
        locks.push(
          acquireOperation(inside(c.workDir, 'fleet-ready.lock'), { command: 'fleet-ready', runId })
        );
        let exclusive = null;
        try {
          exclusive = acquireOperation(inside(station.workDir, 'qualification.lock'), {
            command: 'fleet-install',
            alias,
            runId
          });
          await waitForPathsGone(
            ['install.lock', 'update.lock', 'device-test.lock'].map((n) => inside(c.workDir, n))
          );
          const before = installed(),
            beforeProfile = before.versionCode ? profile() : null;
          originalProfile = beforeProfile;
          row.previousVersionCode = before.versionCode;
          row.profileFilesObserved = beforeProfile
            ? Object.values(beforeProfile).filter(Boolean).length
            : 0;
          save();
          const expectation = shared.expected,
            historyDir = inside(
              c.workDir,
              'fleet-operations/' + shared.release.id + '-' + expectation.sha256
            ),
            journal = path.join(historyDir, 'install.local.json');
          fs.mkdirSync(historyDir, { recursive: true });
          const installLock = acquireOperation(inside(c.workDir, 'install.lock'), {
            command: 'fleet-exact-apk',
            runId
          });
          try {
            row.install = await ensureReviewedInstall(
              {
                observe: async () => installed(),
                load: async () => (fs.existsSync(journal) ? json(journal) : null),
                save: async (j) => writeJSON(journal, j),
                perform: async () => {
                  assertLive();
                  if (sha(bytes(shared.file)) !== expectation.sha256)
                    throw Error('FLEET_APK_CHANGED');
                  call(c.adb, ['-s', c.serial, 'install', '-r', shared.file], { timeout: 120000 });
                }
              },
              expectation
            );
          } finally {
            installLock();
          }
          row.actualApkVerified = true;
          row.version = expectation.version;
          row.apkSha256 = expectation.sha256;
          row.certificateSha256 = expectation.certificate;
          save();
          adb('shell', 'am', 'force-stop', PACKAGE);
          row.launcher = launchApplication(c);
          const ready = await waitReady({
            pid: () => adb('shell', 'pidof', PACKAGE),
            log: (pid) => adb('logcat', '-d', '--pid=' + pid, '-t', '500')
          });
          if (!ready.pid || !foreground()) throw Error('FLEET_LAUNCH_NOT_READY');
          row.profilePreserved =
            !beforeProfile || JSON.stringify(beforeProfile) === JSON.stringify(profile());
          if (!row.profilePreserved) throw Error('FLEET_PROFILE_CHANGED');
          const stampPath = inside(c.workDir, 'installed.local.json'),
            old = fs.existsSync(stampPath) ? json(stampPath) : null;
          if (old)
            writeJSON(
              path.join(historyDir, 'previous-stamp-' + sha(JSON.stringify(old)) + '.local.json'),
              old
            );
          writeJSON(stampPath, {
            ...old,
            repository: REPO,
            package: PACKAGE,
            version: expectation.version,
            versionCode: expectation.versionCode,
            sourceCommit: opt.commit,
            originalSha256: shared.packet.manualApk.originalSha256,
            installedSha256: expectation.sha256,
            certificateSha256: expectation.certificate,
            installedAt: row.install.mutated
              ? new Date().toISOString()
              : old?.installedAt || new Date().toISOString(),
            readyMarker: true,
            installationReadback: row.install,
            transformation: 'published manual artifact, no private-key duplication',
            humanAcceptance: 'pending'
          });
          writeJSON(inside(c.workDir, 'fleet-target.local.json'), {
            schemaVersion: 1,
            repository: REPO,
            alias,
            physicalSerial: c.physicalSerial,
            model: identity.model,
            request: slot.request,
            observedAt: new Date().toISOString()
          });
        } finally {
          if (exclusive) exclusive();
        }
        // The existing suite owns the primary qualification lock; secondary keeps primary updater idle.
        if (alias === 'phone-B')
          locks.push(
            acquireOperation(inside(station.workDir, 'qualification.lock'), {
              command: 'fleet-secondary-handoff',
              runId
            })
          );
        const configFile = path.join(folder, alias + '.config.local.json');
        writeJSON(configFile, c);
        assertLive();
        const suiteStarted = Date.now();
        const suite = spawnSync(
          process.execPath,
          [
            'scripts/device-suite.mjs',
            '--config',
            configFile,
            '--target',
            'phone',
            '--suite',
            'handoff',
            '--finish',
            'normal'
          ],
          { cwd: root, shell: false, encoding: 'utf8', timeout: 900000, maxBuffer: 8000000 }
        );
        fs.writeFileSync(
          path.join(folder, alias + '.suite.local.log'),
          (suite.stdout || '') + (suite.stderr || '')
        );
        if (suite.error || suite.status !== 0) throw Error('FLEET_HANDOFF_SUITE_FAILED');
        const reported = json(inside(root, '.gameprod/evidence/suite-phone-handoff.json'));
        if (
          reported.status !== 'passed' ||
          reported.installation?.installedSha256 !== shared.expected.sha256 ||
          reported.installation.sourceCommit !== opt.commit ||
          reported.toolDigest !== codeHash ||
          reported.toolDigestAfter !== codeHash ||
          Date.parse(reported.observedAt) < suiteStarted ||
          !Number.isFinite(Date.parse(reported.finishedAt))
        )
          throw Error('FLEET_SUITE_IDENTITY_MISMATCH');
        row.suite = {
          status: 'passed',
          runId: reported.runId,
          report: 'suites/' + reported.runId + '/report.json'
        };
        save();
        row.homeIcon = await runLauncher({ root, config: c, target: 'phone', mode: 'ensure' });
        assertLive();
        const after = installed();
        if (
          after.sha256 !== shared.expected.sha256 ||
          after.certificate !== shared.expected.certificate
        )
          throw Error('FLEET_FINAL_APK_CHANGED');
        row.profilePreserved =
          !originalProfile || JSON.stringify(originalProfile) === JSON.stringify(profile());
        if (!row.profilePreserved) throw Error('FLEET_FINAL_PROFILE_CHANGED');
        row.status = 'ready';
        row.manualApk = shared.packet.links.apk;
      } catch (error) {
        row.status = 'blocked';
        let message = error.message;
        for (const value of [c.serial, c.physicalSerial])
          if (value) message = message.replaceAll(value, '[' + alias + ']');
        row.reason = message;
      } finally {
        for (const release of locks.reverse()) release();
        save();
      }
    }
    if (fingerprint(root, project) !== codeHash || !bytes(stationFile).equals(stationRaw))
      throw Error('FLEET_SOURCE_OR_PRIMARY_CONFIG_CHANGED');
    const summary = {
      schemaVersion: 1,
      runId,
      repository: REPO,
      commit: opt.commit,
      sourceDigest: codeHash,
      observedAt: new Date().toISOString(),
      ...fleetSummary(results, opt.targets),
      report: '.gameprod/evidence/fleet/' + runId + '/report.json'
    };
    writeJSON(path.join(folder, 'report.json'), summary);
    writeJSON(inside(root, '.gameprod/evidence/fleet/latest.json'), summary);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status !== 'ready') process.exitCode = 2;
    return summary;
  } finally {
    sourceLock();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('FLEET_READY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
