import { waitForPathsGone } from '../skills/game-production/scripts/device-coordination.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readJSON,
  writeJSON,
  sha,
  context,
  fingerprint
} from '../skills/game-production/scripts/lib.mjs';
const root = process.cwd(),
  profile = readJSON('.gameprod/project.json');
context(root, profile);
const args = process.argv.slice(2),
  get = (n) => args[args.indexOf('--' + n) + 1];
if (!args.includes('--config')) throw Error('Explicit station config required');
const config = get('config'),
  candidate = readJSON('.gameprod/evidence/candidate.json'),
  directory = candidate.directory;
const manifest = readJSON(path.join(directory, 'build-manifest.json'));
if (
  manifest.repository !== profile.repository ||
  sha(fs.readFileSync(path.join(directory, manifest.apk))) !== manifest.sha256
)
  throw Error('Candidate identity failed');
const owner = readJSON(config),
  lockFile = path.join(owner.workDir, 'qualification.lock');
const lockFd = fs.openSync(lockFile, 'wx');
fs.writeFileSync(
  lockFd,
  JSON.stringify({
    pid: process.pid,
    host: profile.authorizedHosts[0],
    startedAt: new Date().toISOString()
  })
);
fs.closeSync(lockFd);
const previous = '.gameprod/evidence/qualification.json';
if (fs.existsSync(previous)) {
  fs.mkdirSync('.gameprod/evidence/history', { recursive: true });
  fs.copyFileSync(previous, '.gameprod/evidence/history/qualification-' + Date.now() + '.json');
}
const toolDigest = fingerprint(root, profile);
const suite = {
  candidateHead: candidate.head,
  toolDigest,
  startedAt: new Date().toISOString(),
  apk: { version: manifest.version, sha256: manifest.sha256, commit: manifest.commit },
  toolingCommit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  results: []
};
function execute(name, argv, receipt) {
  const start = Date.now();
  const r = spawnSync(process.execPath, argv, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 210000,
    maxBuffer: 2 * 1024 * 1024
  });
  fs.writeFileSync(
    '.gameprod/evidence/qa-' + name + '.local.log',
    (r.stdout || '') + (r.stderr || '')
  );
  let result;
  try {
    result = readJSON(receipt);
    if (Date.parse(result.observedAt || result.at || '') < start - 2000) throw Error('stale');
  } catch {
    result = { status: 'failed', error: r.error?.message || 'Missing or stale command receipt' };
  }
  const row = {
    name,
    status: r.status === 0 && result.status === 'passed' ? 'passed' : 'failed',
    durationMs: Date.now() - start,
    receipt,
    ...(result.error ? { error: result.error } : {})
  };
  suite.results.push(row);
  writeJSON('.gameprod/evidence/qualification.json', suite);
  console.log(name + ': ' + row.status);
  return row.status === 'passed';
}
const device = (target, mode) =>
  execute(
    target + '-' + mode,
    [
      'scripts/device-test.mjs',
      '--config',
      config,
      '--target',
      target,
      '--mode',
      mode,
      '--dir',
      directory
    ],
    '.gameprod/evidence/device-' + target + '-' + mode + '.json'
  );
writeJSON('.gameprod/evidence/qualification.json', { ...suite, status: 'running' });
try {
  suite.coordination = await waitForPathsGone(
    ['update.lock', 'install.lock', 'device-test.lock'].map((n) => path.join(owner.workDir, n)),
    { timeoutMs: 300000 }
  );
  device('emulator-A', 'clean-install');
  for (const target of ['emulator-A', 'emulator-B']) {
    if (device(target, 'install')) {
      device(target, 'ui');
      device(target, 'jni');
      device(target, 'reinstall');
      device(target, 'close');
      device(target, 'launch');
    }
  }
  execute(
    'emulator-pair',
    ['scripts/device-pair.mjs', '--config', config],
    '.gameprod/evidence/emulator-pair.json'
  );
  execute(
    'pvp-emulators',
    ['scripts/room-qualification.mjs', '--config', config],
    '.gameprod/evidence/pvp-emulators.json'
  );
  if (args.includes('--physical')) {
    if (device('phone', 'install')) {
      device('phone', 'ui');
      device('phone', 'tcp-usb');
      device('phone', 'tcp-lan');
      device('phone', 'tcp-peer');
      device('phone', 'bluetooth');
      execute(
        'bluetooth-player-room',
        ['scripts/bluetooth-room-test.mjs', '--config', config],
        '.gameprod/evidence/bluetooth-player-room.json'
      );
      execute(
        'pvp-phone-lan',
        ['scripts/room-qualification.mjs', '--config', config, '--physical'],
        '.gameprod/evidence/pvp-phone-lan.json'
      );
      device('phone', 'reinstall');
      device('phone', 'close');
      device('phone', 'launch');
    }
  }
  suite.finishedAt = new Date().toISOString();
  suite.toolDigestAfter = fingerprint(root, profile);
  suite.status =
    suite.results.every((x) => x.status === 'passed') && suite.toolDigestAfter === toolDigest
      ? 'passed'
      : 'failed';
  writeJSON('.gameprod/evidence/qualification.json', suite);
  console.log('QUALIFICATION_' + suite.status.toUpperCase());
  if (suite.status !== 'passed') process.exitCode = 1;
} catch (e) {
  suite.status = 'failed';
  suite.error = e.message;
  suite.finishedAt = new Date().toISOString();
  writeJSON('.gameprod/evidence/qualification.json', suite);
  throw e;
} finally {
  fs.unlinkSync(lockFile);
}
