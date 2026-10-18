import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, context, readJSON, writeJSON, inside, normalizeRepo } from './lib.mjs';
import { HubClient } from './hub-client.mjs';
import { memorySnapshot, upsertComment } from './issue-memory.mjs';
import { GitHubCoordination, coordinate } from './collaboration-store.mjs';
import { COORD_REPO, assertOwnership } from './collaboration-policy.mjs';
import { acquireOperation } from './operation-lock.mjs';
export function taskResources(task, config) {
  const resources = config.taskResources[task.id] || config.kindResources[task.kind];
  if (!Array.isArray(resources) || !resources.length)
    throw Error('Task needs explicit resource mapping');
  return [...resources];
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'status', ...values] = args;
  if (
    ![
      'init',
      'status',
      'claim',
      'renew',
      'release',
      'start',
      'check-owner',
      'branch',
      'refresh'
    ].includes(mode)
  )
    throw Error('collab init|status|claim TASK AGENT|start TASK AGENT|renew|release|check-owner');
  const root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  if (project.repository !== COORD_REPO || process.env.GITHUB_ACTIONS === 'true')
    throw Error('Use authorized station coordinator; cloud writes not enabled');
  const run = (exe, argv, cwd = root, timeout = 30000) => {
    const r = spawnSync(exe, argv, {
      cwd,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 6000000
    });
    if (r.error || r.status !== 0)
      throw Error('Coordinator command failed: ' + exe + ' ' + argv[0]);
    return r.stdout.trim();
  };
  if (normalizeRepo(run('git', ['remote', 'get-url', 'origin'])) !== COORD_REPO)
    throw Error('Wrong repository origin');
  if (!['4erk', 'venelsendrik'].includes(run('gh', ['api', 'user', '--jq', '.login'])))
    throw Error('Unexpected coordinator account');
  const token = run('gh', ['auth', 'token']),
    hub = new HubClient(token),
    store = new GitHubCoordination(token);
  const config = readJSON(inside(root, '.gameprod/collaboration.json'));
  const output = (result) => console.log(JSON.stringify(result, null, 2));
  if (mode === 'refresh') {
    if (values.length) throw Error('collab refresh uses the current owned slice');
    output(await (await import('./slice-refresh.mjs')).refreshSlice(root, store, hub));
    return;
  }
  if (mode === 'branch') {
    if (values.length !== 1) throw Error('collab branch SHORT_SUFFIX');
    output(await (await import('./slice-branch.mjs')).continueBranch(root, store, values[0]));
    return;
  }
  if (mode === 'init') {
    if (values.length) throw Error('init takes no args');
    const head = (await hub.api('GET', '/git/ref/heads/dev')).object.sha;
    const state = await store.initialize(head);
    output({
      status: 'initialized',
      head: state.head,
      claims: Object.keys(state.state.claims).length
    });
    return;
  }
  if (mode === 'status') {
    if (values.length) throw Error('status takes no args');
    const current = await store.read();
    output(
      current
        ? {
            head: current.head,
            revision: current.state.revision,
            claims: Object.values(current.state.claims).map((c) => ({
              ...c,
              heartbeatExpired: c.expiresAt < Date.now()
            })),
            automaticTakeover: false
          }
        : { status: 'not_initialized' }
    );
    return;
  }
  const bindingFile = inside(root, '.gameprod/agent.local.json');
  if (['check-owner', 'renew', 'release'].includes(mode)) {
    if (values.length) throw Error('Command uses exact current worktree binding');
    const binding = readJSON(bindingFile),
      current = await store.read();
    if (!current) throw Error('Missing coordinator');
    if (mode === 'check-owner') {
      output(assertOwnership(current.state, binding));
      return;
    }
    const id = mode === 'release' ? binding.releaseOperation : randomUUID();
    const result = await coordinate(store, {
      id,
      kind: mode,
      owner: binding.owner,
      token: binding.token,
      fence: binding.fence
    });
    if (mode === 'release') {
      binding.released = true;
      writeJSON(bindingFile, binding);
    }
    output(result);
    return;
  }
  if (
    values.length !== 2 ||
    !/^[A-Z]+-\d+$/.test(values[0]) ||
    !/^[a-z][a-z0-9-]{2,47}$/.test(values[1])
  )
    throw Error('Expected task ID and unique chat alias');
  const [taskId, owner] = values;
  if (mode === 'claim') {
    if (!/^(feature|fix|docs|test)\//.test(run('git', ['branch', '--show-current'])))
      throw Error('Claim requires a feature worktree');
    if (fs.existsSync(bindingFile)) {
      const old = readJSON(bindingFile);
      if (!old.released && (old.owner !== owner || old.task !== taskId))
        throw Error('Current worktree has another active binding');
    }
  }
  if (mode === 'start') {
    const existing = inside(workspace, 'slice-' + owner);
    if (fs.existsSync(existing)) {
      if (
        run('git', ['branch', '--show-current'], existing) !==
        'feature/' + taskId.toLowerCase() + '-' + owner
      )
        throw Error('Existing slice belongs to another task');
      const binding = inside(existing, '.gameprod/agent.local.json');
      if (fs.existsSync(binding)) {
        const old = readJSON(binding);
        if (old.released)
          throw Error('Released slice is preserved as history; choose a new chat alias');
        if (!old.released && (old.owner !== owner || old.task !== taskId))
          throw Error('Existing slice binding differs');
      }
    }
  }
  const snapshot = await memorySnapshot(hub, readJSON(inside(root, '.gameprod/workplan.json')));
  if (snapshot.source !== 'github-issues' || snapshot.missing.length)
    throw Error('Complete Issue memory required');
  const row = snapshot.records.find((r) => r.task.id === taskId);
  if (!row) throw Error('Task missing from Issues');
  const blocked = row.task.dependsOn.filter(
    (id) => snapshot.plan.tasks.find((t) => t.id === id)?.status !== 'verified'
  );
  if (row.task.status === 'verified' || blocked.length)
    throw Error('Task done or prerequisites incomplete: ' + blocked.join(','));
  const head = (await hub.api('GET', '/git/ref/heads/dev')).object.sha;
  let current = await store.read();
  if (!current) throw Error('Run collab init first');
  let claim = Object.values(current.state.claims).find(
    (c) => c.task === taskId && c.owner === owner
  );
  const resources = taskResources(row.task, config);
  if (
    claim &&
    JSON.stringify(claim.resources) !== JSON.stringify(['task:' + taskId, ...resources].sort())
  )
    throw Error('Existing claim scope differs');
  const journal = inside(root, '.gameprod/evidence/collab-start-' + owner + '.json');
  if (!claim) {
    let request = { id: randomUUID(), kind: 'claim', task: taskId, owner, base: head, resources };
    if (fs.existsSync(journal)) {
      const old = readJSON(journal);
      if (old.request?.task === taskId && old.request?.owner === owner && !old.finished)
        request = old.request;
    }
    writeJSON(journal, { request, finished: false });
    claim = await coordinate(store, request);
  }
  current = await store.read();
  assertOwnership(current.state, claim);
  let target = root,
    branch = run('git', ['branch', '--show-current']);
  if (mode === 'start') {
    target = inside(workspace, 'slice-' + owner);
    branch = 'feature/' + taskId.toLowerCase() + '-' + owner;
    const unlock = acquireOperation(inside(workspace, 'collaboration-worktrees.lock'), {
      command: 'start-slice',
      owner
    });
    try {
      if (!fs.existsSync(target)) {
        run('git', ['fetch', 'origin', 'dev']);
        run('git', ['worktree', 'add', '-b', branch, target, claim.base]);
      }
      if (
        run('git', ['branch', '--show-current'], target) !== branch ||
        normalizeRepo(run('git', ['remote', 'get-url', 'origin'], target)) !== COORD_REPO
      )
        throw Error('Existing worktree is not the requested slice');
      const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      if (!fs.existsSync(path.join(target, 'node_modules/prettier/package.json'))) {
        if (!fs.existsSync(npmCli))
          throw Error('Pinned Node installation lacks npm CLI; worktree preserved');
        run(
          process.execPath,
          [npmCli, 'ci', '--ignore-scripts', '--no-fund', '--no-audit'],
          target,
          180000
        );
      }
      if (process.platform === 'win32') {
        const engineDir = inside(workspace, 'tools/godot');
        const consoleName = fs.readdirSync(engineDir).find((name) => /console\.exe$/i.test(name));
        if (!consoleName) throw Error('Pinned Godot not found; slice preserved');
        const { verificationRuntime } = await import('../../../tools/godot-runtime.mjs');
        const { prepareGodotProject } = await import('../../../tools/godot-preflight.mjs');
        const engine = verificationRuntime(target, path.join(engineDir, consoleName));
        prepareGodotProject(target, engine);
      }
    } finally {
      unlock();
    }
  }
  const local = inside(target, '.gameprod/agent.local.json');
  if (fs.existsSync(local)) {
    const previous = readJSON(local);
    if (previous.token !== claim.token && !previous.released)
      throw Error('Worktree already belongs to another claim');
  }
  const binding = {
    ...claim,
    branch,
    issue: row.issue,
    releaseOperation:
      fs.existsSync(local) && readJSON(local).token === claim.token
        ? readJSON(local).releaseOperation
        : randomUUID(),
    released: false
  };
  writeJSON(local, binding);
  writeJSON(journal, { request: null, finished: true, token: claim.token, target, branch });
  await upsertComment(
    hub,
    row.issue,
    'claim-' + claim.token,
    '## Работа взята в отдельный срез\n\nЧат: `' +
      owner +
      '`; ветка: `' +
      branch +
      '`; исходный dev: `' +
      claim.base +
      '`.\n\nРесурсы: ' +
      claim.resources.join(', ') +
      '. Fence: ' +
      claim.fence +
      '.\n\nЭто владение задачей, не завершение работы. Метки не являются блокировкой; состояние в coordination-state проверяется перед записью.'
  );
  output({
    status: mode === 'start' ? 'worktree_ready' : 'claimed',
    task: taskId,
    issue: row.issue,
    owner,
    branch,
    directory: target,
    token: claim.token,
    fence: claim.fence,
    commands: {
      resume: 'npm run game -- resume',
      verifyOwnership: 'npm run game -- collab check-owner',
      renew: 'npm run game -- collab renew',
      release: 'npm run game -- collab release'
    },
    manualApprovalRequired: false
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error('COLLAB_BLOCKED: ' + error.message);
    process.exitCode = 1;
  });
