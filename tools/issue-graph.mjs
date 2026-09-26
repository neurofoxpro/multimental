import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HubClient } from '../skills/game-production/scripts/hub-client.mjs';
import { memorySnapshot, upsertComment } from '../skills/game-production/scripts/issue-memory.mjs';
import { GitHubCoordination } from '../skills/game-production/scripts/collaboration-store.mjs';
import { taskResources } from '../skills/game-production/scripts/collaboration.mjs';
import {
  findRoot,
  context,
  readJSON,
  inside,
  writeJSON
} from '../skills/game-production/scripts/lib.mjs';
export function desiredMetadata(snapshot, claims, config) {
  if (snapshot.source !== 'github-issues' || snapshot.missing.length)
    throw Error('Complete primary graph required');
  const byId = new Map(snapshot.records.map((r) => [r.task.id, r]));
  return snapshot.records.map((row) => {
    const t = row.task,
      blocked = t.dependsOn.filter((id) => byId.get(id)?.task.status !== 'verified');
    const state =
      t.status === 'verified'
        ? 'verified'
        : claims.some((c) => c.task === t.id)
          ? 'active'
          : t.status === 'manual'
            ? 'external'
            : blocked.length
              ? 'blocked'
              : 'ready';
    const priority =
      t.priority <= 5 ? 'p0' : t.priority <= 20 ? 'p1' : t.priority <= 60 ? 'p2' : 'p3';
    const area =
      taskResources(t, config)
        .find((r) => r.startsWith('area:'))
        ?.slice(5) || 'release';
    return {
      issue: row.issue,
      id: t.id,
      status: state,
      priority,
      labels: ['gp:status:' + state, 'gp:priority:' + priority, 'gp:area:' + area],
      dependencies: t.dependsOn.map((id) => {
        if (!byId.has(id)) throw Error('Missing dependency');
        return byId.get(id).issue;
      })
    };
  });
}
export async function synchronizeMetadata(client, snapshot, claims, config) {
  const items = desiredMetadata(snapshot, claims, config),
    allIssues = await client.list('/issues?state=all');
  const byNumber = new Map(allIssues.filter((i) => !i.pull_request).map((i) => [i.number, i]));
  let labels = await client.list('/labels'),
    writes = 0;
  const needed = [...new Set(items.flatMap((x) => x.labels))].sort();
  for (const name of needed)
    if (!labels.some((l) => l.name === name)) {
      await client.pause(1000);
      try {
        await client.api('POST', '/labels', {
          name,
          color: '2f81f7',
          description: 'Managed projection; not an ownership lock'
        });
        writes++;
      } catch (error) {
        labels = await client.list('/labels');
        if (!labels.some((l) => l.name === name)) throw error;
      }
    }
  for (const item of items) {
    const issue = byNumber.get(item.issue);
    if (!issue) throw Error('Issue unavailable');
    const present = issue.labels.map((l) => l.name);
    const missing = item.labels.filter((name) => !present.includes(name));
    if (missing.length) {
      await client.pause(1000);
      await client.api('POST', '/issues/' + item.issue + '/labels', { labels: missing });
      writes++;
    }
    for (const name of present.filter(
      (n) => /^gp:(status|priority|area):/.test(n) && !item.labels.includes(n)
    )) {
      await client.pause(1000);
      await client.api('DELETE', '/issues/' + item.issue + '/labels/' + encodeURIComponent(name));
      writes++;
    }
    const dependencies = await client.list('/issues/' + item.issue + '/dependencies/blocked_by');
    for (const number of item.dependencies) {
      const parent = byNumber.get(number);
      if (!Number.isSafeInteger(parent?.id)) throw Error('Dependency needs stable database ID');
      if (dependencies.some((d) => d.id === parent.id)) continue;
      await client.pause(1000);
      try {
        await client.api('POST', '/issues/' + item.issue + '/dependencies/blocked_by', {
          issue_id: parent.id
        });
        writes++;
      } catch (error) {
        const observed = await client.list('/issues/' + item.issue + '/dependencies/blocked_by');
        if (!observed.some((d) => d.id === parent.id)) throw error;
      }
    }
  }
  return {
    status: 'synchronized',
    tasks: items.length,
    writes,
    items,
    manualRelationshipsPreserved: true,
    labelsAreLocks: false
  };
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'plan', ...extra] = args;
  if (!['plan', 'sync'].includes(mode) || extra.length) throw Error('issue-graph plan|sync');
  const root = findRoot(),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/dev')
  )
    throw Error('Issue writer is dev-push only');
  const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 });
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || gh.stdout?.trim();
  const client = new HubClient(token),
    store = new GitHubCoordination(token),
    config = readJSON(inside(root, '.gameprod/collaboration.json'));
  const snapshot = await memorySnapshot(client, readJSON(inside(root, '.gameprod/workplan.json')));
  const coord = await store.read(),
    claims = coord ? Object.values(coord.state.claims) : [];
  const result =
    mode === 'sync'
      ? await synchronizeMetadata(client, snapshot, claims, config)
      : { status: 'planned', items: desiredMetadata(snapshot, claims, config) };
  writeJSON(inside(root, '.gameprod/evidence/issue-graph.json'), {
    at: new Date().toISOString(),
    ...result
  });
  if (mode === 'sync')
    await upsertComment(
      client,
      29,
      'parallel-index',
      '## Очередь параллельных срезов\n\n' +
        result.items
          .filter((x) => x.status !== 'verified')
          .map(
            (x) =>
              '- #' +
              x.issue +
              ' ' +
              x.id +
              ' — ' +
              x.priority +
              ' / ' +
              x.status +
              (x.dependencies.length
                ? ' / после ' + x.dependencies.map((n) => '#' + n).join(', ')
                : '')
          )
          .join('\n') +
        '\n\nВладение: `npm run game -- collab status`. Метки — представление, не блокировка.'
    );
  console.log(
    JSON.stringify(
      mode === 'sync'
        ? { status: result.status, tasks: result.tasks, writes: result.writes }
        : result,
      null,
      2
    )
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('ISSUE_GRAPH_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
