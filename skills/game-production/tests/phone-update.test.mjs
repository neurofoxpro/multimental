import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneOptions,
  latestPhoneRelease,
  phoneResume,
  updatePhone
} from '../scripts/phone-update-policy.mjs';
const commit = 'a'.repeat(40),
  source = 'b'.repeat(64),
  apk = 'c'.repeat(64),
  cert = 'd'.repeat(64);
const option = () => phoneOptions(['honor']);
const release = () => ({
  id: 123,
  tag_name: 'v0.14.2-alpha.293.1',
  target_commitish: commit,
  draft: false,
  prerelease: true,
  published_at: '2026-09-28T00:30:22Z',
  html_url: 'https://github.com/neurofoxpro/multimental/releases/tag/v0.14.2-alpha.293.1',
  assets: []
});
function fake(changes = {}) {
  const order = [],
    saved = [];
  let verified = changes.verified !== false,
    prepared = changes.prepared !== false;
  const selected = latestPhoneRelease([release()]);
  const artifact = { release: release(), expected: { sha256: apk, certificate: cert } };
  const row = {
    alias: 'phone-B',
    status: 'ready',
    actualApkVerified: true,
    profilePreserved: true,
    version: '0.14.2-alpha.293.1',
    apkSha256: apk,
    certificateSha256: cert,
    suite: { status: 'passed' },
    homeIcon: { status: 'passed', home: { launchConfirmed: true } }
  };
  const result = {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    status: 'ready',
    commit,
    sourceDigest: source,
    phones: [row],
    requestedPhones: 1,
    readyPhones: 1,
    twoPhysicalPhonesReady: false,
    report: '.gameprod/evidence/fleet/x/report.json',
    runId: 'x'
  };
  const a = {
    selectRelease: async (sha) => {
      order.push('release');
      assert.ok(sha === null || sha === commit);
      return selected;
    },
    save: async (phase, value) => saved.push({ phase, value }),
    discover: async (targets) => {
      order.push('discover');
      return targets.map((alias) => ({
        alias,
        status: changes.unavailable ? 'unavailable' : 'available'
      }));
    },
    isVerified: async () => verified,
    verify: async () => {
      order.push('verify');
      verified = true;
    },
    seal: async () => ({ sourceHash: source, configHash: source }),
    assertSeal: async () => order.push('seal-check'),
    preparedArtifact: async (sha) => {
      order.push('artifact');
      assert.equal(sha, commit);
      return prepared ? artifact : null;
    },
    prepareReview: async (sha) => {
      order.push('review');
      assert.equal(sha, commit);
      prepared = true;
    },
    deliver: async (target, sha) => {
      order.push('deliver');
      assert.equal(target, 'phone-B');
      assert.equal(sha, commit);
      return result;
    },
    ...changes.adapter
  };
  return { a, order, saved, result, selected, artifact };
}
test('one familiar phone name maps to exactly its registered identity', () => {
  assert.deepEqual(phoneOptions(['honor']), {
    mode: 'update',
    name: 'honor',
    target: 'phone-B',
    commit: null
  });
  assert.equal(phoneOptions(['redmi']).target, 'phone-A');
  assert.equal(phoneOptions(['all']).target, 'all');
  assert.equal(phoneOptions([]).mode, 'help');
});
for (const args of [
  ['192.168.0.8:37000'],
  ['phone-B'],
  ['honor', '--force'],
  ['honor', '--commit', 'dev'],
  ['honor', '--commit', commit, '--commit', commit],
  ['resume', 'honor'],
  ['help', '--all'],
  ['random-device'],
  ['honor', '--skip-tests', 'yes']
])
  test('no arbitrary target, bypass flag or ambiguous arguments ' + args.join(' '), () =>
    assert.throws(() => phoneOptions(args))
  );
