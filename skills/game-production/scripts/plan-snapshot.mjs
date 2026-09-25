import { validatePlan } from './control.mjs';
import { REPO } from './hub-identity.mjs';
// Live Issue definitions are data; this never executes commands or grants release authority.
export function proposedSnapshot(seed, snapshot) {
  validatePlan(seed);
  if (
    snapshot?.repository !== REPO ||
    snapshot.source !== 'github-issues' ||
    !Array.isArray(snapshot.missing) ||
    snapshot.missing.length ||
    !Array.isArray(snapshot.records)
  )
    throw Error('Complete live Issue snapshot required');
  const time = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(time)) throw Error('Snapshot timestamp required');
  const records = new Map();
  const issueNumbers = new Set();
  for (const row of snapshot.records) {
    if (
      !row?.task?.id ||
      records.has(row.task.id) ||
      !Number.isSafeInteger(row.issue) ||
      row.issue < 1 ||
      !/^[a-f0-9]{64}$/.test(row.bodySha256 || '')
    )
      throw Error('Invalid or duplicate Issue identity');
    if (issueNumbers.has(row.issue)) throw Error('Two tasks reference the same Issue');
    issueNumbers.add(row.issue);
    records.set(row.task.id, row);
  }
  const tasks = seed.tasks.map((old) => {
    const row = records.get(old.id);
    if (!row) throw Error('Missing primary task: ' + old.id);
    if (old.requiredForPlay && row.task.requiredForPlay === false)
      throw Error('Scope removal needs separate reviewed decision: ' + old.id);
    return structuredClone(row.task);
  });
  if (records.size !== tasks.length) throw Error('New task requires explicit workplan enrollment');
  const next = validatePlan({ ...seed, tasks });
  const changes = tasks
    .filter((task, i) => JSON.stringify(task) !== JSON.stringify(seed.tasks[i]))
    .map((task) => ({
      id: task.id,
      issue: records.get(task.id).issue,
      from: seed.tasks.find((x) => x.id === task.id).status,
      to: task.status,
      sourceHash: records.get(task.id).bodySha256
    }));
  if (changes.length) next.updatedAt = new Date(time).toISOString().slice(0, 10);
  return { plan: next, changes, source: 'github-issues', publicationAuthorized: false };
}
