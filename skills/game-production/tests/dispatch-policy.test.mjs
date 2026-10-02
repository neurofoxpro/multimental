import test from 'node:test';
import assert from 'node:assert/strict';
import { options, dispatchPlan, selectDispatch } from '../scripts/dispatch-policy.mjs';
const repo = 'neurofoxpro/multimental';
function task(id, extra = {}) {
  return {
    id,
    title: id,
    stage: 'development',
    kind: 'game',
    source: 'owner',
    status: 'planned',
    priority: 10,
    dependsOn: [],
    acceptance: ['must pass'],
    evidence: [],
    readset: [],
    requiredForBeta: true,
    requiredForPlay: true,
    ...extra
  };
}
const config = {
  taskResources: {},
  kindResources: {
    game: ['area:core'],
    ui: ['area:ui'],
    automation: ['area:auto'],
    external: ['area:external']
  }
};
function snapshot(tasks) {
  return {
    source: 'github-issues',
    missing: [],
    plan: { schemaVersion: 1, repository: repo, tasks },
    records: tasks.map((t, i) => ({ task: t, issue: i + 1, issueState: 'open' }))
  };
}
test('independent waves follow explicit priorities without assigning agents', () => {
  const s = snapshot([
    task('CORE-01'),
    task('UX-01', { kind: 'ui', priority: 2 }),
    task('CORE-02'),
    task('AUTO-01', { kind: 'automation' })
  ]);
  const p = dispatchPlan(s, [], config);
  assert.deepEqual(p.waves, [['UX-01', 'AUTO-01', 'CORE-01'], ['CORE-02']]);
  assert.equal(p.agentsStarted, false);
  assert.equal(p.prioritiesChanged, false);
});
test('expired claims still hold all overlapping work; labels never authorize a write', () => {
  const s = snapshot([task('CORE-01'), task('CORE-02'), task('UX-01', { kind: 'ui' })]);
  const p = dispatchPlan(
    s,
    [{ task: 'CORE-01', owner: 'other', resources: ['area:core'], expiresAt: 1 }],
    config
  );
  assert.deepEqual(
    p.ready.map((t) => t.id),
    ['UX-01']
  );
  assert.equal(p.held.length, 2);
});
test('dependencies and human gates cannot be auto-claimed', () => {
  const p = dispatchPlan(
    snapshot([
      task('CORE-01'),
      task('CORE-02', { dependsOn: ['CORE-01'] }),
      task('STORE-01', { kind: 'external', status: 'manual', priority: 1 })
    ]),
    [],
    config
  );
  assert.deepEqual(
    p.ready.map((t) => t.id),
    ['CORE-01']
  );
  assert.equal(p.held.length, 2);
});
test('multiple tags are AND filters with projected GitHub areas', () => {
  const s = snapshot([
    task('UX-01', { kind: 'ui' }),
    task('UX-02', { kind: 'ui', requiredForBeta: false }),
    task('CORE-01')
  ]);
  assert.deepEqual(
    dispatchPlan(s, [], config, ['gp:area:ui', 'beta']).ready.map((t) => t.id),
    ['UX-01']
  );
});
test('closed nonverified definition is held instead of rerun', () => {
  const s = snapshot([task('CORE-01')]);
  s.records[0].issueState = 'closed';
  assert.equal(dispatchPlan(s, [], config).ready.length, 0);
});
for (const change of [
  (s) => (s.source = 'cached'),
  (s) => (s.missing = ['CORE-02']),
  (s) => (s.records = []),
  (s) => s.records.push(s.records[0])
])
  test('incomplete snapshots fail closed ' + change, () => {
    const s = snapshot([task('CORE-01')]);
    change(s);
    assert.throws(() => dispatchPlan(s, [], config));
  });
for (const args of [
  ['next'],
  ['next', '../x'],
  ['plan', '--tag'],
  ['plan', '--tag', 'a;b'],
  ['plan', '--tag', 'beta', '--tag', 'beta'],
  ['enroll', '../../x'],
  ['unknown']
])
  test('invalid args ' + args.join(' '), () => assert.throws(() => options(args)));
test('parser accepts exact alias and safe literal tags', () =>
  assert.deepEqual(options(['next', 'ui-worker-123', '--tag', 'gp:area:ui']), {
    mode: 'next',
    alias: 'ui-worker-123',
    tags: ['gp:area:ui']
  }));
test('ambiguous start is resumed for same task, never silently selects another', () => {
  const p = { ready: [{ id: 'CORE-02' }] };
  const old = { alias: 'worker', task: 'CORE-01', status: 'starting' };
  assert.equal(
    selectDispatch(p, 'worker', old, [{ owner: 'worker', task: 'CORE-01' }], null),
    'CORE-01'
  );
  assert.throws(() => selectDispatch(p, 'worker', old, [], null));
  assert.throws(() =>
    selectDispatch(p, 'worker', null, [{ owner: 'worker', task: 'CORE-01' }], null)
  );
});
test('one task per active binding', () => {
  assert.throws(() =>
    selectDispatch({ ready: [{ id: 'CORE-01' }] }, 'new', null, [], { released: false })
  );
  assert.equal(
    selectDispatch({ ready: [{ id: 'CORE-01' }] }, 'new', null, [], { released: true }),
    'CORE-01'
  );
});
test('finished released aliases cannot be recycled', () =>
  assert.throws(() =>
    selectDispatch(
      { ready: [{ id: 'CORE-01' }] },
      'old',
      { alias: 'old', task: 'CORE-01', status: 'ready' },
      [],
      null
    )
  ));

import { ideaIsClosed } from '../scripts/control.mjs';
test('multi-task enrollment is closed only when every managed task is done', () => {
  const tasks = [task('UX-08'), task('UX-09')],
    plan = snapshot(tasks).plan;
  const idea = { schemaVersion: 1, id: 'IDEA-12', type: 'task_enrollment', tasks };
  assert.equal(ideaIsClosed(idea, plan), false);
  tasks[0].status = 'verified';
  assert.equal(ideaIsClosed(idea, plan), false);
  tasks[1].status = 'verified';
  assert.equal(ideaIsClosed(idea, plan), true);
  assert.throws(() => ideaIsClosed({ ...idea, tasks: [] }, plan));
  assert.throws(() => ideaIsClosed({ ...idea, tasks: [tasks[0], tasks[0]] }, plan));
  assert.throws(() => ideaIsClosed({ ...idea, tasks: [{ id: 'UX-99' }] }, plan));
});
