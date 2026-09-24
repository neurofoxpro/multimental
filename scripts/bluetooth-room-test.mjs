import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readJSON, writeJSON, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { waitForPathsGone } from '../skills/game-production/scripts/device-coordination.mjs';
import { exec, validateConfig } from './install-device.mjs';
import { launchApplication } from './device-launch.mjs';
import { waitReady } from './device-readiness.mjs';
const a = process.argv.slice(2);
if (!a.includes('--config')) throw Error('Explicit selected phone configuration required');
const c = validateConfig(readJSON(a[a.indexOf('--config') + 1]));
const call = (...x) => exec(c.adb, ['-s', c.serial, ...x]),
  opt = (...x) => exec(c.adb, ['-s', c.serial, ...x], { allowFailure: true });
const out = '.gameprod/evidence',
  lease = path.join(c.workDir, 'device-test.lock');
const r = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  scope: 'player_bluetooth_room',
  path: 'PHYSICAL_SECURE_RFCOMM_WINDOWS_GUEST_ANDROID_HOST',
  status: 'running',
  physicalRadio: true,
  tls: false
};
let locked = false,
  wifiWasOn = false,
  nonce = '';
const report = () => {
  try {
    return JSON.parse(opt('shell', 'run-as', c.package, 'cat', 'files/automation-result.json'));
  } catch {
    return null;
  }
};
async function wait(stage) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    const v = report();
    if (v?.nonce === nonce) {
      if (stage && v.stage === stage) return v;
      if (['passed', 'failed', 'blocked'].includes(v.status)) {
        if (v.status !== 'passed')
          throw Error('Android Bluetooth room failed: ' + (v.error || v.connection || v.status));
        return v;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error('Android Bluetooth room timeout');
}
try {
  chooseDevice(exec(c.adb, ['devices', '-l']), c.serial);
  const fd = fs.openSync(lease, 'wx');
  fs.writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, mode: 'secure_bluetooth_room', startedAt: r.observedAt })
  );
  fs.closeSync(fd);
  locked = true;
  await waitForPathsGone(['update.lock', 'install.lock'].map((n) => path.join(c.workDir, n)));
  wifiWasOn = opt('shell', 'settings', 'get', 'global', 'wifi_on').trim() === '1';
  if (wifiWasOn) call('shell', 'svc', 'wifi', 'disable');
  r.wifiDisabled = opt('shell', 'settings', 'get', 'global', 'wifi_on').trim() === '0';
  if (!r.wifiDisabled) throw Error('Physical Bluetooth test requires Wi-Fi off');
  call('shell', 'pm', 'grant', c.package, 'android.permission.BLUETOOTH_CONNECT');
  call('shell', 'am', 'force-stop', c.package);
  nonce = crypto.randomBytes(24).toString('hex');
  const write = spawnSync(
    c.adb,
    [
      '-s',
      c.serial,
      'shell',
      'run-as',
      c.package,
      'sh',
      '-c',
      "'cat > files/automation-request.json'"
    ],
    {
      input: JSON.stringify({ nonce, mode: 'pvp-host', transport: 'bluetooth' }),
      encoding: 'utf8',
      timeout: 10000
    }
  );
  if (write.status !== 0) throw Error('Device request failed');
  launchApplication(c);
  await waitReady({
    pid: () => opt('shell', 'pidof', c.package),
    log: (pid) => opt('logcat', '-d', '--pid=' + pid, '-t', '400')
  });
  const lobby = await wait('room_created');
  const prefix = 'multimental-bt://join/';
  if (!lobby.invitation.startsWith(prefix)) throw Error('Bluetooth invitation absent');
  const token = lobby.invitation.slice(prefix.length),
    address = opt('shell', 'settings', 'get', 'secure', 'bluetooth_address').trim();
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    !/^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/.test(address) ||
    address === '02:00:00:00:00:00'
  )
    throw Error('Explicit phone radio target unavailable');
  const privateRequest = path.join(out, 'secure-bt-room-request.local.json');
  writeJSON(privateRequest, { address, token });
  const client = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/bluetooth-pvp.ps1',
      '-RequestFile',
      path.resolve(privateRequest)
    ],
    { encoding: 'utf8', timeout: 90000, maxBuffer: 1000000 }
  );
  fs.writeFileSync(
    path.join(out, 'secure-bt-room-client.local.log'),
    (client.stdout || '') + (client.stderr || '')
  );
  if (client.status !== 0)
    throw Error(
      'Secure Bluetooth peer failed; inspect pairing/permission and local diagnostics, never fall back to insecure RFCOMM'
    );
  const line = (client.stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter((x) => x.startsWith('{'))
    .at(-1);
  const guest = JSON.parse(line);
  const host = await wait();
  assert.equal(guest.status, 'passed');
  assert.equal(guest.authenticatedRFCOMM, true);
  assert.equal(guest.encryptedRFCOMM, true);
  assert.equal(guest.reconnect, true);
  assert.equal(host.secure_bluetooth, true);
  assert.equal(host.tls, false);
  assert.equal(host.turn, guest.turn);
  assert.deepEqual(host.scores, guest.scores.toReversed());
  assert.ok(host.winner !== guest.winner || host.winner === 2);
  r.host = {
    version: host.version,
    winner: host.winner,
    turn: host.turn,
    actions: host.actions,
    secureBluetooth: true,
    privateView: host.private_view
  };
  r.guest = guest;
  r.status = 'passed';
} catch (e) {
  r.status = 'failed';
  r.error = e.message;
  process.exitCode = 1;
  const v = report();
  if (v?.nonce === nonce)
    r.lastStage = { status: v.status, stage: v.stage, error: v.error, connection: v.connection };
  const pid = opt('shell', 'pidof', c.package).trim().split(/\s+/)[0];
  if (/^\d+$/.test(pid))
    fs.writeFileSync(
      path.join(out, 'secure-bt-room-phone.local.log'),
      opt('logcat', '-d', '--pid=' + pid, '-t', '600')
    );
} finally {
  if (locked) {
    opt('shell', 'am', 'force-stop', c.package);
    if (wifiWasOn) {
      opt('shell', 'svc', 'wifi', 'enable');
      const end = Date.now() + 25000;
      while (
        Date.now() < end &&
        !/\binet \d+\./.test(opt('shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0'))
      )
        await new Promise((x) => setTimeout(x, 250));
      r.wifiRestored = /\binet \d+\./.test(opt('shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0'));
      if (!r.wifiRestored) {
        r.status = 'failed';
        process.exitCode = 1;
      }
    }
    fs.unlinkSync(lease);
  }
  r.finishedAt = new Date().toISOString();
  writeJSON(path.join(out, 'bluetooth-player-room.json'), r);
  console.log(JSON.stringify(r, null, 2));
}
