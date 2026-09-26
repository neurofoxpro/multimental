import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verificationRuntime } from './godot-runtime.mjs';
import {
  findRoot,
  inside,
  readJSON,
  context,
  writeJSON,
  fingerprint,
  sha
} from '../skills/game-production/scripts/lib.mjs';
const [suite = 'model', ...extra] = process.argv.slice(2);
const choices = {
  model: ['profile_test.gd', 'MULTIMENTAL_PROFILE_PASS'],
  network: ['network_decks_test.gd', 'MULTIMENTAL_NETWORK_DECKS_PASS'],
  collection: ['collection_test.gd', 'MULTIMENTAL_COLLECTION_PASS'],
  editor: ['collection_ui_test.gd', 'MULTIMENTAL_COLLECTION_UI_PASS'],
  storage: ['profile_store_test.gd', 'MULTIMENTAL_PROFILE_STORAGE_PASS'],
  ui: ['profile_ui_test.gd', 'MULTIMENTAL_PROFILE_UI_PASS']
};
if (!Object.hasOwn(choices, suite) || extra.length)
  throw Error('profile-test model|storage|ui|collection|editor');
const [script, marker] = choices[suite];
const root = findRoot();
process.chdir(root);
if (process.platform === 'win32')
  process.env.PATH =
    path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
const p = readJSON(inside(root, '.gameprod/project.json'));
context(root, p);
let binary = process.env.GODOT_BIN;
if (!binary && process.platform === 'win32') {
  const dir = path.join(path.dirname(root), 'tools/godot');
  const name = fs.readdirSync(dir).find((n) => /console.exe$/i.test(n));
  if (name) binary = path.join(dir, name);
}
if (!binary) binary = 'godot';
const exe = verificationRuntime(root, binary);
const before = fingerprint(root, p);
const r = spawnSync(exe, ['--headless', '--path', 'game', '--script', 'res://tests/' + script], {
  cwd: root,
  encoding: 'utf8',
  shell: false,
  timeout: 90000,
  maxBuffer: 8 * 1024 * 1024
});
const output = (r.stdout || '') + (r.stderr || '');
const after = fingerprint(root, p);
const ok =
  r.status === 0 &&
  !r.error &&
  before === after &&
  output.includes(marker) &&
  !/SCRIPT ERROR|Parse Error|PROFILE_FAIL/.test(output);
const logfile = '.gameprod/evidence/profile-' + suite + '-tests.log';
fs.mkdirSync(inside(root, '.gameprod/evidence'), { recursive: true });
fs.writeFileSync(inside(root, logfile), output);
writeJSON(inside(root, '.gameprod/evidence/profile-' + suite + '-tests.json'), {
  status: ok ? 'passed' : 'failed',
  exitCode: r.status,
  sourceDigest: before,
  sourceDigestAfter: after,
  log: logfile,
  logHash: sha(output),
  scope: suite + ' profile checks; no phone installation claimed',
  at: new Date().toISOString()
});
process.stdout.write(output);
if (!ok) process.exitCode = 1;
