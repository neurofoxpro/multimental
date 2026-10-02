import { planRecord } from './balance-audit-policy.mjs';
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
import {
  validatePlan,
  argsFor,
  seedsFor,
  requests,
  validateShard,
  summarize,
  resumeShard,
  markdown,
  hash
} from './balance-audit-policy.mjs';
import { verificationRuntime } from '../../../tools/godot-runtime.mjs';
import { prepareGodotProject } from '../../../tools/godot-preflight.mjs';
import { runtimeSucceeded } from '../../../tools/runtime-diagnostics.mjs';
export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'human') return (await import('./balance-human.mjs')).main(args.slice(1));
  if (args[0] === 'mixed') return (await import('./balance-competition.mjs')).main(args.slice(1));
  const opt = argsFor(args),
    root = findRoot(),
    p = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, p);
  await guardWorktree(root, 'balance', [opt.mode]);
  const plan = validatePlan(readJSON(inside(root, 'tools/balance-plan.json'))),
    planHash = hash(JSON.stringify(plan));
  if (opt.mode === 'plan') {
    console.log(
      JSON.stringify(
        { plan, planHash, source: 'tools/balance-plan.json', simulationsExecuted: false },
        null,
        2
      )
    );
    return;
  }
  if (process.env.GITHUB_ACTIONS === 'true')
    throw Error('Full research runs use the authorized station; CI uses bounded regressions');
  const git = (argv) => {
    const r = spawnSync('git', argv, { cwd: root, shell: false, encoding: 'utf8', timeout: 15000 });
    if (r.error || r.status !== 0) throw Error('BALANCE_GIT_IDENTITY');
    return r.stdout.trim();
  };
  if (normalizeRepo(git(['remote', 'get-url', 'origin'])) !== 'neurofoxpro/multimental')
    throw Error('BALANCE_ORIGIN');
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'balance-run'
  });
  try {
    let executable = process.env.GODOT_BIN;
    if (!executable && process.platform === 'win32') {
      const folder = inside(root, '.gameprod/runtime/godot');
      const name = fs.readdirSync(folder).find((n) => /console\.exe$/i.test(n));
      if (name) executable = path.join(folder, name);
    }
    const engine = verificationRuntime(root, executable || 'godot');
    prepareGodotProject(root, engine);
    const sourceDigest = fingerprint(root, p),
      engineHash = hash(fs.readFileSync(engine)),
      seeds = seedsFor(opt.seed, opt.count),
      shards = requests(plan, seeds, opt.profile);
    const key = hash(
        JSON.stringify({ planHash, sourceDigest, engineHash, seeds, profile: opt.profile })
      ),
      dir = '.gameprod/evidence/balance-standard/' + key;
    const bound = (rel) => inside(root, dir + '/' + rel),
      read = (rel, max = 12 * 1024 * 1024) => {
        const f = bound(rel),
          s = fs.statSync(f);
        if (!s.isFile() || s.size > max) throw Error('BALANCE_RESULT_SIZE');
        return fs.readFileSync(f);
      };
    const immutable = (rel, body) => {
      const f = bound(rel),
        data = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (fs.existsSync(f)) {
        if (!read(rel).equals(data)) throw Error('BALANCE_IMMUTABLE_CONFLICT');
        return;
      }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, data, { flag: 'wx' });
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
        profile: opt.profile,
        plan
      },
      sourceHead
    );
    immutable('plan.json', JSON.stringify(inputRecord, null, 2) + '\n');
    const progressFile = bound('progress.json'),
      parts = [],
      proofs = [];
    let reused = 0;
    writeJSON(progressFile, {
      status: 'running',
      key,
      totalShards: shards.length,
      completedShards: 0
    });
    for (let i = 0; i < shards.length; i++) {
      if (fingerprint(root, p) !== sourceDigest) throw Error('BALANCE_SOURCE_CHANGED');
      const request = shards[i],
        prefix = 'shards/' + String(i).padStart(3, '0'),
        identity = hash(JSON.stringify({ key, request })),
        receiptFile = bound(prefix + '/receipt.json');
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
        writeJSON(receiptFile, { schemaVersion: 1, status: 'running', identity, request, key });
        const result = spawnSync(
          engine,
          [
            '--headless',
            '--path',
            'game',
            '--script',
            'res://tests/balance_audit_runner.gd',
            '--',
            bound(prefix + '/input.json'),
            bound(prefix + '/result.json')
          ],
          { cwd: root, shell: false, encoding: 'utf8', timeout: 180000, maxBuffer: 4000000 }
        );
        const log = (result.stdout || '') + (result.stderr || '');
        fs.writeFileSync(bound(prefix + '/run.log'), log);
        if (
          result.error ||
          !runtimeSucceeded(result.status, log, 'MULTIMENTAL_BALANCE_AUDIT_PASS') ||
          fingerprint(root, p) !== sourceDigest
        ) {
          writeJSON(receiptFile, { schemaVersion: 1, status: 'failed', identity, request, key });
          throw Error('BALANCE_SHARD_RUNTIME ' + i);
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
      console.log('BALANCE_AUDIT_PROGRESS ' + (i + 1) + '/' + shards.length + ' reused=' + reused);
    }
    const summary = summarize(plan, seeds, parts);
    immutable('summary.json', JSON.stringify(summary, null, 2) + '\n');
    immutable('REPORT.ru.md', markdown(summary));
    if (sourceDigest !== fingerprint(root, p)) throw Error('BALANCE_SOURCE_CHANGED');
    const receipt = {
      schemaVersion: 1,
      repository: p.repository,
      status: 'passed',
      kind: 'engineering_experiment_not_balance_acceptance',
      key,
      sourceDigest,
      sourceDigestAfter: sourceDigest,
      sourceBase: inputRecord.sourceBase,
      observedHead: sourceHead,
      engineHash,
      planHash,
      seedBase: opt.seed,
      seeds,
      profile: opt.profile,
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
    writeJSON(inside(root, '.gameprod/evidence/balance-standard/latest.json'), receipt);
    if (opt.name) {
      const label = '.gameprod/evidence/balance-standard/names/' + opt.name + '.json';
      const file = inside(root, label);
      if (fs.existsSync(file) && readJSON(file).key !== key)
        throw Error('BALANCE_LABEL_ALREADY_BINDS_DIFFERENT_RUN');
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
          screen: summary.overall,
          policies: summary.policies.map((s) => ({
            policy: s.policy,
            firstScore: s.firstMoverScore,
            firstScreen: s.firstMoverScreen,
            forcedLimits: s.forcedLimits,
            cycles: s.deterministicCycles,
            concerns: s.screenConcerns
          })),
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('BALANCE_AUDIT_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
