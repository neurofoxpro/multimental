import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CANONICAL_REPOSITORY = 'neurofoxpro/multimental';
export const PLAN_FILE = '.gameprod/workplan.json';
const OPS = 'skills/game-production/scripts/ops.mjs';
const STATES = ['planned', 'implemented', 'verified', 'manual'];
const HUMAN_KINDS = ['product', 'subjective', 'physical_consent', 'release_approval', 'external'];
const ID = /^[A-Z]+-\d+$/;
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function validatePlan(plan) {
  if (plan?.schemaVersion !== 1 || plan.repository !== CANONICAL_REPOSITORY) {
    throw Error('Explicit canonical workplan required');
  }
  if (!Array.isArray(plan.tasks) || !plan.tasks.length) throw Error('Empty workplan');
  const seen = new Map();
  for (const task of plan.tasks) {
    if (!ID.test(task.id) || seen.has(task.id)) throw Error('Invalid/duplicate task ID');
    if (
      typeof task.title !== 'string' ||
      !task.title ||
      typeof task.source !== 'string' ||
      !task.source ||
      typeof task.stage !== 'string' ||
      !task.stage ||
      !STATES.includes(task.status)
    ) {
      throw Error('Incomplete task ' + task.id);
    }
    if (
      !Array.isArray(task.dependsOn) ||
      !Array.isArray(task.acceptance) ||
      !task.acceptance.length
    ) {
      throw Error('Dependencies and acceptance required: ' + task.id);
    }
    if (task.acceptance.some((x) => typeof x !== 'string' || !x.trim()))
      throw Error('Empty acceptance text');
    if (!Array.isArray(task.evidence) || !Array.isArray(task.readset)) {
      throw Error('Evidence/readset required: ' + task.id);
    }
    if ([...task.evidence, ...task.readset].some((ref) => !safeRelative(ref)))
      throw Error('Unsafe input reference: ' + task.id);
    if (task.status === 'verified' && !task.evidence.length) {
      throw Error('Historical verification without evidence: ' + task.id);
    }
    if (task.status === 'manual' && !HUMAN_KINDS.includes(task.kind)) {
      throw Error('Missing software cannot be a manual gate: ' + task.id);
    }
    if (typeof task.requiredForPlay !== 'boolean' || typeof task.requiredForBeta !== 'boolean') {
      throw Error('Explicit release scope required: ' + task.id);
    }
    if (!task.requiredForPlay && !task.disposition) {
      throw Error('Out-of-scope idea needs explicit disposition: ' + task.id);
    }
    if (!Number.isFinite(task.priority)) throw Error('Priority required: ' + task.id);
    seen.set(task.id, task);
  }
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (!seen.has(id)) throw Error('Missing dependency: ' + id);
    if (active.has(id)) throw Error('Dependency cycle: ' + id);
    if (visited.has(id)) return;
    active.add(id);
    for (const parent of seen.get(id).dependsOn) visit(parent);
    active.delete(id);
    visited.add(id);
  }
  for (const id of seen.keys()) visit(id);
  return plan;
}

export function nextTasks(plan) {
  validatePlan(plan);
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  return plan.tasks
    .filter((task) => task.status !== 'verified' && task.requiredForPlay)
    .map((task) => ({
      id: task.id,
      title: task.title,
      kind: task.kind,
      status: task.status,
      priority: task.priority,
      blockedBy: task.dependsOn.filter((id) => byId.get(id).status !== 'verified'),
      nextCommand: 'npm run game -- task ' + task.id
    }))
    .sort((a, b) => a.blockedBy.length - b.blockedBy.length || a.priority - b.priority);
}

export function projectRequirements(plan) {
  validatePlan(plan);
  return {
    schemaVersion: 1,
    observedAt: plan.updatedAt,
    repository: plan.repository,
    generatedFrom: PLAN_FILE,
    evidenceSemantics: 'Historical evidence only; not a fresh release gate or human approval.',
    requirements: plan.tasks.map((task) => ({
      id: task.id,
      text: task.title,
      version: task.stage,
      status: task.status,
      kind: task.kind === 'external' ? 'release_approval' : task.kind,
      evidence: task.evidence,
      source: task.source,
      requiredForBeta: task.requiredForBeta
    })),
    principle: 'Absent implementation is engineering work, never a human acceptance checkbox.'
  };
}

