import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, readJSON, writeJSON, inside, context, sha } from './lib.mjs';
import { processState } from './device-lock-recovery.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
export function provenBranchOrphan(lock, binding, journal, observed) {
  if (!Number.isSafeInteger(lock?.pid) || lock.pid < 1 || !Number.isSafeInteger(observed?.now))
    throw Error('Missing owner/time observation');
  if (
    lock?.command !== 'owned-next-branch' ||
    lock.token !== binding?.token ||
    journal?.token !== binding.token ||
    journal.status !== 'completed' ||
    binding.released ||
    journal.to !== binding.branch ||
    observed.branch !== binding.branch ||
    observed.head !== journal.head ||
    observed.process !== 'absent' ||
    !Number.isFinite(Date.parse(lock.startedAt)) ||
    observed.now - Date.parse(lock.startedAt) < 30000
  )
    throw Error('Unproven branch-operation orphan; preserve lock');
  return true;
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'plan', ...extra] = args;
  if (!['plan', 'apply'].includes(mode) || extra.length) throw Error('branch-recovery plan|apply');
  const root = findRoot();
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, readJSON(inside(root, '.gameprod/project.json')));
  await guardWorktree(root, 'recover-branch', []);
  const target = inside(root, '.gameprod/evidence/ops.lock');
  if (!fs.existsSync(target)) {
    console.log('BRANCH_RECOVERY_NOT_NEEDED');
    return;
  }
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (r.status !== 0) throw Error('Unknown source identity');
    return r.stdout.trim();
  };
  const read = () => {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('Unsafe lock');
    const bytes = fs.readFileSync(target);
    return { stat, bytes, lock: JSON.parse(bytes.toString('utf8')) };
  };
  const binding = readJSON(inside(root, '.gameprod/agent.local.json')),
    journal = readJSON(inside(root, '.gameprod/evidence/branch-transition.json'));
  const check = (row) =>
    provenBranchOrphan(row.lock, binding, journal, {
      branch: git('branch', '--show-current'),
      head: git('rev-parse', 'HEAD'),
      process: processState(row.lock.pid),
      now: Date.now()
    });
  const row = read();
  check(row);
  if (mode === 'plan') {
    console.log(
      JSON.stringify({
        status: 'proven_orphan',
        pid: row.lock.pid,
        sha256: sha(row.bytes),
        branch: binding.branch
      })
    );
    return;
  }
  const release = acquireOperation(inside(root, '.gameprod/evidence/branch-recovery.lock'), {
    command: 'completed-branch-orphan'
  });
  try {
    const archive = inside(root, '.gameprod/evidence/branch-recovery/' + randomUUID());
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(path.join(archive, 'lock-before.json'), row.bytes, { flag: 'wx' });
    if (sha(fs.readFileSync(path.join(archive, 'lock-before.json'))) !== sha(row.bytes))
      throw Error('Archive mismatch');
    const current = read();
    if (
      sha(current.bytes) !== sha(row.bytes) ||
      current.stat.ino !== row.stat.ino ||
      current.stat.dev !== row.stat.dev
    )
      throw Error('Lock changed');
    check(current);
    fs.renameSync(target, path.join(archive, 'orphan.lock'));
    if (sha(fs.readFileSync(path.join(archive, 'orphan.lock'))) !== sha(row.bytes))
      throw Error('Moved lock identity mismatch');
    const result = {
      status: 'recovered',
      branch: binding.branch,
      ownerAbsent: true,
      oldLockHash: sha(row.bytes),
      sourceAndPhoneDataRemoved: false
    };
    writeJSON(path.join(archive, 'receipt.json'), result);
    console.log(JSON.stringify(result));
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('BRANCH_RECOVERY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
