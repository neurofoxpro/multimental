import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeUsb } from './usb-inventory-policy.mjs';
import { fileURLToPath } from 'node:url';
import { findRoot, readJSON, inside, context, writeJSON, fingerprint } from './lib.mjs';
import { adbPhysicalRows, adbTransportRows, collapseFleetDevices } from './fleet-policy.mjs';
import { exec, validateConfig } from '../../../scripts/install-device.mjs';
export function probeOptions(args) {
  if (args.length > 1 || (args[0] && !['probe', 'usb'].includes(args[0])))
    throw Error(
      'Only read-only probe|usb is deployed; secondary registration and signing are not active'
    );
  return args[0] || 'probe';
}
export async function main(args = process.argv.slice(2)) {
  const mode = probeOptions(args);
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('Physical inventory is station-only');
  const root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  const c = validateConfig(readJSON(inside(workspace, 'station.local.json')));
  if (
    project.repository !== 'neurofoxpro/multimental' ||
    c.repository !== project.repository ||
    c.package !== 'pro.neurofox.multimental.dev'
  )
    throw Error('Wrong inventory scope');
  const inventory = exec(c.adb, ['devices', '-l']);
  const usbRows = adbPhysicalRows(inventory);
  if (mode === 'usb') {
    if (process.platform !== 'win32')
      throw Error('Windows PnP diagnostic requires authorized Windows station');
    const before = fingerprint(root, project);
    const child = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        inside(root, 'tools/usb-phone-inventory.ps1')
      ],
      { cwd: root, shell: false, encoding: 'utf8', timeout: 30000, maxBuffer: 131072 }
    );
    if (child.error || child.status !== 0)
      throw Error('USB inventory unavailable; no empty-success fallback');
    let raw;
    try {
      raw = JSON.parse(child.stdout.replace(/^\uFEFF/, ''));
    } catch {
      throw Error('Invalid USB inventory JSON');
    }
    const after = fingerprint(root, project);
    if (before !== after) throw Error('USB diagnostic source changed during observation');
    const result = {
      ...summarizeUsb(
        raw,
        usbRows.map((r) => r.state)
      ),
      observedAt: new Date().toISOString(),
      repository: project.repository,
      sourceDigest: before,
      sourceDigestAfter: after
    };
    writeJSON(inside(root, '.gameprod/evidence/usb-phone-observation.json'), result);
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const observed = [];
  for (const row of adbTransportRows(inventory)) {
    if (row.state !== 'device') continue;
    const cmd = (...a) => exec(c.adb, ['-s', row.serial, ...a]);
    if (cmd('shell', 'getprop', 'ro.kernel.qemu').trim() === '1') continue;
    const identity = cmd('shell', 'getprop', 'ro.serialno').trim();
    observed.push({
      state: row.state,
      transport: row.transport,
      identity,
      model: cmd('shell', 'getprop', 'ro.product.model').trim(),
      android: cmd('shell', 'getprop', 'ro.build.version.release').trim(),
      version: cmd('shell', 'dumpsys', 'package', c.package).match(/versionName=(\S+)/)?.[1] || null
    });
  }
  const primaryIdentity = c.physicalSerial || c.serial;
  const devices = collapseFleetDevices(observed, primaryIdentity);
  let unbound = 0;
  const phones = devices.map((r) => ({
    alias: r.identity === primaryIdentity ? 'phone-A' : 'unbound-' + ++unbound,
    state: 'device',
    physical: true,
    transports: r.transports,
    model: r.model,
    android: r.android,
    version: r.version
  }));
  const result = {
    status: 'observed',
    phones,
    secondBound: false,
    secondaryDelivery: 'not_deployed'
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('FLEET_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