export function releaseBlockers(plan, ideas = []) {
  validatePlan(plan);
  const blockers = plan.tasks
    .filter((task) => task.requiredForPlay && task.status !== 'verified')
    .map((task) => ({ id: task.id, kind: task.kind, reason: task.title }));
  for (const idea of ideas) {
    if (!ideaIsClosed(idea, plan))
      blockers.push({ id: idea.id, reason: 'Idea has no completed task or explicit disposition' });
  }
  // This inventory cannot authorize publication, even with all task statuses changed.
  for (const key of [
    'freshRcQualification',
    'ownerReleaseApproval',
    'playReadback',
    'storeInstall'
  ]) {
    blockers.push({
      id: key,
      reason: 'Must be checked by the protected release adapter, not a metadata boolean'
    });
  }
  return blockers;
}

export function safeRelative(ref) {
  return (
    typeof ref === 'string' &&
    /^[a-zA-Z0-9_.\/-]+$/.test(ref) &&
    !ref.startsWith('/') &&
    !ref.split('/').some((part) => !part || part === '.' || part === '..')
  );
}

export function ideaIsClosed(idea, plan) {
  if (!ID.test(idea?.id || '')) throw Error('Invalid idea ID');
  if (idea.taskId) {
    const task = plan.tasks.find((item) => item.id === idea.taskId);
    if (!task) throw Error('Idea references missing task');
    return task.status === 'verified' || (!task.requiredForPlay && !!task.disposition);
  }
  return (
    ['rejected', 'deferred'].includes(idea.status) &&
    !!idea.reason &&
    safeRelative(idea.decisionEvidence) &&
    Array.isArray(idea.source) &&
    idea.source.length > 0
  );
}

export function projectBacklog(plan) {
  return plan.tasks.map((task) => ({
    id: task.id,
    status: task.status === 'verified' ? 'done' : 'pending',
    action: task.title,
    dependsOn: task.dependsOn,
    manual: HUMAN_KINDS.includes(task.kind),
    generatedFrom: PLAN_FILE,
    evidence: task.evidence,
    nextCommand: 'npm run game -- task ' + task.id
  }));
}

export function assessReceipt(receipt, expected, readBytes) {
  if (!receipt || receipt.status !== 'passed' || receipt.exitCode !== 0) return 'failed_or_missing';
  if (!SHA.test(expected.commit || '') || !HASH.test(expected.sourceDigest || '')) {
    return 'missing_expected_identity';
  }
  if (receipt.commit !== expected.commit || receipt.sourceDigest !== expected.sourceDigest) {
    return 'stale_source';
  }
  if (!Array.isArray(receipt.logs) || !receipt.logs.length) return 'missing_logs';
  if (
    receipt.sourceChanged === true ||
    (receipt.sourceDigestAfter && receipt.sourceDigestAfter !== receipt.sourceDigest)
  )
    return 'source_changed_during_step';
  if (receipt.artifacts !== undefined && !Array.isArray(receipt.artifacts))
    return 'invalid_artifacts';
  try {
    for (const item of [...receipt.logs, ...(receipt.artifacts || [])]) {
      if (
        !safeRelative(item.path) ||
        !HASH.test(item.sha256 || '') ||
        digest(readBytes(item.path)) !== item.sha256
      ) {
        return 'changed_evidence';
      }
    }
    for (const required of expected.artifacts || []) {
      if (!receipt.artifacts?.some((item) => item.path === required)) return 'missing_artifact';
    }
  } catch {
    return 'unreadable_evidence';
  }
  return 'passed';
}

