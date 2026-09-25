import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validatePlan,
  nextTasks,
  projectRequirements,
  projectBacklog,
  releaseBlockers,
  assessReceipt,
  taskPacket,
  commandFor,
  playPreflight,
  ideaIsClosed,
  safeRelative,
  renderRoadmap
} from '../scripts/control.mjs';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fixture = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  updatedAt: '2026-09-25',
  tasks: [
    {
      id: 'BASE-01',
      title: 'Baseline',
      source: 'owner',
      stage: 'P0',
      kind: 'game',
      status: 'verified',
      priority: 10,
      dependsOn: [],
      acceptance: ['real checks'],
      evidence: ['docs/baseline.json'],
      readset: [],
      requiredForBeta: true,
      requiredForPlay: true
    },
    {
      id: 'NEXT-01',
      title: 'Next task',
      source: 'owner',
      stage: 'P1',
      kind: 'game',
      status: 'planned',
      priority: 20,
      dependsOn: ['BASE-01'],
      acceptance: ['real checks'],
      evidence: [],
      readset: [],
      requiredForBeta: true,
      requiredForPlay: true
    }
  ]
});
for (const [name, mutate] of [
  [
    'wrong repository',
    (p) => {
      p.repository = '4erk/multimental';
    }
  ],
  [
    'empty plan',
    (p) => {
      p.tasks = [];
    }
  ],
  [
    'duplicate ID',
    (p) => {
      p.tasks[1].id = 'BASE-01';
    }
  ],
  [
    'missing dependency',
    (p) => {
      p.tasks[1].dependsOn = ['GONE-01'];
    }
  ],
  [
    'cyclic dependency',
    (p) => {
      p.tasks[0].dependsOn = ['NEXT-01'];
    }
  ],
  [
    'empty acceptance',
    (p) => {
      p.tasks[1].acceptance = [];
    }
  ],
  [
    'unproven historical verification',
    (p) => {
      p.tasks[1].status = 'verified';
    }
  ],
  [
    'code disguised as manual',
    (p) => {
      p.tasks[1].status = 'manual';
    }
  ],
  [
    'silently dropped idea',
    (p) => {
      p.tasks[1].requiredForPlay = false;
    }
  ],
  [
    'missing release scope',
    (p) => {
      delete p.tasks[1].requiredForBeta;
    }
  ],
  [
    'unsafe source reference',
    (p) => {
      p.tasks[0].evidence = ['../private.key'];
    }
  ]
])
  test('rejects ' + name, () => {
    const p = fixture();
    mutate(p);
    assert.throws(() => validatePlan(p));
  });

