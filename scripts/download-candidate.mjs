import { resumableDownload } from '../skills/game-production/scripts/resumable-download.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readJSON,
  writeJSON,
  context,
  sha,
  verifyManifest
} from '../skills/game-production/scripts/lib.mjs';
const root = process.cwd(),
  p = readJSON('.gameprod/project.json');
context(root, p);
const [runText, targetText] = process.argv.slice(2);
if (!/^\d+$/.test(runText) || !targetText)
  throw Error('Explicit run and staging directory required');
const target = path.resolve(targetText),
  allowed = path.resolve('.gameprod/evidence/candidate');
if (!target.startsWith(allowed + path.sep))
  throw Error('Candidate staging outside managed directory');
fs.mkdirSync(target, { recursive: true });
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw Error('GitHub credential/API access failed');
  return r.stdout.trim();
}
const login = gh(['api', 'user', '--jq', '.login']);
if (p.githubLogin && login !== p.githubLogin) throw Error('Wrong GitHub account');
let token = gh(['auth', 'token']);
const headers = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Multimental-production'
};
async function api(route) {
  const r = await fetch('https://api.github.com/repos/' + p.repository + route, {
    headers,
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw Error('GitHub API status ' + r.status);
  return r.json();
}
const run = await api('/actions/runs/' + runText);
if (
  run.repository.full_name !== p.repository ||
  run.conclusion !== 'success' ||
  run.path !== '.github/workflows/build.yml'
)
  throw Error('Not a successful canonical build');
const listing = await api('/actions/runs/' + runText + '/artifacts');
const matches = listing.artifacts.filter((a) => a.name === 'multimental-android' && !a.expired);
if (matches.length !== 1) throw Error('Expected one unexpired Android artifact');
const artifact = matches[0];
if (artifact.size_in_bytes > 300 * 1024 * 1024) throw Error('Oversized artifact');
const zip = path.join(target, 'candidate.zip');
if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''))
  throw Error('Immutable GitHub artifact digest missing');
const transfer = await resumableDownload({
  file: zip,
  id: String(artifact.id),
  sha256: artifact.digest.slice(7),
  resolveURL: async () => {
    const response = await fetch(
      'https://api.github.com/repos/' + p.repository + '/actions/artifacts/' + artifact.id + '/zip',
      { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) }
    );
    if (response.status !== 302) throw Error('Artifact redirect status ' + response.status);
    return response.headers.get('location');
  },
  progress: (value) => console.log('DOWNLOAD_PROGRESS ' + JSON.stringify(value))
});
console.log('CANDIDATE_ARCHIVE_VERIFIED ' + JSON.stringify(transfer));
token = '';
delete headers.Authorization;
const ps =
  "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;$z=[IO.Compression.ZipFile]::OpenRead($env:MM_CANDIDATE_ZIP);$seen=New-Object 'System.Collections.Generic.HashSet[string]';try{foreach($entry in $z.Entries){if($entry.FullName -notmatch '^(?:build-manifest\\.json|SHA256SUMS\\.txt|RELEASE_NOTES\\.ru\\.md|[A-Za-z0-9_.-]+\\.apk)$' -or -not $seen.Add($entry.FullName)){throw 'Unexpected or duplicate ZIP entry'};if($entry.Length -gt 300MB){throw 'Oversized ZIP entry'};$dest=Join-Path $env:MM_CANDIDATE_DIR $entry.FullName;if(Test-Path $dest){$input=$entry.Open();$hash=[Security.Cryptography.SHA256]::Create();try{$expected=([BitConverter]::ToString($hash.ComputeHash($input))).Replace('-','');if((Get-FileHash $dest).Hash -ne $expected){throw 'Existing extracted file differs'}}finally{$input.Dispose();$hash.Dispose()}}else{[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$false)}}}finally{$z.Dispose()}";
const extraction = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
  encoding: 'utf8',
  timeout: 60000,
  env: { ...process.env, MM_CANDIDATE_ZIP: zip, MM_CANDIDATE_DIR: target }
});
if (extraction.status !== 0) throw Error('Safe archive extraction failed: ' + extraction.stderr);
const m = readJSON(path.join(target, 'build-manifest.json'));
verifyManifest(target, m);
if (m.repository !== p.repository || String(m.workflowRun) !== runText)
  throw Error('Manifest provenance mismatch');
writeJSON(path.join(target, 'download-receipt.json'), {
  run: runText,
  artifact: artifact.id,
  sha256: sha(fs.readFileSync(zip)),
  verified: true,
  at: new Date().toISOString()
});
console.log('CANDIDATE_DOWNLOAD_PASS ' + m.version);