export function taskPacket(plan, id) {
  validatePlan(plan);
  const task = plan.tasks.find((item) => item.id === id);
  if (!task) throw Error('Unknown task ' + id);
  return {
    schemaVersion: 1,
    repository: plan.repository,
    authorizedHost: 'VENEL-SENDRIK',
    task,
    readset: [
      ...new Set([
        'AGENTS.md',
        'NEXT_CHAT.ru.md',
        'docs/production/AUTHORITY.md',
        PLAN_FILE,
        ...task.readset
      ])
    ],
    sequence: [
      'read inputs',
      'reproduce baseline',
      'implement small change',
      'check',
      'review',
      'ship',
      'record evidence'
    ],
    commands: {
      start: 'npm run game -- start ' + id,
      experiment: 'npm run game -- experiment ' + id,
      check: 'npm run game -- check',
      ship: 'npm run game -- ship ' + id,
      recover: 'npm run game -- resume-cycle'
    },
    boundaries: [
      'Do not change accepted game rules without owner approval.',
      'Do not replace missing software with manual acceptance.',
      'Do not use other hosts/repos, remove phone data or regenerate installed signing identity.',
      'Main, stable and Google Play production require separate owner approval.',
      'Historical receipts do not qualify a new candidate.'
    ]
  };
}

export function renderRoadmap(plan) {
  validatePlan(plan);
  const stages = [...new Set(plan.tasks.map((task) => task.stage))];
  return (
    '# Multimental — от идеи до Google Play\n\n' +
    'Источник: `' +
    PLAN_FILE +
    '`. Обновлено: ' +
    plan.updatedAt +
    '.\n\n' +
    '**Исторически проверено не означает допуск текущего RC.** Невыполненный код не является ручной задачей.\n\n' +
    '## Работа одной командой\n\n' +
    '```text\nnpm run game -- next\nnpm run game -- task META-05\nnpm run game -- start META-05\nnpm run game -- check\nnpm run game -- ship META-05\nnpm run game -- resume-cycle\nnpm run game -- play-check\n```\n\n' +
    'Dev APK продолжаются небольшими итерациями. Play не публикуется, пока инженерные, продуктовые и внешние gates не пройдены.\n\n' +
    stages
      .map(
        (stage) =>
          '## ' +
          stage +
          '\n\n' +
          plan.tasks
            .filter((task) => task.stage === stage)
            .map(
              (task) =>
                '### ' +
                task.id +
                ' — ' +
                task.title +
                '\n\n' +
                'Статус: **' +
                task.status +
                '**. Ответственность: ' +
                task.kind +
                '. До Play: ' +
                (task.requiredForPlay ? 'да' : 'нет — ' + task.disposition) +
                '.\n\n' +
                'Зависимости: ' +
                (task.dependsOn.join(', ') || 'нет') +
                '.\n\n' +
                task.acceptance.map((line) => '- ' + line).join('\n') +
                '\n\n' +
                'Пакет работ: `npm run game -- task ' +
                task.id +
                '`.\n'
            )
            .join('\n')
      )
      .join('\n') +
    '\n## Сохранённая история\n\n' +
    'Последний ранее установленный dev: 0.5.1-alpha.105.1. Матрица 29/29 относится к кандидату .104.1, не к новому изменению. ' +
    '30 карт и 10 стихий, размещение с добровольной атакой, поворот, первый удар, стихийные клетки и доход 4/6 сохраняются. ' +
    'Старая roadmap архивирована в docs/production/ROADMAP.20260925-baseline.ru.md.\n'
  );
}

