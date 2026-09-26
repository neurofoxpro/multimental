import { uiLabSpec, assertUiLab } from '../skills/game-production/scripts/ui-lab-spec.mjs';
import { waitWifiAddress } from '../skills/game-production/scripts/network-readiness.mjs';
import { waitForPathsGone } from '../skills/game-production/scripts/device-coordination.mjs';
import { receiptName, tapTarget } from '../skills/game-production/scripts/device-suite-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readJSON, writeJSON, sha, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { exec, validateConfig, install } from './install-device.mjs';
import { waitReady } from './device-readiness.mjs';
import { launchApplication } from './device-launch.mjs';
import { dismissEmulatorTutorial } from './emulator-onboarding.mjs';
const args = process.argv.slice(2),
  opt = (n, d) => {
    const i = args.indexOf('--' + n);
    return i < 0 ? d : args[i + 1];
  };
if (!args.includes('--config')) throw Error('Explicit --config required');
const original = validateConfig(readJSON(opt('config')));
let c = { ...original };
const target = opt('target', 'phone');
const runId = opt('run-id', crypto.randomUUID());
const uniqueReceipt = receiptName(runId, target, opt('mode', 'ui'));
if (fs.existsSync(path.resolve('.gameprod/evidence', uniqueReceipt)))
  throw Error('Device step ID already recorded');
