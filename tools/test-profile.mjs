import { runtimeSucceeded } from './runtime-diagnostics.mjs';
import fs from 'node:fs';
import { prepareGodotProject } from './godot-preflight.mjs';
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
  inspector: ['card_inspector_test.gd', 'MULTIMENTAL_CARD_INSPECTOR_PASS'],
  'inspector-lab': ['inspector_lab_test.gd', 'MULTIMENTAL_INSPECTOR_LAB_PASS'],
  taps: ['ui_tap_geometry_test.gd', 'MULTIMENTAL_TAP_GEOMETRY_PASS'],
  crafting: ['crafting_test.gd', 'MULTIMENTAL_CRAFT_PASS'],
  'crafting-ui': ['crafting_ui_test.gd', 'MULTIMENTAL_CRAFT_UI_PASS'],
  menu: ['menu_layout_test.gd', 'MULTIMENTAL_MENU_LAYOUT_PASS'],
  economy: ['economy_test.gd', 'MULTIMENTAL_ECONOMY_PASS'],
  shop: ['shop_ui_test.gd', 'MULTIMENTAL_SHOP_UI_PASS'],
  'editor-lab': ['collection_lab_test.gd', 'MULTIMENTAL_COLLECTION_LAB_PASS'],
  network: ['network_decks_test.gd', 'MULTIMENTAL_NETWORK_DECKS_PASS'],
  collection: ['collection_test.gd', 'MULTIMENTAL_COLLECTION_PASS'],
  editor: ['collection_ui_test.gd', 'MULTIMENTAL_COLLECTION_UI_PASS'],
  storage: ['profile_store_test.gd', 'MULTIMENTAL_PROFILE_STORAGE_PASS'],
  ui: ['profile_ui_test.gd', 'MULTIMENTAL_PROFILE_UI_PASS']
};
if (suite === 'list' && extra.length === 0) {
  console.log(
    JSON.stringify(
      {
        suites: Object.entries(choices).map(([name, [file, marker]]) => ({
          name,
          file,
          marker,
          command: 'npm run game -- profile-test ' + name
        })),
        testsExecuted: false
      },
      null,
      2
    )
  );
  process.exit(0);
}
if (!Object.hasOwn(choices, suite) || extra.length)
  throw Error('profile-test ' + Object.keys(choices).join('|') + '|list');
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
prepareGodotProject(root, exe);
console.log('GODOT_PROJECT_CACHE_READY');
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
  r.status === 0 && !r.error && before === after && runtimeSucceeded(r.status, output, marker);
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
