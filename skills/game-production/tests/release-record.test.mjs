import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseRecord } from '../../../tools/record-release.mjs';
const H = 'a'.repeat(40),
  A = 'b'.repeat(64),
  M = 'c'.repeat(64);
const manifest = () => ({
  schemaVersion: 1,
  repository: 'neurofoxpro/multimental',
  package: 'pro.neurofox.multimental.dev',
  sourceBranch: 'dev',
  commit: H,
  workflowRun: '123',
  version: '0.5.1-alpha.125.1',
  versionCode: 22501,
  apk: 'multimental-0.5.1-alpha.125.1-aaaaaaa.apk',
  sha256: A
});
const release = () => ({
  tag_name: 'v0.5.1-alpha.125.1',
  target_commitish: H,
  prerelease: true,
  draft: false,
  html_url: 'https://github.com/neurofoxpro/multimental/releases/tag/v0.5.1-alpha.125.1',
  assets: [
    { name: manifest().apk, state: 'uploaded', digest: 'sha256:' + A },
    { name: 'build-manifest.json', state: 'uploaded', digest: 'sha256:' + M }
  ]
});
const record = (m, r) => releaseRecord(m, r, { commit: H, run: '123' }, M);
test('release record is source-bound and does not claim installation', () => {
  const r = record(manifest(), release());
  assert.equal(r.status, 'published_observed');
  assert.equal(r.device, 'not_verified_by_publication');
  assert.equal(r.humanAcceptance, 'not_inferred');
});
for (const [name, mutate] of [
  ['foreign repo', (m) => (m.repository = 'other/repo')],
  ['production package', (m) => (m.package = 'pro.neurofox.multimental')],
  ['wrong branch', (m) => (m.sourceBranch = 'feature/x')],
  ['other commit', (m) => (m.commit = 'd'.repeat(40))],
  ['other build run', (m) => (m.workflowRun = '456')],
  ['path escape', (m) => (m.apk = '../app.apk')],
  ['invalid version', (m) => (m.version = 'latest')],
  ['invalid code', (m) => (m.versionCode = -1)],
  ['missing digest', (m) => (m.sha256 = '')]
])
  test('rejects manifest ' + name, () => {
    const m = manifest();
    mutate(m);
    assert.throws(() => record(m, release()));
  });
for (const [name, mutate] of [
  ['draft', (r) => (r.draft = true)],
  ['stable', (r) => (r.prerelease = false)],
  ['other tag', (r) => (r.tag_name = 'other')],
  ['other commit', (r) => (r.target_commitish = 'd'.repeat(40))],
  ['foreign URL', (r) => (r.html_url = 'https://example.org')],
  ['unuploaded APK', (r) => (r.assets[0].state = 'starter')],
  ['changed APK', (r) => (r.assets[0].digest = 'sha256:' + M)],
  ['missing manifest', (r) => r.assets.pop()],
  ['duplicate artifact', (r) => r.assets.push({ ...r.assets[0] })]
])
  test('rejects publication ' + name, () => {
    const r = release();
    mutate(r);
    assert.throws(() => record(manifest(), r));
  });
