import fs from 'node:fs';
import path from 'node:path';
const ROOT_KEY = 'MULTIMENTAL_WORKFLOW_ROOT',
  TOKEN_KEY = 'MULTIMENTAL_WORKFLOW_TOKEN',
  PID_KEY = 'MULTIMENTAL_WORKFLOW_PID';
const normalize = (value) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
export function workflowChildEnvironment(root, lock, env = process.env, ownerPid = process.pid) {
  if (
    lock?.command !== 'ship' ||
    lock.repository !== 'neurofoxpro/multimental' ||
    lock.pid !== ownerPid ||
    !/^[a-f0-9]{32}$/.test(lock.token || '')
  )
    throw Error('WORKFLOW_LEASE_NOT_OWNED');
  return {
    ...env,
    [ROOT_KEY]: normalize(root),
    [TOKEN_KEY]: lock.token,
    [PID_KEY]: String(lock.pid)
  };
}
export function assertWorkflowPermit(
  lock,
  root,
  env = process.env,
  alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
) {
  if (!lock) return true;
  if (
    lock.command !== 'ship' ||
    lock.repository !== 'neurofoxpro/multimental' ||
    !Number.isSafeInteger(lock.pid) ||
    lock.pid < 1 ||
    !/^[a-f0-9]{32}$/.test(lock.token || '')
  )
    throw Error('WORKFLOW_LEASE_INVALID');
  if (
    typeof env[ROOT_KEY] !== 'string' ||
    normalize(env[ROOT_KEY]) !== normalize(root) ||
    env[TOKEN_KEY] !== lock.token ||
    env[PID_KEY] !== String(lock.pid)
  )
    throw Error('WORKFLOW_WRITER_ACTIVE');
  if (alive(lock.pid) !== true) throw Error('WORKFLOW_OWNER_NOT_LIVE');
  return true;
}
export function assertSourceWorkflow(root, env = process.env) {
  const file = path.join(root, '.gameprod/evidence/short-workflow.lock');
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
      throw Error('WORKFLOW_LEASE_INVALID');
    assertWorkflowPermit(JSON.parse(fs.readFileSync(file, 'utf8')), root, env);
  }
  const accepting = path.join(root, '.gameprod/evidence/task-accept.lock');
  if (fs.existsSync(accepting)) throw Error('ACCEPT_WRITER_ACTIVE');
  return true;
}
