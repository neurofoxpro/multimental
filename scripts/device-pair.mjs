import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readJSON, writeJSON, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { exec, validateConfig } from './install-device.mjs';
import { waitReady } from './device-readiness.mjs';
import { launchApplication } from './device-launch.mjs';
const args = process.argv.slice(2);
if (!args.includes('--config')) throw Error('Explicit --config');
const c = validateConfig(readJSON(args[args.indexOf('--config') + 1]));
const a = 'emulator-5554',
  b = 'emulator-5556';
const call = (s, ...x) => exec(c.adb, ['-s', s, ...x]);
const opt = (s, ...x) => exec(c.adb, ['-s', s, ...x], { allowFailure: true });
const report = {
  observedAt: new Date().toISOString(),
  status: 'running',
  devices: ['Multimental_Test_A', 'Multimental_Test_B'],
  path: 'EMULATOR_B_TO_HOST_LOOPBACK_TO_EMULATOR_A_ADB',
  physicalRadio: false
};
const lease = path.join(c.workDir, 'device-test.lock');
let locked = false,
  forwarded = false;
function validate(s, name) {
  chooseDevice(exec(c.adb, ['devices', '-l']), s);
  if (
    !call(s, 'emu', 'avd', 'name')
      .split(/\r?\n/)
      .some((x) => x.trim() === name) ||
    call(s, 'shell', 'getprop', 'ro.kernel.qemu').trim() !== '1'
  )
    throw Error('Wrong test emulator');
}
async function request(s, mode, extras = {}) {
  call(s, 'shell', 'am', 'force-stop', c.package);
  const nonce = crypto.randomBytes(24).toString('hex');
  const r = spawnSync(
    c.adb,
    ['-s', s, 'shell', 'run-as', c.package, 'sh', '-c', "'cat > files/automation-request.json'"],
    { encoding: 'utf8', input: JSON.stringify({ nonce, mode, ...extras }), timeout: 10000 }
  );
  if (r.status !== 0) throw Error('Write request failed');
  launchApplication({ ...c, serial: s });
  await waitReady({
    pid: () => opt(s, 'shell', 'pidof', c.package),
    log: (id) => opt(s, 'logcat', '-d', '--pid=' + id, '-t', '300')
  });
  return nonce;
}
async function wait(s, nonce, stage) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    let r;
    try {
      r = JSON.parse(opt(s, 'shell', 'run-as', c.package, 'cat', 'files/automation-result.json'));
    } catch {}
    if (r?.nonce === nonce) {
      if (stage && r.stage === stage) return r;
      if (['passed', 'failed', 'blocked'].includes(r.status)) {
        if (r.status !== 'passed') throw Error('Emulator pair ' + JSON.stringify(r));
        return r;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error('Emulator pair timeout');
}
try {
  validate(a, 'Multimental_Test_A');
  validate(b, 'Multimental_Test_B');
  const fd = fs.openSync(lease, 'wx');
  fs.writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, mode: 'emulator_pair', at: new Date().toISOString() })
  );
  fs.closeSync(fd);
  locked = true;
  const existing = exec(c.adb, ['forward', '--list']);
  if (existing.includes('tcp:17843')) throw Error('Requested host test port already forwarded');
  call(a, 'forward', '--no-rebind', 'tcp:17843', 'tcp:17843');
  forwarded = true;
  const token = await request(a, 'tcp-server');
  await wait(a, token, 'listening');
  const clientNonce = await request(b, 'tcp-client', { address: '10.0.2.2', token });
  const client = await wait(b, clientNonce);
  const server = await wait(a, token);
  report.client = {
    status: client.status,
    reply_count: client.reply_count,
    version: client.version
  };
  report.server = { status: server.status, requests: server.requests, version: server.version };
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.error = e.message;
  process.exitCode = 1;
} finally {
  if (forwarded) opt(a, 'forward', '--remove', 'tcp:17843');
  if (locked) fs.unlinkSync(lease);
  writeJSON('.gameprod/evidence/emulator-pair.json', report);
  console.log(JSON.stringify(report, null, 2));
}
