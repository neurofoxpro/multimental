import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha, writeJSON } from '../skills/game-production/scripts/lib.mjs';
import { HubClient } from '../skills/game-production/scripts/hub-client.mjs';
import { upsertComment } from '../skills/game-production/scripts/issue-memory.mjs';
const REPO = 'neurofoxpro/multimental';
export function releaseRecord(m, r, expected, manifestHash) {
  if (
    m?.schemaVersion !== 1 ||
    m.repository !== REPO ||
    m.package !== 'pro.neurofox.multimental.dev' ||
    m.sourceBranch !== 'dev'
  )
    throw Error('Wrong development artifact');
  if (
    !/^[a-f0-9]{40}$/.test(expected.commit || '') ||
    m.commit !== expected.commit ||
    String(m.workflowRun) !== String(expected.run)
  )
    throw Error('Wrong release provenance');
  if (
    !/^\d+\.\d+\.\d+-alpha\.\d+\.\d+$/.test(m.version || '') ||
    !Number.isSafeInteger(m.versionCode) ||
    m.versionCode < 1 ||
    !/^[a-f0-9]{64}$/.test(m.sha256 || '')
  )
    throw Error('Invalid artifact metadata');
  const name = 'multimental-' + m.version + '-' + m.commit.slice(0, 7) + '.apk';
  if (
    m.apk !== name ||
    r?.tag_name !== 'v' + m.version ||
    r.target_commitish !== m.commit ||
    r.prerelease !== true ||
    r.draft !== false
  )
    throw Error('Release does not match artifact');
  const url = 'https://github.com/' + REPO + '/releases/tag/v' + m.version;
  if (r.html_url !== url || !Array.isArray(r.assets)) throw Error('Unexpected release URL');
  for (const [file, hash] of [
    [name, m.sha256],
    ['build-manifest.json', manifestHash]
  ]) {
    if (!/^[a-f0-9]{64}$/.test(hash || '')) throw Error('Missing digest');
    const matches = r.assets.filter(
      (a) => a.name === file && a.state === 'uploaded' && a.digest === 'sha256:' + hash
    );
    if (matches.length !== 1) throw Error('Published asset digest mismatch');
  }
  return {
    schemaVersion: 1,
    status: 'published_observed',
    repository: REPO,
    commit: m.commit,
    release: r.tag_name,
    url,
    versionCode: m.versionCode,
    apkSha256: m.sha256,
    manifestSha256: manifestHash,
    workflowRun: String(m.workflowRun),
    device: 'not_verified_by_publication',
    humanAcceptance: 'not_inferred'
  };
}
export async function main() {
  const e = process.env;
  if (
    process.argv.length > 2 ||
    e.GITHUB_ACTIONS !== 'true' ||
    e.GITHUB_REPOSITORY !== REPO ||
    e.GITHUB_EVENT_NAME !== 'push' ||
    e.GITHUB_REF !== 'refs/heads/dev' ||
    !e.GH_TOKEN
  )
    throw Error('Release recorder requires the canonical dev publication job');
  const bytes = fs.readFileSync('artifacts/build-manifest.json');
  const manifest = JSON.parse(bytes.toString('utf8'));
  const client = new HubClient(e.GH_TOKEN);
  const matches = (await client.list('/releases')).filter(
    (r) => r.tag_name === 'v' + manifest.version
  );
  if (matches.length !== 1) throw Error('Published release not observed');
  const report = releaseRecord(
    manifest,
    matches[0],
    { commit: e.GITHUB_SHA, run: e.GITHUB_RUN_ID },
    sha(bytes)
  );
  const text =
    '## Автоматическая квитанция dev-релиза\n\nВерсия: **' +
    report.release +
    '**.\n\nИсточник: `' +
    report.commit +
    '`. CI: ' +
    report.workflowRun +
    '.\n\nРелиз: ' +
    report.url +
    '\n\nAPK SHA-256: `' +
    report.apkSha256 +
    '`.\n\nСверены опубликованный APK и manifest. Установка на телефон и ручная приёмка этой квитанцией **не подтверждаются**.\n';
  const comment = await upsertComment(client, 29, 'release-' + report.release, text);
  writeJSON('.gameprod/evidence/release-record.json', { ...report, commentId: comment.id });
  console.log('RELEASE_MEMORY_RECORDED ' + report.release + ' issue=29');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('RELEASE_MEMORY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
