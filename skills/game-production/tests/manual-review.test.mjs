import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { apkPayload } from '../scripts/apk-payload.mjs';
import {
  REPO,
  hash,
  reviewOptions,
  checkedRelease,
  checkedPcEvidence,
  manualNames,
  publishAsset,
  packetMarkdown
} from '../scripts/manual-review-policy.mjs';
import { labOptions } from '../scripts/lab-policy.mjs';
function zip(rows, compressed = false) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, text] of rows) {
    const n = Buffer.from(name),
      data = Buffer.from(text),
      body = compressed ? deflateRawSync(data) : data,
      local = Buffer.alloc(30),
      dir = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compressed ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(compressed ? 8 : 0, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    central.push(dir, n);
    offset += local.length + n.length + body.length;
  }
  const c = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(rows.length, 8);
  end.writeUInt16LE(rows.length, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, c, end]);
}
const h = 'a'.repeat(64),
  commit = 'b'.repeat(40),
  uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const release = () => ({
  id: 123,
  target_commitish: commit,
  tag_name: 'v0.13.7-alpha.272.1',
  draft: false,
  prerelease: true,
  assets: [],
  html_url: 'https://github.com/' + REPO + '/releases/tag/v0.13.7-alpha.272.1'
});
function evidence() {
  const m = { commit, sha256: h };
  const installation = { sourceCommit: commit, originalSha256: h, installedSha256: 'c'.repeat(64) };
  const modes = ['close', 'launch', 'jni', 'tutorial', 'ui', 'inspector', 'collection', 'restore'];
  const suite = {
    runId: uuid,
    status: 'passed',
    target: 'emulator-B',
    suite: 'handoff',
    repository: REPO,
    toolDigest: h,
    toolDigestAfter: h,
    installation,
    installationAfter: installation,
    modes,
    observedAt: '2026-09-27T11:00:00Z',
    finishedAt: '2026-09-27T11:02:00Z',
    results: modes.map((mode) => ({
      mode,
      status: 'passed',
      exitCode: 0,
      receipt: 'device-emulator-B-' + mode + '-' + uuid + '.json',
      receiptSha256: h
    }))
  };
  const lab = {
    status: 'passed',
    reviewOnly: true,
    target: 'emulator-B',
    runId: uuid,
    release: release().tag_name,
    installation,
    testerSourceHash: h,
    suite: { runId: uuid }
  };
  return { m, suite, lab };
}
test('APK content identity ignores only signatures and compression/offsets, not game data', () => {
  const rows = [
    ['AndroidManifest.xml', 'manifest'],
    ['assets/game.pck', 'actual gameplay'],
    ['META-INF/MANIFEST.MF', 'sig1'],
    ['META-INF/KEY.RSA', 'sig1'],
    ['META-INF/LICENSE', 'license']
  ];
  const changed = rows.map(([n, v]) => [n, /MANIFEST.MF|KEY.RSA/.test(n) ? 'new signature' : v]);
  assert.equal(apkPayload(zip(rows)).sha256, apkPayload(zip(changed, true)).sha256);
  assert.notEqual(
    apkPayload(zip(rows)).sha256,
    apkPayload(zip(rows.map(([n, v]) => [n, n === 'assets/game.pck' ? 'tampered' : v]))).sha256
  );
  assert.notEqual(
    apkPayload(zip(rows)).sha256,
    apkPayload(zip(rows.map(([n, v]) => [n, n === 'META-INF/LICENSE' ? 'wrong' : v]))).sha256
  );
});
for (const rows of [
  [['x', 'not-an-apk']],
  [
    ['AndroidManifest.xml', 'x'],
    ['AndroidManifest.xml', 'y']
  ],
  [
    ['AndroidManifest.xml', 'x'],
    ['../escape', 'y']
  ]
])
  test('unsafe APK archive rejected ' + JSON.stringify(rows), () =>
    assert.throws(() => apkPayload(zip(rows)))
  );
test('truncated and inconsistent ZIP headers fail closed', () => {
  const z = zip([['AndroidManifest.xml', 'x']]);
  assert.throws(() => apkPayload(z.subarray(0, z.length - 1)));
  const altered = Buffer.from(z);
  altered.writeUInt32LE(100000, 18);
  assert.throws(() => apkPayload(altered));
  assert.throws(() => apkPayload(Buffer.alloc(20)));
});
for (const args of [
  ['ready', '--target', 'phone'],
  ['ready', '--commit', 'dev'],
  ['ready', '--target', 'auto', '--target', 'emulator-A'],
  ['resume', '--commit', commit],
  ['unknown'],
  ['ready', '--force', 'yes']
])
  test('review args reject ' + args.join(' '), () => assert.throws(() => reviewOptions(args)));
