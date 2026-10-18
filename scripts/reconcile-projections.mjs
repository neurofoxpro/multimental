import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'neurofoxpro/multimental';
export const BRANCH = 'feature/production-control-20260925';
export const ALLOWED = new Set([
  '.gameprod/requirements.json',
  '.gameprod/backlog.json',
  '.gameprod/roadmap.json',
  'docs/ROADMAP.ru.md',
  'docs/BETA_READINESS.ru.md',
  'CHANGELOG.ru.md',
  'skills/game-production/scripts/control.mjs',
  'skills/game-production/tests/control.test.mjs',
  'tools/verify.mjs',
  'scripts/reconcile-projections.mjs',
  'skills/game-production/tests/reconcile.test.mjs'
]);
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const SHA = /^[a-f0-9]{40}$/;
const fail = (message) => {
  throw Error(message);
};

export function assertScope(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== 'refs/heads/' + BRANCH ||
    env.GITHUB_ACTOR !== '4erk' ||
    !SHA.test(env.GITHUB_SHA || '')
  ) {
    fail('Reconciliation is restricted to the owner push on the explicitly approved branch');
  }
}

export function validateBundle(bundle, source) {
  if (
    bundle?.schemaVersion !== 1 ||
    bundle.repository !== REPOSITORY ||
    bundle.branch !== BRANCH ||
    !SHA.test(source || '') ||
    bundle.source !== source ||
    !Array.isArray(bundle.files) ||
    bundle.files.length > ALLOWED.size
  )
    fail('Invalid bundle identity');
  const seen = new Set();
  let size = 0;
  for (const file of bundle.files) {
    if (
      !ALLOWED.has(file.path) ||
      seen.has(file.path) ||
      typeof file.content !== 'string' ||
      file.content.includes('\0') ||
      hash(file.content) !== file.sha256
    )
      fail('Invalid bundle file');
    size += Buffer.byteLength(file.content);
    if (size > 2000000) fail('Bundle exceeds bounded size');
    seen.add(file.path);
  }
  return bundle;
}

function run(args) {
  const result = spawnSync(args[0], args.slice(1), {
    shell: false,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 8000000
  });
  if (result.status !== 0 || result.error) fail('Reconcile prerequisite failed: ' + args[0]);
  return result.stdout;
}

function prepare() {
  assertScope(process.env);
  const source = process.env.GITHUB_SHA;
  if (run(['git', 'rev-parse', 'HEAD']).trim() !== source) fail('Checkout moved');
  for (const args of [
    ['skills/game-production/scripts/control.mjs', 'render'],
    ['scripts/readiness.mjs', 'render'],
    ['scripts/changelog.mjs', 'render'],
    ['scripts/format.mjs', 'write'],
    ['skills/game-production/scripts/control.mjs', 'validate'],
    ['skills/game-production/scripts/control.mjs', 'render', '--check'],
    ['scripts/readiness.mjs', 'check'],
    ['scripts/changelog.mjs', 'check'],
    ['scripts/format.mjs', 'check']
  ])
    run([process.execPath, ...args]);
  const tests = fs
    .readdirSync('skills/game-production/tests')
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => 'skills/game-production/tests/' + name);
  if (!tests.length) fail('No regression tests');
  const testLog = run([process.execPath, '--test', ...tests]);
  const files = run(['git', 'diff', '--name-only', '-z', source])
    .split('\0')
    .filter(Boolean)
    .map((file) => {
      if (!ALLOWED.has(file)) fail('Unexpected mutation: ' + file);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('Not a regular file');
      const content = fs.readFileSync(file, 'utf8');
      return { path: file, content, sha256: hash(content) };
    });
  const bundle = validateBundle(
    { schemaVersion: 1, repository: REPOSITORY, branch: BRANCH, source, files },
    source
  );
  fs.mkdirSync('.gameprod/evidence/reconcile', { recursive: true });
  fs.writeFileSync('.gameprod/evidence/reconcile/bundle.json', JSON.stringify(bundle));
  fs.writeFileSync('.gameprod/evidence/reconcile/tests.tap', testLog);
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=' + (files.length > 0) + '\n');
  console.log('RECONCILE_PREPARED files=' + files.length);
}

async function publish() {
  assertScope(process.env);
  if (!process.env.GH_TOKEN) fail('Missing scoped workflow credential');
  const file = '.gameprod/evidence/reconcile/bundle.json';
  if (fs.statSync(file).size > 2500000) fail('Oversized bundle');
  const bundle = validateBundle(JSON.parse(fs.readFileSync(file, 'utf8')), process.env.GITHUB_SHA);
  if (!bundle.files.length) {
    console.log('RECONCILE_NO_CHANGES');
    return;
  }
  async function api(suffix, method = 'GET', body = undefined) {
    if (!suffix.startsWith('/git/')) fail('Forbidden endpoint');
    const response = await fetch('https://api.github.com/repos/' + REPOSITORY + suffix, {
      method,
      headers: {
        Authorization: 'Bearer ' + process.env.GH_TOKEN,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'multimental-projection-reconciler',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) fail('GitHub reconciliation HTTP ' + response.status);
    return response.json();
  }
  const ref = '/git/ref/heads/' + BRANCH;
  if ((await api(ref)).object.sha !== bundle.source) fail('Branch advanced; do not overwrite');
  const parent = await api('/git/commits/' + bundle.source);
  const tree = await api('/git/trees', 'POST', {
    base_tree: parent.tree.sha,
    tree: bundle.files.map((item) => ({
      path: item.path,
      mode: '100644',
      type: 'blob',
      content: item.content
    }))
  });
  const commit = await api('/git/commits', 'POST', {
    message: 'chore: reconcile generated production views and formatting',
    parents: [bundle.source],
    tree: tree.sha
  });
  if ((await api(ref)).object.sha !== bundle.source)
    fail('Branch changed during prepare; safe orphan objects only');
  try {
    await api('/git/refs/heads/' + BRANCH, 'PATCH', { sha: commit.sha, force: false });
  } catch (error) {
    if ((await api(ref)).object.sha !== commit.sha) throw error;
  }
  const observed = (await api(ref)).object.sha;
  if (observed !== commit.sha) fail('Commit not confirmed; inspect live branch');
  console.log('RECONCILE_COMMITTED ' + observed);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      'Generated views committed to `' +
        BRANCH +
        '` at `' +
        observed +
        '`.\n\n' +
        'This is not a merge, release or device qualification. Refresh PR checks for this exact head.\n'
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...extra] = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      if (extra.length) fail('Unexpected arguments');
      if (command === 'prepare') return prepare();
      if (command === 'publish') return publish();
      fail('Use prepare or publish');
    })
    .catch((error) => {
      console.error('RECONCILE_BLOCKED: ' + error.message);
      process.exitCode = 1;
    });
}