test('new requests pin latest published dev release, not docs-only HEAD or stable', () => {
  const old = {
    ...release(),
    id: 122,
    published_at: '2026-09-27T00:00:00Z',
    target_commitish: 'e'.repeat(40),
    tag_name: 'v0.14.1-alpha.287.1',
    html_url: 'https://github.com/neurofoxpro/multimental/releases/tag/v0.14.1-alpha.287.1'
  };
  assert.equal(
    latestPhoneRelease([old, release(), { ...release(), id: 124, draft: true }]).id,
    123
  );
  assert.equal(latestPhoneRelease([old, release()], old.target_commitish).id, 122);
  assert.throws(() => latestPhoneRelease([release(), release()]));
  assert.throws(() => latestPhoneRelease([{ ...release(), published_at: 'unknown' }]));
  assert.throws(() =>
    latestPhoneRelease([{ ...release(), html_url: 'https://other.test/release' }])
  );
});
test('unavailable Honor returns before build, source verify, review or any installation', async () => {
  const f = fake({ unavailable: true, verified: false, prepared: false }),
    r = await updatePhone(f.a, option());
  assert.deepEqual(f.order, ['release', 'discover']);
  assert.equal(r.status, 'not_ready');
  assert.equal(r.otherPhoneSubstituted, false);
  assert.equal(r.verificationRun, false);
  assert.equal(r.installationRun, false);
  assert.equal(f.saved.at(-1).phase, 'unavailable');
});
test('ready source and existing verified manual APK avoid source tests and republishing', async () => {
  const f = fake(),
    r = await updatePhone(f.a, option());
  assert.deepEqual(f.order, [
    'release',
    'discover',
    'artifact',
    'seal-check',
    'deliver',
    'seal-check'
  ]);
  assert.equal(r.verificationReused, true);
  assert.equal(r.reviewReused, true);
  assert.equal(r.humanAcceptance, 'pending');
});
test('changed source is checked exactly once; missing review prepared exactly once', async () => {
  const f = fake({ verified: false, prepared: false }),
    r = await updatePhone(f.a, option());
  assert.deepEqual(f.order, [
    'release',
    'discover',
    'verify',
    'artifact',
    'review',
    'artifact',
    'seal-check',
    'deliver',
    'seal-check'
  ]);
  assert.equal(r.verificationReused, false);
  assert.equal(r.reviewReused, false);
});
test('unknown source verification is not truthy success', async () => {
  const f = fake({ adapter: { isVerified: async () => undefined } });
  await assert.rejects(updatePhone(f.a, option()), /VERIFICATION_UNKNOWN/);
  assert.ok(!f.order.includes('deliver'));
});
test('failed checks, corrupted APK and uncertain prepare do not reach installation', async () => {
  for (const changes of [
    {
      verified: false,
      adapter: {
        verify: async () => {
          throw Error('test failed');
        }
      }
    },
    {
      adapter: {
        preparedArtifact: async () => {
          throw Error('signature mismatch');
        }
      }
    },
    {
      prepared: false,
      adapter: {
        prepareReview: async () => {
          throw Error('uncertain upload');
        }
      }
    }
  ]) {
    const f = fake(changes);
    await assert.rejects(updatePhone(f.a, option()));
    assert.ok(!f.order.includes('deliver'));
  }
});
test('a changed source seal cannot reuse old tests', async () => {
  const f = fake({
    adapter: {
      assertSeal: async () => {
        throw Error('source changed');
      }
    }
  });
  await assert.rejects(updatePhone(f.a, option()), /source changed/);
  assert.ok(!f.order.includes('deliver'));
});
test('selected release is not silently replaced after review', async () => {
  const f = fake();
  f.artifact.release.id = 999;
  await assert.rejects(updatePhone(f.a, option()), /RELEASE_CHANGED/);
  assert.ok(!f.order.includes('deliver'));
});
test('expected signature, installed bytes, profile, tests and home icon remain mandatory', async () => {
  for (const change of [
    { actualApkVerified: false },
    { profilePreserved: false },
    { apkSha256: 'e'.repeat(64) },
    { certificateSha256: 'e'.repeat(64) },
    { version: 'old' },
    { suite: { status: 'running' } },
    { homeIcon: { status: 'passed', home: { launchConfirmed: false } } }
  ]) {
    const f = fake();
    Object.assign(f.result.phones[0], change);
    await assert.rejects(updatePhone(f.a, option()));
  }
});
test('a radio claim or second-device acceptance is not invented for one phone', async () => {
  const f = fake(),
    r = await updatePhone(f.a, option());
  assert.equal(r.radioTestPassed, false);
  f.result.twoPhysicalPhonesReady = true;
  await assert.rejects(updatePhone(f.a, option()), /FLEET_COUNTS/);
});
test('failure after successful installation remains visible and is not retried', async () => {
  const f = fake();
  f.result.status = 'not_ready';
  f.result.readyPhones = 0;
  f.result.phones[0] = {
    alias: 'phone-B',
    status: 'blocked',
    install: { mutated: true, disposition: 'upgrade' },
    reason: 'READY missing'
  };
  const r = await updatePhone(f.a, option());
  assert.equal(r.status, 'not_ready');
  assert.equal(r.phones[0].install.mutated, true);
  assert.equal(f.order.filter((x) => x === 'deliver').length, 1);
});
test('mixed or substituted target output cannot satisfy the request', async () => {
  const f = fake();
  f.result.phones[0].alias = 'phone-A';
  await assert.rejects(updatePhone(f.a, option()), /RESULT_MISMATCH/);
});
test('resume pins exact target/release and refuses changed owner, source, or station descriptor', async () => {
  const saved = {
    schemaVersion: 1,
    repository: 'neurofoxpro/multimental',
    owner: 'worker',
    sourceHash: source,
    configHash: source,
    name: 'honor',
    target: 'phone-B',
    release: { id: 123, tag: 'v0.14.2-alpha.293.1', commit }
  };
  const identity = { owner: 'worker', sourceHash: source, configHash: source };
  const opt = phoneResume(saved, identity);
  assert.equal(opt.commit, commit);
  for (const value of [{ owner: 'other' }, { sourceHash: apk }, { configHash: apk }])
    assert.throws(() => phoneResume(saved, { ...identity, ...value }));
  const f = fake();
  f.selected.id = 999;
  await assert.rejects(updatePhone(f.a, opt), /RESUMED_RELEASE_CHANGED/);
});

