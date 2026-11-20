import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, readJSON, writeJSON, inside, context, sha } from './lib.mjs';
import {
  planRecovery,
  assertSameRow,
  processState,
  barrierDetails
} from './source-lock-recovery-policy.mjs';
import { acquireRecoverableBarrier, inspectRecoverableBarrier } from './recovery-barrier.mjs';
import { GitHubCoordination } from './collaboration-store.mjs';
import { assertOwnership } from './collaboration-policy.mjs';

const REPO = 'neurofoxpro/multimental';
const canonical = (p) =>
  process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
function safeFile(file, max = 4096) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > max)
    throw Error('SOURCE_RECOVERY_UNSAFE_FILE');
  const bytes = fs.readFileSync(file);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw Error('SOURCE_RECOVERY_MALFORMED');
  }
  return {
    stat,
    bytes,
    value,
    sha256: sha(bytes),
    inode: String(stat.ino),
    device: String(stat.dev)
  };
}
export function readTarget(target) {
  if (!target || typeof target.id !== 'string' || !path.isAbsolute(target.file))
    throw Error('SOURCE_RECOVERY_TARGET');
  try {
    return { id: target.id, ...safeFile(target.file) };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function writeLease(file, details) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomBytes(16).toString('hex'),
    value = { pid: process.pid, token, startedAt: new Date().toISOString(), ...details };
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {
    token,
    value,
    release() {
      const r = safeFile(file);
      if (r.value.pid !== process.pid || r.value.token !== token)
        throw Error('SOURCE_RECOVERY_BARRIER_CHANGED');
      fs.unlinkSync(file);
    }
  };
}
export function recoverSourceLocks(
  targets,
  {
    mode = 'plan',
    now = Date.now,
    state = processState,
    graceMs = 30000,
    recoveryFile,
    archiveRoot,
    beforeMove = () => {},
    afterMove = () => {}
  } = {}
) {
  if (
    !Array.isArray(targets) ||
    !targets.length ||
    targets.length > 32 ||
    !['plan', 'apply'].includes(mode) ||
    !path.isAbsolute(recoveryFile) ||
    !path.isAbsolute(archiveRoot)
  )
    throw Error('SOURCE_RECOVERY_INPUT');
  const ids = new Set();
  for (const t of targets) {
    if (ids.has(t.id)) throw Error('SOURCE_RECOVERY_DUP_TARGET');
    ids.add(t.id);
  }
  const selfStale = inspectRecoverableBarrier(recoveryFile, {
      command: 'production-source-recovery',
      now,
      state,
      graceMs
    }),
    rows = targets.map(readTarget).filter(Boolean),
    planned = planRecovery(rows, { now: now(), state, graceMs });
  if (mode === 'plan')
    return {
      status: planned.length || selfStale ? 'planned' : 'nothing_to_recover',
      selfBarrier: selfStale ? { sha256: selfStale.sha256, pid: selfStale.value.pid } : null,
      locks: planned.map((x) => ({
        id: x.id,
        sha256: x.sha256,
        pid: x.value.pid,
        command: x.value.command
      }))
    };
  if (!planned.length && !selfStale) return { status: 'nothing_to_recover', locks: [] };
  const selfResult = acquireRecoverableBarrier(recoveryFile, {
      command: 'production-source-recovery',
      now,
      state,
      graceMs,
      archiveRoot
    }),
    self = selfResult.lease,
    guards = [],
    run = crypto.randomUUID(),
    archive = path.join(archiveRoot, run);
  let receipt = {
    schemaVersion: 1,
    runId: run,
    status: 'prepared',
    selfBarrierRecovered: !!selfResult.recovered,
    archived: [],
    planned: planned.map((x) => ({
      id: x.id,
      sha256: x.sha256,
      command: x.value.command,
      pid: x.value.pid
    }))
  };
  fs.mkdirSync(archive, { recursive: true });
  const receiptFile = path.join(archive, 'receipt.json'),
    save = () => writeJSON(receiptFile, receipt);
  save();
  try {
    const again = targets.map(readTarget).filter(Boolean);
    planRecovery(again, { now: now(), state, graceMs });
    for (const t of targets)
      if (!rows.some((r) => r.id === t.id)) guards.push(writeLease(t.file, barrierDetails()));
    for (const expected of planned) {
      const t = targets.find((x) => x.id === expected.id),
        base = expected.id.replaceAll(':', '_').replaceAll('/', '_'),
        backup = path.join(archive, base + '.original.json');
      const fd = fs.openSync(backup, 'wx');
      try {
        fs.writeFileSync(fd, expected.bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (sha(fs.readFileSync(backup)) !== expected.sha256)
        throw Error('SOURCE_RECOVERY_ARCHIVE_CHANGED');
      beforeMove(expected, t);
      const current = readTarget(t);
      if (!current) throw Error('SOURCE_RECOVERY_LOCK_DISAPPEARED');
      assertSameRow(expected, current);
      planRecovery([current], { now: now(), state, graceMs });
      const moved = path.join(archive, base + '.orphan.json');
      fs.renameSync(t.file, moved);
      if (sha(fs.readFileSync(moved)) !== expected.sha256)
        throw Error('SOURCE_RECOVERY_MOVED_BYTES_CHANGED');
      receipt.archived.push(expected.id);
      save();
      afterMove(expected, t);
      guards.push(writeLease(t.file, barrierDetails()));
    }
    receipt.status = 'recovered';
    save();
    return { ...receipt, receipt: receiptFile };
  } catch (e) {
    receipt.status = 'incomplete';
    receipt.error = e.message;
    save();
    throw e;
  } finally {
    let problem = null;
    for (const g of guards.reverse()) {
      try {
        g.release();
      } catch (e) {
        problem ??= e;
      }
    }
    try {
      self.release();
    } catch (e) {
      problem ??= e;
    }
    if (problem) throw problem;
  }
}
function noLinks(root, target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
    throw Error('SOURCE_RECOVERY_PATH_SCOPE');
  let cur = root;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink())
      throw Error('SOURCE_RECOVERY_SYMLINK');
  }
}
export function sourceLockTargets(root, workspace, stationWorkDir) {
  const evidence = inside(root, '.gameprod/evidence'),
    station = path.resolve(stationWorkDir);
  noLinks(workspace, station);
  if (!fs.existsSync(station) || !fs.lstatSync(station).isDirectory())
    throw Error('SOURCE_RECOVERY_STATION_DIR');
  return [
    ['worktree:short-workflow.lock', path.join(evidence, 'short-workflow.lock')],
    ['worktree:task-accept.lock', path.join(evidence, 'task-accept.lock')],
    ['worktree:manual-review.lock', path.join(evidence, 'manual-review.lock')],
    ['worktree:lab.lock', path.join(evidence, 'lab.lock')],
    ['worktree:branch-recovery.lock', path.join(evidence, 'branch-recovery.lock')],
    ['worktree:completed-recovery.lock', path.join(evidence, 'completed-recovery.lock')],
    ['worktree:dispatch-start.lock', path.join(evidence, 'dispatch-start.lock')],
    ['worktree:ops.lock', path.join(evidence, 'ops.lock')],
    ['workspace:collaboration-worktrees.lock', inside(workspace, 'collaboration-worktrees.lock')],
    [
      'workspace:collaboration-dev-integration.lock',
      inside(workspace, 'collaboration-dev-integration.lock')
    ],
    ['station:manual-review.lock', inside(station, 'manual-review.lock')],
    ['station:lab-session.lock', inside(station, 'lab-session.lock')]
  ].map(([id, file]) => ({ id, file }));
}
function assertRegisteredWorktree(root) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000
  });
  if (r.error || r.status !== 0) throw Error('SOURCE_RECOVERY_WORKTREE_LIST');
  const actual = canonical(fs.realpathSync(root)),
    blocks = r.stdout.split(/\r?\n\r?\n/).filter(Boolean);
  if (blocks.length > 64) throw Error('SOURCE_RECOVERY_WORKTREE_LIMIT');
  const hit = blocks.find((b) => {
    const location = /^worktree (.+)$/m.exec(b)?.[1]?.trim();
    return location && canonical(fs.realpathSync(location)) === actual;
  });
  if (!hit || hit.includes('\nlocked') || hit.includes('\nprunable'))
    throw Error('SOURCE_RECOVERY_UNREGISTERED_WORKTREE');
  const branch = /^branch refs\/heads\/(.+)$/m.exec(hit)?.[1]?.trim();
  if (!/^(feature|fix|docs|test)\//.test(branch || ''))
    throw Error('SOURCE_RECOVERY_FEATURE_WORKTREE_REQUIRED');
  return { branch };
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'plan', ...extra] = args;
  if (extra.length || !['plan', 'apply'].includes(mode)) throw Error('source-recover plan|apply');
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('SOURCE_RECOVERY_STATION_ONLY');
  const root = findRoot(),
    workspace = path.dirname(root),
    project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  if (project.repository !== REPO) throw Error('SOURCE_RECOVERY_REPOSITORY');
  const worktree = assertRegisteredWorktree(root);
  const stationFile = inside(workspace, 'station.local.json'),
    station = readJSON(stationFile);
  if (
    station.repository !== REPO ||
    typeof station.workDir !== 'string' ||
    !path.isAbsolute(station.workDir) ||
    !project.authorizedHosts.some(
      (x) => x.toUpperCase() === String(station.allowedHost || '').toUpperCase()
    ) ||
    os.hostname().toUpperCase() !== String(station.allowedHost || '').toUpperCase()
  )
    throw Error('SOURCE_RECOVERY_STATION_CONFIG');
  if (mode === 'apply') {
    const bindingFile = inside(root, '.gameprod/agent.local.json');
    if (!fs.existsSync(bindingFile)) throw Error('SOURCE_RECOVERY_ACTIVE_BINDING_REQUIRED');
    const binding = readJSON(bindingFile);
    if (binding.released || binding.branch !== worktree.branch)
      throw Error('SOURCE_RECOVERY_BINDING_MISMATCH');
    const token =
      process.env.GH_TOKEN ||
      process.env.GITHUB_TOKEN ||
      (() => {
        const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 });
        if (r.error || r.status !== 0) throw Error('SOURCE_RECOVERY_AUTH');
        return r.stdout.trim();
      })();
    const current = await new GitHubCoordination(token).read();
    if (!current?.state) throw Error('SOURCE_RECOVERY_COORDINATION_UNAVAILABLE');
    assertOwnership(current.state, binding);
  }
  const targets = sourceLockTargets(root, workspace, station.workDir),
    result = recoverSourceLocks(targets, {
      mode,
      recoveryFile: inside(root, '.gameprod/evidence/source-recovery.lock'),
      archiveRoot: inside(root, '.gameprod/evidence/source-lock-recovery')
    });
  console.log(
    JSON.stringify(
      { ...result, repository: REPO, host: os.hostname(), sourceWrites: 0, deviceWrites: 0 },
      null,
      2
    )
  );
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('SOURCE_RECOVERY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
