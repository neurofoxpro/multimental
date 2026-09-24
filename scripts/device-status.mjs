import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { exec, validateConfig, isForeground } from './install-device.mjs';
const a = process.argv.slice(2),
  file = a[a.indexOf('--config') + 1];
if (!a.includes('--config')) throw Error('Explicit station config required');
const c = validateConfig(readJSON(file));
const rows = exec(c.adb, ['devices', '-l']);
let state = 'unavailable';
try {
  chooseDevice(rows, c.serial);
  state = 'device';
} catch (e) {
  state = e.message;
}
const get = (n) => {
  const p = path.join(c.workDir, n);
  return fs.existsSync(p) ? readJSON(p) : null;
};
const installed = get('installed.local.json');
const pkg = exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'package', c.package], {
  allowFailure: true
});
const result = {
  observedAt: new Date().toISOString(),
  host: c.allowedHost,
  repository: c.repository,
  adb: state,
  installed: installed
    ? {
        version: installed.version,
        sourceCommit: installed.sourceCommit,
        installedAt: installed.installedAt,
        ready: installed.readyMarker
      }
    : null,
  actualVersion: pkg.match(/versionName=(\S+)/)?.[1] || null,
  foreground: isForeground(c),
  lastCheck: get('last-update-check.local.json'),
  policy: { autoClose: !!c.autoCloseForUpdate, preserveData: true }
};
writeJSON('.gameprod/evidence/device-status.json', result);
console.log(JSON.stringify(result, null, 2));
