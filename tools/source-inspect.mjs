import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, readJSON, inside, sha } from '../skills/game-production/scripts/lib.mjs';
import { safePath } from '../skills/game-production/scripts/apply.mjs';
export function main(paths = process.argv.slice(2)) {
  const root = findRoot();
  if (readJSON(inside(root, '.gameprod/project.json')).repository !== 'neurofoxpro/multimental')
    throw Error('Wrong source repository');
  if (!paths.length || paths.length > 32) throw Error('inspect expects 1..32 source paths');
  const rows = paths.map((p) => {
    const file = safePath(root, p);
    if (!fs.existsSync(file)) return { path: p, exists: false, sha256: null };
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2097152) throw Error('Not a bounded source file');
    const bytes = fs.readFileSync(file);
    return { path: p, exists: true, sha256: sha(bytes), bytes: bytes.length };
  });
  console.log(JSON.stringify(rows, null, 2));
  return rows;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error('SOURCE_INSPECT_BLOCKED: ' + e.message);
    process.exitCode = 1;
  }
}