if (target !== 'phone') {
  if (!['emulator-A', 'emulator-B'].includes(target)) throw Error('Unknown test device');
  c.serial = target === 'emulator-A' ? 'emulator-5554' : 'emulator-5556';
  const avd = exec(c.adb, ['-s', c.serial, 'emu', 'avd', 'name']);
  if (
    !avd.includes(target === 'emulator-A' ? 'Multimental_Test_A' : 'Multimental_Test_B') ||
    exec(c.adb, ['-s', c.serial, 'shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1'
  )
    throw Error('Not the dedicated test emulator');
  c.workDir = path.join(original.workDir, 'emulators', target);
}
chooseDevice(exec(c.adb, ['devices', '-l']), c.serial);
const out = path.resolve('.gameprod/evidence');
fs.mkdirSync(out, { recursive: true });
const result = {
  schemaVersion: 2,
  runId,
  observedAt: new Date().toISOString(),
  target,
  package: c.package,
  mode: opt('mode', 'ui'),
  checks: []
};
const adb = (...a) => exec(c.adb, ['-s', c.serial, ...a]);
const optional = (...a) => exec(c.adb, ['-s', c.serial, ...a], { allowFailure: true });
function rawInput(shellArgs, input) {
  const r = spawnSync(c.adb, ['-s', c.serial, ...shellArgs], {
    shell: false,
    input,
    encoding: 'utf8',
    timeout: 20000
  });
  if (r.status !== 0) throw Error('ADB input failed: ' + String(r.stderr || '').slice(0, 300));
  return r.stdout;
}
function profileHashes() {
  return ['a.json', 'b.json'].map(
    (name) =>
      optional('shell', 'run-as', c.package, 'sha256sum', 'files/profile/' + name)
        .trim()
        .match(/^([a-f0-9]{64})\s/)?.[1] || null
  );
}
function forceStop() {
  adb('shell', 'am', 'force-stop', c.package);
}
async function launch() {
  result.launcher = launchApplication(c);
  return waitReady({
    pid: () => optional('shell', 'pidof', c.package),
    log: (pid) => optional('logcat', '-d', '--pid=' + pid, '-t', '500')
  });
}
function appReport() {
  const text = optional('shell', 'run-as', c.package, 'cat', 'files/automation-result.json');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function startLab(mode, extras = {}) {
  forceStop();
  const nonce = crypto.randomBytes(24).toString('hex');
  const body = JSON.stringify({ mode, nonce, ...extras });
  if (!/^[\w.]+$/.test(c.package)) throw Error('Bad package');
  rawInput(
    ['shell', 'run-as', c.package, 'sh', '-c', "'cat > files/automation-request.json'"],
    body
  );
  await launch();
  return nonce;
}
async function awaitLab(nonce, stage, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = appReport();
    if (r?.nonce === nonce) {
      if (stage && r.stage === stage) return r;
      if (['passed', 'failed', 'blocked'].includes(r.status)) {
        if (r.status !== 'passed') throw Error('Device lab: ' + JSON.stringify(r));
        return r;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error('Device lab timed out');
}
async function tcpDialogue(address, token, port = 17843) {
  const socket = net.createConnection({ host: address, port });
  socket.setTimeout(10000, () => socket.destroy(Error('TCP inactivity timeout')));
  let buffer = '';
  const lines = [];
  socket.on('data', (d) => {
    buffer += d.toString('utf8');
    if (buffer.length > 64000) socket.destroy(Error('Oversize response'));
    let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      lines.push(buffer.slice(0, n));
      buffer = buffer.slice(n + 1);
    }
  });
  let fail;
  socket.on('error', (e) => {
    fail = e;
  });
  const connected = () =>
    new Promise((res, rej) => {
      socket.once('connect', res);
      socket.once('error', rej);
      setTimeout(() => rej(Error('Connect timeout')), 10000).unref();
    });
  await connected();
  async function send(m) {
    socket.write(JSON.stringify(m) + '\n');
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      if (fail) throw fail;
      if (lines.length) return JSON.parse(lines.shift());
      await new Promise((r) => setTimeout(r, 15));
    }
    throw Error('TCP reply timeout');
  }
  try {
    const hello = await send({ v: 1, token, op: 'hello' });
    assert.equal(hello.ok, true, 'hello response: ' + JSON.stringify(hello));
    assert.equal('players' in hello.view, false);
    assert.equal('seed' in hello.view, false);
    const bad = await send({ v: 99, token, op: 'hello' });
    assert.equal(bad.error, 'incompatible_protocol');
    const command = {
      v: 1,
      token,
      op: 'command',
      seq: 1,
      command: hello.view.legal.find((x) => x.type === 'play') || { type: 'pass' }
    };
    const first = await send(command);
    assert.equal(first.ok, true, 'command response: ' + JSON.stringify(first));
    assert.deepEqual(await send(command), first);
    const clash = await send({ ...command, command: { type: 'invalid' } });
    assert.equal(clash.error, 'duplicate_conflict');
    const sync = await send({ v: 1, token, op: 'sync' });
    assert.deepEqual(sync.view, first.view);
    return {
      status: 'passed',
      messages: 6,
      checks: [
        'handshake',
        'version_rejection',
        'private_view',
        'command',
        'deduplication',
        'conflict',
        'resync'
      ]
    };
  } finally {
    socket.destroy();
  }
}
let wifiRestore = false;
let probeName = null,
  probeValue = null;
let lease;
const leasePath = path.join(original.workDir, 'device-test.lock');
try {
  lease = fs.openSync(leasePath, 'wx');
  fs.writeFileSync(
    lease,
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), target })
  );
  fs.closeSync(lease);
  lease = true;
  result.coordination = await waitForPathsGone(
    ['update.lock', 'install.lock'].map((n) => path.join(original.workDir, n))
  );
  const mode = result.mode;
  if (mode === 'close') {
    forceStop();
    assert.equal(optional('shell', 'pidof', c.package).trim(), '');
    result.status = 'passed';
  } else if (mode === 'launch') {
    await launch();
    result.status = 'passed';
  } else if (mode === 'install' || mode === 'reinstall' || mode === 'clean-install') {
    const artifact = opt('dir');
    if (!artifact) throw Error('Explicit --dir required');
    if (mode === 'clean-install') {
      if (target === 'phone') throw Error('Real phone data removal is not authorized by this tool');
      const present = optional('shell', 'pm', 'path', c.package).startsWith('package:');
      if (present) {
        const removed = adb('uninstall', c.package);
        if (!removed.includes('Success')) throw Error('Clean uninstall not confirmed');
      }
      result.cleanUninstallConfirmed = present;
    }
    const m = readJSON(path.join(artifact, 'build-manifest.json'));
    const staged = path.join(c.workDir, 'test-artifacts', m.sha256.slice(0, 20));
    fs.mkdirSync(staged, { recursive: true });
    if (path.basename(m.apk) !== m.apk) throw Error('Invalid artifact name');
    for (const file of ['build-manifest.json', m.apk])
      fs.copyFileSync(path.join(artifact, file), path.join(staged, file));
    const marker = crypto.randomBytes(16).toString('hex');
    if (mode === 'reinstall')
      rawInput(
        [
          'shell',
          'run-as',
          c.package,
          'sh',
          '-c',
          "'cat > files/automation-persistence-marker.txt'"
        ],
        marker
      );
    const before = optional('shell', 'run-as', c.package, 'cat', 'files/settings.cfg');
    const profilesBefore = profileHashes();
    if (mode === 'reinstall') {
      probeValue = crypto.randomBytes(24).toString('hex');
      probeName = 'automation-preserve-' + probeValue.slice(0, 16) + '.txt';
      rawInput(
        ['shell', 'run-as', c.package, 'sh', '-c', "'cat > files/" + probeName + "'"],
        probeValue
      );
    }
    const r = await install({ ...c, autoCloseForUpdate: true }, staged, m, {
      deferForeground: false,
      forceReinstall: mode !== 'install'
    });
    result.install = r;
    const after = optional('shell', 'run-as', c.package, 'cat', 'files/settings.cfg');
    if (mode !== 'clean-install' && before.includes('[ui]')) assert.equal(after, before);
    if (mode === 'reinstall') {
      assert.equal(
        adb('shell', 'run-as', c.package, 'cat', 'files/automation-persistence-marker.txt'),
        marker
      );
      adb('shell', 'run-as', c.package, 'rm', 'files/automation-persistence-marker.txt');
      result.persistedSentinel = true;
    }
    if (probeName) {
      assert.equal(optional('shell', 'run-as', c.package, 'cat', 'files/' + probeName), probeValue);
      result.sentinelPreserved = true;
    }
    if (mode === 'reinstall') {
      assert.deepEqual(
        profileHashes(),
        profilesBefore,
        'Profile generations changed during same-version reinstall'
      );
      result.profileFilesChecked = profilesBefore.filter(Boolean).length;
      result.profileFilesPreserved = true;
    }
    result.settingsPreserved = mode === 'clean-install' ? null : before === after;
    result.status = 'passed';
  } else if (mode === 'jni' || mode === 'profile') {
    const beforeProfile = profileHashes();
    const nonce = await startLab(mode === 'profile' ? 'profile-store' : 'jni-stream');
    result.lab = await awaitLab(nonce);
    if (mode === 'profile') {
      assert.equal(result.lab.test, 'real_profile_storage');
      assert.equal(result.lab.personal_profile_untouched, true);
      assert.deepEqual(profileHashes(), beforeProfile);
      result.profileFilesChecked = beforeProfile.filter(Boolean).length;
      result.personalProfileUntouched = true;
    }
    result.status = 'passed';
  } else if (
    mode === 'ui' ||
    mode === 'tutorial' ||
    mode === 'collection' ||
    mode === 'shop' ||
    mode === 'crafting' ||
    mode === 'inspector'
  ) {
    const personalBefore = profileHashes();
    if (target !== 'phone') {
      await launch();
      result.systemUi = dismissEmulatorTutorial(c);
    }
    const before = optional('shell', 'run-as', c.package, 'cat', 'files/settings.cfg');
    const nonce = await startLab(mode);
    const spec = uiLabSpec(mode);
    const stages =
      spec?.stages ||
      (mode === 'tutorial'
        ? ['waiting_volume_tap', 'waiting_card_tap', 'waiting_target_tap']
        : ['waiting_card_tap', 'waiting_target_tap']);
    for (const stage of stages) {
      const prompt = await awaitLab(nonce, stage);
      tapTarget(prompt, { stage, nonce });
      const frame = exec(c.adb, ['-s', c.serial, 'exec-out', 'screencap', '-p'], { binary: true });
      const screenshot = path.join(
        out,
        mode + '-' + target + '-' + stage + '-' + runId + '.local.png'
      );
      fs.writeFileSync(screenshot, frame);
      result.checks.push({
        stage,
        tap: prompt.tap,
        screenshot: path.basename(screenshot),
        screenshotSha256: sha(frame)
      });
      adb('shell', 'input', 'tap', String(prompt.tap[0]), String(prompt.tap[1]));
    }
    result.lab = await awaitLab(nonce);
    const after = optional('shell', 'run-as', c.package, 'cat', 'files/settings.cfg');
    assert.equal(after, before);
    if (spec) {
      assertUiLab(result.lab, mode);
      assert.equal(result.lab.input_source, 'external_android_input_tap');
      assert.equal(result.lab.personal_profile_untouched, true);
      assert.deepEqual(profileHashes(), personalBefore);
      assert.equal(result.checks.length, spec.stages.length);
      result.personalProfileUntouched = true;
    }
    result.status = 'passed';
  } else if (mode === 'tcp-usb' || mode === 'tcp-lan') {
    const nonce = await startLab('tcp-server');
    await awaitLab(nonce, 'listening');
    let address,
      port = 17843;
    if (mode === 'tcp-usb') {
      const selected = Number(adb('forward', 'tcp:0', 'tcp:17843').trim());
      port = selected;
      address = '127.0.0.1';
      try {
        result.dialogue = await tcpDialogue(address, nonce, port);
      } finally {
        optional('forward', '--remove', 'tcp:' + port);
      }
      result.path = 'ADB_USB_TUNNEL_NOT_WIFI';
    } else {
      address = optional('shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0').match(
        /inet (\d+\.\d+\.\d+\.\d+)\//
      )?.[1];
      if (!address) throw Error('No Wi-Fi address; transport test blocked');
      result.dialogue = await tcpDialogue(address, nonce);
      result.path = 'PHYSICAL_WIFI_DIRECT_TCP';
    }
    result.lab = await awaitLab(nonce);
    result.status = 'passed';
  } else if (mode === 'tcp-peer') {
    if (target !== 'phone')
      throw Error('tcp-peer uses the paired phone as server and dedicated emulator A as client');
    const phoneConfig = { ...c };
    const address = optional('shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0').match(
      /inet (\d+\.\d+\.\d+\.\d+)\//
    )?.[1];
    if (!address) throw Error('Phone not on Wi-Fi');
    const serverNonce = await startLab('tcp-server');
    await awaitLab(serverNonce, 'listening');
    const emu = { ...c, serial: 'emulator-5554' };
    if (!exec(emu.adb, ['-s', emu.serial, 'emu', 'avd', 'name']).includes('Multimental_Test_A'))
      throw Error('Dedicated peer emulator missing');
    c = emu;
    try {
      const clientNonce = await startLab('tcp-client', { address, token: serverNonce });
      result.client = await awaitLab(clientNonce);
    } finally {
      c = phoneConfig;
    }
    result.server = await awaitLab(serverNonce);
    result.path = 'ANDROID_EMULATOR_TO_PHYSICAL_PHONE_OVER_LAN';
    result.status = 'passed';
  } else if (mode === 'bluetooth') {
    if (target !== 'phone') throw Error('Physical Bluetooth test selects actual phone');
    wifiRestore = optional('shell', 'settings', 'get', 'global', 'wifi_on').trim() === '1';
    if (wifiRestore) adb('shell', 'svc', 'wifi', 'disable');
    result.wifiDisabledDuringBluetooth =
      optional('shell', 'settings', 'get', 'global', 'wifi_on').trim() === '0';
    const grant = optional(
      'shell',
      'pm',
      'grant',
      c.package,
      'android.permission.BLUETOOTH_CONNECT'
    );
    const nonce = await startLab('bluetooth-server');
    await awaitLab(nonce, 'listening');
    const address = optional('shell', 'settings', 'get', 'secure', 'bluetooth_address').trim();
    if (!/^(?:[\dA-Fa-f]{2}:){5}[\dA-Fa-f]{2}$/.test(address) || address === '02:00:00:00:00:00')
      throw Error('Actual selected phone Bluetooth address unavailable');
    const req = path.join(out, 'bluetooth-request.local.json');
    writeJSON(req, { address, token: nonce });
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/bluetooth-test.ps1',
        '-RequestFile',
        req
      ],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 1000000 }
    );
    fs.writeFileSync(
      path.join(out, 'bluetooth-host.local.log'),
      (r.stdout || '') + (r.stderr || '')
    );
    if (r.status !== 0)
      throw Error('Bluetooth host exchange failed: ' + String(r.stderr || r.stdout).slice(-800));
    result.lab = await awaitLab(nonce);
    result.path = 'PHYSICAL_RFCOMM_NO_WIFI_NO_USB_PAYLOAD';
    result.status = 'passed';
  } else throw Error('Unknown device-test mode');
} catch (e) {
  result.status = 'failed';
  result.error = e.message;
  const latest = appReport();
  if (latest) {
    result.lastAppStage = latest.stage;
    result.lastAppStatus = latest.status;
    result.lastAppError = latest.error;
  }
  const pid = optional('shell', 'pidof', c.package).trim().split(/\s+/)[0];
  if (/^\d+$/.test(pid)) {
    const logs = optional('logcat', '-d', '--pid=' + pid, '-t', '700');
    fs.writeFileSync(
      path.join(out, 'device-' + target + '-' + result.mode + '-failure.local.log'),
      logs
    );
  }
  process.exitCode = 1;
} finally {
  if (wifiRestore) {
    optional('shell', 'svc', 'wifi', 'enable');
    try {
      await waitWifiAddress({
        probe: () => optional('shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0')
      });
      result.wifiRestored = true;
    } catch (e) {
      result.wifiRestored = false;
      result.status = 'failed';
      result.error = e.message;
      process.exitCode = 1;
    }
  }
  if (lease) fs.unlinkSync(leasePath);
  fs.writeFileSync(
    path.join(out, uniqueReceipt),
    JSON.stringify(result, null, 2) + String.fromCharCode(10),
    { flag: 'wx' }
  );
  writeJSON(path.join(out, 'device-' + target + '-' + result.mode + '.json'), result);
  console.log(JSON.stringify(result, null, 2));
}
