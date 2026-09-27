import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findRoot,
  readJSON,
  writeJSON,
  inside,
  context,
  fingerprint,
  normalizeRepo
} from './lib.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { applyBundle, safePath } from './apply.mjs';
import {
  contentOptions,
  validateCatalog,
  candidate,
  compileRuntime,
  cardSchema,
  catalogMarkdown,
  contentHash,
  hash
} from './content-policy.mjs';
import { parseContentJSON } from './content-json.mjs';
import {
  summarizeTrial,
  trialMarkdown,
  trialResume,
  assertTrialEngine
} from './content-report.mjs';
import { verificationRuntime } from '../../../tools/godot-runtime.mjs';
import { prepareGodotProject } from '../../../tools/godot-preflight.mjs';
import { runtimeSucceeded } from '../../../tools/runtime-diagnostics.mjs';
const ACCEPTED = 'content/accepted/catalog.json';
function load(root, relative, max = 1048576) {
  const file = safePath(root, relative),
    info = fs.statSync(file);
  if (!info.isFile() || info.size > max) throw Error('CONTENT_INPUT_SIZE');
  return fs.readFileSync(file);
}
const normalized = (b) =>
  Buffer.isBuffer(b) ? b.toString('utf8').replace(/\r\n/g, '\n') : b.replace(/\r\n/g, '\n');
