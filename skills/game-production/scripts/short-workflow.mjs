import fs from 'node:fs';
import path from 'node:path';
import { acceptIssue } from './task-acceptance.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, readJSON, writeJSON, inside, context, fingerprint, sha, gate } from './lib.mjs';
import { HubClient, allowedBranch } from './hub-client.mjs';
import { shipStatePath, shortOptions, revisedCheckpoint } from './short-workflow-state.mjs';
import { memorySnapshot, upsertComment } from './issue-memory.mjs';
import { nextTasks } from './control.mjs';
import { safePath } from './apply.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
import { REPO, compactPacket, shipFlow, assertProof, assertPull } from './short-workflow-core.mjs';
const CONTROL = 'skills/game-production/scripts/control.mjs';
const ID = /^[A-Z]+-\d+$/;
function optionalJSON(file) {
  if (!fs.existsSync(file)) return null;
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 8388608)
    throw Error('WORKFLOW_STATE_SIZE');
  return readJSON(file);
}
function resultObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    /* Commands may include progress before one JSON line. */
  }
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try {
      const result = JSON.parse(line);
      if (result && typeof result === 'object' && !Array.isArray(result)) return result;
    } catch {
      /* Keep searching complete lines, never evaluate text. */
    }
  }
  throw Error('WORKFLOW_JSON_RESULT_MISSING');
}
function execution(root) {
  let sequence = 0;
  const call = (exe, args, timeout = 15000) => {
    const r = spawnSync(exe, args, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024
    });
    if (r.error || r.signal || r.status !== 0)
      throw Error('WORKFLOW_COMMAND_FAILED:' + path.basename(exe) + ':' + args[0]);
    return r.stdout.trim();
  };
  const game = (args, timeout = 1200000) => {
    const name = 'workflow-' + Date.now() + '-' + ++sequence + '.local.log';
    const r = spawnSync(process.execPath, [CONTROL, ...args], {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 32 * 1024 * 1024
    });
    const file = inside(root, '.gameprod/evidence/' + name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, (r.stdout || '') + (r.stderr || ''));
    if (r.error || r.signal || r.status !== 0)
      throw Error('WORKFLOW_STAGE_FAILED:' + args[0] + '; log=.gameprod/evidence/' + name);
    return (r.stdout || '').trim();
  };
  return { call, game };
}
export async function main(args = process.argv.slice(2)) {
  const { mode, rest, revise } = shortOptions(args);
  const root = findRoot();
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const p = readJSON(inside(root, '.gameprod/project.json'));
  if (p.repository !== REPO) throw Error('WORKFLOW_REPOSITORY');
  context(root, p);
  if (mode !== 'focus' && process.env.GITHUB_ACTIONS === 'true')
    throw Error('SHORT_WORKFLOW_STATION_ONLY');
  await guardWorktree(root, mode, rest);
  const { call, game } = execution(root);
  const binding = optionalJSON(inside(root, '.gameprod/agent.local.json'));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || call('gh', ['auth', 'token']);
  const client = new HubClient(token);
  const snapshot = await memorySnapshot(client, readJSON(inside(root, '.gameprod/workplan.json')));
  if (snapshot.missing.length || snapshot.source !== 'github-issues')
    throw Error('COMPLETE_LIVE_MEMORY_REQUIRED');
  const id = rest[0] || binding?.task;
  if (!id) {
    if (mode !== 'focus') throw Error('EXPLICIT_TASK_REQUIRED');
    console.log(
      JSON.stringify(
        {
          repository: REPO,
          observedAt: snapshot.observedAt,
          next: nextTasks(snapshot.plan).slice(0, 8),
          commands: ['collab start TASK UNIQUE_ALIAS', 'focus TASK', 'ship TASK']
        },
        null,
        2
      )
    );
    return;
  }
  const row = snapshot.records.find((r) => r.task.id === id);
  if (!row) throw Error('TASK_NOT_IN_LIVE_MEMORY');
  const task = {
    ...row.task,
    blockedBy: nextTasks(snapshot.plan).find((t) => t.id === id)?.blockedBy || []
  };
  const current = () => ({
    repository: REPO,
    branch: call('git', ['branch', '--show-current']),
    head: call('git', ['rev-parse', 'HEAD']),
    dirty: !!call('git', ['status', '--porcelain']),
    binding: optionalJSON(inside(root, '.gameprod/agent.local.json'))
  });
  if (mode === 'focus') {
    const comments = await client.list('/issues/' + row.issue + '/comments');
    const memory = await client.list('/issues/' + snapshot.index + '/comments');
    const source = current();
    const fileRows = [
      ...new Set([
        'AGENTS.md',
        'skills/game-production/SKILL.md',
        'docs/production/AUTHORITY.md',
        '.gameprod/decisions.json',
        ...task.readset
      ])
    ].map((rel) => {
      const file = safePath(root, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > 2097152)
        throw Error('FOCUS_REQUIRED_INPUT_MISSING');
      const bytes = fs.readFileSync(file);
      return { path: rel, sha256: sha(bytes), bytes: bytes.length };
    });
    const priorFile = inside(root, '.gameprod/evidence/focus.local.json');
    const previous = optionalJSON(priorFile);
    const coordination = resultObject(game(['collab', 'status'], 60000));
    const packet = compactPacket({
      snapshot,
      task,
      comments,
      source: {
        ...source,
        binding: binding
          ? { task: binding.task, owner: binding.owner, released: !!binding.released }
          : null
      },
      files: fileRows,
      previous: previous?.task?.id === id ? previous : null,
      claims: coordination.claims
    });
    packet.projectUpdates = memory
      .filter((c) => !String(c.body || '').startsWith('<!-- gameprod:record:release-'))
      .slice(-2)
      .map((c) => ({
        id: c.id,
        updatedAt: c.updated_at,
        excerpt: String(c.body || '').slice(0, 700),
        truncated: String(c.body || '').length > 700
      }));
    const full = {
      repository: REPO,
      observedAt: snapshot.observedAt,
      task,
      issue: row,
      comments,
      projectMemory: memory,
      files: fileRows,
      source: packet.source
    };
    const checkpoint = allowedBranch(source.branch)
      ? optionalJSON(inside(root, shipStatePath(source.branch)))
      : null;
    packet.workflow = checkpoint
      ? {
          phase: checkpoint.phase,
          task: checkpoint.task,
          pr: checkpoint.pr,
          merge: checkpoint.merge,
          sameBranch: checkpoint.branch === source.branch
        }
      : null;
    packet.cooperativeWriteClaim =
      !!binding &&
      !binding.released &&
      binding.task === id &&
      coordination.claims.some((claim) => claim.token === binding.token && claim.task === id);
    packet.fullDetailsBytes = Buffer.byteLength(JSON.stringify(full));
    packet.outputBytesBeforeSizeField = Buffer.byteLength(JSON.stringify(packet));
    writeJSON(priorFile, full);
    console.log(JSON.stringify(packet, null, 2));
    return packet;
  }
  const stateFile = inside(root, shipStatePath(current().branch));
  const saveState = (j) => {
    writeJSON(stateFile, j);
    writeJSON(inside(root, '.gameprod/evidence/ship.json'), j);
  };
  if (mode === 'ship') {
    const release = acquireOperation(inside(root, '.gameprod/evidence/short-workflow.lock'), {
      command: 'ship',
      repository: REPO,
      task: id
    });
    try {
      if (revise) {
        const journal = optionalJSON(stateFile);
        if (!journal?.pr) throw Error('SHIP_REVISION_NEEDS_KNOWN_PR');
        const observed = current();
        call('git', ['merge-base', '--is-ancestor', journal.head, observed.head]);
        const next = revisedCheckpoint(
          journal,
          observed,
          task,
          await client.api('GET', '/pulls/' + journal.pr),
          {
            sourceDigest: fingerprint(root, p),
            descendant: true,
            at: new Date().toISOString()
          }
        );
        const archive = inside(
          root,
          '.gameprod/evidence/ships/history/' + sha(JSON.stringify(journal)) + '.json'
        );
        if (!fs.existsSync(archive)) writeJSON(archive, journal);
        else if (JSON.stringify(readJSON(archive)) !== JSON.stringify(journal))
          throw Error('SHIP_REVISION_ARCHIVE_CONFLICT');
        saveState(next);
        console.log('SHIP_REVISION_ARCHIVED ' + journal.head);
      }
      const result = await shipFlow(
        {
          current,
          load: () => optionalJSON(stateFile),
          save: saveState,
          now: () => new Date().toISOString(),
          digest: () => fingerprint(root, readJSON(inside(root, '.gameprod/project.json'))),
          verified: () =>
            gate(root, readJSON(inside(root, '.gameprod/project.json')), 'verified').ok,
          progress: (name) => console.log('SHIP_STAGE ' + name),
          renew: () => game(['collab', 'renew'], 60000),
          check: () => {
            game(['github', 'snapshot-plan'], 120000);
            game(['check'], 600000);
          },
          publish: (t) =>
            game(
              ['publish', 'feat: ' + t.id + ' verified increment', '[' + t.id + '] ' + t.title],
              120000
            ),
          findPublished: async () => {
            const c = current();
            if (c.dirty) return null;
            const rows = await client.list(
              '/pulls?state=all&base=dev&head=' + encodeURIComponent('neurofoxpro:' + c.branch)
            );
            const exact = rows.filter((pr) => pr.head?.sha === c.head);
            if (exact.length > 1) throw Error('DUPLICATE_SOURCE_PR');
            return exact[0] || null;
          },
          pull: (n) => client.api('GET', '/pulls/' + n),
          changedFiles: async (n) =>
            (await client.list('/pulls/' + n + '/files')).map((f) => f.filename),
          settle: (n, head) => game(['github', 'settle', String(n), head], 1200000),
          waitDev: (merge) => resultObject(game(['wait-dev', merge], 1200000)),
          releases: () => client.list('/releases'),
          record: async (j) => {
            const text =
              '## Проверенный короткий цикл\n\n' +
              JSON.stringify(
                {
                  task: id,
                  pr: j.pr,
                  head: j.head,
                  merge: j.merge,
                  build: j.build,
                  release: j.release,
                  sourceDigest: j.sourceDigest,
                  installation: 'not_inferred',
                  humanAcceptance: 'not_inferred',
                  productionAuthorized: false
                },
                null,
                2
              );
            const key = 'ship-' + j.head;
            await upsertComment(client, row.issue, key, text);
            await upsertComment(client, snapshot.index, key, text);
          }
        },
        task
      );
      console.log(
        JSON.stringify(
          {
            status: 'complete',
            task: id,
            pr: result.pr,
            head: result.head,
            merge: result.merge,
            release: result.release,
            replayedCompletion: result.replayedCompletion,
            device: 'separate',
            receipt: '.gameprod/evidence/ship.json'
          },
          null,
          2
        )
      );
      return result;
    } finally {
      release();
    }
  }
  const release = acquireOperation(inside(root, '.gameprod/evidence/task-accept.lock'), {
    command: 'accept',
    task: id
  });
  try {
    const rel = rest[1];
    if (!/^docs\/production\/evidence\/[a-zA-Z0-9_.-]+\.json$/.test(rel))
      throw Error('VERSIONED_PUBLIC_PROOF_REQUIRED');
    const bytes = fs.readFileSync(safePath(root, rel));
    if (bytes.length > 1048576) throw Error('PROOF_TOO_LARGE');
    const proof = JSON.parse(bytes.toString('utf8'));
    assertProof(proof, task);
    const c = current();
    if (c.dirty) throw Error('ACCEPT_REQUIRES_CLEAN_PUBLISHED_SOURCE');
    const publication = optionalJSON(stateFile);
    if (publication?.phase !== 'complete' || publication.head !== c.head)
      throw Error('ACCEPT_REQUIRES_COMPLETED_SHIP');
    const own = await client.api('GET', '/pulls/' + publication.pr);
    assertPull(own, c.branch, c.head);
    if (!own.merged_at || own.merge_commit_sha !== publication.merge)
      throw Error('ACCEPT_SOURCE_NOT_MERGED');
    for (const reference of [...proof.evidence, rel]) {
      const file = safePath(root, reference);
      if (call('git', ['show', 'HEAD:' + reference]) !== fs.readFileSync(file, 'utf8').trim())
        throw Error('ACCEPT_UNCOMMITTED_EVIDENCE');
    }
    const implemented = await client.api('GET', '/pulls/' + proof.implementation.pr);
    assertPull(implemented, implemented.head?.ref, proof.implementation.head);
    if (!implemented.merged_at || implemented.merge_commit_sha !== proof.sourceCommit)
      throw Error('ACCEPT_WRONG_IMPLEMENTATION');
    const runs = await client.list(
      '/actions/runs?head_sha=' + proof.implementation.head,
      'workflow_runs'
    );
    for (const file of ['build.yml', 'production-control.yml', 'source-quality.yml']) {
      const run = runs
        .filter(
          (r) =>
            r.path === '.github/workflows/' + file &&
            r.event === 'pull_request' &&
            r.head_sha === proof.implementation.head
        )
        .sort((a, b) => b.id - a.id)[0];
      if (!run || run.status !== 'completed' || run.conclusion !== 'success')
        throw Error('ACCEPT_CI_NOT_PROVEN');
    }
    const merge = await client.api('GET', '/commits/' + proof.sourceCommit);
    if (merge.parents?.length !== 2 || merge.parents[1].sha !== proof.implementation.head)
      throw Error('ACCEPT_MERGE_PARENTS');
    const build = runs
      .filter(
        (r) =>
          r.path === '.github/workflows/build.yml' &&
          r.event === 'pull_request' &&
          r.head_sha === proof.implementation.head
      )
      .sort((a, b) => b.id - a.id)[0];
    const jobs = await client.list('/actions/runs/' + build.id + '/jobs', 'jobs');
    if (
      !jobs.some(
        (j) =>
          j.name === 'Source seal ' + merge.parents[0].sha + ' ' + proof.implementation.head &&
          j.conclusion === 'success'
      )
    )
      throw Error('ACCEPT_SOURCE_SEAL');
    const coordination = resultObject(game(['collab', 'status'], 60000));
    if (coordination.claims.some((claim) => claim.task === id && claim.token !== binding?.token))
      throw Error('ACCEPT_TASK_OWNED_BY_ANOTHER_SLICE');
    const proofHash = sha(bytes);
    const accepted = await acceptIssue({
      client,
      issue: row.issue,
      proof,
      reference: rel,
      proofHash,
      record: (text) => upsertComment(client, row.issue, 'accepted-' + proofHash, text)
    });
    const receipt = {
      repository: REPO,
      task: id,
      issue: row.issue,
      status: 'verified',
      proof: rel,
      proofSha256: proofHash,
      observedAt: new Date().toISOString(),
      sourceCommit: proof.sourceCommit,
      currentSource: c.head,
      bodySha256: accepted.bodySha256,
      writeReadback: accepted,
      humanAcceptance: 'not_inferred',
      snapshot: 'next ship refreshes versioned projections'
    };
    writeJSON(inside(root, '.gameprod/evidence/accepted-' + id + '.json'), receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return receipt;
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('SHORT_WORKFLOW_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
