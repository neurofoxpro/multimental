import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  releaseAssetIdentity,
  releaseFetch,
  downloadReleaseAsset
} from '../scripts/release-transfer.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const repo = 'neurofoxpro/multimental';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-transfer-')),
    releaseId = 456;
  fs.mkdirSync(path.join(root, 'releases', String(releaseId)), { recursive: true });
  const bytes = Buffer.from('verified actual artifact fixture ' + 'x'.repeat(400));
  const asset = {
    id: 123,
    name: 'multimental-test.apk',
    size: bytes.length,
    digest: 'sha256:' + hash(bytes),
    browser_download_url:
      'https://github.com/' + repo + '/releases/download/v1/multimental-test.apk'
  };
  const file = path.join(root, 'releases', String(releaseId), asset.name),
    leaseFile = path.join(root, 'update.lock');
  fs.writeFileSync(leaseFile, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
  const manifest = Buffer.from(
    JSON.stringify({
      repository: repo,
      package: 'pro.neurofox.multimental.dev',
      sourceBranch: 'dev',
      commit: 'a'.repeat(40),
      apk: asset.name,
      sha256: hash(bytes)
    })
  );
  const manifestPath = path.join(path.dirname(file), 'build-manifest.json');
  fs.writeFileSync(manifestPath, manifest);
  const args = {
    asset,
    repository: repo,
    releaseId,
    file,
    leaseFile,
    expectedHash: hash(bytes),
    maxBytes: 10000
  };
  return {
    root,
    bytes,
    asset,
    file,
    args,
    legacyManifest: { file: manifestPath, sha256: hash(manifest) },
    clean: () => fs.rmSync(root, { recursive: true, force: true })
  };
}
test('only pinned canonical release identity is accepted', () => {
  const f = fixture();
  try {
    assert.equal(
      releaseAssetIdentity(f.asset, repo, 456, hash(f.bytes), 10000).size,
      f.bytes.length
    );
    for (const changed of [
      { digest: null },
      { digest: 'sha256:' + 'b'.repeat(64) },
      { size: 0 },
      { size: 10001 },
      { name: '../bad.apk' },
      { browser_download_url: 'https://evil.example/test.apk' },
      { browser_download_url: f.asset.browser_download_url + '?redirect=evil' }
    ])
      assert.throws(() =>
        releaseAssetIdentity({ ...f.asset, ...changed }, repo, 456, hash(f.bytes), 10000)
      );
    assert.throws(() => releaseAssetIdentity(f.asset, 'other/repo', 456, hash(f.bytes), 10000));
  } finally {
    f.clean();
  }
});
test('verified local file reuses bytes without network', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file, f.bytes);
    const r = await downloadReleaseAsset({
      ...f.args,
      fetcher: () => {
        throw Error('no network expected');
      }
    });
    assert.equal(r.reused, true);
  } finally {
    f.clean();
  }
});
test('ordinary fresh transfer verifies size and digest', async () => {
  const f = fixture();
  try {
    const r = await downloadReleaseAsset({
      ...f.args,
      fetcher: async () =>
        new Response(f.bytes, { headers: { 'content-length': String(f.bytes.length) } })
    });
    assert.equal(r.status, 'verified');
    assert.equal(hash(fs.readFileSync(f.file)), hash(f.bytes));
  } finally {
    f.clean();
  }
});
test('legacy prefix copied and resumed but never declared verified on its own', async () => {
  const f = fixture();
  try {
    const prefix = f.bytes.subarray(0, 57);
    fs.writeFileSync(f.file + '.part', prefix);
    let range;
    const r = await downloadReleaseAsset({
      ...f.args,
      legacyManifest: f.legacyManifest,
      fetcher: async (_url, opt) => {
        range = opt.headers.Range;
        return new Response(f.bytes.subarray(57), {
          status: 206,
          headers: { 'content-range': `bytes 57-${f.bytes.length - 1}/${f.bytes.length}` }
        });
      }
    });
    assert.equal(range, 'bytes=57-');
    assert.equal(r.seededBytes, 57);
    assert.equal(hash(fs.readFileSync(f.file + '.part')), hash(prefix));
    assert.equal(hash(fs.readFileSync(f.file)), hash(f.bytes));
    const seed = JSON.parse(fs.readFileSync(f.file + '.verified-download.seed.json', 'utf8'));
    assert.equal(seed.prefixAuthenticated, false);
    assert.equal(seed.finalSha256Required, true);
  } finally {
    f.clean();
  }
});
test('corrupt copied prefix cannot produce a completed artifact', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file + '.part', Buffer.from('wrong'));
    await assert.rejects(
      downloadReleaseAsset({
        ...f.args,
        legacyManifest: f.legacyManifest,
        fetcher: async () =>
          new Response(f.bytes.subarray(5), {
            status: 206,
            headers: { 'content-range': `bytes 5-${f.bytes.length - 1}/${f.bytes.length}` }
          })
      }),
      /SHA-256 mismatch/
    );
    assert.equal(fs.existsSync(f.file), false);
    assert.equal(fs.readFileSync(f.file + '.part', 'utf8'), 'wrong');
  } finally {
    f.clean();
  }
});
test('manifest mismatch never adopts another legacy partial', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file + '.part', 'prefix');
    await assert.rejects(
      downloadReleaseAsset({
        ...f.args,
        legacyManifest: { ...f.legacyManifest, sha256: 'b'.repeat(64) }
      })
    );
    assert.equal(fs.existsSync(f.file + '.verified-download.part'), false);
  } finally {
    f.clean();
  }
});
test('a pending transfer resumes the same identity on the next call', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      downloadReleaseAsset({
        ...f.args,
        transfer: async (p) => {
          fs.writeFileSync(p.file + '.part', f.bytes.subarray(0, 20));
          fs.writeFileSync(p.file + '.part.json', JSON.stringify({ id: p.id, sha256: p.sha256 }));
          throw Error('bounded pause');
        }
      })
    );
    const r = await downloadReleaseAsset({
      ...f.args,
      fetcher: async (_url, opt) => {
        assert.equal(opt.headers.Range, 'bytes=20-');
        return new Response(f.bytes.subarray(20), {
          status: 206,
          headers: { 'content-range': `bytes 20-${f.bytes.length - 1}/${f.bytes.length}` }
        });
      }
    });
    assert.equal(r.status, 'verified');
    assert.equal(hash(fs.readFileSync(f.file)), hash(f.bytes));
  } finally {
    f.clean();
  }
});
test('copied prefix before metadata write is recovered only through its exact journal', async () => {
  const f = fixture();
  try {
    const prefix = f.bytes.subarray(0, 40),
      identity = releaseAssetIdentity(f.asset, repo, 456, hash(f.bytes), 10000);
    fs.writeFileSync(f.file + '.part', prefix);
    fs.writeFileSync(f.file + '.verified-download.part', prefix);
    fs.writeFileSync(
      f.file + '.verified-download.seed.json',
      JSON.stringify({
        schemaVersion: 1,
        id: identity.id,
        sha256: identity.sha256,
        bytes: 40,
        copiedPrefixHash: hash(prefix),
        prefixAuthenticated: false,
        finalSha256Required: true
      })
    );
    const r = await downloadReleaseAsset({
      ...f.args,
      legacyManifest: f.legacyManifest,
      fetcher: async () =>
        new Response(f.bytes.subarray(40), {
          status: 206,
          headers: { 'content-range': `bytes 40-${f.bytes.length - 1}/${f.bytes.length}` }
        })
    });
    assert.equal(r.status, 'verified');
  } finally {
    f.clean();
  }
});
test('foreign or missing lease and unknown final bytes are preserved', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.args.leaseFile, JSON.stringify({ pid: process.pid + 1 }));
    await assert.rejects(downloadReleaseAsset(f.args));
    fs.writeFileSync(f.args.leaseFile, JSON.stringify({ pid: process.pid }));
    fs.writeFileSync(f.file, 'wrong final');
    await assert.rejects(downloadReleaseAsset(f.args));
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'wrong final');
  } finally {
    f.clean();
  }
});
test('redirect allowlist blocks local endpoints without following them', async () => {
  let calls = 0;
  await assert.rejects(
    releaseFetch('https://github.com/a', {}, async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    })
  );
  assert.equal(calls, 1);
});
test('allowed CDN redirect preserves Range and shared time limit', async () => {
  let calls = 0;
  const signal = AbortSignal.timeout(1000);
  const r = await releaseFetch(
    'https://github.com/a',
    { signal, headers: { Range: 'bytes=10-' } },
    async (url, opt) => {
      calls++;
      assert.equal(opt.signal, signal);
      assert.equal(opt.headers.Range, 'bytes=10-');
      return calls === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/asset' }
          })
        : new Response('ok');
    }
  );
  assert.equal(await r.text(), 'ok');
  assert.equal(calls, 2);
});
test('symlink installation directory is refused without privileged file symlinks', async () => {
  const f = fixture();
  try {
    const linked = path.join(f.root, 'linked');
    fs.symlinkSync(f.root, linked, 'junction');
    await assert.rejects(
      downloadReleaseAsset({
        ...f.args,
        file: path.join(linked, 'releases', '456', f.asset.name),
        leaseFile: path.join(linked, 'update.lock')
      })
    );
  } finally {
    f.clean();
  }
});

