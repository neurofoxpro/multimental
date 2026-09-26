import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inside, readJSON } from './lib.mjs';
import { assertOwnership } from './collaboration-policy.mjs';
import { GitHubCoordination } from './collaboration-store.mjs';
export function requiresOwnership(entry, args = []) {
  if (
    [
      'collab',
      'resume',
      'next',
      'task',
      'focus',
      'help',
      'inspect',
      'roadmap',
      'validate',
      'closeout',
      'device-status',
      'play-check'
    ].includes(entry)
  )
    return false;
  if (entry === 'github' && ['resume', 'task', 'doctor', 'offline'].includes(args[0])) return false;
  return true;
}
export function validateBinding(state, binding, branch) {
  if (binding.released || !/^(feature|fix|docs|test)\//.test(branch) || binding.branch !== branch)
    throw Error('Inactive or mismatched worktree binding');
  return assertOwnership(state, binding);
}
export async function guardWorktree(root, entry, args) {
  const file = inside(root, '.gameprod/agent.local.json');
  if (!fs.existsSync(file) || !requiresOwnership(entry, args)) return;
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const run = (exe, argv) => {
    const r = spawnSync(exe, argv, { cwd: root, shell: false, encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0 || r.error) throw Error('Cannot verify worktree ownership');
    return r.stdout.trim();
  };
  const binding = readJSON(file);
  const store = new GitHubCoordination(
    process.env.GH_TOKEN || process.env.GITHUB_TOKEN || run('gh', ['auth', 'token'])
  );
  const current = await store.read();
  if (!current?.state) throw Error('Coordination unavailable; writes blocked');
  validateBinding(current.state, binding, run('git', ['branch', '--show-current']));
}
