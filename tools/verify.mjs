import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verificationRuntime} from './godot-runtime.mjs';
const root = process.cwd();
function run(exe, args, markers = []) {
  const r = spawnSync(exe, args, {cwd: root, encoding: 'utf8', shell: false, timeout: 120000, maxBuffer: 16*1024*1024});
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  if (r.error || r.status !== 0 || /SCRIPT ERROR:|Parse Error:|PRODUCTION_TEST_FAIL/.test(out) || markers.some(m => !out.includes(m))) {
    throw Error('Verification failed: ' + exe + ' ' + args.join(' '));
  }
}
for (const dir of ['scripts', 'tools', 'skills/game-production/scripts']) {
  for (const file of fs.readdirSync(dir)) if (file.endsWith('.mjs')) run(process.execPath, ['--check', path.join(dir, file)]);
}
run(process.execPath, ['--test', 'skills/game-production/tests/production.test.mjs', 'skills/game-production/tests/updater.test.mjs', 'skills/game-production/tests/source-stability.test.mjs']);
console.log('PRODUCTION_TESTS_PASS');
const godot = verificationRuntime(root, process.env.GODOT_BIN || 'godot');
run(godot, ['--headless', '--editor', '--path', 'game', '--quit']);
run(godot, ['--headless', '--path', 'game', '--script', 'res://tests/core_test.gd'], ['MULTIMENTAL_CORE_PASS']);
run(godot, ['--headless', '--path', 'game', '--script', 'res://tests/ui_test.gd'], ['MULTIMENTAL_UI_PASS']);
const core = fs.readFileSync(path.join(root, 'game/src/match_core.gd'), 'utf8');
if (/extends\s+(Node|Control)|get_tree\(|Time\.|HTTP|OS\./.test(core)) throw Error('Domain dependency violation');
console.log('ARCHITECTURE_PASS');
