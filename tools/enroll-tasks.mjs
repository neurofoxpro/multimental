import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePlan } from '../skills/game-production/scripts/control.mjs';
import { findRoot, readJSON, inside, sha } from '../skills/game-production/scripts/lib.mjs';
import { applyBundle } from '../skills/game-production/scripts/apply.mjs';
export function enrollTasks(plan, tasks) {
  validatePlan(plan);
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 20)
    throw Error('Expected bounded task definitions');
  const next = structuredClone(plan),
    seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) throw Error('Duplicate enrollment');
    seen.add(task.id);
    const old = next.tasks.find((t) => t.id === task.id);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(task))
        throw Error('Existing task must be changed in its Issue');
      continue;
    }
    if (task.status !== 'planned' && task.status !== 'manual')
      throw Error('New work must not be pre-verified');
    next.tasks.push(structuredClone(task));
  }
  return validatePlan(next);
}
export function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !args[0].startsWith('.gameprod/ideas/') || !args[0].endsWith('.json'))
    throw Error('enroll requires an explicit .gameprod/ideas/*.json proposal');
  const root = findRoot();
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const file = inside(root, '.gameprod/workplan.json'),
    before = fs.readFileSync(file, 'utf8');
  const proposed = readJSON(inside(root, args[0]));
  const next = enrollTasks(JSON.parse(before), proposed.tasks);
  for (const t of next.tasks)
    for (const ref of [...t.readset, ...t.evidence])
      if (!fs.existsSync(inside(root, ref))) throw Error('Missing task reference: ' + ref);
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000
  });
  if (git.status !== 0) throw Error('Missing source identity');
  if (JSON.stringify(next) !== JSON.stringify(JSON.parse(before)))
    applyBundle(root, {
      base: git.stdout.trim(),
      files: [
        {
          path: '.gameprod/workplan.json',
          expectedCurrentSha256: sha(before),
          content: JSON.stringify(next, null, 2) + '\n'
        }
      ]
    });
  const render = spawnSync(
    process.execPath,
    ['skills/game-production/scripts/control.mjs', 'render'],
    { cwd: root, shell: false, stdio: 'inherit', timeout: 60000 }
  );
  if (render.status !== 0) throw Error('Projection rendering failed; rerun enrollment to resume');
  console.log(
    'TASKS_ENROLLED ' +
      proposed.tasks.length +
      ' total=' +
      next.tasks.length +
      '; next: npm run game -- github sync'
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  try {
    main();
  } catch (e) {
    console.error('ENROLL_BLOCKED: ' + e.message);
    process.exitCode = 1;
  }
