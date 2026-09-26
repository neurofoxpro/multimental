import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findRoot,
  inside,
  readJSON,
  writeJSON,
  context,
  fingerprint,
  sha,
  chooseDevice
} from './lib.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { waitForPathsGone } from './device-coordination.mjs';
import { primaryTransport } from './primary-transport.mjs';
import { installationIdentity } from './device-suite-policy.mjs';
import { adbLines, dedicatedEmulator } from './android-text.mjs';
import {
  frameNodes,
  homeIcon,
  pinConfirmation,
  center,
  frameHash,
  nativeResult
} from './launcher-policy.mjs';
import { validateConfig } from '../../../scripts/install-device.mjs';
import { prepareDisplay, launchApplication } from '../../../scripts/device-launch.mjs';
const PACKAGE = 'pro.neurofox.multimental.dev';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function runLauncher({ root, config, target = 'phone', mode = 'verify' }) {
  if (
    !['verify', 'ensure'].includes(mode) ||
    !['phone', 'emulator-A', 'emulator-B'].includes(target)
  )
    throw Error('Explicit launcher operation and target required');
  const owner = validateConfig(config),
    project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  if (owner.repository !== 'neurofoxpro/multimental' || owner.package !== PACKAGE)
    throw Error('Wrong launcher scope');
  const station = validateConfig(readJSON(inside(path.dirname(root), 'station.local.json')));
  if (
    path.resolve(owner.workDir) !== path.resolve(station.workDir) ||
    (owner.physicalSerial || owner.serial) !== station.serial ||
    ['adb', 'java', 'apksigner', 'aapt'].some((k) => owner[k] !== station[k])
  )
    throw Error('Launcher configuration is outside the saved project station');
  const c =
    target === 'phone'
      ? primaryTransport(owner)
      : {
          ...owner,
          serial: target === 'emulator-A' ? 'emulator-5554' : 'emulator-5556',
          workDir: path.join(owner.workDir, 'emulators', target)
        };
  const call = (args, { optional = false, binary = false, input } = {}) => {
    const r = spawnSync(c.adb, ['-s', c.serial, ...args], {
      shell: false,
      encoding: binary ? null : 'utf8',
      input,
      timeout: 12000,
      maxBuffer: 16000000
    });
    if (r.error || r.status !== 0) {
      if (optional) return null;
      throw Error('Bounded launcher device operation failed: ' + args[0]);
    }
    return binary ? r.stdout : (r.stdout || '').trim();
  };
  const foreground = () => {
    const d = call(['shell', 'dumpsys', 'activity', 'activities']);
    return (
      adbLines(d)
        .filter((l) => /mResumedActivity|topResumedActivity/.test(l))
        .map((l) => l.match(/u\d+\s+([A-Za-z0-9_.]+)\//)?.[1])
        .filter(Boolean)
        .at(-1) || ''
    );
  };
  const profile = () =>
    ['a.json', 'b.json'].map(
      (n) =>
        call(['shell', 'run-as', PACKAGE, 'sha256sum', 'files/profile/' + n], {
          optional: true
        })?.match(/^([a-f0-9]{64})\s/)?.[1] || null
    );
  const files = () => adbLines(call(['shell', 'run-as', PACKAGE, 'ls', '-a', 'files']));
  const observe = () => {
    chooseDevice(
      spawnSync(c.adb, ['devices', '-l'], { shell: false, encoding: 'utf8', timeout: 8000 })
        .stdout || '',
      c.serial
    );
    const dump = call(['shell', 'dumpsys', 'package', PACKAGE]);
    const list = adbLines(call(['shell', 'pm', 'path', PACKAGE]));
    if (list.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk$/.test(list[0]))
      throw Error('Expected actual universal application APK');
    const digest = call(['shell', 'sha256sum', list[0].slice(8)]).split(/\s+/)[0];
    return installationIdentity(readJSON(path.join(c.workDir, 'installed.local.json')), {
      version: dump.match(/versionName=(\S+)/)?.[1],
      versionCode: Number(dump.match(/versionCode=(\d+)/)?.[1]),
      apkSha256: digest
    });
  };
  if (
    target !== 'phone' &&
    !dedicatedEmulator(
      call(['emu', 'avd', 'name']),
      call(['shell', 'getprop', 'ro.kernel.qemu']),
      'Multimental_Test_' + target.at(-1)
    )
  )
    throw Error('Wrong assigned virtual device');
  const lease = acquireOperation(path.join(owner.workDir, 'qualification.lock'), {
    command: 'launcher-' + mode,
    target
  });
  const runId = randomUUID(),
    out = inside(root, '.gameprod/evidence/launcher/' + runId);
  fs.mkdirSync(out, { recursive: true });
  const report = {
    schemaVersion: 1,
    runId,
    repository: owner.repository,
    target,
    operation: mode,
    status: 'running',
    startedAt: new Date().toISOString(),
    pages: [],
    pinCreated: false,
    unrelatedHomeItemsModified: false
  };
  const save = () => {
    report.updatedAt = new Date().toISOString();
    writeJSON(path.join(out, 'report.json'), report);
    writeJSON(inside(root, '.gameprod/evidence/launcher-' + target + '.json'), report);
  };
  const deadline = performance.now() + 180000;
  const ensureTime = () => {
    if (performance.now() > deadline)
      throw Error('Launcher operation timed out; no repeated unknown tap');
  };
  let temp = null;
  try {
    await waitForPathsGone(
      ['update.lock', 'install.lock', 'device-test.lock'].map((x) => path.join(owner.workDir, x))
    );
    report.sourceHash = fingerprint(root, project);
    report.installation = observe();
    const beforeProfile = profile();
    save();
    if (files().includes('automation-request.json'))
      throw Error('Pending game diagnostic request preserved');
    report.display = prepareDisplay(c);
    const resolved = adbLines(
      call([
        'shell',
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.HOME'
      ])
    ).filter((x) => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(x));
    if (resolved.length !== 1) throw Error('Default launcher is ambiguous');
    const launcher = resolved[0].split('/')[0];
    report.launcherPackage = launcher;
    async function frame() {
      ensureTime();
      temp = '/sdcard/multimental-ui-' + randomBytes(12).toString('hex') + '.xml';
      call(['shell', 'uiautomator', 'dump', temp]);
      const xml = call(['shell', 'cat', temp]);
      call(['shell', 'rm', temp]);
      temp = null;
      const png = call(['exec-out', 'screencap', '-p'], { binary: true });
      if (!png || png.length < 24 || png.subarray(1, 4).toString() !== 'PNG')
        throw Error('Actual screen dimensions unavailable');
      const width = png.readUInt32BE(16),
        height = png.readUInt32BE(20);
      return { nodes: frameNodes(xml, width, height), width, height };
    }
    async function launchIcon(node) {
      call(['shell', 'input', 'tap', ...center(node).map(String)]);
      const until = performance.now() + 12000;
      while (performance.now() < until) {
        if (foreground() === PACKAGE) return true;
        await pause(300);
      }
      throw Error('Home icon did not open the expected application');
    }
    async function findIcon() {
      for (const direction of ['left', 'right']) {
        call(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
        await pause(350);
        const seen = new Set();
        for (let page = 0; page < 7; page++) {
          ensureTime();
          if (foreground() !== launcher) throw Error('Expected home launcher is not foreground');
          const current = await frame(),
            signature = frameHash(current.nodes);
          const icon = homeIcon(current.nodes, launcher);
          report.pages.push({ direction, page, signature, iconFound: !!icon });
          save();
          if (icon) {
            await launchIcon(icon);
            return { page, direction, label: 'Multimental Dev', launchConfirmed: true };
          }
          if (seen.has(signature)) break;
          seen.add(signature);
          const y = Math.round(current.height * 0.52),
            left = Math.round(current.width * 0.16),
            right = Math.round(current.width * 0.84);
          call([
            'shell',
            'input',
            'swipe',
            String(direction === 'left' ? right : left),
            String(y),
            String(direction === 'left' ? left : right),
            String(y),
            '240'
          ]);
          await pause(300);
        }
      }
      return null;
    }
    call(['shell', 'am', 'force-stop', PACKAGE]);
    let found = await findIcon();
    if (!found && mode === 'ensure') {
      const pointer = inside(
        root,
        '.gameprod/evidence/launcher-' + target + '.operation.local.json'
      );
      let operation = fs.existsSync(pointer) ? readJSON(pointer) : null;
      const expectedBase = {
        version: report.installation.version,
        commit: report.installation.sourceCommit
      };
      if (
        operation &&
        operation.installationHash === report.installation.installedSha256 &&
        operation.status === 'blocked'
      )
        throw Error(
          'Previous same-APK launcher request was not confirmed; preserve its receipt instead of repeated prompts'
        );
      if (files().includes('automation-launcher-request.json')) {
        const pending = JSON.parse(
          call(['shell', 'run-as', PACKAGE, 'cat', 'files/automation-launcher-request.json'])
        );
        if (!operation || pending.nonce !== operation.nonce)
          throw Error('Unowned pending launcher request preserved');
      }
      if (
        !operation ||
        operation.installationHash !== report.installation.installedSha256 ||
        operation.status === 'complete'
      ) {
        operation = {
          schemaVersion: 1,
          nonce: randomBytes(24).toString('hex'),
          installationHash: report.installation.installedSha256,
          status: 'prepared',
          ...expectedBase
        };
        writeJSON(pointer, operation);
      }
      const expected = { nonce: operation.nonce, ...expectedBase };
      let existingResult = null;
      const beforeResult = call(
        ['shell', 'run-as', PACKAGE, 'cat', 'files/automation-launcher-result.json'],
        { optional: true }
      );
      if (beforeResult) {
        try {
          const value = JSON.parse(beforeResult);
          if (value.nonce === expected.nonce) existingResult = nativeResult(value, expected);
        } catch {}
      }
      let pending = files().includes('automation-launcher-request.json');
      if (operation.status === 'prepared' && !pending && !existingResult) {
        const packet = JSON.stringify({
          schemaVersion: 1,
          mode: 'ensure_home_shortcut',
          nonce: operation.nonce,
          expectedVersion: expectedBase.version
        });
        call(
          [
            'shell',
            'run-as',
            PACKAGE,
            'sh',
            '-c',
            "'cat > files/automation-launcher-request.json'"
          ],
          { input: packet }
        );
        const readback = call([
          'shell',
          'run-as',
          PACKAGE,
          'cat',
          'files/automation-launcher-request.json'
        ]);
        if (readback !== packet) throw Error('Launcher request write not confirmed');
        operation.status = 'request_written';
        writeJSON(pointer, operation);
        pending = true;
      }
      if (!pending && !existingResult)
        throw Error('Uncertain prior launcher request; observe it rather than creating another');
      if (pending) call(['shell', 'am', 'force-stop', PACKAGE]);
      launchApplication(c);
      report.pinRequested = true;
      save();
      let native = existingResult,
        confirmed = operation.confirmationAttempted === true;
      const until = Math.min(deadline, performance.now() + 60000);
      while (performance.now() < until) {
        const text = call(
          ['shell', 'run-as', PACKAGE, 'cat', 'files/automation-launcher-result.json'],
          { optional: true }
        );
        if (text) {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {}
          if (parsed?.nonce === expected.nonce) {
            native = nativeResult(parsed, expected);
            report.native = {
              status: native.status,
              requestAccepted: native.requestAccepted,
              code: native.code
            };
            save();
          }
        }
        if (native?.status === 'pinned') break;
        if (native && ['failed', 'unsupported', 'not_confirmed'].includes(native.status)) break;
        if (native && !confirmed && foreground() === launcher) {
          const current = await frame();
          const action = pinConfirmation(current.nodes, launcher, native, expected);
          if (action) {
            confirmed = true;
            operation.confirmationAttempted = true;
            writeJSON(pointer, operation);
            call(['shell', 'input', 'tap', ...center(action).map(String)]);
            report.confirmationButtonTapped = true;
            save();
          }
        }
        await pause(400);
      }
      if (native?.status !== 'pinned') {
        operation.status = 'blocked';
        writeJSON(pointer, operation);
        throw Error('Launcher pin was not confirmed by Android; existing home items preserved');
      }
      found = await findIcon();
      operation.status = found ? 'complete' : 'blocked';
      writeJSON(pointer, operation);
      report.pinCreated = !!found && native.code !== 'already_pinned';
    }
    if (!found) throw Error('Game shortcut not found on the bounded home-page scan');
    report.home = found;
    report.profilePreserved = JSON.stringify(beforeProfile) === JSON.stringify(profile());
    report.installationAfter = observe();
    report.sourceHashAfter = fingerprint(root, project);
    if (
      !report.profilePreserved ||
      JSON.stringify(report.installationAfter) !== JSON.stringify(report.installation) ||
      report.sourceHash !== report.sourceHashAfter
    )
      throw Error('Application or profile changed during launcher verification');
    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    save();
    return {
      status: report.status,
      runId,
      target,
      version: report.installation.version,
      home: report.home,
      pinCreated: report.pinCreated,
      profilePreserved: true,
      report: '.gameprod/evidence/launcher/' + runId + '/report.json'
    };
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    save();
    throw error;
  } finally {
    if (temp) {
      try {
        call(['shell', 'rm', temp]);
      } catch {}
    }
    lease();
  }
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'verify', ...rest] = args,
    values = {};
  if (!['verify', 'ensure'].includes(mode))
    throw Error('launcher verify|ensure [--target phone|emulator-A|emulator-B]');
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = rest.slice(i, i + 2);
    if (!['--target', '--config'].includes(key) || Object.hasOwn(values, key) || !value)
      throw Error('Invalid launcher options');
    values[key] = value;
  }
  const root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const config = readJSON(values['--config'] || path.join(workspace, 'station.local.json'));
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'launcher-' + mode
  });
  try {
    console.log(
      JSON.stringify(
        await runLauncher({ root, config, target: values['--target'] || 'phone', mode }),
        null,
        2
      )
    );
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('LAUNCHER_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
