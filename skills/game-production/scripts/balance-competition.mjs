import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
import {
  validatePlan,
  argsFor,
  seedsFor,
  requests,
  validateShard,
  summarize,
  resumeShard,
  planRecord,
  markdown,
  hash
} from './balance-competition-policy.mjs';
import { verificationRuntime } from '../../../tools/godot-runtime.mjs';
import { prepareGodotProject } from '../../../tools/godot-preflight.mjs';
import { runtimeSucceeded } from '../../../tools/runtime-diagnostics.mjs';

export async function main(args = process.argv.slice(2)) {
  const opt = argsFor(args);
  const root = findRoot();
  const project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  await guardWorktree(root, 'balance', [opt.mode]);
  const plan = validatePlan(readJSON(inside(root, 'tools/balance-mixed-plan.json')));
  const planHash = hash(JSON.stringify(plan));
  if (opt.mode === 'plan') {
    console.log(
      JSON.stringify(
        {
          plan,
          planHash,
          source: 'tools/balance-mixed-plan.json',
          simulationsExecuted: false
        },
        null,
        2
      )
    );
    return;
  }
  if (process.env.GITHUB_ACTIONS === 'true')
    throw Error('Full mixed balance runs use the authorized station; CI uses bounded regressions');

  const git = (argv) => {
    const result = spawnSync('git', argv, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: 15000
    });
    if (result.error || result.status !== 0) throw Error('MIXED_BALANCE_GIT_IDENTITY');
    return result.stdout.trim();
  };
  if (normalizeRepo(git(['remote', 'get-url', 'origin'])) !== 'neurofoxpro/multimental')
    throw Error('MIXED_BALANCE_ORIGIN');
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'balance-mixed-run'
  });
  try {
    let executable = process.env.GODOT_BIN;
    if (!executable && process.platform === 'win32') {
      const folder = inside(root, '.gameprod/runtime/godot');
      const name = fs.readdirSync(folder).find((item) => /console\.exe$/i.test(item));
      if (name) executable = path.join(folder, name);
    }
    const engine = verificationRuntime(root, executable || 'godot');
    prepareGodotProject(root, engine);
    const sourceDigest = fingerprint(root, project);
    const engineHash = hash(fs.readFileSync(engine));
    const seeds = seedsFor(opt.seed, opt.count);
    const shards = requests(plan, seeds);
    const key = hash(JSON.stringify({ planHash, sourceDigest, engineHash, seeds }));
    const dir = '.gameprod/evidence/balance-mixed/' + key;
    const bound = (rel) => inside(root, dir + '/' + rel);
    const read = (rel, max = 24 * 1024 * 1024) => {
      const file = bound(rel);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > max) throw Error('MIXED_BALANCE_RESULT_SIZE');
      return fs.readFileSync(file);
    };
    const immutable = (rel, body) => {
      const file = bound(rel);
      const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (fs.existsSync(file)) {
        if (!read(rel).equals(data)) throw Error('MIXED_BALANCE_IMMUTABLE_CONFLICT');
        return;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data, { flag: 'wx' });
    };

    const sourceHead = git(['rev-parse', 'HEAD']);
    const previousPlan = fs.existsSync(bound('plan.json')) ? JSON.parse(read('plan.json')) : null;
    const inputRecord = planRecord(
      previousPlan,
      {
        schemaVersion: 1,
        key,
        sourceDigest,
        engineHash,
        planHash,
        seeds,
        plan
      },
      sourceHead
    );
    immutable('plan.json', JSON.stringify(inputRecord, null, 2) + '\n');

    const progressFile = bound('progress.json');
    const parts = [];
    const proofs = [];
    let reused = 0;
    writeJSON(progressFile, {
      status: 'running',
      key,
      totalShards: shards.length,
      completedShards: 0
    });

    for (let i = 0; i < shards.length; i++) {
      if (fingerprint(root, project) !== sourceDigest) throw Error('MIXED_BALANCE_SOURCE_CHANGED');
      const request = shards[i];
      const prefix = 'shards/' + String(i).padStart(3, '0');
      const identity = hash(JSON.stringify({ key, request }));
      const receiptFile = bound(prefix + '/receipt.json');
      immutable(prefix + '/input.json', JSON.stringify(request));
      const prior = fs.existsSync(receiptFile) ? readJSON(receiptFile) : null;
      const state = resumeShard(prior, identity, (name) => {
        try {
          return hash(read(prefix + '/' + name));
        } catch {
          return null;
        }
      });

      if (state === 'reuse') reused++;
      else {
        if (prior) {
          const past = prefix + '/history/' + hash(JSON.stringify(prior));
          immutable(past + '/receipt.json', JSON.stringify(prior));
          for (const name of ['result.json', 'run.log'])
            if (fs.existsSync(bound(prefix + '/' + name)))
              immutable(past + '/' + name, read(prefix + '/' + name));
        }
        writeJSON(receiptFile, {
          schemaVersion: 1,
          status: 'running',
          identity,
          request,
          key
        });
        const result = spawnSync(
          engine,
          [
            '--headless',
            '--path',
            'game',
            '--script',
            'res://tests/balance_competition_runner.gd',
            '--',
            bound(prefix + '/input.json'),
            bound(prefix + '/result.json')
          ],
          {
            cwd: root,
            shell: false,
            encoding: 'utf8',
            timeout: 240000,
            maxBuffer: 8 * 1024 * 1024
          }
        );
        const log = (result.stdout || '') + (result.stderr || '');
        fs.writeFileSync(bound(prefix + '/run.log'), log);
        if (
          result.error ||
          !runtimeSucceeded(result.status, log, 'MULTIMENTAL_BALANCE_COMPETITION_PASS') ||
          fingerprint(root, project) !== sourceDigest
        ) {
          writeJSON(receiptFile, {
            schemaVersion: 1,
            status: 'failed',
            identity,
            request,
            key
          });
          throw Error('MIXED_BALANCE_SHARD_RUNTIME ' + i);
        }
        const data = validateShard(JSON.parse(read(prefix + '/result.json')), request);
        writeJSON(receiptFile, {
          schemaVersion: 1,
          status: 'passed',
          identity,
          request,
          key,
          resultHash: hash(read(prefix + '/result.json')),
          logHash: hash(log),
          games: data.rows.length
        });
      }

      const data = validateShard(JSON.parse(read(prefix + '/result.json')), request);
      parts.push({ request, data });
      proofs.push({
        index: i,
        request,
        identity,
        resultHash: hash(read(prefix + '/result.json')),
        logHash: hash(read(prefix + '/run.log'))
      });
      writeJSON(progressFile, {
        status: 'running',
        key,
        totalShards: shards.length,
        completedShards: i + 1,
        reused
      });
      console.log('MIXED_BALANCE_PROGRESS ' + (i + 1) + '/' + shards.length + ' reused=' + reused);
    }

    const summary = summarize(plan, seeds, parts);
    immutable('summary.json', JSON.stringify(summary, null, 2) + '\n');
    immutable('REPORT.ru.md', markdown(summary));
    if (sourceDigest !== fingerprint(root, project)) throw Error('MIXED_BALANCE_SOURCE_CHANGED');
    const receipt = {
      schemaVersion: 1,
      repository: project.repository,
      status: 'passed',
      kind: 'mixed_deck_cross_policy_engineering_experiment',
      key,
      sourceDigest,
      sourceDigestAfter: sourceDigest,
      sourceBase: inputRecord.sourceBase,
      observedHead: sourceHead,
      engineHash,
      planHash,
      seedBase: opt.seed,
      seeds,
      games: summary.games,
      shards: proofs,
      summary: dir + '/summary.json',
      summaryHash: hash(read('summary.json')),
      report: dir + '/REPORT.ru.md',
      reportHash: hash(read('REPORT.ru.md')),
      reusedShards: reused,
      observedAt: new Date().toISOString(),
      humanAcceptance: 'pending',
      coreGameplayChanged: false
    };
    writeJSON(bound('receipt.json'), receipt);
    writeJSON(inside(root, '.gameprod/evidence/balance-mixed/latest.json'), receipt);
    if (opt.name) {
      const file = inside(root, '.gameprod/evidence/balance-mixed/names/' + opt.name + '.json');
      if (fs.existsSync(file) && readJSON(file).key !== key)
        throw Error('MIXED_BALANCE_LABEL_ALREADY_BINDS_DIFFERENT_RUN');
      writeJSON(file, { key, receipt: dir + '/receipt.json' });
    }
    writeJSON(progressFile, {
      status: 'passed',
      key,
      totalShards: shards.length,
      completedShards: shards.length,
      reused
    });
    console.log(
      JSON.stringify(
        {
          status: 'passed',
          games: summary.games,
          key,
          reusedShards: reused,
          shards: shards.length,
          firstMover: summary.firstMoverScore,
          firstMoverScreen: summary.firstMoverScreen,
          crossPolicy: summary.crossPolicy,
          concerns: summary.concerns,
          report: receipt.report,
          receipt: dir + '/receipt.json',
          humanDurationMeasured: false
        },
        null,
        2
      )
    );
  } finally {
    release();
  }
}