import { freshFleetReport, compactPhoneResult } from '../scripts/phone-update-policy.mjs';
test('captured child output must bind a new successful or explicitly partial fleet receipt', () => {
  const startedAt = Date.parse('2026-09-28T10:00:00Z'),
    r = {
      commit,
      runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      observedAt: '2026-09-28T10:00:01Z',
      status: 'ready'
    },
    p = { previousRunId: null, startedAt, exitCode: 0, commit };
  assert.equal(freshFleetReport(r, p), r);
  for (const change of [
    { previousRunId: r.runId },
    { startedAt: startedAt + 2000 },
    { exitCode: 1 },
    { commit: 'e'.repeat(40) }
  ])
    assert.throws(() => freshFleetReport(r, { ...p, ...change }));
  assert.throws(() => freshFleetReport({ ...r, status: 'not_ready' }, p));
  assert.equal(
    freshFleetReport({ ...r, status: 'not_ready' }, { ...p, exitCode: 2 }).status,
    'not_ready'
  );
});
test('routine result remains compact and never exposes serial/config/verbose logs', async () => {
  const f = fake(),
    r = await updatePhone(f.a, option());
  r.phones[0].physicalSerial = 'PRIVATE';
  r.phones[0].config = { password: 'PRIVATE' };
  r.phones[0].log = 'PRIVATE'.repeat(1000);
  const view = compactPhoneResult(r, 'local-result.json');
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
  assert.ok(JSON.stringify(view).length < 1600);
  assert.equal(view.phones[0].homeLaunchConfirmed, true);
  assert.equal(view.phones[0].device, 'Honor');
});
test('all retains unavailable Honor instead of falsely declaring two ready phones', async () => {
  const f = fake();
  f.a.discover = async () => [
    { alias: 'phone-A', status: 'available' },
    { alias: 'phone-B', status: 'unavailable' }
  ];
  f.result.phones = [
    { ...f.result.phones[0], alias: 'phone-A' },
    { alias: 'phone-B', status: 'unavailable' }
  ];
  f.result.status = 'partially_ready';
  f.result.requestedPhones = 2;
  f.a.deliver = async () => f.result;
  const r = await updatePhone(f.a, phoneOptions(['all']));
  assert.equal(r.status, 'partially_ready');
  assert.equal(r.phones[1].status, 'unavailable');
});
