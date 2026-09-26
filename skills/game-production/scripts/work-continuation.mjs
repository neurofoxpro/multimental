import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findRoot,
  context,
  readJSON,
  writeJSON,
  inside,
  sha,
  fingerprint,
  normalizeRepo,
  gate
} from './lib.mjs';
import { HubClient } from './hub-client.mjs';
import { GitHubCoordination, coordinate } from './collaboration-store.mjs';
import { assertOwnership, digest } from './collaboration-policy.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { memorySnapshot, upsertComment } from './issue-memory.mjs';
import { continueInterrupted, continuationDigest } from './work-continuation-policy.mjs';
const REPO = 'neurofoxpro/multimental';
const canonical = (p) =>
  process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
function json(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 524288)
    throw Error('CONTINUATION_BAD_METADATA');
  return readJSON(file);
}
export async function main(args = process.argv.slice(2)) {
  const [task, nextOwner, flag, ...extra] = args;
  if (
    !/^[A-Z]+-\d+$/.test(task || '') ||
    !/^[a-z][a-z0-9-]{2,47}$/.test(nextOwner || '') ||
    extra.length ||
    (flag !== undefined && flag !== '--apply')
  )
    throw Error('collab continue-interrupted TASK NEW_ALIAS [--apply]');
  const apply = flag === '--apply',
    root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const project = json(inside(root, '.gameprod/project.json'));
  context(root, project);
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('CONTINUATION_STATION_ONLY');
  const cmd = (cwd, args, optional = false) => {
    const r = spawnSync('git', args, {
      cwd,
      shell: false,
      encoding: 'utf8',
      timeout: 25000,
      maxBuffer: 2000000
    });
    if (!optional && (r.error || r.status !== 0)) throw Error('CONTINUATION_GIT_' + args[0]);
    return optional ? r : (r.stdout || '').trim();
  };
  if (normalizeRepo(cmd(root, ['remote', 'get-url', 'origin'])) !== REPO)
    throw Error('CONTINUATION_WRONG_ORIGIN');
  const bindingPath = inside(root, '.gameprod/agent.local.json'),
    binding = json(bindingPath);
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    (() => {
      const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 });
      if (r.error || r.status !== 0) throw Error('CONTINUATION_AUTH');
      return r.stdout.trim();
    })();
  const client = new HubClient(token),
    store = new GitHubCoordination(token);
  const snapshot = await memorySnapshot(client, json(inside(root, '.gameprod/workplan.json')));
  if (snapshot.source !== 'github-issues' || snapshot.missing.length)
    throw Error('CONTINUATION_LIVE_MEMORY_REQUIRED');
  const targetTask = snapshot.records.find((r) => r.task.id === task),
    actorTask = snapshot.records.find((r) => r.task.id === binding.task);
  if (!targetTask || !actorTask) throw Error('CONTINUATION_PRIMARY_TASK_MISSING');
  const folder = inside(root, '.gameprod/evidence/continuations');
  fs.mkdirSync(folder, { recursive: true });
  const journal = path.join(folder, task + '-' + nextOwner + '.json');
  const owned = new Map();
  function tree(claim) {
    const rows = cmd(root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
    if (rows.length > 64) throw Error('CONTINUATION_WORKTREE_LIMIT');
    const matches = [];
    for (const row of rows) {
      const location = /^worktree (.+)$/m.exec(row)?.[1]?.trim();
      if (
        !location ||
        canonical(path.dirname(location)) !== canonical(workspace) ||
        !path.basename(location).startsWith('slice-')
      )
        continue;
      if (canonical(fs.realpathSync(location)) !== canonical(location))
        throw Error('CONTINUATION_SYMLINK_WORKTREE');
      const file = path.join(location, '.gameprod/agent.local.json');
      if (!fs.existsSync(file)) continue;
      const b = json(file);
      if (b.token === claim.token && b.owner === claim.owner && b.task === task) {
        if (row.includes('\nlocked') || row.includes('\nprunable'))
          throw Error('CONTINUATION_LOCKED_GIT_WORKTREE');
        matches.push({
          location,
          file,
          registeredHead: /^HEAD ([a-f0-9]{40})$/m.exec(row)?.[1],
          registeredBranch: /^branch refs\/heads\/(.+)$/m.exec(row)?.[1]?.trim()
        });
      }
    }
    if (matches.length !== 1 || canonical(matches[0].location) === canonical(root))
      throw Error('CONTINUATION_UNIQUE_OTHER_SLICE_REQUIRED');
    return matches[0];
  }
  function source(t) {
    const b = json(t.file),
      p = json(path.join(t.location, '.gameprod/project.json'));
    if (p.repository !== REPO) throw Error('CONTINUATION_WRONG_PROJECT');
    return {
      head: cmd(t.location, ['rev-parse', 'HEAD']),
      branch: cmd(t.location, ['branch', '--show-current']),
      clean: !cmd(t.location, ['status', '--porcelain', '--untracked-files=all']),
      sourceDigest: fingerprint(t.location, p),
      bindingDigest: sha(fs.readFileSync(t.file)),
      binding: b,
      remote: normalizeRepo(cmd(t.location, ['remote', 'get-url', 'origin']))
    };
  }
  function pending(location) {
    const evidence = path.join(location, '.gameprod/evidence');
    const paths = [
      ...fs
        .readdirSync(evidence)
        .filter((n) => n.endsWith('.lock'))
        .map((n) => path.join(evidence, n)),
      path.join(workspace, 'collaboration-dev-integration.lock'),
      path.join(workspace, 'collaboration-worktrees.lock')
    ];
    return [...new Set(paths)].filter(
      (p) => fs.existsSync(p) && owned.get(canonical(p)) !== sha(fs.readFileSync(p))
    ).length;
  }
  const result = await continueInterrupted(
    {
      now: Date.now,
      load: async () => (fs.existsSync(journal) ? json(journal) : null),
      save: async (value) => {
        writeJSON(journal, value);
        writeJSON(path.join(folder, value.request.id + '.json'), value);
      },
      reconcile: async (request) => {
        const state = await store.read(),
          event = state?.state?.events.find((e) => e.id === request.id);
        if (!event) return null;
        if (event.hash !== digest(request)) throw Error('CONTINUATION_OPERATION_ID_CONFLICT');
        return event.result;
      },
      observe: async () => {
        const current = await store.read();
        if (!current?.state) throw Error('CONTINUATION_COORDINATOR_MISSING');
        const actor = assertOwnership(current.state, binding),
          claims = Object.values(current.state.claims).filter((c) => c.task === task);
        if (claims.length !== 1 || claims[0].token === actor.token)
          throw Error('CONTINUATION_TARGET_NOT_UNIQUE');
        const claim = claims[0],
          t = tree(claim),
          s = source(t),
          head = cmd(root, ['rev-parse', 'HEAD']);
        const dev = (await client.api('GET', '/git/ref/heads/dev')).object.sha;
        cmd(root, ['fetch', 'origin', 'dev']);
        const operatorSourceReleased =
          !cmd(root, ['status', '--porcelain']) &&
          gate(root, project, 'verified').ok &&
          cmd(root, ['merge-base', '--is-ancestor', head, dev], true).status === 0;
        const pulls = await client.list(
          '/pulls?state=open&base=dev&head=' + encodeURIComponent('neurofoxpro:' + s.branch)
        );
        if (pulls.length !== 1) throw Error('CONTINUATION_EXACT_OPEN_PR_REQUIRED');
        const pr = await client.api('GET', '/pulls/' + pulls[0].number),
          remote = (await client.api('GET', '/git/ref/heads/' + s.branch)).object.sha;
        const runs = await client.list(
          '/actions/runs?branch=' + encodeURIComponent(s.branch),
          'workflow_runs'
        );
        const reviews = await client.list('/pulls/' + pr.number + '/reviews'),
          latest = new Map();
        for (const r of reviews.sort((a, b) => a.id - b.id))
          if (!['COMMENTED', 'PENDING'].includes(r.state)) latest.set(r.user?.login, r.state);
        const active = runs.filter((r) => r.status !== 'completed'),
          locks = pending(t.location);
        const guard = fs.readFileSync(
          path.join(t.location, 'skills/game-production/scripts/collaboration-guard.mjs'),
          'utf8'
        );
        const targetIssue = await client.api('GET', '/issues/' + targetTask.issue);
        const proof = {
          schemaVersion: 1,
          repository: REPO,
          task,
          claimDigest: continuationDigest(claim),
          observedAt: Date.now(),
          head: s.head,
          branch: s.branch,
          dev,
          pr: pr.number,
          sourceDigest: s.sourceDigest,
          bindingDigest: s.bindingDigest,
          registeredWorktree: t.registeredHead === s.head && t.registeredBranch === s.branch,
          canonicalRemote: s.remote === REPO,
          bindingMatches:
            s.binding.token === claim.token &&
            s.binding.owner === claim.owner &&
            s.binding.fence === claim.fence &&
            s.binding.branch === s.branch &&
            !s.binding.released,
          cleanWorktree: s.clean,
          openExactPull: pr.state === 'open' && !pr.merged && pr.head?.sha === s.head,
          canonicalDevPull:
            pr.base?.ref === 'dev' &&
            pr.base?.repo?.full_name === REPO &&
            pr.head?.repo?.full_name === REPO,
          remoteBranchUnchanged: remote === s.head,
          allRunsComplete: active.length === 0,
          allWritersIdle: locks === 0,
          operatorSourceReleased,
          oldGuardChecksCurrentOwnership:
            guard.includes('assertOwnership(') && guard.includes('await store.read('),
          taskStillOpen: targetIssue.state === 'open' && targetTask.task.status !== 'verified',
          openPullRequests: pulls.length,
          activeRuns: active.length,
          pendingLocks: locks,
          requestedChanges: [...latest.values()].filter((s) => s === 'CHANGES_REQUESTED').length,
          draft: pr.draft
        };
        return { proof, claim, actor, tree: t };
      },
      reserve: async (first) => {
        const releases = [];
        try {
          for (const p of [
            inside(root, '.gameprod/evidence/ops.lock'),
            path.join(first.tree.location, '.gameprod/evidence/ops.lock'),
            path.join(workspace, 'collaboration-dev-integration.lock')
          ]) {
            const release = acquireOperation(p, {
              command: 'explicit-interrupted-continuation',
              task,
              nextOwner
            });
            releases.push(release);
            owned.set(canonical(p), sha(fs.readFileSync(p)));
          }
          return () => {
            for (const release of releases.reverse()) release();
            owned.clear();
          };
        } catch (e) {
          for (const release of releases.reverse()) release();
          owned.clear();
          throw e;
        }
      },
      request: async (fresh) => ({
        id: randomUUID(),
        kind: 'continue_interrupted',
        owner: binding.owner,
        actorToken: binding.token,
        actorFence: binding.fence,
        token: fresh.claim.token,
        fence: fresh.claim.fence,
        claimDigest: continuationDigest(fresh.claim),
        proof: fresh.proof,
        proofDigest: continuationDigest(fresh.proof),
        nextOwner,
        base: fresh.proof.dev,
        intent: 'owner-requested-project-continuation'
      }),
      submit: (request) => coordinate(store, request, { attempts: 1 }),
      preserved: async (fresh) => {
        const after = source(fresh.tree);
        if (
          after.head !== fresh.proof.head ||
          !after.clean ||
          after.sourceDigest !== fresh.proof.sourceDigest ||
          after.bindingDigest !== fresh.proof.bindingDigest
        )
          throw Error('CONTINUATION_OLD_SOURCE_CHANGED');
      },
      finish: async (done) => {
        const current = await store.read();
        assertOwnership(current.state, done.result);
        const onDisk = json(bindingPath);
        if (onDisk.token !== done.request.actorToken || onDisk.fence !== done.request.actorFence)
          throw Error('CONTINUATION_ACTOR_BINDING_CHANGED');
        if (!onDisk.released)
          writeJSON(bindingPath, { ...onDisk, released: true, continuedBy: nextOwner });
        const text =
          '## Явное продолжение прерванного среза по поручению владельца\n\n' +
          JSON.stringify(
            {
              task,
              from: done.result.previousOwner,
              nextOwner,
              preservedHead: done.proof.head,
              preservedPr: done.proof.pr,
              newBase: done.proof.dev,
              sourceWritesToOldTree: 0,
              phoneChanges: 0,
              oldClaimRevoked: true,
              operatorTaskReleasedNotAccepted: binding.task,
              result: done.result,
              limits:
                'No timer takeover. Exact source, no writers, fresh CAS and explicit continuation. Existing open PR preserved, not merged or declared completed.'
            },
            null,
            2
          );
        for (const issue of [...new Set([targetTask.issue, actorTask.issue, snapshot.index])])
          await upsertComment(client, issue, 'continuation-' + done.request.id, text);
        await (await import('./collaboration.mjs')).main(['start', task, nextOwner]);
      }
    },
    { task, nextOwner, apply }
  );
  if (!apply) writeJSON(path.join(folder, 'plan-' + task + '-' + nextOwner + '.json'), result);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        task,
        nextOwner,
        proof: result.proof,
        result: result.result,
        replayed: result.replayed,
        oldSourceWrites: 0,
        phoneChanges: 0
      },
      null,
      2
    )
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('CONTINUATION_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
