import fs from 'node:fs';
import path from 'node:path';
import { stableFormat } from '../tools/format-stability.mjs';
import { readJSON, context, findRoot } from '../skills/game-production/scripts/lib.mjs';
const root = findRoot(),
  mode = process.argv[2] || 'check';
if (!['check', 'write'].includes(mode)) throw Error('format check|write');
if (mode === 'write') context(root, readJSON(path.join(root, '.gameprod/project.json')));
const options = JSON.parse(fs.readFileSync(path.join(root, '.prettierrc.json'), 'utf8'));
const files = [];
function walk(rel) {
  for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
    const p = path.join(rel, name);
    const full = path.join(root, p);
    if (fs.lstatSync(full).isSymbolicLink()) throw Error('Symlink refused');
    if (fs.statSync(full).isDirectory()) {
      if (!['node_modules', '.git', 'runtime', 'evidence'].includes(name)) walk(p);
    } else if (name.endsWith('.mjs')) files.push(p);
  }
}
for (const dir of ['scripts', 'tools', 'skills/game-production']) walk(dir);
let changed = 0;
for (const file of files) {
  const full = path.join(root, file),
    before = fs.readFileSync(full, 'utf8'),
    after = await stableFormat(before, { ...options, filepath: file });
  if (before === after) continue;
  changed++;
  if (mode === 'write') fs.writeFileSync(full, after);
  else console.error('FORMAT_DIFF ' + file);
}
// Git configuration files are plain text; keep cross-platform line endings stable.
for (const file of ['.gitignore', '.gitattributes']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replaceAll('\r\n', '\n');
  if (before === after) continue;
  changed++;
  if (mode === 'write') fs.writeFileSync(full, after);
  else console.error('FORMAT_DIFF ' + file);
}
if (mode === 'check' && changed) {
  process.exitCode = 1;
  console.error('FORMAT_CHECK_FAILED ' + changed);
} else
  console.log(
    'FORMAT_' +
      (mode === 'write' ? 'APPLIED' : 'PASS') +
      ' files=' +
      files.length +
      ' changed=' +
      changed
  );
