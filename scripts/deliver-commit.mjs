import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON } from '../skills/game-production/scripts/lib.mjs';
import { awaitDelivery } from '../skills/game-production/scripts/delivery-policy.mjs';
import { exec, validateConfig } from './install-device.mjs';
import { update } from './update-device.mjs';
const args = process.argv.slice(2),
  arg = (n) => {
    const i = args.indexOf('--' + n);
    return i < 0 ? null : args[i + 1];
  };
const config = arg('config'),
  commit = arg('commit');
if (!config || !commit) throw Error('Explicit --config and --commit required');
const c = validateConfig(readJSON(config));
async function current() {
  const f = path.join(c.workDir, 'installed.local.json');
  if (!fs.existsSync(f)) return null;
  const r = readJSON(f);
  const pkg = exec(c.adb, ['-s', c.serial, 'shell', 'dumpsys', 'package', c.package], {
    allowFailure: true
  });
  return {
    ...r,
    observedVersionMatches: Number(pkg.match(/versionCode=(\d+)/)?.[1] || 0) === r.versionCode
  };
}
const report = { expectedCommit: commit, startedAt: new Date().toISOString(), status: 'running' };
try {
  const result = await awaitDelivery({
    expectedCommit: commit,
    current,
    attempt: async () => {
      const r = await update(c, { expectedCommit: commit });
      writeJSON(path.join(c.workDir, 'last-update-check.local.json'), {
        checkedAt: new Date().toISOString(),
        ...r
      });
      console.log('DELIVERY_CHECK ' + r.status);
      return r;
    }
  });
  Object.assign(report, {
    status: 'passed',
    attempts: result.attempts,
    alreadyInstalled: !!result.alreadyInstalled,
    installedVersion: result.actual.version,
    installedCommit: result.actual.sourceCommit,
    versionCode: result.actual.versionCode,
    originalSha256: result.actual.originalSha256,
    installedSha256: result.actual.installedSha256,
    readyMarker: result.actual.readyMarker
  });
  console.log('EXPECTED_RELEASE_INSTALLED ' + result.actual.version);
} catch (e) {
  report.status = 'failed';
  report.error = e.message;
  console.error('DELIVERY_BLOCKED: ' + e.message);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeJSON('.gameprod/evidence/delivery.json', report);
}
