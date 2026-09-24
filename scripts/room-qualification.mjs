import { waitWifiAddress } from '../skills/game-production/scripts/network-readiness.mjs';
import { dedicatedEmulator } from '../skills/game-production/scripts/android-text.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readJSON, writeJSON, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { waitForPathsGone } from '../skills/game-production/scripts/device-coordination.mjs';
import { exec, validateConfig } from './install-device.mjs';
import { waitReady } from './device-readiness.mjs';
import { launchApplication } from './device-launch.mjs';
const args = process.argv.slice(2),
  option = (n, d) => {
    const i = args.indexOf('--' + n);
    return i < 0 ? d : args[i + 1];
  };
if (!args.includes('--config')) throw Error('Explicit --config required');
const c = validateConfig(readJSON(option('config'))),
  physical = args.includes('--physical');
const host = physical ? c.serial : 'emulator-5554',
  guest = 'emulator-5556';
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  status: 'running',
  scope: 'player_room_complete_match',
  path: physical
    ? 'ANDROID_EMULATOR_TO_REAL_PHONE_TLS_LAN'
    : 'TWO_ANDROID_EMULATORS_TLS_VIA_LOOPBACK_BRIDGE',
  physicalRadio: physical
};
const call = (s, ...a) => exec(c.adb, ['-s', s, ...a]);
const optional = (s, ...a) => exec(c.adb, ['-s', s, ...a], { allowFailure: true });
const lease = path.join(c.workDir, 'device-test.lock');
let held = false,
  port = 0;
function validate(s, name) {
  chooseDevice(exec(c.adb, ['devices', '-l']), s);
  if (
    name &&
    !dedicatedEmulator(
      call(s, 'emu', 'avd', 'name'),
      call(s, 'shell', 'getprop', 'ro.kernel.qemu'),
      name
    )
  )
    throw Error('Wrong dedicated emulator');
}
function app(s) {
  try {
    return JSON.parse(
      optional(s, 'shell', 'run-as', c.package, 'cat', 'files/automation-result.json')
    );
  } catch {
    return null;
  }
}
async function request(s, mode, extra = {}) {
  call(s, 'shell', 'am', 'force-stop', c.package);
  const nonce = crypto.randomBytes(24).toString('hex');
  const r = spawnSync(
    c.adb,
    ['-s', s, 'shell', 'run-as', c.package, 'sh', '-c', "'cat > files/automation-request.json'"],
    { input: JSON.stringify({ nonce, mode, ...extra }), encoding: 'utf8', timeout: 10000 }
  );
  if (r.status !== 0) throw Error('Device request failed');
  launchApplication({ ...c, serial: s });
  await waitReady({
    pid: () => optional(s, 'shell', 'pidof', c.package),
    log: (id) => optional(s, 'logcat', '-d', '--pid=' + id, '-t', '400')
  });
  return nonce;
}
async function wait(s, nonce, stage, ms = 100000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = app(s);
    if (r?.nonce === nonce) {
      if (stage && r.stage === stage) return r;
      if (['passed', 'failed', 'blocked'].includes(r.status)) {
        if (r.status !== 'passed')
          throw Error(
            'Room device test: ' +
              String(r.error || r.status) +
              ' connection=' +
              String(r.connection || '')
          );
        return r;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Room device test timeout');
}
function summary(r) {
  return {
    status: r.status,
    role: r.role,
    version: r.version,
    winner: r.winner,
    reason: r.reason,
    actions: r.actions,
    turn: r.turn,
    scores: r.scores,
    reconnect: r.reconnect,
    tls: r.tls,
    privateView: r.private_view,
    durationMs: r.duration_ms,
    input: r.input_source
  };
}
try {
  validate(host, physical ? null : 'Multimental_Test_A');
  validate(guest, 'Multimental_Test_B');
  const fd = fs.openSync(lease, 'wx');
  fs.writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, mode: 'player_room', time: new Date().toISOString() })
  );
  fs.closeSync(fd);
  held = true;
  await waitForPathsGone(['update.lock', 'install.lock'].map((x) => path.join(c.workDir, x)));
  const address = physical
    ? await waitWifiAddress({
        probe: () => optional(host, 'shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0')
      })
    : '127.0.0.1';
  const hn = await request(host, 'pvp-host', { address });
  const lobby = await wait(host, hn, 'room_created', 15000);
  if (!String(lobby.invitation).startsWith('multimental://join/'))
    throw Error('Host did not produce invitation');
  let invitation = lobby.invitation;
  if (!physical) {
    port = Number(call(host, 'forward', 'tcp:0', 'tcp:17844').trim());
    if (!Number.isInteger(port) || port < 1024) throw Error('ADB bridge allocation failed');
    const prefix = 'multimental://join/',
      data = JSON.parse(Buffer.from(invitation.slice(prefix.length), 'base64url').toString());
    data.address = '10.0.2.2';
    data.port = port;
    invitation = prefix + Buffer.from(JSON.stringify(data)).toString('base64url');
  }
  const gn = await request(guest, 'pvp-guest', { invitation });
  const guestResult = await wait(guest, gn);
  const hostResult = await wait(host, hn);
  report.host = summary(hostResult);
  report.guest = summary(guestResult);
  assert.equal(hostResult.tls, true);
  assert.equal(guestResult.tls, true);
  assert.equal(guestResult.reconnect, true);
  assert.equal(hostResult.private_view, true);
  assert.equal(guestResult.private_view, true);
  assert.ok(hostResult.actions > 0 && guestResult.actions > 0);
  assert.equal(hostResult.turn, guestResult.turn);
  assert.deepEqual(hostResult.scores, guestResult.scores.toReversed());
  assert.ok(hostResult.winner !== guestResult.winner || hostResult.winner === 2);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.error = e.message;
  process.exitCode = 1;
  for (const [label, s] of [
    ['host', host],
    ['guest', guest]
  ]) {
    const pid = optional(s, 'shell', 'pidof', c.package).trim().split(/\s+/)[0];
    if (/^\d+$/.test(pid))
      fs.writeFileSync(
        '.gameprod/evidence/pvp-' + label + '.local.log',
        optional(s, 'logcat', '-d', '--pid=' + pid, '-t', '400')
      );
    const r = app(s);
    if (r) {
      delete r.invitation;
      delete r.nonce;
      report[label + 'Failure'] = {
        status: r.status,
        stage: r.stage,
        error: r.error,
        connection: r.connection
      };
    }
  }
} finally {
  if (port) optional(host, 'forward', '--remove', 'tcp:' + port);
  if (held) {
    for (const s of [host, guest]) optional(s, 'shell', 'am', 'force-stop', c.package);
    fs.unlinkSync(lease);
  }
  report.finishedAt = new Date().toISOString();
  writeJSON(
    '.gameprod/evidence/' + (physical ? 'pvp-phone-lan' : 'pvp-emulators') + '.json',
    report
  );
  console.log(JSON.stringify(report, null, 2));
}
