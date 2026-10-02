import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
const sha = (b) => createHash('sha256').update(b).digest('hex');
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4096)
    throw Error('RECOVERY_BARRIER_UNSAFE');
  const bytes = fs.readFileSync(file);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw Error('RECOVERY_BARRIER_MALFORMED');
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
function lease(file, details) {
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
    value,
    release() {
      const actual = read(file);
      if (actual.value.pid !== process.pid || actual.value.token !== token)
        throw Error('RECOVERY_BARRIER_CHANGED');
      fs.unlinkSync(file);
    }
  };
}
export function inspectRecoverableBarrier(
  file,
  { command, now = Date.now, state, graceMs = 30000 } = {}
) {
  if (typeof command !== 'string' || !command || typeof state !== 'function')
    throw Error('RECOVERY_BARRIER_INPUT');
  let row;
  try {
    row = read(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const v = row.value,
    started = Date.parse(v?.startedAt || '');
  if (
    v?.command !== command ||
    !Number.isSafeInteger(v.pid) ||
    v.pid < 1 ||
    !/^[a-f0-9]{32}$/.test(v.token || '') ||
    !Number.isFinite(started) ||
    now() - started < graceMs ||
    state(v.pid) !== 'absent'
  )
    throw Error('RECOVERY_BARRIER_LIVE_OR_UNKNOWN');
  return row;
}
export function acquireRecoverableBarrier(
  file,
  { command, archiveRoot, now = Date.now, state, graceMs = 30000 } = {}
) {
  if (!path.isAbsolute(file) || !path.isAbsolute(archiveRoot)) throw Error('RECOVERY_BARRIER_PATH');
  try {
    return { lease: lease(file, { command }), recovered: null };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const a = inspectRecoverableBarrier(file, { command, now, state, graceMs }),
      b = inspectRecoverableBarrier(file, { command, now, state, graceMs });
    if (!a || !b || a.sha256 !== b.sha256 || a.inode !== b.inode || a.device !== b.device)
      throw Error('RECOVERY_BARRIER_RACE');
    fs.mkdirSync(archiveRoot, { recursive: true });
    const moved = path.join(archiveRoot, 'barrier-' + crypto.randomUUID() + '.orphan.json');
    fs.renameSync(file, moved);
    if (sha(fs.readFileSync(moved)) !== a.sha256) throw Error('RECOVERY_BARRIER_ARCHIVE_CHANGED');
    return { lease: lease(file, { command }), recovered: { sha256: a.sha256, archived: moved } };
  }
}