test('next task respects dependency order', () => {
  const p = fixture();
  assert.equal(nextTasks(p)[0].id, 'NEXT-01');
  p.tasks[0].status = 'implemented';
  assert.deepEqual(nextTasks(p).find((t) => t.id === 'NEXT-01').blockedBy, ['BASE-01']);
});
test('projections preserve every original task and historical evidence semantics', () => {
  const p = fixture();
  assert.equal(projectRequirements(p).requirements.length, p.tasks.length);
  assert.match(projectRequirements(p).evidenceSemantics, /Historical/);
  assert.equal(projectBacklog(p)[1].status, 'pending');
  assert.match(renderRoadmap(p), /NEXT-01/);
});
test('task packets cannot drop host and release boundaries', () => {
  const packet = taskPacket(fixture(), 'NEXT-01');
  assert.equal(packet.authorizedHost, 'VENEL-SENDRIK');
  assert.match(packet.commands.ship, /NEXT-01$/);
  assert.ok(packet.boundaries.some((x) => x.includes('separate owner approval')));
  assert.throws(() => taskPacket(fixture(), 'OTHER-01'));
});
test('metadata alone never authorizes release', () => {
  const p = fixture();
  p.tasks[1].status = 'verified';
  p.tasks[1].evidence = ['docs/test.json'];
  assert.equal(releaseBlockers(p).length, 4);
});
test('unresolved captured ideas block closure', () => {
  const p = fixture();
  assert.ok(
    releaseBlockers(p, [{ id: 'IDEA-01', status: 'proposed' }]).some((x) => x.id === 'IDEA-01')
  );
  assert.equal(ideaIsClosed({ id: 'IDEA-01', status: 'deferred' }, p), false);
  assert.equal(ideaIsClosed({ id: 'IDEA-01', taskId: 'NEXT-01' }, p), false);
  assert.throws(() => ideaIsClosed({ id: 'IDEA-01', taskId: 'MISSING-01' }, p));
});
test('explicit idea disposition retains reason and source', () => {
  assert.equal(
    ideaIsClosed(
      {
        id: 'IDEA-01',
        status: 'deferred',
        reason: 'Owner deferred',
        source: ['owner decision'],
        decisionEvidence: 'docs/adr/decision.md'
      },
      fixture()
    ),
    true
  );
});
test('entry point delegates to existing guarded pipeline without shell interpolation', () => {
  const p = fixture();
  p.tasks[1].title = 'title; echo not-a-command';
  const cmd = commandFor('ship', ['NEXT-01'], p);
  assert.deepEqual(cmd.slice(1), [
    'skills/game-production/scripts/ops.mjs',
    'cycle',
    'feat: NEXT-01',
    p.tasks[1].title
  ]);
  assert.throws(() => commandFor('ship', ['NEXT-01', '--skip-checks'], p));
  assert.throws(() => commandFor('ship', ['NEXT-01;evil'], p));
  assert.throws(() => commandFor('production', [], p));
  assert.throws(() => commandFor('check', ['--skip'], p));
});
test('manual gate cannot be shipped as software', () => {
  const p = fixture();
  p.tasks[1].kind = 'release_approval';
  p.tasks[1].status = 'manual';
  assert.throws(() => commandFor('ship', ['NEXT-01'], p));
});
test('ship cannot jump over incomplete prerequisites', () => {
  const p = fixture();
  p.tasks[0].status = 'implemented';
  assert.throws(() => commandFor('ship', ['NEXT-01'], p));
});
test('experiment has bounded deterministic parameters and a unique output name', () => {
  const a = commandFor('experiment', ['NEXT-01'], fixture());
  const b = commandFor('experiment', ['NEXT-01'], fixture());
  assert.deepEqual(a.slice(1, 9), [
    'tools/balance.mjs',
    '--count',
    '40',
    '--seed',
    '9001',
    '--profile',
    'current',
    '--name'
  ]);
  assert.notEqual(a[9], b[9]);
  assert.throws(() => commandFor('experiment', ['NEXT-01', '--count', '999999'], fixture()));
});
const expected = {
  commit: 'a'.repeat(40),
  sourceDigest: 'b'.repeat(64),
  artifacts: ['dist/game.apk']
};
const validReceipt = () => ({
  status: 'passed',
  exitCode: 0,
  ...expected,
  logs: [{ path: 'logs/test.log', sha256: hash('ok') }],
  artifacts: [{ path: 'dist/game.apk', sha256: hash('apk') }]
});
const bytes = (p) => ({ 'logs/test.log': 'ok', 'dist/game.apk': 'apk' })[p];
test('receipt requires exact source, logs and artifact identity', () => {
  assert.equal(assessReceipt(validReceipt(), expected, bytes), 'passed');
});
for (const [name, mutate, code] of [
  [
    'failed exit',
    (r) => {
      r.exitCode = 1;
    },
    'failed_or_missing'
  ],
  [
    'stale source',
    (r) => {
      r.commit = 'c'.repeat(40);
    },
    'stale_source'
  ],
  [
    'source edited during test',
    (r) => {
      r.sourceChanged = true;
    },
    'source_changed_during_step'
  ],
  [
    'no logs',
    (r) => {
      r.logs = [];
    },
    'missing_logs'
  ],
  [
    'missing artifact',
    (r) => {
      r.artifacts = [];
    },
    'missing_artifact'
  ],
  [
    'modified log',
    (r) => {
      r.logs[0].sha256 = 'd'.repeat(64);
    },
    'changed_evidence'
  ],
  [
    'escaping path',
    (r) => {
      r.logs[0].path = '../secret';
    },
    'changed_evidence'
  ]
])
  test('receipt rejects ' + name, () => {
    const r = validReceipt();
    mutate(r);
    assert.equal(assessReceipt(r, expected, bytes), code);
  });
