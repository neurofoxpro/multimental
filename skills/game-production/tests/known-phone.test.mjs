import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  REPO,
  PACKAGE,
  sha,
  knownPhones,
  targetConfig,
  assertKnownPhoneConfig,
  readyOptions,
  actualInstallDisposition,
  ensureReviewedInstall,
  fleetSummary
} from '../scripts/known-phone-policy.mjs';
const certificate = 'a'.repeat(64),
  apk = 'b'.repeat(64);
const station = () => ({
  repository: REPO,
  package: PACKAGE,
  allowedHost: 'VENEL-SENDRIK',
  serial: 'REDA123456',
  workDir: path.resolve('/tmp/station/installations'),
  adb: 'adb',
  java: 'java',
  apksigner: 'signer',
  aapt: 'aapt',
  keytool: 'keytool'
});
const honor = () => ({
  schemaVersion: 1,
  repository: REPO,
  brand: 'HONOR',
  manufacturer: 'HONOR',
  model: 'BRC-NX1',
  physicalSerial: 'HONR654321',
  observedAt: '2026-09-27T17:21:41Z',
  endpoint: '192.168.0.1:41000'
});
test('two known physical identities retain primary paths, never alias transports as extra phones', () => {
  const s = station(),
    saved = JSON.stringify(s),
    r = knownPhones(s, honor());
  assert.equal(r.length, 2);
  assert.equal(r[0].workDir, s.workDir);
  assert.equal(r[1].alias, 'phone-B');
  assert.equal(JSON.stringify(s), saved);
  const c = targetConfig(s, honor(), 'phone-B');
  assert.equal(c.serial, 'HONR654321');
  assert.equal(c.physicalSerial, 'HONR654321');
  assert.equal(
    c.workDir,
    path.join(s.workDir, 'phones', 'honor-' + sha('HONR654321').slice(0, 12))
  );
  assert.equal(c.sharedSigningDirectory, undefined);
});
test('absent second descriptor never fabricates an available phone or reuses the first', () => {
  assert.equal(knownPhones(station(), null).length, 1);
  assert.throws(() => targetConfig(station(), null, 'phone-B'));
  assert.throws(() => knownPhones(station(), { ...honor(), physicalSerial: 'REDA123456' }));
});
for (const change of [
  { brand: 'Other' },
  { manufacturer: 'Other' },
  { model: 'other' },
  { physicalSerial: '192.168.0.2:5555' },
  { physicalSerial: '../escape' },
  { repository: 'other/project' },
  { schemaVersion: 2 },
  { observedAt: 'unknown' }
])
  test('unknown secondary descriptor refused ' + JSON.stringify(change), () =>
    assert.throws(() => knownPhones(station(), { ...honor(), ...change }))
  );
test('secondary launcher accepts only the immutable physical mapping and exact station tools', () => {
  const s = station(),
    c = targetConfig(s, honor(), 'phone-B');
  assert.equal(
    assertKnownPhoneConfig({ ...c, serial: '192.168.0.2:43123' }, s, honor()).alias,
    'phone-B'
  );
  for (const change of [
    { physicalSerial: s.serial },
    { workDir: s.workDir },
    { adb: 'other' },
    { java: 'other' },
    { package: 'pro.neurofox.multimental' },
    { sharedSigningDirectory: 'some-key-directory' },
    { allowedHost: 'OTHER-HOST' }
  ])
    assert.throws(() => assertKnownPhoneConfig({ ...c, ...change }, s, honor()));
});
for (const args of [
  ['ready'],
  ['ready', '--commit', 'dev'],
  ['ready', '--commit', 'a'.repeat(40), '--target', 'unbound-1'],
  ['known', '--commit', 'a'.repeat(40)],
  ['ready', '--target', 'phone-A', '--target', 'phone-B'],
  ['ready', '--force', '1'],
  ['bind'],
  ['pair'],
  ['known', '--target']
])
  test('explicit bounded route ' + args.join(' '), () => assert.throws(() => readyOptions(args)));
