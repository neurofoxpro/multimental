import { primaryTransport } from '../skills/game-production/scripts/primary-transport.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  readJSON,
  writeJSON,
  findRoot,
  context,
  fingerprint,
  sha,
  chooseDevice
} from '../skills/game-production/scripts/lib.mjs';
import { acquireOperation } from '../skills/game-production/scripts/operation-lock.mjs';
import { waitForPathsGone } from '../skills/game-production/scripts/device-coordination.mjs';
import { adbLines } from '../skills/game-production/scripts/android-text.mjs';
import {
  suiteOptions,
  receiptName,
  assessDeviceStep,
  installationIdentity,
  completeSuite,
  PACKAGE
} from '../skills/game-production/scripts/device-suite-policy.mjs';
import { validateConfig, exec } from './install-device.mjs';
const options = suiteOptions(process.argv.slice(2));
const root = findRoot(),
  project = readJSON(path.join(root, '.gameprod/project.json'));
context(root, project);
const savedOwner = validateConfig(readJSON(options.config));
const owner = options.target === 'phone' ? primaryTransport(savedOwner) : savedOwner;
if (owner.repository !== 'neurofoxpro/multimental' || owner.package !== PACKAGE)
  throw Error('Wrong suite project');
const c = {
  ...owner,
  serial:
    options.target === 'phone'
      ? owner.serial
      : options.target === 'emulator-A'
        ? 'emulator-5554'
        : 'emulator-5556'
};
const installedDir =
  options.target === 'phone'
    ? owner.workDir
    : path.join(owner.workDir, 'emulators', options.target);
const runId = crypto.randomUUID(),
  out = path.join(root, '.gameprod/evidence');
const archive = path.join(out, 'suites', runId);
fs.mkdirSync(archive, { recursive: true });
const release = acquireOperation(path.join(owner.workDir, 'qualification.lock'), {
  command: 'device-suite',
  runId
});
const report = {
  schemaVersion: 2,
  runId,
  observedAt: new Date().toISOString(),
  repository: owner.repository,
  target: options.target,
  suite: options.suite,
  modes: options.modes,
  status: 'running',
  results: [],
  humanAcceptance: 'not_inferred'
};
const save = () => {
  writeJSON(path.join(archive, 'report.json'), report);
  writeJSON(path.join(out, 'suite-' + options.target + '-' + options.suite + '.json'), report);
};
const adb = (...args) => exec(c.adb, ['-s', c.serial, ...args]);
function observeInstallation() {
  chooseDevice(exec(c.adb, ['devices', '-l']), c.serial);
  const dump = adb('shell', 'dumpsys', 'package', PACKAGE);
  const paths = adbLines(adb('shell', 'pm', 'path', PACKAGE));
  if (paths.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk$/.test(paths[0]))
    throw Error('Expected one installed universal APK');
  const apkPath = paths[0].slice('package:'.length);
  const apkSha256 = adb('shell', 'sha256sum', apkPath).trim().split(/\s+/)[0];
  return installationIdentity(readJSON(path.join(installedDir, 'installed.local.json')), {
    version: dump.match(/versionName=(\S+)/)?.[1],
    versionCode: Number(dump.match(/versionCode=(\d+)/)?.[1]),
    apkSha256
  });
}
try {
  save();
  await waitForPathsGone(
    ['update.lock', 'install.lock', 'device-test.lock'].map((n) => path.join(owner.workDir, n))
  );
  report.toolDigest = fingerprint(root, project);
  report.installation = observeInstallation();
  save();
  for (const mode of options.modes) {
    const start = Date.now();
    const child = spawnSync(
      process.execPath,
      [
        'scripts/device-test.mjs',
        '--config',
        options.config,
        '--target',
        options.target,
        '--mode',
        mode,
        '--run-id',
        runId
      ],
      { cwd: root, shell: false, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 }
    );
    const end = Date.now();
    const log = (child.stdout || '') + (child.stderr || '');
    const logPath = path.join(archive, mode + '.local.log');
    fs.writeFileSync(logPath, log);
    const name = receiptName(runId, options.target, mode),
      receiptPath = path.join(out, name);
    let receipt = null,
      receiptHash = null;
    try {
      const bytes = fs.readFileSync(receiptPath);
      receiptHash = sha(bytes);
      receipt = JSON.parse(bytes.toString('utf8'));
    } catch {
      /* Missing or malformed evidence must fail. */
    }
    const verdict = assessDeviceStep(child, receipt, {
      runId,
      target: options.target,
      mode,
      start,
      end,
      version: report.installation.version
    });
    report.results.push({
      mode,
      status: verdict === 'passed' ? 'passed' : 'failed',
      verdict,
      exitCode: child.status,
      durationMs: end - start,
      receipt: name,
      receiptSha256: receiptHash,
      log: 'suites/' + runId + '/' + mode + '.local.log',
      logSha256: sha(log)
    });
    save();
    console.log(mode + ': ' + verdict);
  }
  report.installationAfter = observeInstallation();
  report.toolDigestAfter = fingerprint(root, project);
  report.status = completeSuite(
    report.results,
    options.modes,
    report.installation,
    report.installationAfter,
    report.toolDigest,
    report.toolDigestAfter
  )
    ? 'passed'
    : 'failed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
} finally {
  report.finishedAt = new Date().toISOString();
  try {
    save();
  } finally {
    release();
  }
}
console.log(
  JSON.stringify(
    {
      status: report.status,
      runId,
      suite: options.suite,
      target: options.target,
      version: report.installation?.version,
      actualApkChecked: !!report.installationAfter,
      report: 'suites/' + runId + '/report.json',
      error: report.error
    },
    null,
    2
  )
);
if (report.status !== 'passed') process.exitCode = 1;
