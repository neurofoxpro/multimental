import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, inside, readJSON, writeJSON, context, normalizeRepo, sha } from './lib.mjs';
import { acquireOperation } from './operation-lock.mjs';
const REPO = 'neurofoxpro/multimental';
const SHA = /^[a-f0-9]{40}$/;
const ZERO = '0'.repeat(40);
export function removableName(name) {
  return (
    typeof name === 'string' &&
    /^(feature|fix|docs|test)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
    !name.includes('..') &&
    !name.endsWith('/') &&
    !name.endsWith('.lock')
  );
}
export function cleanupPlan(refs, prs, active, ancestors, dev) {
  if (
    !SHA.test(dev) ||
    !Array.isArray(refs) ||
    !Array.isArray(prs) ||
    !Array.isArray(active) ||
    !Array.isArray(ancestors)
  )
    throw Error('Invalid cleanup inventory');
  const remove = [],
    keep = [];
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref.name) || !SHA.test(ref.oid || '')) throw Error('Invalid/duplicate ref');
    seen.add(ref.name);
    let reason = '';
    const merged = prs
      .filter(
        (p) =>
          p.state === 'MERGED' &&
          p.baseRefName === 'dev' &&
          p.headRepository?.nameWithOwner === REPO &&
          p.headRefName === ref.name &&
          p.headRefOid === ref.oid
      )
      .sort((a, b) => b.number - a.number)[0];
    if (!removableName(ref.name)) reason = 'protected_or_non_work_branch';
    else if (active.includes(ref.name)) reason = 'active_worktree';
    else if (
      prs.some(
        (p) =>
          p.state === 'OPEN' &&
          p.headRefName === ref.name &&
          p.headRepository?.nameWithOwner === REPO
      )
    )
      reason = 'open_pr';
    else if (!merged) reason = 'no_exact_merged_dev_pr';
    else if (!ancestors.includes(ref.oid)) reason = 'not_reachable_from_dev';
    if (reason) keep.push({ ...ref, reason });
    else remove.push({ ...ref, pr: merged.number });
  }
  return { repository: REPO, dev, remove, keep };
}
export function cleanupMutation(plan, repositoryId) {
  if (
    plan.repository !== REPO ||
    !SHA.test(plan.dev) ||
    typeof repositoryId !== 'string' ||
    !repositoryId ||
    !Array.isArray(plan.remove) ||
    plan.remove.length === 0 ||
    plan.remove.length > 50
  )
    throw Error('Invalid bounded cleanup');
  const seen = new Set();
  for (const r of plan.remove) {
    if (
      !removableName(r.name) ||
      !SHA.test(r.oid) ||
      r.oid === ZERO ||
      !Number.isSafeInteger(r.pr) ||
      r.pr < 1 ||
      seen.has(r.name)
    )
      throw Error('Unsafe removal');
    seen.add(r.name);
  }
  return {
    repositoryId,
    clientMutationId: 'cleanup-' + sha(JSON.stringify(plan.remove)).slice(0, 24),
    refUpdates: [
      { name: 'refs/heads/dev', beforeOid: plan.dev, afterOid: plan.dev, force: false },
      ...plan.remove.map((r) => ({
        name: 'refs/heads/' + r.name,
        beforeOid: r.oid,
        afterOid: ZERO,
        force: false
      }))
    ]
  };
}
const REF_QUERY =
  'query($cursor:String){repository(owner:"neurofoxpro",name:"multimental"){id nameWithOwner refs(refPrefix:"refs/heads/",first:100,after:$cursor){nodes{name target{oid}} pageInfo{hasNextPage endCursor}}}}';
const PR_QUERY =
  'query($cursor:String){repository(owner:"neurofoxpro",name:"multimental"){id nameWithOwner pullRequests(first:100,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number state baseRefName headRefName headRefOid headRepository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}';
