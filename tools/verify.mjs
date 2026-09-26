import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verificationRuntime } from './godot-runtime.mjs';
const root = process.cwd();
function run(exe, args, markers = []) {
  const r = spawnSync(exe, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 180000,
    maxBuffer: 24 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  if (
    r.error ||
    r.status !== 0 ||
    /SCRIPT ERROR:|Parse Error:|PRODUCTION_TEST_FAIL|^ERROR:|Unicode parsing error/m.test(out) ||
    markers.some((m) => !out.includes(m))
  )
    throw Error('Verification failed: ' + exe + ' ' + args.join(' '));
}
for (const dir of ['scripts', 'tools', 'skills/game-production/scripts'])
  for (const f of fs.readdirSync(dir))
    if (f.endsWith('.mjs')) run(process.execPath, ['--check', path.join(dir, f)]);
run(process.execPath, ['tools/security-lint.mjs']);
run(process.execPath, ['tools/review.mjs'], ['AUTOMATED_REVIEW_PASS']);
run(process.execPath, ['scripts/format.mjs', 'check'], ['FORMAT_PASS']);
run(process.execPath, ['tools/test-format-integration.mjs'], ['FORMAT_INTEGRATION_PASS']);
run(process.execPath, ['scripts/changelog.mjs', 'check'], ['RUSSIAN_CHANGELOG_PASS']);
run(process.execPath, ['tools/audio.mjs', 'check'], ['AUDIO_ASSETS_PASS']);
run(process.execPath, ['scripts/research.mjs', 'check'], ['RESEARCH_LEDGER_PASS']);
run(process.execPath, ['tools/study.mjs', 'check'], ['STUDY_DEFINITIONS_PASS']);
run(process.execPath, ['tools/gallery.mjs', 'check'], ['MULTIMENTAL_GALLERY_CHECK_PASS']);
run(process.execPath, ['scripts/readiness.mjs', 'check'], ['REQUIREMENTS_SCHEMA_PASS']);
run(
  process.execPath,
  ['skills/game-production/scripts/control.mjs', 'validate'],
  ['WORKPLAN_PASS']
);
run(
  process.execPath,
  ['skills/game-production/scripts/control.mjs', 'render', '--check'],
  ['WORKPLAN_PROJECTIONS_PASS']
);
if (process.platform === 'win32')
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "$errorsFound=@();Get-ChildItem scripts -Filter *.ps1 | ForEach-Object { $tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors)|Out-Null;if($errors){$errorsFound += $errors} };if($errorsFound.Count){$errorsFound|ForEach-Object {$_.ToString()};exit 1};Write-Output 'POWERSHELL_SYNTAX_PASS'"
    ],
    ['POWERSHELL_SYNTAX_PASS']
  );
const tests = fs
  .readdirSync('skills/game-production/tests')
  .filter((x) => x.endsWith('.test.mjs'))
  .map((x) => 'skills/game-production/tests/' + x);
run(process.execPath, ['--test', ...tests]);
console.log('PRODUCTION_TESTS_PASS');
const godot = verificationRuntime(root, process.env.GODOT_BIN || 'godot');
run(godot, ['--headless', '--editor', '--path', 'game', '--quit']);
for (const [file, marker] of [
  ['core_test.gd', 'MULTIMENTAL_CORE_PASS'],
  ['ui_test.gd', 'MULTIMENTAL_UI_PASS'],
  ['protocol_test.gd', 'MULTIMENTAL_PROTOCOL_PASS'],
  ['room_test.gd', 'MULTIMENTAL_ROOM_PASS'],
  ['lan_test.gd', 'MULTIMENTAL_LAN_PASS'],
  ['address_test.gd', 'MULTIMENTAL_ADDRESSES_PASS'],
  ['bluetooth_session_test.gd', 'MULTIMENTAL_BLUETOOTH_MODEL_PASS'],
  ['presentation_test.gd', 'MULTIMENTAL_PRESENTATION_PASS'],
  ['directional_test.gd', 'MULTIMENTAL_DIRECTIONAL_PASS'],
  ['directional_ui_test.gd', 'MULTIMENTAL_DIRECTIONAL_UI_PASS'],
  ['terrain_test.gd', 'MULTIMENTAL_TERRAIN_PASS'],
  ['balance_test.gd', 'MULTIMENTAL_BALANCE_PARAMETERS_PASS'],
  ['room_automation_test.gd', 'MULTIMENTAL_ROOM_AUTOMATION_PASS'],
  ['profile_test.gd', 'MULTIMENTAL_PROFILE_PASS'],
  ['rewards_test.gd', 'MULTIMENTAL_REWARDS_PASS'],
  ['rewards_ui_test.gd', 'MULTIMENTAL_REWARDS_UI_PASS'],
  ['rewards_lab_test.gd', 'MULTIMENTAL_REWARDS_LAB_PASS'],
  ['rewards_simulation_test.gd', 'MULTIMENTAL_REWARDS_SIMULATION_PASS'],
  ['ui_tap_geometry_test.gd', 'MULTIMENTAL_TAP_GEOMETRY_PASS'],
  ['crafting_test.gd', 'MULTIMENTAL_CRAFT_PASS'],
  ['crafting_ui_test.gd', 'MULTIMENTAL_CRAFT_UI_PASS'],
  ['card_inspector_test.gd', 'MULTIMENTAL_CARD_INSPECTOR_PASS'],
  ['inspector_lab_test.gd', 'MULTIMENTAL_INSPECTOR_LAB_PASS'],
  ['menu_layout_test.gd', 'MULTIMENTAL_MENU_LAYOUT_PASS'],
  ['usability_test.gd', 'MULTIMENTAL_USABILITY_PASS'],
  ['connection_ui_test.gd', 'MULTIMENTAL_CONNECTION_UI_PASS'],
  ['profile_store_test.gd', 'MULTIMENTAL_PROFILE_STORAGE_PASS'],
  ['profile_ui_test.gd', 'MULTIMENTAL_PROFILE_UI_PASS'],
  ['collection_test.gd', 'MULTIMENTAL_COLLECTION_PASS'],
  ['collection_ui_test.gd', 'MULTIMENTAL_COLLECTION_UI_PASS'],
  ['network_decks_test.gd', 'MULTIMENTAL_NETWORK_DECKS_PASS'],
  ['collection_lab_test.gd', 'MULTIMENTAL_COLLECTION_LAB_PASS'],
  ['economy_test.gd', 'MULTIMENTAL_ECONOMY_PASS'],
  ['shop_ui_test.gd', 'MULTIMENTAL_SHOP_UI_PASS']
])
  run(godot, ['--headless', '--path', 'game', '--script', 'res://tests/' + file], [marker]);
const core = fs.readFileSync('game/src/match_core.gd', 'utf8');
if (/extends\s+(Node|Control)|get_tree\(|Time\.|HTTP|OS\./.test(core))
  throw Error('Domain dependency violation');
console.log('ARCHITECTURE_PASS');
if (process.platform === 'win32')
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Add-Type -Path 'tools/BluetoothChannel.cs'; Add-Type -Path 'tools/BluetoothPairing.cs'; Write-Output 'WINDOWS_NATIVE_INTEROP_COMPILE_PASS'"
    ],
    ['WINDOWS_NATIVE_INTEROP_COMPILE_PASS']
  );
