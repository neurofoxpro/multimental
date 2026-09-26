import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  findRoot,
  readJSON,
  writeJSON,
  profile,
  context,
  fingerprint,
  sha,
  inside,
  gate
} from './lib.mjs';
const root = findRoot();
const p = profile(readJSON(path.join(root, '.gameprod/project.json')));
const [cmd = 'status', arg] = process.argv.slice(2);

function validate() {
  const s = readJSON(inside(root, '.gameprod/state.json'));
  if (s.repository !== p.repository) throw Error('State repository mismatch');
  const ds = readJSON(inside(root, '.gameprod/decisions.json')),
    ids = new Set();
  for (const d of ds) {
    if (
      !d.id ||
      ids.has(d.id) ||
      !['accepted', 'recommended', 'deferred', 'superseded'].includes(d.status)
    )
      throw Error('Invalid decision ledger');
    ids.add(d.id);
  }
  if (readJSON(inside(root, '.gameprod/lifecycle.json')).length < 20)
    throw Error('Incomplete lifecycle');
  for (const f of p.requiredFiles || [])
    if (!fs.existsSync(inside(root, f))) throw Error('Missing ' + f);
  console.log('PRODUCTION_METADATA_PASS');
}

function run(name) {
  context(root, p);
  validate();
  const step = p.steps[name];
  if (!step) throw Error('Unconfigured step');
  for (const dep of step.requires || [])
    if (!gate(root, p, dep).ok) throw Error('Unpassed prerequisite ' + dep);
  const dir = inside(root, '.gameprod/evidence');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'execution.lock');
  const fd = fs.openSync(lock, 'wx');
  fs.writeFileSync(
    fd,
    JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      step: name,
      time: new Date().toISOString()
    })
  );
  fs.closeSync(fd);
  try {
    const sourceDigest = fingerprint(root, p),
      startedAt = new Date().toISOString();
    let [exe, ...args] = step.command;
    if (exe === 'node') exe = process.execPath;
    const r = spawnSync(exe, args, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: step.timeoutSeconds * 1000,
      maxBuffer: 32 * 1024 * 1024,
      env: process.env
    });
    let output = (r.stdout || '') + (r.stderr || '') + (r.error ? '\n' + r.error.message : '');
    let sourceDigestAfter = null;
    try {
      sourceDigestAfter = fingerprint(root, p);
    } catch (e) {
      output += '\nSource check failed: ' + e.message;
    }
    const sourceChanged = sourceDigestAfter !== sourceDigest;
    if (sourceChanged)
      output += '\nPRODUCTION_SOURCE_CHANGED: step altered its declared source inputs\n';
    process.stdout.write(output);
    const log = '.gameprod/evidence/' + name.replaceAll(':', '-') + '.log';
    fs.writeFileSync(inside(root, log), output);
    let ok =
      r.status === 0 &&
      !r.error &&
      !sourceChanged &&
      !/SCRIPT ERROR:|Parse Error:|PRODUCTION_TEST_FAIL|^ERROR:|Unicode parsing error/m.test(
        output
      );
    for (const marker of step.markers || []) if (!output.includes(marker)) ok = false;
    const outputs = [];
    for (const file of step.outputs || []) {
      if (!fs.existsSync(inside(root, file))) {
        ok = false;
        continue;
      }
      outputs.push({ path: file, sha256: sha(fs.readFileSync(inside(root, file))) });
    }
    writeJSON(path.join(dir, name.replaceAll(':', '-') + '.json'), {
      schemaVersion: 1,
      step: name,
      status: ok ? 'passed' : 'failed',
      exitCode: r.status ?? 1,
      sourceDigest,
      sourceDigestAfter,
      sourceChanged,
      startedAt,
      finishedAt: new Date().toISOString(),
      host: process.env.GITHUB_ACTIONS === 'true' ? 'github-hosted' : os.hostname(),
      command: step.command,
      log,
      logHash: sha(output),
      outputs
    });
    if (!ok) throw Error('Step failed ' + name);
    console.log('PRODUCTION_STEP_PASS ' + name);
  } finally {
    fs.unlinkSync(lock);
  }
}

try {
  switch (cmd) {
    case 'validate':
      validate();
      break;
    case 'status':
      console.log(
        JSON.stringify(
          {
            ...readJSON(inside(root, '.gameprod/state.json')),
            gates: Object.fromEntries(Object.keys(p.gates).map((k) => [k, gate(root, p, k)]))
          },
          null,
          2
        )
      );
      break;
    case 'next':
      console.log(
        JSON.stringify(
          readJSON(inside(root, '.gameprod/backlog.json')).find((x) => x.status !== 'done') || {},
          null,
          2
        )
      );
      break;
    case 'run':
      run(arg);
      break;
    case 'gate': {
      const g = gate(root, p, arg);
      console.log(JSON.stringify(g, null, 2));
      if (!g.ok) process.exitCode = 2;
      break;
    }
    case 'doctor': {
      context(root, p);
      for (const exe of [process.execPath, process.env.GODOT_BIN || 'godot', 'gh']) {
        const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 10000 });
        console.log(
          path.basename(exe) +
            ': ' +
            (r.status === 0 ? (r.stdout || '').trim().split('\n')[0] : 'MISSING')
        );
      }
      break;
    }
    default:
      throw Error('Usage: status|validate|next|doctor|run STEP|gate GATE');
  }
} catch (e) {
  console.error('PRODUCTION_BLOCKED: ' + e.message);
  process.exitCode = 1;
}
