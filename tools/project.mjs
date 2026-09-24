import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(),
  godot = process.env.GODOT_BIN || 'godot';
function run(exe, args) {
  const r = spawnSync(exe, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 540000,
    maxBuffer: 32 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  if (r.error || r.status !== 0 || /SCRIPT ERROR:|Parse Error:/.test(out))
    throw Error('Command failed: ' + exe);
}
const [cmd, target] = process.argv.slice(2);
try {
  if (cmd === 'verify' || cmd === 'test') run(process.execPath, ['tools/verify.mjs']);
  else if (cmd === 'doctor')
    run(process.execPath, ['skills/game-production/scripts/gameprod.mjs', 'doctor']);
  else if (cmd === 'build') {
    const web = target === 'web';
    if (!web && target !== 'android') throw Error('Unknown build target');
    const output = path.join(root, web ? 'dist/web/index.html' : 'dist/multimental-debug.apk');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    run(godot, [
      '--headless',
      '--path',
      'game',
      '--export-debug',
      web ? 'Web' : 'Android Debug',
      output
    ]);
    if (!fs.existsSync(output)) throw Error('Export did not produce output');
    console.log('MULTIMENTAL_BUILD_PASS ' + target);
  } else throw Error('Usage: verify|test|doctor|build android|build web');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
