import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, inside, readJSON, writeJSON, context, normalizeRepo } from './lib.mjs';
import { HubClient } from './hub-client.mjs';
import { memorySnapshot, upsertComment } from './issue-memory.mjs';
import { GitHubCoordination } from './collaboration-store.mjs';
import { dispatchPlan } from './dispatch-policy.mjs';
import { teamSummary } from './team-policy.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
export async function main(args = process.argv.slice(2)) {
  const [mode = 'status', ...extra] = args;
  if (!['status', 'publish'].includes(mode) || extra.length) throw Error('team status|publish');
  const root = findRoot(),
    workspace = path.dirname(root),
    p = readJSON(inside(root, '.gameprod/project.json'));
  context(root, p);
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  await guardWorktree(root, 'team', [mode]);
  const call = (exe, argv, cwd = root) => {
    const r = spawnSync(exe, argv, {
      cwd,
      shell: false,
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 3000000
    });
    if (r.error || r.status !== 0) throw Error('Team observation failed: ' + argv[0]);
    return r.stdout;
  };
  if (
    normalizeRepo(call('git', ['remote', 'get-url', 'origin']).trim()) !== 'neurofoxpro/multimental'
  )
    throw Error('Wrong project team');
  const token =
      process.env.GH_TOKEN || process.env.GITHUB_TOKEN || call('gh', ['auth', 'token']).trim(),
    client = new HubClient(token),
    state = await new GitHubCoordination(token).read();
  if (!state?.state) throw Error('Live coordination missing');
  const snapshot = await memorySnapshot(client, readJSON(inside(root, '.gameprod/workplan.json'))),
    claims = Object.values(state.state.claims),
    pulls = await client.list('/pulls?state=all&base=dev');
  const registry = call('git', ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/),
    locals = [];
  if (registry.length > 80) throw Error('Bounded worktree inventory exceeded');
  for (const row of registry) {
    const dir = /^worktree (.+)$/m.exec(row)?.[1]?.trim();
    if (
      !dir ||
      path.resolve(path.dirname(dir)).toLowerCase() !== path.resolve(workspace).toLowerCase()
    )
      continue;
    const identity = path.join(dir, '.gameprod/agent.local.json');
    if (!fs.existsSync(identity)) continue;
    if (
      fs.lstatSync(identity).isSymbolicLink() ||
      fs.realpathSync(dir).toLowerCase() !== path.resolve(dir).toLowerCase()
    )
      throw Error('Unexpected worktree alias');
    const binding = readJSON(identity);
    if (!claims.some((c) => c.token === binding.token)) continue;
    const local = { token: binding.token, branch: null, head: null, dirtyPaths: [], locks: [] };
    try {
      if (
        normalizeRepo(call('git', ['remote', 'get-url', 'origin'], dir).trim()) !==
        'neurofoxpro/multimental'
      )
        throw Error('Wrong sibling origin');
      local.branch = call('git', ['branch', '--show-current'], dir).trim();
      local.head = call('git', ['rev-parse', 'HEAD'], dir).trim();
      local.dirtyPaths = [
        ...new Set(
          [
            ...call('git', ['diff', '--name-only', '-z', 'HEAD'], dir).split('\0'),
            ...call('git', ['ls-files', '--others', '--exclude-standard', '-z'], dir).split('\0')
          ].filter(Boolean)
        )
      ].sort();
      const evidence = path.join(dir, '.gameprod/evidence');
      if (fs.existsSync(evidence))
        for (const name of fs.readdirSync(evidence).filter((n) => n.endsWith('.lock'))) {
          const f = path.join(evidence, name);
          let status = 'unknown';
          try {
            if (fs.statSync(f).size > 4096) throw Error('oversized');
            const l = readJSON(f);
            if (!Number.isSafeInteger(l.pid) || l.pid < 1) throw Error('pid');
            try {
              process.kill(l.pid, 0);
              status = 'alive';
            } catch (e) {
              status = e.code === 'ESRCH' ? 'process_absent_not_auto_reclaimed' : 'unknown';
            }
          } catch {
            /* Preserve unknown locks. */
          }
          local.locks.push({ name, status });
        }
    } catch (e) {
      local.error = e.message;
    }
    locals.push(local);
  }
  const dispatch = dispatchPlan(
    snapshot,
    claims,
    readJSON(inside(root, '.gameprod/collaboration.json')),
    ['beta']
  );
  const report = teamSummary({ snapshot, claims, locals, pulls, dispatch });
  report.coordinationHead = state.head;
  writeJSON(inside(root, '.gameprod/evidence/team.json'), report);
  const compact = {
    ...report,
    workers: report.workers.map((w) => ({
      ...w,
      dirtyPathCount: w.dirtyPaths.length,
      dirtyPaths: w.dirtyPaths.filter((p) => !p.startsWith('docs/media/gallery/')).slice(0, 16)
    })),
    fullLocalReport: '.gameprod/evidence/team.json'
  };
  if (mode === 'publish') {
    const text =
      '## Координация параллельных исполнителей\n\n' +
      JSON.stringify(compact, null, 2) +
      '\n\nЭто наблюдение Git/Issues, не чтение закрытых чатов и не запуск дополнительных моделей. Не менять чужие черновики; собственный срез брать через work next.';
    await upsertComment(client, 29, 'team-current', text);
  }
  console.log(JSON.stringify(compact, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('TEAM_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