export function commandFor(name, args, plan) {
  if (name === 'start') {
    if (args.length !== 1 || !ID.test(args[0])) throw Error('start requires one task ID');
    const packet = taskPacket(plan, args[0]);
    if (HUMAN_KINDS.includes(packet.task.kind))
      throw Error('Owner/external task is not a code branch');
    const blocked = nextTasks(plan).find((task) => task.id === args[0])?.blockedBy || [];
    if (blocked.length) throw Error('Unfinished prerequisites: ' + blocked.join(', '));
    return [process.execPath, OPS, 'begin', 'feature/' + args[0].toLowerCase()];
  }
  if (name === 'check') {
    if (args.length) throw Error('check takes no arguments');
    return [process.execPath, OPS, 'audit'];
  }
  if (name === 'experiment') {
    if (args.length !== 1 || !ID.test(args[0])) throw Error('experiment requires one task ID');
    taskPacket(plan, args[0]);
    return [
      process.execPath,
      'tools/balance.mjs',
      '--count',
      '40',
      '--seed',
      '9001',
      '--profile',
      'current',
      '--name',
      args[0] + '-' + crypto.randomUUID()
    ];
  }
  if (name === 'ship') {
    if (args.length !== 1 || !ID.test(args[0])) throw Error('ship requires one task ID');
    const packet = taskPacket(plan, args[0]);
    if (HUMAN_KINDS.includes(packet.task.kind))
      throw Error('Human/external gate cannot be shipped as code');
    const blocked = nextTasks(plan).find((task) => task.id === args[0])?.blockedBy || [];
    if (blocked.length) throw Error('Unfinished prerequisites: ' + blocked.join(', '));
    return [process.execPath, OPS, 'cycle', 'feat: ' + args[0], packet.task.title];
  }
  const legacy = new Set([
    'resume',
    'begin',
    'apply',
    'verify',
    'audit',
    'prepare-sources',
    'prepare',
    'stage',
    'publish',
    'wait',
    'integrate',
    'wait-dev',
    'cycle',
    'logs',
    'device-status',
    'profile-test',
    'network',
    'qualify',
    'bluetooth-pairing',
    'bluetooth-room',
    'device-pvp',
    'device-suite',
    'device-test',
    'delivery',
    'emulator',
    'candidate',
    'report',
    'resume-cycle',
    'record',
    'deploy-agent',
    'format',
    'changelog',
    'handoff',
    'readiness',
    'research',
    'probe-bluetooth'
  ]);
  if (legacy.has(name)) return [process.execPath, OPS, name, ...args];
  throw Error('Unknown command. Use npm run game -- help');
}