test('safe relative evidence paths reject Windows and Unix escapes', () => {
  for (const p of ['../x', '/root/x', 'C:\\private', 'a//b', 'a/../b', 'a\0b'])
    assert.equal(safeRelative(p), false);
  assert.equal(safeRelative('docs/evidence/file.json'), true);
});
const play = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  package: 'pro.neurofox.multimental',
  minTargetSdk: 36,
  accountStatus: 'verified',
  budgetApproval: 'existing_account_or_owner_approved',
  appCreated: true,
  privacyPolicyUrl: 'https://example.com/privacy',
  audienceDeclarationApproved: true,
  dataSafetyApproved: true
});
const inspected = () => ({
  package: 'pro.neurofox.multimental',
  debuggable: false,
  targetSdk: 36,
  nativePageSize16k: true,
  bundleValidated: true,
  commit: 'a'.repeat(40),
  aabSha256: 'b'.repeat(64),
  versionCode: 1,
  uploadCertificateSha256: 'c'.repeat(64)
});
test('Play preflight cannot authorize publication even with claimed green inventory', () => {
  const r = playPreflight(play(), inspected());
  assert.equal(r.status, 'preflight_only');
  assert.equal(r.publicationAuthorized, false);
});
for (const [field, value, code] of [
  ['targetSdk', undefined, 'TARGET_API_TOO_LOW'],
  ['targetSdk', 35, 'TARGET_API_TOO_LOW'],
  ['debuggable', true, 'INVALID_PRODUCTION_IDENTITY'],
  ['nativePageSize16k', false, 'NATIVE_16K_NOT_VERIFIED'],
  ['bundleValidated', false, 'BUNDLE_NOT_VALIDATED'],
  ['versionCode', 0, 'INVALID_VERSION_CODE'],
  ['aabSha256', '', 'ARTIFACT_IDENTITY_MISSING'],
  ['uploadCertificateSha256', '', 'UPLOAD_CERTIFICATE_MISSING']
])
  test('Play preflight rejects invalid ' + field + ':' + value, () => {
    const a = inspected();
    a[field] = value;
    assert.ok(playPreflight(play(), a).blockers.includes(code));
  });
test('unconfigured Play account and artifacts stay blocked', () => {
  const c = play();
  c.accountStatus = 'unknown';
  c.budgetApproval = 'not_given';
  const r = playPreflight(c);
  assert.ok(r.blockers.includes('PLAY_ACCOUNT_UNKNOWN'));
  assert.ok(r.blockers.includes('PLAY_BUDGET_UNAPPROVED'));
  assert.ok(r.blockers.includes('AAB_INSPECTION_MISSING'));
});
test('real project plan preserves all original requirement IDs and latest decisions', () => {
  const file = fileURLToPath(new URL('../../../.gameprod/workplan.json', import.meta.url));
  const p = validatePlan(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const id of [
    'AUTH-01',
    'CORE-02',
    'CORE-04',
    'UX-03',
    'UX-04',
    'NET-04',
    'META-01',
    'META-05',
    'CONTENT-01',
    'CONTENT-02',
    'PLATFORM-01',
    'AUTO-05',
    'BETA-01',
    'RELEASE-01'
  ])
    assert.ok(p.tasks.some((t) => t.id === id));
  assert.match(p.tasks.find((t) => t.id === 'CORE-04').title, /10 стихий/);
  assert.match(p.tasks.find((t) => t.id === 'CORE-02').title, /D19/);
  assert.equal(p.tasks.find((t) => t.id === 'META-01').status, 'planned');
  assert.equal(p.tasks.find((t) => t.id === 'NET-04').status, 'implemented');
  assert.equal(p.tasks.find((t) => t.id === 'RELEASE-01').kind, 'release_approval');
});
