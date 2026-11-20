import { createHash } from 'node:crypto';
import { validatePlan } from './control.mjs';
import { REPO, TRUSTED } from './hub-identity.mjs';
const ID = /^[A-Z]+-\d+$/;
const SHA = /^[a-f0-9]{40}$/;
const INDEX = '<!-- gameprod:memory:v1 -->';
const hash = (text) => createHash('sha256').update(text).digest('hex');
export function taskBody(task, commit) {
  if (!ID.test(task.id) || !SHA.test(commit)) throw Error('Invalid task identity');
  return (
    `<!-- gameprod:task:${task.id} -->\n# ${task.title}\n\n` +
    `Основная память задачи — эта Issue. Обсуждение и результаты сохраняются здесь; файлы репозитория — проверяемый снимок.\n\n` +
    `Исходный статус: **${task.status}**. Это историческая запись, не допуск нового RC.\n\n` +
    `## Критерии\n${task.acceptance.map((x) => '- [ ] ' + x).join('\n')}\n\n` +
    `## Запуск\n\`npm run game -- task ${task.id}\`\n\n` +
    `## Источник\n${task.source}\n\nСнимок: ${commit}\n\n` +
    `<!-- gameprod:definition:start -->\n\`\`\`json\n${JSON.stringify(task, null, 2)}\n\`\`\`\n<!-- gameprod:definition:end -->\n`
  );
}

export function readTask(issue) {
  if (issue.pull_request || !TRUSTED.includes(issue.user?.login)) return null;
  const id = /^<!-- gameprod:task:([A-Z]+-\d+) -->/.exec(issue.body || '')?.[1];
  if (!id) return null;
  const m =
    /<!-- gameprod:definition:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- gameprod:definition:end -->/.exec(
      issue.body
    );
  if (!m) throw Error('ISSUE_DEFINITION_MISSING #' + issue.number);
  let task;
  try {
    task = JSON.parse(m[1]);
  } catch {
    throw Error('ISSUE_DEFINITION_INVALID #' + issue.number);
  }
  if (task.id !== id) throw Error('ISSUE_ID_MISMATCH');
  return {
    task,
    issue: issue.number,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    issueState: issue.state,
    bodySha256: hash(issue.body)
  };
}

export async function memorySnapshot(client, seedPlan) {
  const issues = (await client.list('/issues?state=all')).filter((i) => !i.pull_request);
  const records = issues.map(readTask).filter(Boolean);
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.task.id)) throw Error('DUPLICATE_MANAGED_ISSUE ' + record.task.id);
    seen.add(record.task.id);
  }
  const missing = seedPlan.tasks.filter((task) => !seen.has(task.id)).map((task) => task.id);
  const restored = new Map(seedPlan.tasks.map((t) => [t.id, t]));
  for (const record of records) restored.set(record.task.id, record.task);
  const plan = validatePlan({ ...seedPlan, tasks: [...restored.values()] });
  return {
    schemaVersion: 1,
    repository: REPO,
    observedAt: new Date().toISOString(),
    source: records.length
      ? missing.length
        ? 'github-issues-partial-migration'
        : 'github-issues'
      : 'seed-not-migrated',
    missing,
    plan,
    records,
    index:
      issues.find((i) => TRUSTED.includes(i.user?.login) && (i.body || '').startsWith(INDEX))
        ?.number || null
  };
}

async function createOnce(client, marker, title, body) {
  const lookup = async () =>
    (await client.list('/issues?state=all')).filter(
      (i) => !i.pull_request && TRUSTED.includes(i.user?.login) && (i.body || '').startsWith(marker)
    );
  const existing = await lookup();
  if (existing.length > 1) throw Error('DUPLICATE_ISSUE_MARKER');
  if (existing.length) return existing[0];
  try {
    return await client.api('POST', '/issues', { title, body });
  } catch (error) {
    const observed = await lookup();
    if (observed.length === 1) return observed[0];
    throw error;
  }
}

export async function syncMemory(client, plan, commit) {
  validatePlan(plan);
  if (!SHA.test(commit)) throw Error('SOURCE_SHA_REQUIRED');
  let current = (await client.list('/issues?state=all')).filter((i) => !i.pull_request);
  const indexRows = current.filter(
    (i) => TRUSTED.includes(i.user?.login) && (i.body || '').startsWith(INDEX)
  );
  if (indexRows.length > 1) throw Error('DUPLICATE_MEMORY_INDEX');
  const index =
    indexRows[0] ||
    (await createOnce(
      client,
      INDEX,
      '[MEMORY] Multimental — задачи, решения, релизы и продолжение',
      INDEX +
        '\n# Multimental: постоянная память\n\nВсе задачи и результаты — в связанных Issues. ' +
        'Начало: `npm run game -- resume`. Закрытая Issue сама по себе не является доказательством прохождения тестов. ' +
        'Dev может выпускаться без телефона; установка, аппаратные проверки и ручная приёмка учитываются отдельно. ' +
        'Main/stable/Google Play production требуют отдельного разрешения владельца.\n'
    ));
  const records = current.map(readTask).filter(Boolean);
  const seen = new Map();
  for (const row of records) {
    if (seen.has(row.task.id)) throw Error('DUPLICATE_MANAGED_ISSUE ' + row.task.id);
    seen.set(row.task.id, row.issue);
  }
  for (const task of plan.tasks) {
    if (seen.has(task.id)) continue; // Never overwrite edits made in the primary memory.
    await client.pause(800);
    const issue = await createOnce(
      client,
      '<!-- gameprod:task:' + task.id + ' -->',
      '[' + task.id + '] ' + task.title,
      taskBody(task, commit)
    );
    seen.set(task.id, issue.number);
    if (task.status === 'verified') {
      await client.pause(800);
      await client.api('PATCH', '/issues/' + issue.number, {
        state: 'closed',
        state_reason: 'completed'
      });
    }
  }
  const table = plan.tasks.map((t) => '- ' + t.id + ': #' + seen.get(t.id)).join('\n');
  await upsertComment(
    client,
    index.number,
    'task-index',
    '## Навигация по задачам\n\n' +
      table +
      '\n\nПервичная миграция не изменяет критерии и не выдаёт исторический результат за новый RC.'
  );
  return { index: index.number, issues: Object.fromEntries(seen), count: seen.size };
}

export async function upsertComment(client, issue, key, text) {
  if (!Number.isSafeInteger(issue) || issue < 1 || !/^[a-zA-Z0-9:._-]{1,140}$/.test(key))
    throw Error('COMMENT_IDENTITY_INVALID');
  const marker = '<!-- gameprod:record:' + key + ' -->';
  const body = marker + '\n' + text;
  if (body.length > 60000) throw Error('COMMENT_TOO_LONG');
  const rows = (await client.list('/issues/' + issue + '/comments')).filter(
    (c) => TRUSTED.includes(c.user?.login) && (c.body || '').startsWith(marker)
  );
  if (rows.length > 1) throw Error('DUPLICATE_RECORD');
  if (rows[0]?.body === body) return rows[0];
  if (rows.length) return client.api('PATCH', '/issues/comments/' + rows[0].id, { body });
  try {
    return await client.api('POST', '/issues/' + issue + '/comments', { body });
  } catch (error) {
    const found = (await client.list('/issues/' + issue + '/comments')).filter(
      (c) => TRUSTED.includes(c.user?.login) && c.body === body
    );
    if (found.length === 1) return found[0];
    throw error;
  }
}
