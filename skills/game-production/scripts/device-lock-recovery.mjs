import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { findRoot, readJSON, writeJSON, context, sha } from './lib.mjs';
import { acquireOperation } from './operation-lock.mjs';
const NAMES = ['install.lock', 'device-test.lock', 'qualification.lock', 'update.lock'];
export function processState(pid, probe = process.kill) {
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unknown';
  try {
    probe(pid, 0);
    return 'alive';
  } catch (error) {
    return error.code === 'ESRCH' ? 'absent' : 'unknown';
  }
}
export function orphanPlan(rows, now, state) {
  if (!Number.isFinite(now) || !Array.isArray(rows)) throw Error('Invalid lock inventory');
  const seen = new Set();
  for (const row of rows) {
    if (!NAMES.includes(row.name) || seen.has(row.name) || !/^[a-f0-9]{64}$/.test(row.hash || ''))
      throw Error('Unexpected lock');
    seen.add(row.name);
    const value = row.value;
    const started = Date.parse(
      value?.startedAt || value?.started || value?.createdAt || value?.time || ''
    );
    if (
      !Number.isFinite(started) ||
      now - started < 30000 ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1
    )
      throw Error('Unproven lock owner/time');
    if (state(value.pid) !== 'absent') throw Error('Owner alive or unknown; lock preserved');
  }
  return NAMES.flatMap((name) => rows.filter((row) => row.name === name));
}
export function lockInventory(directory) {
  return NAMES.flatMap((name) => {
    const file = path.join(directory, name);
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4096)
      throw Error('Unsafe lock file');
    const bytes = fs.readFileSync(file);
    let value;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw Error('Malformed lock; preserve it');
    }
    return [
      { name, hash: sha(bytes), value, inode: String(stat.ino), device: String(stat.dev), bytes }
    ];
  });
}
export function recoverOrphans(
  directory,
  { mode = 'plan', now = Date.now, state = processState, beforeMove = () => {} } = {}
) {
  if (!['plan', 'apply'].includes(mode) || !path.isAbsolute(directory))
    throw Error('Explicit recovery directory and mode required');
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
    throw Error('Unsafe recovery directory');
  const archiveRoot = path.join(directory, 'lock-recovery');
  if (
    fs.existsSync(archiveRoot) &&
    (!fs.lstatSync(archiveRoot).isDirectory() || fs.lstatSync(archiveRoot).isSymbolicLink())
  )
    throw Error('Unsafe archive directory');
  const rows = orphanPlan(lockInventory(directory), now(), state);
  const publicRows = rows.map(({ name, hash, value }) => ({
    name,
    sha256: hash,
    owner: value.pid
  }));
  if (mode === 'plan' || !rows.length)
    return {
      status: rows.length ? 'planned' : 'nothing_to_recover',
      locks: publicRows,
      installation: 'not_inferred'
    };
  const release = acquireOperation(path.join(directory, 'recovery.lock'), {
    command: 'dead-device-owner-recovery'
  });
  const guards = [];
  let report, journal;
  try {
    for (const name of ['update.lock', 'qualification.lock', 'device-test.lock', 'install.lock']) {
      if (!rows.some((row) => row.name === name))
        guards.push(acquireOperation(path.join(directory, name), { command: 'recovery-barrier' }));
    }
    const run = crypto.randomUUID();
    const archive = path.join(directory, 'lock-recovery', run);
    fs.mkdirSync(archive, { recursive: true });
    journal = path.join(archive, 'receipt.json');
    report = {
      schemaVersion: 1,
      runId: run,
      status: 'prepared',
      locks: publicRows,
      archived: [],
      at: new Date(now()).toISOString(),
      installation: 'not_inferred'
    };
    writeJSON(journal, report);
    for (const row of rows) {
      const backup = path.join(archive, row.name + '.original.json');
      const fd = fs.openSync(backup, 'wx');
      try {
        fs.writeFileSync(fd, row.bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (sha(fs.readFileSync(backup)) !== row.hash) throw Error('Archive verification failed');
    }
    for (const row of rows) {
      beforeMove(row);
      const current = lockInventory(directory).find((item) => item.name === row.name);
      if (
        !current ||
        current.hash !== row.hash ||
        current.inode !== row.inode ||
        current.device !== row.device
      )
        throw Error('Lock changed; recovery stopped');
      orphanPlan([current], now(), state);
      const old = path.join(directory, row.name),
        moved = path.join(archive, row.name + '.orphan.json');
      fs.renameSync(old, moved);
      if (sha(fs.readFileSync(moved)) !== row.hash)
        throw Error('Archived lock changed; inspect journal');
      report.archived.push(row.name);
      writeJSON(journal, report);
      guards.push(acquireOperation(old, { command: 'recovery-barrier' }));
    }
    report.status = 'recovered';
    writeJSON(journal, report);
    return { ...report, receipt: journal };
  } catch (error) {
    if (report && journal) {
      report.status = 'incomplete';
      report.error = error.message;
      writeJSON(journal, report);
    }
    throw error;
  } finally {
    let problem;
    for (const guard of guards.reverse())
      try {
        guard();
      } catch (error) {
        problem ||= error;
      }
    try {
      release();
    } catch (error) {
      problem ||= error;
    }
    if (problem) throw problem;
  }
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'plan', ...extra] = args;
  if (extra.length || !['plan', 'apply'].includes(mode)) throw Error('device-recover plan|apply');
  if (process.env.GITHUB_ACTIONS === 'true')
    throw Error('Personal device recovery is not a CI action');
  const root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const project = readJSON(path.join(root, '.gameprod/project.json'));
  context(root, project);
  if (project.repository !== 'neurofoxpro/multimental') throw Error('Wrong repository');
  const { validateConfig } = await import('../../../scripts/install-device.mjs');
  const { inside } = await import('./lib.mjs');
  const config = validateConfig(readJSON(inside(workspace, 'station.local.json')));
  if (config.repository !== project.repository || config.package !== 'pro.neurofox.multimental.dev')
    throw Error('Wrong device scope');
  const directory = inside(workspace, path.relative(workspace, config.workDir));
  if (directory === root || directory === workspace)
    throw Error('Expected isolated installation directory');
  const archive = path.join(directory, 'lock-recovery');
  if (
    fs.existsSync(archive) &&
    (!fs.lstatSync(archive).isDirectory() || fs.lstatSync(archive).isSymbolicLink())
  )
    throw Error('Unsafe archive directory');
  const release = acquireOperation(path.join(root, '.gameprod/evidence/ops.lock'), {
    command: 'device-recover',
    repository: project.repository
  });
  try {
    console.log(JSON.stringify(recoverOrphans(directory, { mode }), null, 2));
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('DEVICE_RECOVERY_BLOCKED: ' + error.message);
    process.exitCode = 1;
  });
}
