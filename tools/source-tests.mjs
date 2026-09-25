import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  findRoot,
  inside,
  readJSON,
  writeJSON,
  fingerprint,
  sha
} from '../skills/game-production/scripts/lib.mjs';
const root = findRoot();
process.chdir(root);
const project = readJSON(inside(root, '.gameprod/project.json'));
if (project.repository !== 'neurofoxpro/multimental') throw Error('Wrong source repository');
const files = fs
  .readdirSync(inside(root, 'skills/game-production/tests'))
  .filter((n) => n.endsWith('.test.mjs'))
  .sort()
  .map((n) => 'skills/game-production/tests/' + n);
if (!files.length) throw Error('Empty test suite');
const before = fingerprint(root, project);
const run = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=tap', '--test-concurrency=2', ...files],
  { cwd: root, shell: false, encoding: 'utf8', timeout: 180000, maxBuffer: 24 * 1024 * 1024 }
);
const text = (run.stdout || '') + (run.stderr || '');
const after = fingerprint(root, project);
const count = Number(/^# tests (\d+)$/m.exec(text)?.[1] || 0);
const ok =
  !run.error &&
  run.status === 0 &&
  before === after &&
  count > 0 &&
  /^# fail 0$/m.test(text) &&
  /^# cancelled 0$/m.test(text);
const logfile = '.gameprod/evidence/source-tests.log';
fs.mkdirSync(inside(root, '.gameprod/evidence'), { recursive: true });
fs.writeFileSync(inside(root, logfile), text);
writeJSON(inside(root, '.gameprod/evidence/source-tests.json'), {
  status: ok ? 'passed' : 'failed',
  tests: count,
  exitCode: run.status,
  sourceDigest: before,
  sourceDigestAfter: after,
  log: logfile,
  logHash: sha(text),
  platform: process.platform,
  at: new Date().toISOString(),
  scope: 'source-only; no device access'
});
console.log('SOURCE_TESTS_' + (ok ? 'PASS' : 'FAIL') + ' tests=' + count);
if (!ok) {
  process.stdout.write(text.slice(-12000));
  process.exitCode = 1;
}
