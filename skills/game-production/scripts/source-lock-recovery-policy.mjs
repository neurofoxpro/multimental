const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[a-f0-9]{32}$/;
const COMMANDS = {
  'worktree:short-workflow.lock': ['ship'],
  'worktree:task-accept.lock': ['accept'],
  'worktree:manual-review.lock': ['review'],
  'station:manual-review.lock': ['manual-release-packet'],
  'worktree:lab.lock': ['lab'],
  'station:lab-session.lock': ['lab'],
  'workspace:collaboration-worktrees.lock': ['start-slice'],
  'workspace:collaboration-dev-integration.lock': [
    'settle',
    'explicit-interrupted-continuation',
    'completed-slice-recovery'
  ],
  'worktree:branch-recovery.lock': ['completed-branch-orphan'],
  'worktree:completed-recovery.lock': ['completed-slice-recovery'],
  'worktree:dispatch-start.lock': ['dispatch'],
  'worktree:ops.lock': [
    'begin',
    'apply',
    'verify',
    'audit',
    'prepare-sources',
    'prepare',
    'probe-bluetooth',
    'publish',
    'stage',
    'wait',
    'integrate',
    'wait-dev',
    'cycle',
    'profile-test',
    'network',
    'qualify',
    'bluetooth-pairing',
    'bluetooth-room',
    'device-pvp',
    'device-suite',
    'device-test',
    'delivery',
    'emulator',
    'candidate',
    'report',
    'resume-cycle',
    'record',
    'deploy-agent',
    'format',
    'changelog',
    'handoff',
    'readiness',
    'research',
    'balance-run',
    'branches-plan',
    'branches-apply',
    'lab',
    'launcher-verify',
    'launcher-ensure',
    'refresh-owned-slice',
    'content-build',
    'content-add',
    'content-trial',
    'manual-review-publication',
    'control-metadata',
    'experiment',
    'gallery-capture',
    'gallery-promote',
    'study-run',
    'study-record',
    'owned-next-branch',
    'explicit-interrupted-continuation',
    'completed-slice-recovery',
    'device-recover'
  ]
};
const BARRIER = 'production-source-recovery-barrier';
export const LOCK_COMMANDS = COMMANDS;
export function processState(pid, probe = process.kill) {
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unknown';
  try {
    probe(pid, 0);
    return 'alive';
  } catch (e) {
    return e?.code === 'ESRCH' ? 'absent' : 'unknown';
  }
}
function validTime(value, now, graceMs) {
  const started = Date.parse(value?.startedAt || '');
  return Number.isFinite(started) && Number.isFinite(now) && now - started >= graceMs;
}
export function validateRow(
  row,
  { now, state = processState, graceMs = 30000, allowBarrier = true } = {}
) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('SOURCE_RECOVERY_ROW');
  if (!Object.hasOwn(COMMANDS, row.id)) throw Error('SOURCE_RECOVERY_UNKNOWN_LOCK');
  if (
    !HASH.test(row.sha256 || '') ||
    typeof row.inode !== 'string' ||
    !row.inode ||
    typeof row.device !== 'string' ||
    !row.device
  )
    throw Error('SOURCE_RECOVERY_IDENTITY');
  const v = row.value;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    !Number.isSafeInteger(v.pid) ||
    v.pid < 1 ||
    !TOKEN.test(v.token || '')
  )
    throw Error('SOURCE_RECOVERY_OWNER');
  const allowed = COMMANDS[row.id];
  const barrier = allowBarrier && v.command === BARRIER;
  if (!barrier && !allowed.includes(v.command)) throw Error('SOURCE_RECOVERY_COMMAND');
  if (!validTime(v, now, graceMs)) throw Error('SOURCE_RECOVERY_FRESH_OR_BAD_TIME');
  if (state(v.pid) !== 'absent') throw Error('SOURCE_RECOVERY_OWNER_LIVE_OR_UNKNOWN');
  return { ...row, barrier };
}
export function planRecovery(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length > 32) throw Error('SOURCE_RECOVERY_INVENTORY');
  const seen = new Set(),
    validated = [];
  for (const row of rows) {
    if (seen.has(row.id)) throw Error('SOURCE_RECOVERY_DUPLICATE');
    seen.add(row.id);
    validated.push(validateRow(row, options));
  }
  return validated.sort((a, b) => a.id.localeCompare(b.id));
}
export function assertSameRow(expected, actual) {
  if (
    !expected ||
    !actual ||
    expected.id !== actual.id ||
    expected.sha256 !== actual.sha256 ||
    expected.inode !== actual.inode ||
    expected.device !== actual.device ||
    expected.value?.pid !== actual.value?.pid ||
    expected.value?.token !== actual.value?.token ||
    expected.value?.command !== actual.value?.command ||
    expected.value?.startedAt !== actual.value?.startedAt
  )
    throw Error('SOURCE_RECOVERY_LOCK_CHANGED');
  return true;
}
export function barrierDetails() {
  return { command: BARRIER };
}
