import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SHA = /^[a-f0-9]{40}$/;
const REPO = 'neurofoxpro/multimental';
export function sealSource(event, env, actual, parents) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== REPO ||
    !SHA.test(actual || '') ||
    !Array.isArray(parents)
  )
    throw Error('Invalid CI repository/source');
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !event?.pull_request)
    throw Error('PR source seal requires a real PR event');
  const pr = event.pull_request;
  if (pr.base?.repo?.full_name !== REPO || !['dev', 'main'].includes(pr.base?.ref))
    throw Error('Unexpected PR target');
  if (!Number.isSafeInteger(event.number) || event.number < 1 || pr.number !== event.number)
    throw Error('Invalid PR identity');
  const head = pr.head?.sha;
  const base = pr.base?.sha;
  if (!SHA.test(head || '') || !SHA.test(base || '') || actual !== env.GITHUB_SHA)
    throw Error('Invalid or moved source identity');
  if (parents.length !== 2 || parents[0] !== base || parents[1] !== head)
    throw Error('Checkout is not the tested head/base merge');
  return {
    schemaVersion: 1,
    repository: REPO,
    pullRequest: event.number,
    base,
    head,
    checkout: actual,
    target: pr.base.ref,
    sourceRepository: pr.head?.repo?.full_name || null,
    publicationAuthorized: false
  };
}
export function main() {
  if (process.argv.length > 2) throw Error('CI identity takes no command-line input');
  const git = (...args) => {
    const result = spawnSync('git', args, { encoding: 'utf8', shell: false, timeout: 10000 });
    if (result.error || result.status !== 0) throw Error('Unable to read checkout identity');
    return result.stdout.trim();
  };
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const seal = sealSource(
    event,
    process.env,
    git('rev-parse', 'HEAD'),
    git('show', '-s', '--format=%P', 'HEAD').split(' ').filter(Boolean)
  );
  fs.mkdirSync('.gameprod/evidence', { recursive: true });
  fs.writeFileSync('.gameprod/evidence/ci-source.json', JSON.stringify(seal, null, 2) + '\n');
  console.log('SOURCE_IDENTITY_PASS ' + JSON.stringify(seal));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error('SOURCE_SEAL_BLOCKED: ' + error.message);
    process.exitCode = 1;
  }
}
