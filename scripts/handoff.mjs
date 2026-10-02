import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readJSON,
  writeJSON,
  findRoot,
  context,
  sha
} from '../skills/game-production/scripts/lib.mjs';
import {
  READSET,
  publicInstall,
  nextCommand,
  renderHandoff
} from '../skills/game-production/scripts/handoff-lib.mjs';
import { readiness } from './readiness.mjs';
const root = findRoot(),
  p = readJSON(path.join(root, '.gameprod/project.json'));
context(root, p);
const get = (f) => {
  try {
    return readJSON(path.resolve(root, f));
  } catch {
    return null;
  }
};
const run = (exe, args) => {
  const r = spawnSync(exe, args, { cwd: root, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0)
    throw Error('Handoff observation failed: ' + path.basename(exe) + ' ' + args[0]);
  return r.stdout.trim();
};
const head = run('git', ['rev-parse', 'HEAD']),
  branch = run('git', ['branch', '--show-current']),
  dirty = !!run('git', ['status', '--porcelain']);
let pr = null;
const observed = spawnSync(
  'gh',
  [
    'pr',
    'view',
    branch,
    '--repo',
    p.repository,
    '--json',
    'number,state,isDraft,baseRefName,headRefOid,url'
  ],
  { cwd: root, encoding: 'utf8', timeout: 20000 }
);
if (observed.status === 0) pr = JSON.parse(observed.stdout);
const rs = readiness(get('.gameprod/requirements.json')),
  candidate = get('.gameprod/evidence/candidate.json'),
  qualification = get('.gameprod/evidence/qualification.json');
const h = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  repository: p.repository,
  host: p.authorizedHosts[0],
  head,
  branch,
  dirty,
  pr,
  installed: publicInstall(get('../installations/installed.local.json')),
  candidate: candidate ? { head: candidate.head, version: candidate.manifest?.version } : null,
  qualification: qualification
    ? {
        status: qualification.status || 'running',
        candidateHead: qualification.candidateHead,
        finishedAt: qualification.finishedAt,
        failed: qualification.results.filter((x) => x.status === 'failed').map((x) => x.name)
      }
    : null,
  remaining: rs.remaining,
  manual: rs.manual,
  readset: READSET.map((file) => ({
    path: file,
    sha256: sha(fs.readFileSync(path.join(root, file)))
  }))
};
h.next = nextCommand(h);
writeJSON(path.join(root, '.gameprod/evidence/handoff.json'), h);
fs.writeFileSync(path.join(root, '.gameprod/evidence/NEXT_CHAT.ru.md'), renderHandoff(h));
if (process.argv.includes('--write')) {
  writeJSON(path.join(root, 'docs/production/handoff/state.json'), h);
  fs.writeFileSync(path.join(root, 'NEXT_CHAT.ru.md'), renderHandoff(h));
}
console.log(
  JSON.stringify(
    {
      status: 'handoff_prepared',
      repository: h.repository,
      branch,
      head,
      dirty,
      pr: pr?.number,
      installed: h.installed?.version,
      next: h.next,
      remaining: h.remaining.length,
      readset: READSET.length,
      written: process.argv.includes('--write')
    },
    null,
    2
  )
);