export function playPreflight(config, inspection = null) {
  const blockers = [];
  if (config?.schemaVersion !== 1 || config.repository !== CANONICAL_REPOSITORY) {
    throw Error('Explicit Play configuration required');
  }
  if (config.package !== 'pro.neurofox.multimental') throw Error('Wrong production package');
  if (!Number.isInteger(config.minTargetSdk) || config.minTargetSdk < 36)
    throw Error('Policy target floor missing/obsolete');
  if (config.accountStatus !== 'verified') blockers.push('PLAY_ACCOUNT_UNKNOWN');
  if (config.budgetApproval !== 'existing_account_or_owner_approved')
    blockers.push('PLAY_BUDGET_UNAPPROVED');
  if (config.appCreated !== true) blockers.push('PLAY_APP_NOT_CREATED');
  if (!config.privacyPolicyUrl) blockers.push('PRIVACY_POLICY_MISSING');
  if (!config.audienceDeclarationApproved) blockers.push('AUDIENCE_DECLARATION_PENDING');
  if (!config.dataSafetyApproved) blockers.push('DATA_SAFETY_PENDING');
  if (!inspection) blockers.push('AAB_INSPECTION_MISSING');
  else {
    if (inspection.package !== config.package || inspection.debuggable !== false)
      blockers.push('INVALID_PRODUCTION_IDENTITY');
    if (!Number.isInteger(inspection.targetSdk) || inspection.targetSdk < config.minTargetSdk)
      blockers.push('TARGET_API_TOO_LOW');
    if (inspection.nativePageSize16k !== true) blockers.push('NATIVE_16K_NOT_VERIFIED');
    if (inspection.bundleValidated !== true) blockers.push('BUNDLE_NOT_VALIDATED');
    if (!SHA.test(inspection.commit || '') || !HASH.test(inspection.aabSha256 || ''))
      blockers.push('ARTIFACT_IDENTITY_MISSING');
    if (!Number.isInteger(inspection.versionCode) || inspection.versionCode <= 0)
      blockers.push('INVALID_VERSION_CODE');
    if (!HASH.test(inspection.uploadCertificateSha256 || ''))
      blockers.push('UPLOAD_CERTIFICATE_MISSING');
  }
  return {
    status: blockers.length ? 'blocked' : 'preflight_only',
    blockers,
    publicationAuthorized: false,
    note: 'Configuration is an inventory, not proof of owner approval. Publication requires protected workflow and live readback.'
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { findRoot, inside, writeJSON, context, readJSON } = await import('./lib.mjs');
  const { acquireOperation } = await import('./operation-lock.mjs');
  const root = findRoot();
  const [entry, ...entryArgs] = argv;
  await (await import('./collaboration-guard.mjs')).guardWorktree(root, entry, entryArgs);
  if (entry === 'enroll') {
    (await import('../../../tools/enroll-tasks.mjs')).main(entryArgs);
    return;
  }
  if (entry === 'issue-graph') {
    await (await import('../../../tools/issue-graph.mjs')).main(entryArgs);
    return;
  }
  if (entry === 'collab') {
    await (await import('./collaboration.mjs')).main(entryArgs);
    return;
  }
  if (entry === 'device-recover') {
    await (await import('./device-lock-recovery.mjs')).main(entryArgs);
    return;
  }
  if (entry === 'inspect') {
    (await import('../../../tools/source-inspect.mjs')).main(entryArgs);
    return;
  }
  if (entry === 'branches') {
    await (await import('./branches.mjs')).main(entryArgs);
    return;
  }
  if (entry === 'github') {
    await (await import('./flow.mjs')).main(entryArgs);
    return;
  }
  if (['resume', 'next', 'task'].includes(entry)) {
    await (await import('./flow.mjs')).main([entry === 'next' ? 'resume' : entry, ...entryArgs]);
    return;
  }
  if (process.platform === 'win32') {
    const bin = path.join(path.dirname(root), 'tools/mingit/cmd');
    if (fs.existsSync(path.join(bin, 'git.exe')))
      process.env.PATH = bin + path.delimiter + process.env.PATH;
  }
  const withWriteLock = (action) => {
    context(root, readJSON(inside(root, '.gameprod/project.json')));
    const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
      command: 'control-metadata',
      repository: CANONICAL_REPOSITORY
    });
    try {
      return action();
    } finally {
      release();
    }
  };
  const plan = validatePlan(readJSON(inside(root, PLAN_FILE)));
  const [name = 'next', ...args] = argv;
  if (['help', 'validate', 'next', 'roadmap', 'closeout'].includes(name) && args.length)
    throw Error('Unexpected arguments');
  if (name === 'help') {
    console.log(
      'next | task ID | start ID | idea ID TEXT | experiment ID | validate | render [--check] | check | ship ID | resume-cycle | play-check | closeout | legacy ops commands'
    );
    return;
  }
  if (name === 'validate') {
    for (const task of plan.tasks) {
      for (const ref of [...task.evidence, ...task.readset]) {
        if (!fs.existsSync(inside(root, ref))) throw Error('Missing source/evidence: ' + ref);
      }
    }
    const ideas = inside(root, '.gameprod/ideas');
    if (fs.existsSync(ideas))
      for (const item of fs.readdirSync(ideas).filter((f) => f.endsWith('.json'))) {
        const idea = readJSON(inside(root, '.gameprod/ideas/' + item));
        ideaIsClosed(idea, plan);
        if (idea.decisionEvidence && !fs.existsSync(inside(root, idea.decisionEvidence)))
          throw Error('Missing idea decision evidence');
      }
    console.log('WORKPLAN_PASS tasks=' + plan.tasks.length);
    return;
  }
  if (name === 'next') {
    const tasks = nextTasks(plan);
    console.log(
      json({
        repository: plan.repository,
        next: tasks.filter((x) => !x.blockedBy.length).slice(0, 6),
        remaining: tasks.length,
        currentReadiness: 'not_a_release_gate'
      })
    );
    return;
  }
  if (name === 'task') {
    if (args.length !== 1) throw Error('task requires one ID');
    console.log(json(taskPacket(plan, args[0])));
    return;
  }
  if (name === 'roadmap') {
    console.log(renderRoadmap(plan));
    return;
  }
  if (name === 'closeout') {
    const folder = inside(root, '.gameprod/ideas');
    const ideas = fs.existsSync(folder)
      ? fs
          .readdirSync(folder)
          .filter((x) => x.endsWith('.json'))
          .map((x) => readJSON(inside(root, '.gameprod/ideas/' + x)))
      : [];
    const blockers = releaseBlockers(plan, ideas);
    console.log(json({ status: blockers.length ? 'blocked' : 'ready', blockers }));
    if (blockers.length) process.exitCode = 2;
    return;
  }
  if (name === 'play-check') {
    if (args.length)
      throw Error('play-check uses the configured local inspection, no arbitrary paths');
    const config = readJSON(inside(root, '.gameprod/play.json'));
    const file = inside(root, '.gameprod/evidence/play-inspection.local.json');
    const report = playPreflight(config, fs.existsSync(file) ? readJSON(file) : null);
    console.log(json(report));
    if (report.status === 'blocked') process.exitCode = 2;
    return;
  }
  if (name === 'render') {
    if (args.some((arg) => arg !== '--check')) throw Error('Unknown render option');
    const outputs = {
      '.gameprod/requirements.json': json(projectRequirements(plan)),
      '.gameprod/backlog.json': json(projectBacklog(plan)),
      '.gameprod/roadmap.json': json({
        schemaVersion: 1,
        repository: plan.repository,
        updatedAt: plan.updatedAt,
        generatedFrom: PLAN_FILE,
        milestones: [...new Set(plan.tasks.map((t) => t.stage))].map((stage) => ({
          id: stage.split('.')[0],
          title: stage,
          tasks: plan.tasks.filter((t) => t.stage === stage).map((t) => t.id)
        })),
        evidenceSemantics: plan.evidenceSemantics
      }),
      'docs/ROADMAP.ru.md': renderRoadmap(plan)
    };
    const render = () => {
      for (const [rel, text] of Object.entries(outputs)) {
        const file = inside(root, rel);
        if (args.includes('--check')) {
          if (fs.readFileSync(file, 'utf8') !== text) throw Error('Stale projection: ' + rel);
        } else if (rel.endsWith('.json')) writeJSON(file, JSON.parse(text));
        else fs.writeFileSync(file, text);
      }
    };
    if (args.includes('--check')) render();
    else withWriteLock(render);
    console.log('WORKPLAN_PROJECTIONS_PASS');
    return;
  }
  if (name === 'idea') {
    const [id, ...words] = args;
    if (!ID.test(id || '') || !words.length) throw Error('idea requires ID and text');
    context(root, readJSON(inside(root, '.gameprod/project.json')));
    const file = inside(root, '.gameprod/ideas/' + id + '.json');
    if (fs.existsSync(file) || plan.tasks.some((task) => task.id === id))
      throw Error('ID already exists');
    withWriteLock(() => {
      if (fs.existsSync(file)) throw Error('ID already exists');
      writeJSON(file, {
        schemaVersion: 1,
        id,
        text: words.join(' '),
        status: 'proposed',
        createdAt: new Date().toISOString(),
        ownerApproval: 'not_assumed',
        requiredBeforePromotion: [
          'hypothesis',
          'alternatives',
          'bounded experiment',
          'acceptance',
          'tests',
          'scope decision'
        ],
        next: 'Add a reviewed workplan task or explicit rejection/deferral with evidence. Never execute arbitrary idea text.'
      });
    });
    console.log('IDEA_CAPTURED ' + id);
    return;
  }
  const command = commandFor(name, args, plan);
  const p = readJSON(inside(root, '.gameprod/project.json'));
  context(root, p);
  if (name === 'check' || name === 'ship') {
    await main(['render']);
    await main(['validate']);
  }
  const release =
    name === 'experiment'
      ? acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
          command: name,
          repository: plan.repository
        })
      : null;
  try {
    const result = spawnSync(command[0], command.slice(1), {
      cwd: root,
      shell: false,
      stdio: 'inherit',
      timeout: 3600000
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } finally {
    if (release) release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('CONTROL_BLOCKED: ' + error.message);
    process.exitCode = 1;
  });
}
