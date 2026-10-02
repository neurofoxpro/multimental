import { validatePlan } from './control.mjs';
import { taskResources } from './collaboration.mjs';
const HUMAN = new Set([
  'product',
  'subjective',
  'physical_consent',
  'release_approval',
  'external'
]);
export function options(args) {
  const [mode = 'plan', ...rest] = args;
  if (!['plan', 'next', 'enroll'].includes(mode))
    throw Error('work plan|next ALIAS|enroll PROPOSAL');
  if (mode === 'enroll') {
    if (rest.length !== 1 || !/^\.gameprod\/ideas\/[a-zA-Z0-9_-]+\.json$/.test(rest[0]))
      throw Error('Explicit proposal required');
    return { mode, file: rest[0] };
  }
  let alias = null;
  if (mode === 'next') {
    alias = rest.shift();
    if (!/^[a-z][a-z0-9-]{2,47}$/.test(alias || '')) throw Error('Unique alias required');
  }
  const tags = [];
  for (let i = 0; i < rest.length; i += 2) {
    if (
      rest[i] !== '--tag' ||
      !/^[a-zA-Z0-9:_-]{1,80}$/.test(rest[i + 1] || '') ||
      tags.includes(rest[i + 1])
    )
      throw Error('Expected unique --tag VALUE');
    tags.push(rest[i + 1]);
  }
  if (tags.length > 8) throw Error('Too many tags');
  return { mode, alias, tags };
}
export function dispatchPlan(snapshot, claims, config, tags = [], lanes = 3) {
  if (
    snapshot?.source !== 'github-issues' ||
    snapshot.missing?.length !== 0 ||
    !Array.isArray(claims)
  )
    throw Error('Fresh complete Issue and claim snapshot required');
  validatePlan(snapshot.plan);
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 8) throw Error('Bounded lanes required');
  const byId = new Map(snapshot.plan.tasks.map((t) => [t.id, t]));
  const records = new Map(snapshot.records.map((r) => [r.task.id, r]));
  if (records.size !== byId.size || snapshot.records.length !== byId.size)
    throw Error('Incomplete or duplicate task records');
  for (const claim of claims)
    if (
      !claim ||
      !byId.has(claim.task) ||
      typeof claim.owner !== 'string' ||
      !Array.isArray(claim.resources)
    )
      throw Error('Unknown claim resource state');
  const rows = [];
  for (const task of snapshot.plan.tasks) {
    if (task.status === 'verified') continue;
    const row = records.get(task.id);
    const resources = [...new Set(['task:' + task.id, ...taskResources(task, config)])].sort();
    const occupied = claims.filter(
      (c) => c.resources.some((r) => resources.includes(r)) || c.task === task.id
    );
    const dependencies = task.dependsOn.filter((id) => byId.get(id)?.status !== 'verified');
    const human = HUMAN.has(task.kind) || task.status === 'manual';
    const priority =
      task.priority <= 5 ? 'p0' : task.priority <= 20 ? 'p1' : task.priority <= 60 ? 'p2' : 'p3';
    const area = resources.find((r) => r.startsWith('area:'))?.slice(5) || 'release';
    const labels = [
      'task:' + task.id,
      'kind:' + task.kind,
      'gp:area:' + area,
      'gp:priority:' + priority,
      ...(task.requiredForBeta ? ['beta'] : []),
      ...(task.tags || [])
    ];
    if (labels.some((t) => typeof t !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(t)))
      throw Error('Invalid task tags');
    const held = [
      ...(human ? ['human-or-external-gate'] : []),
      ...(row.issueState === 'closed' ? ['closed-issue-definition-inconsistent'] : []),
      ...dependencies.map((id) => 'dependency:' + id),
      ...occupied.map((c) => 'owner:' + c.owner)
    ];
    if (tags.some((t) => !labels.includes(t))) continue;
    rows.push({
      id: task.id,
      issue: row.issue,
      title: task.title,
      priority: task.priority,
      kind: task.kind,
      tags: labels,
      resources,
      blockedBy: held,
      unblocks: snapshot.plan.tasks.filter(
        (t) => t.status !== 'verified' && t.dependsOn.includes(task.id)
      ).length
    });
  }
  rows.sort(
    (a, b) => a.priority - b.priority || b.unblocks - a.unblocks || a.id.localeCompare(b.id)
  );
  const ready = rows.filter((r) => r.blockedBy.length === 0),
    held = rows.filter((r) => r.blockedBy.length !== 0);
  const pending = [...ready],
    waves = [];
  while (pending.length) {
    const taken = new Set(),
      wave = [];
    for (let i = 0; i < pending.length && wave.length < lanes;) {
      const task = pending[i];
      if (task.resources.some((r) => taken.has(r))) {
        i++;
        continue;
      }
      wave.push(task.id);
      task.resources.forEach((r) => taken.add(r));
      pending.splice(i, 1);
    }
    waves.push(wave);
  }
  return {
    status: 'planned',
    selectedTags: [...tags],
    ready,
    held,
    waves,
    prioritiesChanged: false,
    labelsAreLocks: false,
    agentsStarted: false,
    deviceActions: false
  };
}
export function selectDispatch(plan, alias, prior, claims, binding) {
  if (binding && !binding.released)
    throw Error('Finish or deliberately release current task before claiming another');
  const existing = claims.find((c) => c.owner === alias);
  if (prior) {
    if (prior.alias !== alias || !/^([A-Z]+-\d+)$/.test(prior.task || ''))
      throw Error('Dispatch checkpoint mismatch');
    if (existing && existing.task !== prior.task) throw Error('Alias owns another task');
    if (prior.status === 'ready' && !existing)
      throw Error('Old dispatch claim released; use a new unique alias');
    if (!existing && !plan.ready.some((t) => t.id === prior.task))
      throw Error('Recorded selection no longer ready');
    return prior.task;
  }
  if (existing)
    throw Error('Alias already belongs to another dispatch; resume exact recorded slice');
  return plan.ready[0]?.id || null;
}
