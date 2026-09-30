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
import { guardWorktree } from './collaboration-guard.mjs';
import { GitHubCoordination, coordinate } from './collaboration-store.mjs';
import { assertOwnership, digest } from './collaboration-policy.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { memorySnapshot, readTask, upsertComment } from './issue-memory.mjs';
import { recoverZeroWork, zeroWorkDigest } from './zero-work-recovery-policy.mjs';

const REPO = 'neurofoxpro/multimental';
const canonical = (file) =>
  process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function boundedJSON(file, limit = 262144) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw Error('ZERO_WORK_BAD_METADATA');
  return readJSON(file);
}

export async function main(args = process.argv.slice(2)) {
  const [task, flag, ...extra] = args;
  if (
    !/^[A-Z]+-\d+$/.test(task || '') ||
    extra.length ||
    (flag !== undefined && flag !== '--apply')
  )
    throw Error('collab recover-zero-work TASK [--apply]');
  const apply = flag === '--apply',
    root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('ZERO_WORK_STATION_ONLY');
  await guardWorktree(root, 'zero-work-recover', args);
  const binding = boundedJSON(inside(root, '.gameprod/agent.local.json'));
  const cmd = (cwd, argv, optional = false) => {
    const result = spawnSync('git', argv, {
      cwd,
      encoding: 'utf8',
      shell: false,
      timeout: 20000,
      maxBuffer: 1048576
    });
    if ((result.error || result.status !== 0) && !optional) throw Error('ZERO_WORK_GIT_' + argv[0]);
    return optional ? result : (result.stdout || '').trim();
  };
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    (() => {
      const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 });
      if (result.status !== 0) throw Error('ZERO_WORK_AUTH');
      return result.stdout.trim();
    })();
  const client = new HubClient(token),
    store = new GitHubCoordination(token);
  const snapshot = await memorySnapshot(client, readJSON(inside(root, '.gameprod/workplan.json'))),
    targetRecord = snapshot.records.find((row) => row.task.id === task),
    actorRecord = snapshot.records.find((row) => row.task.id === binding.task);
  if (!targetRecord || !actorRecord || snapshot.missing.length)
    throw Error('ZERO_WORK_PRIMARY_MEMORY');
  const actorHead = cmd(root, ['rev-parse', 'HEAD']);
  const liveDev = (await client.api('GET', '/git/ref/heads/dev')).object.sha;
  if (apply) {
    if (cmd(root, ['status', '--porcelain']) || !gate(root, project, 'verified').ok)
      throw Error('ZERO_WORK_REQUIRES_CLEAN_VERIFIED_ADAPTER');
    if (cmd(root, ['merge-base', '--is-ancestor', actorHead, liveDev], true).status !== 0)
      throw Error('ZERO_WORK_ADAPTER_NOT_IN_DEV');
  }
  const config = boundedJSON(path.join(workspace, 'station.local.json'));
  if (
    config.repository !== REPO ||
    config.allowedHost.toUpperCase() !== 'VENEL-SENDRIK' ||
    !path.isAbsolute(config.workDir)
  )
    throw Error('ZERO_WORK_STATION_CONFIG');

  const ownedLocks = new Map();
  const folder = inside(root, '.gameprod/evidence/zero-work-recovery');
  fs.mkdirSync(folder, { recursive: true });
  const journal = path.join(folder, task + '.json');

  function targetTree(claim) {
    const rows = cmd(root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
    if (rows.length > 64) throw Error('ZERO_WORK_WORKTREE_LIMIT');
    const found = [];
    for (const row of rows) {
      const location = /^worktree (.+)$/m.exec(row)?.[1]?.trim();
      if (
        !location ||
        canonical(path.dirname(location)) !== canonical(workspace) ||
        !path.basename(location).startsWith('slice-')
      )
        continue;
      if (canonical(fs.realpathSync(location)) !== canonical(location))
        throw Error('ZERO_WORK_WORKTREE_LINK');
      const file = path.join(location, '.gameprod/agent.local.json');
      if (!fs.existsSync(file)) continue;
      const candidate = boundedJSON(file);
      if (
        candidate.token === claim.token &&
        candidate.owner === claim.owner &&
        candidate.task === claim.task
      ) {
        if (row.includes('\nlocked') || row.includes('\nprunable'))
          throw Error('ZERO_WORK_GIT_WORKTREE_LOCKED');
        found.push({
          location,
          file,
          registeredHead: /^HEAD ([a-f0-9]{40})$/m.exec(row)?.[1],
          registeredBranch: /^branch refs\/heads\/(.+)$/m.exec(row)?.[1]?.trim()
        });
      }
    }
    if (found.length !== 1 || canonical(found[0].location) === canonical(root))
      throw Error('ZERO_WORK_UNIQUE_FOREIGN_WORKTREE_REQUIRED');
    return found[0];
  }

  function lockPaths(location) {
    const evidence = path.join(location, '.gameprod/evidence');
    const local = fs.existsSync(evidence)
      ? fs
          .readdirSync(evidence)
          .filter((name) => name.endsWith('.lock'))
          .map((name) => path.join(evidence, name))
      : [];
    return [
      ...new Set([
        ...local,
        path.join(workspace, 'collaboration-dev-integration.lock'),
        path.join(workspace, 'collaboration-worktrees.lock'),
        ...['qualification.lock', 'update.lock', 'install.lock', 'device-test.lock'].map((name) =>
          path.join(config.workDir, name)
        )
      ])
    ];
  }

  function pending(location) {
    let count = 0;
    for (const file of lockPaths(location)) {
      if (!fs.existsSync(file)) continue;
      const known = ownedLocks.get(canonical(file));
      if (known && sha(fs.readFileSync(file)) === known) continue;
      count++;
    }
    return count;
  }

  function source(tree) {
    const taskBinding = boundedJSON(tree.file),
      taskProject = boundedJSON(path.join(tree.location, '.gameprod/project.json')),
      head = cmd(tree.location, ['rev-parse', 'HEAD']),
      branch = cmd(tree.location, ['branch', '--show-current']);
    if (taskProject.repository !== REPO) throw Error('ZERO_WORK_PROJECT_MISMATCH');
    return {
      head,
      branch,
      clean: !cmd(tree.location, ['status', '--porcelain', '--untracked-files=all']),
      sourceDigest: fingerprint(tree.location, taskProject),
      bindingDigest: sha(fs.readFileSync(tree.file)),
      binding: taskBinding,
      remote: normalizeRepo(cmd(tree.location, ['remote', 'get-url', 'origin']))
    };
  }

  const load = () => (fs.existsSync(journal) ? boundedJSON(journal, 1048576) : null);
  const result = await recoverZeroWork(
    {
      now: Date.now,
      load,
      save: (_task, data) => {
        writeJSON(journal, data);
        writeJSON(path.join(folder, data.request.id + '.json'), data);
      },
      reconcile: async (request) => {
        const current = await store.read();
        const event = current?.state?.events.find((row) => row.id === request.id);
        if (!event) return null;
        if (event.hash !== digest(request)) throw Error('ZERO_WORK_OPERATION_ID_CONFLICT');
        return event.result;
      },
      observe: async () => {
        const observed = await store.read();
        if (!observed?.state) throw Error('ZERO_WORK_COORDINATION_MISSING');
        const actor = assertOwnership(observed.state, binding);
        const claims = Object.values(observed.state.claims).filter((claim) => claim.task === task);
        if (claims.length !== 1 || claims[0].token === actor.token)
          throw Error('ZERO_WORK_TARGET_NOT_UNIQUE_FOREIGN');
        const claim = claims[0],
          tree = targetTree(claim),
          state = source(tree);
        const pulls = await client.list(
          '/pulls?state=all&head=' + encodeURIComponent('neurofoxpro:' + state.branch)
        );
        let remoteHead = null,
          remoteBranchState = 'absent';
        try {
          remoteHead = (await client.api('GET', '/git/ref/heads/' + state.branch)).object.sha;
          remoteBranchState = remoteHead === state.head ? 'exact_head' : 'different_head';
        } catch (error) {
          if (!String(error?.message || error).startsWith('HUB_HTTP_404 ')) throw error;
        }
        const runRows = [
          ...(await client.list(
            '/actions/runs?branch=' + encodeURIComponent(state.branch),
            'workflow_runs'
          )),
          ...(await client.list('/actions/runs?head_sha=' + state.head, 'workflow_runs'))
        ];
        const runs = [...new Map(runRows.map((row) => [row.id, row])).values()];
        const active = runs.filter((row) => row.status !== 'completed');
        const locks = pending(tree.location);
        const liveIssue = readTask(await client.api('GET', '/issues/' + targetRecord.issue));
        const proof = {
          schemaVersion: 1,
          repository: REPO,
          task,
          claimDigest: zeroWorkDigest(claim),
          observedAt: Date.now(),
          base: claim.base,
          head: state.head,
          branch: state.branch,
          remoteHead,
          remoteBranchState,
          sourceDigest: state.sourceDigest,
          bindingDigest: state.bindingDigest,
          registeredWorktree:
            tree.registeredHead === state.head && tree.registeredBranch === state.branch,
          canonicalRemote: state.remote === REPO,
          bindingMatches:
            state.binding.token === claim.token &&
            state.binding.owner === claim.owner &&
            state.binding.fence === claim.fence &&
            state.binding.branch === state.branch &&
            !state.binding.released,
          cleanWorktree: state.clean,
          baseEqualsHead: claim.base === state.head,
          baseInsideDev:
            cmd(root, ['merge-base', '--is-ancestor', claim.base, liveDev], true).status === 0,
          remoteBranchSafe:
            remoteBranchState === 'absent' ||
            (remoteBranchState === 'exact_head' && remoteHead === state.head),
          noCommitsBeyondBase:
            cmd(tree.location, ['rev-list', '--count', claim.base + '..' + state.head]) === '0',
          noPullRequests: pulls.length === 0,
          allRunsComplete: active.length === 0,
          allWritersIdle: locks === 0,
          taskStillOpen:
            !!liveIssue &&
            liveIssue.task.id === task &&
            liveIssue.issueState === 'open' &&
            liveIssue.task.status !== 'verified',
          pullRequests: pulls.length,
          activeRuns: active.length,
          pendingLocks: locks
        };
        return { proof, claim, actor, tree };
      },
      reserve: async (first) => {
        const releases = [];
        try {
          for (const file of [
            path.join(root, '.gameprod/evidence/zero-work-recovery.lock'),
            path.join(first.tree.location, '.gameprod/evidence/ops.lock'),
            path.join(workspace, 'collaboration-dev-integration.lock'),
            path.join(workspace, 'collaboration-worktrees.lock'),
            path.join(config.workDir, 'qualification.lock')
          ]) {
            const release = acquireOperation(file, {
              command: 'zero-work-claim-recovery',
              repository: REPO,
              task
            });
            releases.push(release);
            ownedLocks.set(canonical(file), sha(fs.readFileSync(file)));
          }
          return () => {
            for (const release of releases.reverse()) release();
            ownedLocks.clear();
          };
        } catch (error) {
          for (const release of releases.reverse()) release();
          ownedLocks.clear();
          throw error;
        }
      },
      request: async (fresh) => ({
        id: randomUUID(),
        kind: 'release_zero_work',
        owner: binding.owner,
        actorToken: binding.token,
        actorFence: binding.fence,
        token: fresh.claim.token,
        fence: fresh.claim.fence,
        claimDigest: zeroWorkDigest(fresh.claim),
        proof: fresh.proof,
        proofDigest: zeroWorkDigest(fresh.proof)
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
          throw Error('ZERO_WORK_POST_OPERATION_SOURCE_CHANGED');
      },
      record: async (done) => {
        const text =
          '## Освобождён только доказанно пустой просроченный срез\n\n' +
          JSON.stringify(
            {
              task,
              proof: done.proof,
              result: done.result,
              sourceWrites: 0,
              phoneChanges: 0,
              taskAcceptance: 'not_inferred',
              automaticTakeover: false
            },
            null,
            2
          );
        for (const issue of [...new Set([targetRecord.issue, actorRecord.issue, snapshot.index])])
          await upsertComment(client, issue, 'zero-work-recovery-' + done.request.id, text);
      }
    },
    { task, apply }
  );
  const receipt =
    '.gameprod/evidence/zero-work-recovery/' + (apply ? '' : 'plan-') + task + '.json';
  if (!apply) writeJSON(inside(root, receipt), result);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        task,
        proof: result.proof,
        result: result.result,
        replayed: result.replayed,
        sourceWrites: 0,
        phoneChanges: 0,
        receipt
      },
      null,
      2
    )
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error('ZERO_WORK_RECOVERY_BLOCKED: ' + error.message);
    process.exitCode = 1;
  });
