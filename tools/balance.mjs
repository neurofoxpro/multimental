import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  context,
  readJSON,
  writeJSON,
  inside,
  fingerprint,
  sha
} from '../skills/game-production/scripts/lib.mjs';
import { verificationRuntime } from './godot-runtime.mjs';
const root = process.cwd();
if (process.platform === 'win32') {
  const portableGit = path.join(path.dirname(root), 'tools/mingit/cmd');
  if (fs.existsSync(path.join(portableGit, 'git.exe')))
    process.env.PATH = portableGit + path.delimiter + process.env.PATH;
}
const project = readJSON(inside(root, '.gameprod/project.json'));
context(root, project);
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--count', '--seed', '--name', '--profile'].includes(args[i]) || !args[i + 1])
    throw Error('Use --count N --seed N --name LABEL --profile current|before');
  if (options[args[i]] !== undefined) throw Error('Duplicate option');
  options[args[i]] = args[i + 1];
}
const count = Number(options['--count'] || 20),
  seed = Number(options['--seed'] || 9001);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 200 ||
  !Number.isSafeInteger(seed) ||
  seed < 1 ||
  seed > 1000000000
)
  throw Error('Invalid bounded simulation range');
const name = options['--name'] || 'balance-' + Date.now();
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw Error('Invalid report name');
const profile = options['--profile'] || 'current';
if (!['current', 'before'].includes(profile)) throw Error('Unknown profile');
const output = inside(root, '.gameprod/evidence/' + name + '.json');
if (fs.existsSync(output)) throw Error('Report already exists; choose a new name');
const config = {
  count,
  seed_start: seed,
  policies: ['greedy', 'positional'],
  pairings: [
    ['guard', 'lancer'],
    ['guard', 'archer'],
    ['guard', 'flanker'],
    ['lancer', 'archer'],
    ['lancer', 'flanker'],
    ['archer', 'flanker'],
    ['starter', 'rush'],
    ['starter', 'elite']
  ],
  overrides:
    profile === 'before'
      ? {
          5: { attack: 1 },
          13: { attack: 1 },
          3: { health: 2 },
          11: { health: 2 },
          19: { health: 2 },
          7: { health: 3 },
          15: { health: 3 }
        }
      : {},
  output
};
const input = inside(root, '.gameprod/evidence/' + name + '-input.json');
writeJSON(input, config);
let executable = process.env.GODOT_BIN;
if (!executable && process.platform === 'win32') {
  const folder = inside(root, '.gameprod/runtime/godot');
  const found =
    fs.existsSync(folder) && fs.readdirSync(folder).find((x) => /_console\.exe$/i.test(x));
  if (found) executable = path.join(folder, found);
}
executable = verificationRuntime(root, executable || 'godot');
const before = fingerprint(root, project);
const result = spawnSync(
  executable,
  ['--headless', '--path', 'game', '--script', inside(root, 'tools/balance_lab.gd'), '--', input],
  {
    cwd: root,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024,
    shell: false
  }
);
const log = String(result.stdout || '') + String(result.stderr || '');
fs.writeFileSync(inside(root, '.gameprod/evidence/' + name + '.log'), log);
process.stdout.write(log);
if (
  result.error ||
  result.status !== 0 ||
  /SCRIPT ERROR:|Parse Error:|BALANCE_ILLEGAL_COMMAND|^ERROR:/m.test(log)
)
  throw Error('Simulation failed');
if (fingerprint(root, project) !== before) throw Error('Source changed during simulation');
const data = readJSON(output);
if (data.failures !== 0 || data.rows.length !== count * 32)
  throw Error('Missing or failed simulated games');
writeJSON(inside(root, '.gameprod/evidence/' + name + '-identity.json'), {
  schemaVersion: 1,
  sourceDigest: before,
  profile,
  count: data.rows.length,
  coreSha256: sha(fs.readFileSync(inside(root, 'game/src/match_core.gd'))),
  harnessSha256: sha(fs.readFileSync(inside(root, 'tools/balance_lab.gd'))),
  outputSha256: sha(fs.readFileSync(output)),
  status: 'passed',
  limits: [
    'Two heuristic policies, not human play or perfect search',
    'Turns are not measured match minutes',
    'Deck samples do not cover every collectible combination'
  ]
});
console.log('BALANCE_REPORT_READY ' + output);
