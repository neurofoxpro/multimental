import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { options, dispatchPlan, selectDispatch } from './dispatch-policy.mjs';
import { findRoot, inside, readJSON, writeJSON, context, normalizeRepo } from './lib.mjs';
import { HubClient } from './hub-client.mjs';
import { memorySnapshot } from './issue-memory.mjs';
import { GitHubCoordination } from './collaboration-store.mjs';
import { acquireOperation } from './operation-lock.mjs';
export async function main(args = process.argv.slice(2)) {
  const opt = options(args),
    root = findRoot();
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, readJSON(inside(root, '.gameprod/project.json')));
  const run = (exe, argv, timeout = 30000) => {
    const r = spawnSync(exe, argv, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 2000000
    });
    if (r.error || r.status !== 0) throw Error('Dispatch child failed: ' + exe + ' ' + argv[0]);
    return r.stdout.trim();
  };
  if (normalizeRepo(run('git', ['remote', 'get-url', 'origin'])) !== 'neurofoxpro/multimental')
    throw Error('Wrong origin');
  if (opt.mode !== 'plan' && process.env.GITHUB_ACTIONS === 'true')
    throw Error('Personal station only');
  if (opt.mode === 'enroll') {
    (await import('../../../tools/enroll-tasks.mjs')).main([opt.file]);
    await (await import('./flow.mjs')).main(['sync']);
    console.log('DISPATCH_ENROLLED; labels/dependencies refresh through the dev-push projection');
    return;
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || run('gh', ['auth', 'token']);
  const client = new HubClient(token),
    store = new GitHubCoordination(token);
  const snapshot = await memorySnapshot(client, readJSON(inside(root, '.gameprod/workplan.json')));
  const coord = await store.read();
  if (!coord?.state) throw Error('Live coordinator missing');
  const claims = Object.values(coord.state.claims);
  const plan = dispatchPlan(
    snapshot,
    claims,
    readJSON(inside(root, '.gameprod/collaboration.json')),
    opt.tags
  );
  const out = { ...plan, observedAt: new Date().toISOString(), coordinationHead: coord.head };
  writeJSON(inside(root, '.gameprod/evidence/dispatch-plan.json'), out);
  if (opt.mode === 'plan') {
    console.log(
      JSON.stringify(
        {
          ...out,
          held: out.held.map((t) => ({ id: t.id, blockedBy: t.blockedBy })),
          detail: '.gameprod/evidence/dispatch-plan.json'
        },
        null,
        2
      )
    );
    return;
  }
  const checkpoint = inside(root, '.gameprod/evidence/dispatch-' + opt.alias + '.json');
  const prior = fs.existsSync(checkpoint) ? readJSON(checkpoint) : null;
  if (prior && JSON.stringify(prior.tags) !== JSON.stringify(opt.tags))
    throw Error('Cannot change tags on an existing dispatch');
  const bindingFile = inside(root, '.gameprod/agent.local.json');
  const task = selectDispatch(
    plan,
    opt.alias,
    prior,
    claims,
    fs.existsSync(bindingFile) ? readJSON(bindingFile) : null
  );
  if (!task) {
    console.log(JSON.stringify({ status: 'no_ready_task', held: plan.held, agentsStarted: false }));
    return;
  }
  const release = acquireOperation(inside(root, '.gameprod/evidence/dispatch-start.lock'), {
    command: 'dispatch',
    alias: opt.alias
  });
  try {
    const receipt = {
      schemaVersion: 1,
      alias: opt.alias,
      task,
      tags: opt.tags,
      status: 'starting',
      selectedAt: prior?.selectedAt || out.observedAt
    };
    writeJSON(checkpoint, receipt);
    await (await import('./collaboration.mjs')).main(['start', task, opt.alias]);
    const directory = inside(path.dirname(root), 'slice-' + opt.alias);
    const binding = readJSON(inside(directory, '.gameprod/agent.local.json'));
    if (binding.task !== task || binding.owner !== opt.alias || binding.released)
      throw Error('Dispatch readback mismatch');
    writeJSON(checkpoint, { ...receipt, status: 'ready', directory, token: binding.token });
    console.log(
      JSON.stringify(
        {
          status: 'task_claimed',
          task,
          directory,
          next: [
            'focus',
            ...(fs.existsSync(inside(directory, '.gameprod/studies/' + task + '.json'))
              ? ['study packet ' + task]
              : []),
            'apply BUNDLE.json',
            'ship'
          ],
          agentsStarted: false
        },
        null,
        2
      )
    );
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('DISPATCH_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