test('manual review has one short no-phone default and pinned revision', () => {
  assert.deepEqual(reviewOptions([]), { mode: 'ready', target: 'auto', commit: null });
  assert.equal(reviewOptions(['ready', '--commit', commit]).commit, commit);
});
test('software readiness is explicit and cannot relax phone or partial-suite checks', () => {
  assert.equal(labOptions(['test', '--readiness', 'software']).reviewOnly, true);
  for (const args of [
    ['test', '--target', 'phone', '--readiness', 'software'],
    ['test', '--target', 'available', '--readiness', 'software'],
    ['test', '--suite', 'ui', '--readiness', 'software'],
    ['deliver', '--readiness', 'software']
  ])
    assert.throws(() => labOptions(args));
  assert.equal(Object.hasOwn(labOptions(['test']), 'reviewOnly'), false);
});
test('published exact dev release only; main/stable/draft/moved tags rejected', () => {
  assert.equal(checkedRelease(release(), commit).id, 123);
  for (const edit of [
    { draft: true },
    { prerelease: false },
    { target_commitish: 'dev' },
    { tag_name: 'v1.0.0' },
    { html_url: 'https://evil.test/r' }
  ])
    assert.throws(() => checkedRelease({ ...release(), ...edit }, commit));
});
test('a green partial or other-APK computer report is not review readiness', () => {
  const { lab, suite, m } = evidence();
  assert.equal(checkedPcEvidence(lab, suite, release(), m, () => h).steps.length, 8);
  for (const change of [
    { status: 'failed' },
    { target: 'phone' },
    { reviewOnly: false },
    { testerSourceHash: 'd'.repeat(64) }
  ])
    assert.throws(() => checkedPcEvidence({ ...lab, ...change }, suite, release(), m, () => h));
  assert.throws(() =>
    checkedPcEvidence(lab, { ...suite, results: suite.results.slice(1) }, release(), m, () => h)
  );
  assert.throws(() => checkedPcEvidence(lab, suite, release(), m, () => null));
  assert.throws(() =>
    checkedPcEvidence(lab, { ...suite, toolDigestAfter: 'd'.repeat(64) }, release(), m, () => h)
  );
});
test('manual asset name includes signing identity, not a moving latest alias', () => {
  assert.match(
    manualNames({ commit, version: '0.13.7-alpha.272.1' }, h).apk,
    /manual-aaaaaaaaaaaa\.apk$/
  );
  assert.throws(() => manualNames({ commit: 'dev', version: '0.13.7-alpha.272.1' }, h));
});
function publisher({ lost = false, preexisting = false, immutable = false } = {}) {
  const expected = { name: 'file.apk', size: 10, sha256: h };
  let asset = preexisting
      ? { id: 42, ...expected, state: 'uploaded', digest: 'sha256:' + h }
      : null,
    journal = null,
    calls = 0;
  return {
    expected,
    getCalls: () => calls,
    a: {
      list: async () => (asset ? [asset] : []),
      load: async () => journal,
      immutable: async () => immutable,
      save: async (j) => {
        journal = j;
      },
      upload: async () => {
        calls++;
        asset = { id: 42, name: 'file.apk', size: 10, state: 'uploaded', digest: 'sha256:' + h };
        if (lost) throw Error('lost upload acknowledgement');
      }
    }
  };
}
test('lost upload response is read back and rerun never uploads twice', async () => {
  const p = publisher({ lost: true });
  const first = await publishAsset(p.a, p.expected);
  assert.equal(first.recoveredReply, true);
  assert.equal((await publishAsset(p.a, p.expected)).reused, true);
  assert.equal(p.getCalls(), 1);
});
test('immutable releases and foreign same-name bytes are never replaced', async () => {
  const p = publisher({ immutable: true });
  await assert.rejects(publishAsset(p.a, p.expected));
  assert.equal(p.getCalls(), 0);
  const q = publisher({ preexisting: true });
  await assert.rejects(publishAsset(q.a, { ...q.expected, sha256: 'f'.repeat(64) }));
  assert.equal(q.getCalls(), 0);
});
test('unconfirmed earlier upload is not retried blindly', async () => {
  const p = publisher();
  p.a.load = async () => ({ attempted: true });
  await assert.rejects(publishAsset(p.a, p.expected), /unconfirmed/);
  assert.equal(p.getCalls(), 0);
});
test('manual instructions preserve review uncertainty and upgrade data', () => {
  const text = packetMarkdown({
    version: '1',
    sourceCommit: commit,
    links: { apk: 'https://github.com/x', release: 'r', source: 's', feedback: 'f' },
    manualApk: { sha256: h, certificateSha256: h },
    computer: { target: 'emulator-B' }
  });
  for (const term of ['не удаляйте', 'pending', 'ADB не нужны', 'Шаги воспроизведения'])
    assert.ok(text.includes(term));
});

import { releaseEvidence } from '../scripts/short-workflow-core.mjs';
test('supplemental manual APK does not replace the canonical CI APK in repeated ship checks', () => {
  const r = release();
  r.assets = [
    { name: 'build-manifest.json', size: 10, state: 'uploaded', digest: 'sha256:' + h },
    {
      name: 'multimental-' + r.tag_name.slice(1) + '-' + commit.slice(0, 7) + '.apk',
      size: 50,
      state: 'uploaded',
      digest: 'sha256:' + h
    }
  ];
  const manual = {
    name: manualNames({ commit, version: r.tag_name.slice(1) }, 'd'.repeat(64)).apk,
    size: 51,
    state: 'uploaded',
    digest: 'sha256:' + 'e'.repeat(64)
  };
  r.assets.push(manual);
  assert.equal(releaseEvidence([r], commit, true).apkSha256, h);
  r.assets.push({ ...manual });
  assert.throws(() => releaseEvidence([r], commit, true));
  r.assets.pop();
  r.assets.push({ ...manual, name: 'unknown.apk' });
  assert.throws(() => releaseEvidence([r], commit, true));
  r.assets.pop();
  manual.state = 'starter';
  assert.throws(() => releaseEvidence([r], commit, true));
});
test('step receipts from another test run cannot be mixed into manual readiness', () => {
  const { lab, suite, m } = evidence();
  suite.results[0].receipt = suite.results[0].receipt.replace(
    uuid,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  assert.throws(() => checkedPcEvidence(lab, suite, release(), m, () => h));
});