test('target all means two requested physical phones, never an emulator fallback', () =>
  assert.deepEqual(readyOptions(['ready', '--commit', 'a'.repeat(40)]), {
    mode: 'ready',
    targets: ['phone-A', 'phone-B'],
    commit: 'a'.repeat(40)
  }));
const expected = () => ({ versionCode: 100, version: 'test', sha256: apk, certificate });
const installed = () => ({ versionCode: 100, sha256: apk, certificate });
test('known lower same-certificate APK upgrades, exact current APK is not installed twice', () => {
  assert.equal(actualInstallDisposition({ versionCode: 0 }, expected()), 'install');
  assert.equal(
    actualInstallDisposition({ ...installed(), versionCode: 99 }, expected()),
    'upgrade'
  );
  assert.equal(actualInstallDisposition(installed(), expected()), 'already_installed');
  for (const edit of [
    { versionCode: 101 },
    { sha256: 'c'.repeat(64) },
    { certificate: 'd'.repeat(64) }
  ])
    assert.throws(() => actualInstallDisposition({ ...installed(), ...edit }, expected()));
});
test('lost install acknowledgement reconciles actual complete hash before any new install', async () => {
  let observation = { versionCode: 0 },
    journal = null,
    calls = 0;
  const a = {
    observe: async () => observation,
    load: async () => journal,
    save: async (j) => {
      journal = j;
    },
    perform: async () => {
      calls++;
      observation = installed();
      throw Error('lost reply');
    }
  };
  const first = await ensureReviewedInstall(a, expected());
  assert.equal(first.recoveredReply, true);
  assert.equal((await ensureReviewedInstall(a, expected())).mutated, false);
  assert.equal(calls, 1);
});
test('unconfirmed mutation is not repeated blindly, even if shell once printed Success', async () => {
  let calls = 0,
    journal = null;
  const a = {
    observe: async () => ({ versionCode: 0 }),
    load: async () => journal,
    save: async (j) => {
      journal = j;
    },
    perform: async () => {
      calls++;
      return 'Success';
    }
  };
  await assert.rejects(ensureReviewedInstall(a, expected()));
  await assert.rejects(ensureReviewedInstall(a, expected()), /UNCONFIRMED/);
  assert.equal(calls, 1);
});
test('a journal cannot be retargeted to another release or certificate', async () => {
  const a = {
    observe: async () => installed(),
    load: async () => ({ expected: { ...expected(), certificate: 'f'.repeat(64) } })
  };
  await assert.rejects(ensureReviewedInstall(a, expected()), /JOURNAL_CHANGED/);
});
const ready = (alias) => ({
  alias,
  status: 'ready',
  identityKey: sha(alias),
  actualApkVerified: true,
  profilePreserved: true,
  apkSha256: apk,
  certificateSha256: certificate,
  version: 'same',
  suite: { status: 'passed' },
  homeIcon: { status: 'passed' }
});
test('one phone success plus one offline is partial and cannot close two-phone QA', () => {
  const r = fleetSummary(
    [ready('phone-A'), { alias: 'phone-B', status: 'unavailable' }],
    ['phone-A', 'phone-B']
  );
  assert.equal(r.status, 'partially_ready');
  assert.equal(r.readyPhones, 1);
  assert.equal(r.twoPhysicalPhonesReady, false);
  assert.equal(r.radioTestPassed, false);
  assert.equal(r.phones[0].identityKey, undefined);
});
test('duplicate physical identity, different signed build and unconfirmed home icon never pass fleet', () => {
  const a = ready('phone-A'),
    b = ready('phone-B');
  assert.equal(fleetSummary([a, b], ['phone-A', 'phone-B']).twoPhysicalPhonesReady, true);
  for (const patch of [
    { identityKey: a.identityKey },
    { apkSha256: 'f'.repeat(64) },
    { certificateSha256: 'f'.repeat(64) },
    { profilePreserved: false },
    { homeIcon: { status: 'requested' } },
    { suite: { status: 'failed' } }
  ])
    assert.throws(() => fleetSummary([a, { ...b, ...patch }], ['phone-A', 'phone-B']));
});