const MUTATION = 'mutation($input:UpdateRefsInput!){updateRefs(input:$input){clientMutationId}}';
export async function runCleanup(plan, repositoryId, { mutate, readRefs, record }) {
  const input = cleanupMutation(plan, repositoryId);
  await record({ status: 'prepared', plan, input });
  let error = null;
  try {
    await mutate(input);
  } catch (e) {
    error = e;
  }
  const current = await readRefs();
  const remaining = plan.remove.filter((r) => current.some((v) => v.name === r.name));
  if (remaining.length) {
    await record({ status: 'blocked', plan, remaining });
    throw error || Error('Cleanup not confirmed; no blind retry');
  }
  const result = {
    status: 'deleted',
    count: plan.remove.length,
    plan,
    readback: true,
    recoveredUnknownResponse: !!error
  };
  await record(result);
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'plan', ...extra] = args;
  if (!['plan', 'apply'].includes(mode) || extra.length) throw Error('branches plan|apply');
  const root = findRoot(),
    p = readJSON(inside(root, '.gameprod/project.json'));
  if (p.repository !== REPO) throw Error('Wrong repo');
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, p);
  const run = (exe, argv) => {
    const r = spawnSync(exe, argv, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024
    });
    if (r.status !== 0 || r.error) throw Error('Cleanup command failed: ' + exe + ' ' + argv[0]);
    return r.stdout.trim();
  };
  if (
    normalizeRepo(run('git', ['remote', 'get-url', 'origin'])) !== REPO ||
    normalizeRepo(run('git', ['remote', 'get-url', '--push', 'origin'])) !== REPO
  )
    throw Error('Wrong remote');
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (
      !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) ||
      process.env.GITHUB_REF !== 'refs/heads/dev' ||
      !['4erk', 'venelsendrik'].includes(process.env.GITHUB_ACTOR)
    )
      throw Error('Untrusted cleanup workflow');
  } else if (!['4erk', 'venelsendrik'].includes(run('gh', ['api', 'user', '--jq', '.login'])))
    throw Error('Unexpected account');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || run('gh', ['auth', 'token']);
  async function gql(query, variables) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'multimental-branch-hygiene'
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) throw Error('GraphQL HTTP ' + response.status);
    const value = await response.json();
    if (value.errors?.length) throw Error('GraphQL operation rejected; no automatic retry');
    return value.data;
  }
  async function pages(query, key) {
    let cursor = null,
      repositoryId = null;
    const nodes = [];
    for (let n = 0; n < 20; n++) {
      const data = await gql(query, { cursor });
      const repo = data?.repository;
      if (repo?.nameWithOwner !== REPO || (repositoryId && repositoryId !== repo.id))
        throw Error('Wrong repository identity');
      repositoryId = repo.id;
      const connection = repo[key];
      if (!Array.isArray(connection?.nodes)) throw Error('Invalid GraphQL page');
      nodes.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) return { nodes, repositoryId };
      cursor = connection.pageInfo.endCursor;
    }
    throw Error('Incomplete cleanup inventory');
  }
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'branches-' + mode,
    repository: REPO
  });
  try {
    const { HubClient } = await import('./hub-client.mjs');
    const client = new HubClient(token);
    const [refs, prs, runs] = await Promise.all([
      pages(REF_QUERY, 'refs'),
      pages(PR_QUERY, 'pullRequests'),
      client.list('/actions/runs', 'workflow_runs')
    ]);
    if (refs.repositoryId !== prs.repositoryId) throw Error('Inventory mismatch');
    const dev = refs.nodes.find((r) => r.name === 'dev')?.target.oid;
    if (!SHA.test(dev || '')) throw Error('Missing dev');
    run('git', ['fetch', 'origin', 'dev']);
    const active = run('git', ['worktree', 'list', '--porcelain'])
      .split(/\r?\n/)
      .filter((x) => x.startsWith('branch refs/heads/'))
      .map((x) => x.slice('branch refs/heads/'.length));
    active.push(...runs.filter((r) => r.status !== 'completed').map((r) => r.head_branch));
    const shortRefs = refs.nodes.map((r) => ({ name: r.name, oid: r.target.oid }));
    const preliminary = cleanupPlan(
      shortRefs,
      prs.nodes,
      active,
      shortRefs.map((r) => r.oid),
      dev
    );
    const ancestors = [],
      unproven = [];
    for (const candidate of preliminary.remove) {
      const r = spawnSync('git', ['merge-base', '--is-ancestor', candidate.oid, dev], {
        cwd: root,
        shell: false,
        timeout: 15000
      });
      if (r.error) throw Error('Git ancestry inspection failed for ' + candidate.name);
      if (r.status === 0) ancestors.push(candidate.oid);
      else if (r.status !== 1)
        unproven.push({
          name: candidate.name,
          oid: candidate.oid,
          exitCode: r.status,
          reason: 'local_ancestry_not_proven'
        });
    }
    const plan = cleanupPlan(shortRefs, prs.nodes, active, ancestors, dev);
    plan.unproven = unproven;
    const reportFile = inside(root, '.gameprod/evidence/branch-cleanup-' + Date.now() + '.json');
    const record = async (report) =>
      writeJSON(reportFile, { schemaVersion: 1, at: new Date().toISOString(), ...report });
    await record({ status: 'planned', plan });
    if (mode === 'plan' || !plan.remove.length) {
      console.log(
        JSON.stringify(
          {
            status: mode === 'plan' ? 'planned' : 'nothing_to_delete',
            candidates: plan.remove,
            kept: plan.keep.length,
            unproven,
            report: reportFile
          },
          null,
          2
        )
      );
      return;
    }
    const result = await runCleanup(plan, refs.repositoryId, {
      mutate: async (input) => gql(MUTATION, { input }),
      readRefs: async () =>
        (await pages(REF_QUERY, 'refs')).nodes.map((r) => ({ name: r.name, oid: r.target.oid })),
      record
    });
    console.log(
      JSON.stringify(
        {
          status: result.status,
          deleted: result.plan.remove,
          kept: result.plan.keep.length,
          report: reportFile
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
    console.error('BRANCH_CLEANUP_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
