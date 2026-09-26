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
import { HubClient, allowedBranch } from './hub-client.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
import { GitHubCoordination, coordinate } from './collaboration-store.mjs';
import { assertOwnership, digest } from './collaboration-policy.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { memorySnapshot, upsertComment } from './issue-memory.mjs';
import { recoverCompleted, recoveryDigest } from './completed-recovery-policy.mjs';
const REPO = 'neurofoxpro/multimental';
const canonical = (file) =>
  process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
function boundedJSON(file, limit = 262144) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > limit) throw Error('RECOVERY_BAD_METADATA');
  return readJSON(file);
}
export async function main(args = process.argv.slice(2)) {
  const [task, flag, ...extra] = args;
  if (
    !/^[A-Z]+-\d+$/.test(task || '') ||
    extra.length ||
    (flag !== undefined && flag !== '--apply')
  )
    throw Error('collab recover-completed TASK [--apply]');
  const apply = flag === '--apply',
    root = findRoot(),
    workspace = path.dirname(root);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const p = readJSON(inside(root, '.gameprod/project.json'));
  context(root, p);
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('RECOVERY_STATION_ONLY');
  await guardWorktree(root, 'completed-recover', args);
  const binding = boundedJSON(inside(root, '.gameprod/agent.local.json'));
  const cmd = (cwd, argv, optional = false) => {
    const r = spawnSync('git', argv, {
      cwd,
      encoding: 'utf8',
      shell: false,
      timeout: 20000,
      maxBuffer: 1048576
    });
    if ((r.error || r.status !== 0) && !optional) throw Error('RECOVERY_GIT_' + argv[0]);
    return optional ? r : (r.stdout || '').trim();
  };
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    (() => {
      const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 });
      if (r.status !== 0) throw Error('RECOVERY_AUTH');
      return r.stdout.trim();
    })();
  const client = new HubClient(token),
    store = new GitHubCoordination(token);
  const snapshot = await memorySnapshot(client, readJSON(inside(root, '.gameprod/workplan.json'))),
    targetIssue = snapshot.records.find((r) => r.task.id === task)?.issue,
    actorIssue = snapshot.records.find((r) => r.task.id === binding.task)?.issue;
  if (!targetIssue || !actorIssue || snapshot.missing.length)
    throw Error('RECOVERY_PRIMARY_MEMORY');
  const actorHead = cmd(root, ['rev-parse', 'HEAD']);
  const liveDev = (await client.api('GET', '/git/ref/heads/dev')).object.sha;
  if (apply) {
    if (cmd(root, ['status', '--porcelain']) || !gate(root, p, 'verified').ok)
      throw Error('RECOVERY_REQUIRES_CLEAN_VERIFIED_ADAPTER');
    if (cmd(root, ['merge-base', '--is-ancestor', actorHead, liveDev], true).status !== 0)
      throw Error('RECOVERY_ADAPTER_NOT_IN_DEV');
  }
  const config = boundedJSON(path.join(workspace, 'station.local.json'));
  if (
    config.repository !== REPO ||
    config.allowedHost.toUpperCase() !== 'VENEL-SENDRIK' ||
    !path.isAbsolute(config.workDir)
  )
    throw Error('RECOVERY_STATION_CONFIG');
  const ownedLocks = new Map();
  const folder = inside(root, '.gameprod/evidence/completed-recovery');
  fs.mkdirSync(folder, { recursive: true });
  const journal = path.join(folder, task + '.json');
  function targetTree(claim) {
    const rows = cmd(root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
    if (rows.length > 64) throw Error('RECOVERY_WORKTREE_LIMIT');
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
        throw Error('RECOVERY_WORKTREE_LINK');
      const file = path.join(location, '.gameprod/agent.local.json');
      if (!fs.existsSync(file)) continue;
      const b = boundedJSON(file);
      if (b.token === claim.token && b.owner === claim.owner && b.task === claim.task) {
        if (row.includes('\nlocked') || row.includes('\nprunable'))
          throw Error('RECOVERY_GIT_WORKTREE_LOCKED');
        found.push({
          location,
          b,
          file,
          registeredHead: /^HEAD ([a-f0-9]{40})$/m.exec(row)?.[1],
          registeredBranch: /^branch refs\/heads\/(.+)$/m.exec(row)?.[1]?.trim()
        });
      }
    }
    if (found.length !== 1 || canonical(found[0].location) === canonical(root))
      throw Error('RECOVERY_UNIQUE_FOREIGN_WORKTREE_REQUIRED');
    return found[0];
  }
  function lockPaths(location) {
    const dir = path.join(location, '.gameprod/evidence');
    const list = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((n) => n.endsWith('.lock'))
          .map((n) => path.join(dir, n))
      : [];
    return [
      ...new Set([
        ...list,
        path.join(workspace, 'collaboration-dev-integration.lock'),
        ...['qualification.lock', 'update.lock', 'install.lock', 'device-test.lock'].map((n) =>
          path.join(config.workDir, n)
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
  function source(t) {
    const b = boundedJSON(t.file),
      head = cmd(t.location, ['rev-parse', 'HEAD']),
      branch = cmd(t.location, ['branch', '--show-current']);
    const tp = boundedJSON(path.join(t.location, '.gameprod/project.json'));
    if (tp.repository !== REPO) throw Error('RECOVERY_PROJECT_MISMATCH');
    return {
      head,
      branch,
      clean: !cmd(t.location, ['status', '--porcelain', '--untracked-files=all']),
      sourceDigest: fingerprint(t.location, tp),
      bindingDigest: sha(fs.readFileSync(t.file)),
      binding: b,
      remote: normalizeRepo(cmd(t.location, ['remote', 'get-url', 'origin']))
    };
  }
  const load = () => (fs.existsSync(journal) ? boundedJSON(journal, 1048576) : null);
  const result = await recoverCompleted(
    {
      now: Date.now,
      load,
      save: (_task, data) => {
        writeJSON(journal, data);
        writeJSON(path.join(folder, data.request.id + '.json'), data);
      },
      reconcile: async (request) => {
        const r = await store.read();
        const event = r?.state?.events.find((e) => e.id === request.id);
        if (!event) return null;
        if (event.hash !== digest(request)) throw Error('RECOVERY_OPERATION_ID_CONFLICT');
        return event.result;
      },
      observe: async () => {
        const observed = await store.read();
        if (!observed?.state) throw Error('RECOVERY_COORDINATION_MISSING');
        const actor = assertOwnership(observed.state, binding);
        const claims = Object.values(observed.state.claims).filter((c) => c.task === task);
        if (claims.length !== 1 || claims[0].token === actor.token)
          throw Error('RECOVERY_TARGET_NOT_UNIQUE_FOREIGN');
        const claim = claims[0],
          t = targetTree(claim),
          s = source(t);
        const pulls = await client.list(
          '/pulls?state=all&base=dev&head=' + encodeURIComponent('neurofoxpro:' + s.branch)
        );
        const open = pulls.filter((pr) => pr.state === 'open');
        const exact = pulls.filter((pr) => pr.merged_at && pr.head?.sha === s.head);
        if (exact.length !== 1) throw Error('RECOVERY_EXACT_MERGED_PR_REQUIRED');
        const pr = await client.api('GET', '/pulls/' + exact[0].number);
        const commit = await client.api('GET', '/commits/' + pr.merge_commit_sha);
        const runs = [
          ...(await client.list(
            '/actions/runs?branch=' + encodeURIComponent(s.branch),
            'workflow_runs'
          )),
          ...(await client.list('/actions/runs?head_sha=' + pr.merge_commit_sha, 'workflow_runs'))
        ];
        const active = runs.filter((r) => r.status !== 'completed');
        const locks = pending(t.location);
        const proof = {
          schemaVersion: 1,
          repository: REPO,
          task,
          claimDigest: recoveryDigest(claim),
          observedAt: Date.now(),
          head: s.head,
          branch: s.branch,
          merge: pr.merge_commit_sha,
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
          mergedExactHead: !!pr.merged && pr.head?.sha === s.head,
          canonicalDevMerge:
            pr.base?.ref === 'dev' &&
            pr.base?.repo?.full_name === REPO &&
            pr.head?.repo?.full_name === REPO,
          mergeParentsMatch: commit.parents?.length === 2 && commit.parents[1].sha === s.head,
          sourceInsideDev:
            cmd(root, ['merge-base', '--is-ancestor', pr.merge_commit_sha, liveDev], true)
              .status === 0,
          allRunsComplete: active.length === 0,
          allWritersIdle: locks === 0,
          openPullRequests: open.length,
          activeRuns: active.length,
          pendingLocks: locks
        };
        return { proof, claim, actor, tree: t };
      },
      reserve: async (first) => {
        const releases = [];
        try {
          for (const file of [
            path.join(root, '.gameprod/evidence/completed-recovery.lock'),
            path.join(first.tree.location, '.gameprod/evidence/ops.lock'),
            path.join(workspace, 'collaboration-dev-integration.lock'),
            path.join(config.workDir, 'qualification.lock')
          ]) {
            const release = acquireOperation(file, {
              command: 'completed-slice-recovery',
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
        } catch (e) {
          for (const release of releases.reverse()) release();
          ownedLocks.clear();
          throw e;
        }
      },
      request: async (fresh) => ({
        id: randomUUID(),
        kind: 'release_completed',
        owner: binding.owner,
        actorToken: binding.token,
        actorFence: binding.fence,
        token: fresh.claim.token,
        fence: fresh.claim.fence,
        claimDigest: recoveryDigest(fresh.claim),
        proof: fresh.proof,
        proofDigest: recoveryDigest(fresh.proof)
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
          throw Error('RECOVERY_POST_OPERATION_SOURCE_CHANGED');
      },
      record: async (done) => {
        const text =
          '## Освобождён только завершённый срез\n\n' +
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
        for (const issue of [...new Set([targetIssue, actorIssue, snapshot.index])])
          await upsertComment(client, issue, 'completed-slice-' + done.request.id, text);
      }
    },
    { task, apply }
  );
  const receipt =
    '.gameprod/evidence/completed-recovery/' + (apply ? '' : 'plan-') + task + '.json';
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
  main().catch((e) => {
    console.error('COMPLETED_RECOVERY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