function immutable(root, relative, body) {
  const file = safePath(root, relative);
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(Buffer.from(body))) throw Error('CONTENT_IMMUTABLE_CONFLICT');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { flag: 'wx' });
  }
  return file;
}
export async function main(args = process.argv.slice(2)) {
  const opt = contentOptions(args),
    root = findRoot(),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  if (project.repository !== 'neurofoxpro/multimental') throw Error('CONTENT_REPOSITORY');
  await guardWorktree(root, 'content', [opt.mode]);
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, shell: false, encoding: 'utf8', timeout: 15000 });
    if (r.error || r.status !== 0) throw Error('CONTENT_GIT_READ');
    return r.stdout.trim();
  };
  if (normalizeRepo(git(['remote', 'get-url', 'origin'])) !== project.repository)
    throw Error('CONTENT_ORIGIN');
  const readAsset = (p) => load(root, p, 4000000);
  const data = validateCatalog(parseContentJSON(load(root, ACCEPTED).toString('utf8')), readAsset);
  const artifacts = [
    { path: 'content/card.schema.json', content: JSON.stringify(cardSchema(), null, 2) + '\n' },
    { path: 'game/src/content_catalog.gd', content: compileRuntime(data, readAsset) },
    { path: 'docs/production/CARD_CATALOG.ru.md', content: catalogMarkdown(data) }
  ];
  const check = () => {
    for (const a of artifacts)
      if (normalized(load(root, a.path)) !== a.content)
        throw Error('CONTENT_STALE_GENERATED:' + a.path);
  };
  if (opt.mode === 'check') {
    check();
    const files = fs
      .readdirSync(safePath(root, 'content/candidates'))
      .filter((f) => f.endsWith('.json'));
    if (files.length > 32) throw Error('CONTENT_CANDIDATE_LIMIT');
    for (const file of files)
      candidate(
        parseContentJSON(load(root, 'content/candidates/' + file).toString('utf8')),
        data,
        readAsset
      );
    console.log(
      'MULTIMENTAL_CONTENT_SCHEMA_PASS accepted=' +
        data.cards.length +
        ' candidates=' +
        files.length +
        ' source=' +
        contentHash(data)
    );
    return;
  }
  if (process.env.GITHUB_ACTIONS === 'true') throw Error('CONTENT_MUTATION_REQUIRES_STATION');
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'content-' + opt.mode
  });
  try {
    if (opt.mode === 'build') {
      const journal = '.gameprod/evidence/content/build.json',
        prior = fs.existsSync(inside(root, journal)) ? readJSON(inside(root, journal)) : null;
      const files = artifacts.filter(
        (a) => !fs.existsSync(inside(root, a.path)) || normalized(load(root, a.path)) !== a.content
      );
      for (const file of files) {
        const full = safePath(root, file.path);
        if (!fs.existsSync(full)) continue;
        const status = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', file.path], {
          cwd: root,
          shell: false,
          timeout: 10000
        });
        const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', file.path], {
          cwd: root,
          shell: false,
          timeout: 10000,
          encoding: 'utf8'
        });
        if (status.error || tracked.error || ![0, 1].includes(status.status))
          throw Error('CONTENT_GENERATED_OWNERSHIP');
        if (status.status !== 0 || tracked.status !== 0) {
          const actual = hash(load(root, file.path));
          if (!prior?.files?.some((f) => f.path === file.path && f.sha256 === actual))
            throw Error('CONTENT_PRESERVE_UNKNOWN_GENERATED_EDIT');
          file.expectedCurrentSha256 = actual;
        }
      }
      if (files.length) applyBundle(root, { base: git(['rev-parse', 'HEAD']), files });
      check();
      writeJSON(inside(root, journal), {
        status: 'built',
        acceptedHash: contentHash(data),
        files: artifacts.map((a) => ({ path: a.path, sha256: hash(load(root, a.path)) }))
      });
      console.log(
        JSON.stringify({
          status: 'built',
          filesChanged: files.length,
          acceptedCards: data.cards.length,
          candidatesPromoted: 0,
          catalog: 'docs/production/CARD_CATALOG.ru.md'
        })
      );
      return;
    }
    check();
    const spec = parseContentJSON(load(root, opt.file).toString('utf8')),
      prepared = candidate(spec, data, readAsset);
    const stage = '.gameprod/evidence/content/candidates/' + prepared.hash;
    immutable(
      root,
      '.gameprod/evidence/content/identities/' + prepared.id + '-r' + prepared.revision + '.json',
      JSON.stringify({
        id: prepared.id,
        revision: prepared.revision,
        hash: prepared.hash,
        acceptedHash: prepared.acceptedHash
      })
    );
    immutable(root, stage + '/candidate.json', JSON.stringify(prepared, null, 2) + '\n');
    immutable(root, stage + '/catalog.md', catalogMarkdown({ cards: prepared.cards }, 'candidate'));
    if (opt.mode === 'add') {
      console.log(
        JSON.stringify({
          status: 'candidate_staged',
          id: prepared.id,
          card: prepared.testedCard,
          version: spec.card.version,
          catalog: stage + '/catalog.md',
          candidate: stage + '/candidate.json',
          acceptedCatalogueChanged: false,
          next: 'content trial ' + opt.file
        })
      );
      return;
    }
    let executable = process.env.GODOT_BIN;
    if (!executable && process.platform === 'win32') {
      const folder = inside(root, '.gameprod/runtime/godot');
      const name = fs.readdirSync(folder).find((x) => /console\.exe$/i.test(x));
      if (name) executable = path.join(folder, name);
    }
    const engine = verificationRuntime(root, executable || 'godot');
    prepareGodotProject(root, engine);
    const before = fingerprint(root, project),
      engineHash = hash(fs.readFileSync(engine));
    const request = { seed: opt.seed, count: opt.count, candidate: prepared };
    const key = contentHash({ source: before, engine: engineHash, request });
    const dir = '.gameprod/evidence/content/trials/' + key,
      receiptPath = dir + '/receipt.json',
      outPath = dir + '/results.json';
    const input = immutable(root, dir + '/input.json', JSON.stringify(request));
    const prior = fs.existsSync(inside(root, receiptPath))
      ? readJSON(inside(root, receiptPath))
      : null;
    const decision = trialResume(
      prior,
      { key, sourceDigest: before, engineHash, seed: opt.seed, count: opt.count },
      (name) => {
        try {
          return hash(load(root, dir + '/' + name, 24000000));
        } catch {
          return null;
        }
      }
    );
    if (decision === 'reuse') {
      const report = JSON.parse(load(root, outPath, 24000000).toString('utf8'));
      assertTrialEngine(report.engineVersion);
      const summary = summarizeTrial(report, request);
      if (normalized(load(root, dir + '/report.md')) !== trialMarkdown(prepared, summary))
        throw Error('CONTENT_SUMMARY_CHANGED');
      console.log(
        JSON.stringify({
          status: 'passed',
          reused: true,
          games: summary.games,
          key,
          report: dir + '/report.md',
          receipt: receiptPath,
          acceptedCatalogueChanged: false
        })
      );
      return;
    }
    if (prior) {
      const archive = dir + '/history/' + contentHash(prior);
      immutable(root, archive + '/receipt.json', JSON.stringify(prior, null, 2) + '\n');
      for (const name of ['results.json', 'run.log'])
        if (fs.existsSync(inside(root, dir + '/' + name)))
          immutable(root, archive + '/' + name, load(root, dir + '/' + name, 24000000));
    }
    writeJSON(inside(root, receiptPath), {
      status: 'running',
      sourceDigest: before,
      engineHash,
      key,
      seed: opt.seed,
      count: opt.count
    });
    const result = spawnSync(
      engine,
      [
        '--headless',
        '--path',
        'game',
        '--script',
        'res://tests/content_trial_runner.gd',
        '--',
        input,
        inside(root, outPath)
      ],
      { cwd: root, shell: false, encoding: 'utf8', timeout: 180000, maxBuffer: 4000000 }
    );
    const log = (result.stdout || '') + (result.stderr || '');
    fs.writeFileSync(inside(root, dir + '/run.log'), log);
    if (
      result.error ||
      !runtimeSucceeded(result.status, log, 'MULTIMENTAL_CONTENT_TRIAL_PASS') ||
      before !== fingerprint(root, project)
    )
      throw Error('CONTENT_TRIAL_RUNTIME_OR_SOURCE_CHANGED');
    const report = JSON.parse(load(root, outPath, 24000000).toString('utf8'));
    assertTrialEngine(report.engineVersion);
    const summary = summarizeTrial(report, request);
    immutable(root, dir + '/report.md', trialMarkdown(prepared, summary));
    const receipt = {
      schemaVersion: 1,
      status: 'passed',
      candidateHash: prepared.hash,
      acceptedHash: prepared.acceptedHash,
      sourceDigest: before,
      sourceDigestAfter: fingerprint(root, project),
      engineHash,
      engine: report.engine,
      key,
      seed: opt.seed,
      count: opt.count,
      resultHash: hash(load(root, outPath, 24000000)),
      logHash: hash(log),
      summary,
      observedAt: new Date().toISOString(),
      output: outPath,
      report: dir + '/report.md',
      candidate: stage + '/candidate.json'
    };
    writeJSON(inside(root, receiptPath), receipt);
    writeJSON(inside(root, '.gameprod/evidence/content/latest-trial.json'), receipt);
    console.log(
      JSON.stringify(
        {
          status: 'passed',
          reused: false,
          key,
          games: summary.games,
          replays: summary.replaysVerified,
          comparisons: summary.groups.length,
          report: dir + '/report.md',
          receipt: receiptPath,
          automaticBalanceApproval: false,
          acceptedCatalogueChanged: false
        },
        null,
        2
      )
    );
  } finally {
    release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('CONTENT_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
