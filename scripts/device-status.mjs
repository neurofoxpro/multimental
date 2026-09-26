import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON } from '../skills/game-production/scripts/lib.mjs';
import { exec, validateConfig, isForeground } from './install-device.mjs';
import { primaryTransport } from '../skills/game-production/scripts/primary-transport.mjs';
const a = process.argv.slice(2);
if (a.length !== 2 || a[0] !== '--config') throw Error('Explicit station config required');
const saved = validateConfig(readJSON(a[1]));
let c = saved,
  state = 'unavailable';
try {
  c = primaryTransport(saved, { reconnect: false });
  state = 'device';
} catch (error) {
  state = error.message;
}
const get = (name) => {
  const file = path.join(saved.workDir, name);
  return fs.existsSync(file) ? readJSON(file) : null;
};
const installed = get('installed.local.json');
const pkg =
  state === 'device'
    ? exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'package', c.package], {
        allowFailure: true
      })
    : '';
const last = get('last-update-check.local.json');
if (last?.error) {
  for (const value of [saved.serial, c.serial, saved.physicalSerial, c.physicalSerial])
    if (value) last.error = String(last.error).replaceAll(value, '[device]');
}
const result = {
  observedAt: new Date().toISOString(),
  host: saved.allowedHost,
  repository: saved.repository,
  adb: state,
  transport: state === 'device' ? (c.serial === saved.serial ? 'usb' : 'wifi') : null,
  physicalIdentityVerified: state === 'device',
  installed: installed
    ? {
        version: installed.version,
        sourceCommit: installed.sourceCommit,
        installedAt: installed.installedAt,
        ready: installed.readyMarker
      }
    : null,
  actualVersion: pkg.match(/versionName=(\S+)/)?.[1] || null,
  foreground: state === 'device' && isForeground(c),
  lastCheck: last,
  policy: {
    autoClose: !!saved.autoCloseForUpdate,
    preserveData: true,
    configurationRewritten: false
  }
};
writeJSON('.gameprod/evidence/device-status.json', result);
console.log(JSON.stringify(result, null, 2));