import { releaseCandidate, updateOptions } from '../scripts/release-transfer.mjs';
test('pinned commit selects its actual release instead of waiting for a newer unrelated one', () => {
  const first = {
    id: 1,
    prerelease: true,
    draft: false,
    tag_name: 'v0.13.0-alpha.1',
    published_at: '2026-09-26T12:00:00Z',
    target_commitish: 'a'.repeat(40),
    assets: [{ name: 'build-manifest.json' }]
  };
  const latest = {
    ...first,
    id: 2,
    target_commitish: 'b'.repeat(40),
    published_at: '2026-09-26T13:00:00Z'
  };
  assert.equal(releaseCandidate([first, latest]).id, 2);
  assert.equal(releaseCandidate([latest, first], 'a'.repeat(40)).id, 1);
  assert.equal(releaseCandidate([latest], 'a'.repeat(40)), null);
  assert.throws(() =>
    releaseCandidate([
      { ...first, assets: [{ name: 'build-manifest.json' }, { name: 'build-manifest.json' }] }
    ])
  );
  assert.equal(releaseCandidate([{ ...first, draft: true }]), null);
  assert.equal(releaseCandidate([{ ...first, prerelease: false }]), null);
});
test('updater options cannot silently ignore unknown flags or a moving branch', () => {
  assert.deepEqual(updateOptions(['--config', 'local.json', '--commit', 'a'.repeat(40)]), {
    config: 'local.json',
    expectedCommit: 'a'.repeat(40)
  });
  for (const args of [
    [],
    ['--config'],
    ['--config', 'x', '--config', 'y'],
    ['--config', 'x', '--force', 'yes'],
    ['--config', 'x', '--commit', 'dev']
  ])
    assert.throws(() => updateOptions(args));
});
test('deployed updater bundle includes transitive relative module dependencies', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const deploy = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-agent.mjs'), 'utf8');
  const list = /const files = \[([\s\S]*?)\];/.exec(deploy)?.[1];
  assert.ok(list);
  const paths = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.includes('skills/game-production/scripts/release-transfer.mjs'));
  assert.ok(paths.includes('skills/game-production/scripts/resumable-download.mjs'));
  for (const file of paths.filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.')) {
        const needed = path
          .relative(repoRoot, path.resolve(repoRoot, path.dirname(file), m[1]))
          .replaceAll(path.sep, '/');
        assert.ok(paths.includes(needed), 'deployed dependency ' + needed);
      }
    }
  }
  assert.ok(
    deploy.includes("ExecutionTimeLimit='PT15M'"),
    'scheduler budget covers bounded download and install'
  );
});
