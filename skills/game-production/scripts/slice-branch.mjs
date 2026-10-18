import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inside, readJSON, writeJSON, fingerprint } from './lib.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { assertOwnership } from './collaboration-policy.mjs';
export function nextBranch(binding, suffix) {
  if (
    !/^[a-z][a-z0-9-]{2,30}$/.test(suffix || '') ||
    !/^[A-Z]+-\d+$/.test(binding?.task || '') ||
    !/^[a-f0-9-]{36}$/.test(binding.token || '') ||
    binding.released
  )
    throw Error('Invalid owned branch transition');
  return 'feature/' + binding.task.toLowerCase() + '-' + suffix + '-' + binding.token.slice(0, 8);
}
export async function continueBranch(root, store, suffix) {
  const file = inside(root, '.gameprod/agent.local.json'),
    binding = readJSON(file),
    newBranch = nextBranch(binding, suffix);
  const current = await store.read();
  if (!current?.state) throw Error('Missing coordinator');
  assertOwnership(current.state, binding);
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, shell: false, encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0 || r.error) throw Error('Branch transition failed: ' + args[0]);
    return r.stdout.trim();
  };
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'owned-next-branch',
    claimToken: binding.token
  });
  try {
    const record = inside(root, '.gameprod/evidence/branch-transition.json'),
      project = readJSON(inside(root, '.gameprod/project.json'));
    const actual = git('branch', '--show-current'),
      head = git('rev-parse', 'HEAD'),
      hash = fingerprint(root, project);
    if (actual === newBranch && binding.branch === newBranch)
      return { status: 'already_current', branch: newBranch, head };
    if (actual === binding.branch) {
      if (!/^(feature|fix|docs|test)\//.test(actual)) throw Error('Protected branch');
      writeJSON(record, {
        status: 'prepared',
        token: binding.token,
        from: actual,
        to: newBranch,
        head,
        sourceDigest: hash
      });
      git('switch', '-c', newBranch);
    } else {
      const previous = readJSON(record);
      if (
        actual !== newBranch ||
        previous.token !== binding.token ||
        previous.to !== newBranch ||
        previous.head !== head ||
        previous.sourceDigest !== hash
      )
        throw Error('Unrecognized partial branch transition');
    }
    if (git('rev-parse', 'HEAD') !== head || fingerprint(root, project) !== hash)
      throw Error('Source changed during branch transition; inspect journal');
    binding.branch = newBranch;
    writeJSON(file, binding);
    writeJSON(record, {
      status: 'completed',
      token: binding.token,
      to: newBranch,
      head,
      sourceDigest: hash
    });
    return { status: 'branch_ready', branch: newBranch, head, sourcePreserved: true };
  } finally {
    release();
  }
}
