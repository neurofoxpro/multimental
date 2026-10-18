import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CHECKS,
  validateStudy,
  hash,
  stage,
  captureSource,
  checkPassed,
  assessment
} from '../skills/game-production/scripts/study-policy.mjs';
import {
  findRoot,
  context,
  inside,
  readJSON,
  writeJSON,
  fingerprint
} from '../skills/game-production/scripts/lib.mjs';
import { safePath } from '../skills/game-production/scripts/apply.mjs';
import { acquireOperation } from '../skills/game-production/scripts/operation-lock.mjs';
export async function main(args = process.argv.slice(2)) {
  const [mode = 'check', task, resultFile] = args,
    root = findRoot();
  if (
    !['check', 'packet', 'run', 'record'].includes(mode) ||
    (mode === 'check'
      ? args.length > 1
      : !/^[A-Z]+-\d+$/.test(task || '') || args.length !== (mode === 'record' ? 3 : 2))
  )
    throw Error('study check|packet TASK|run TASK|record TASK RESULT.json');
  const directory = inside(root, '.gameprod/studies');
  if (mode === 'check') {
    const files = fs.readdirSync(directory).filter((f) => /^[A-Z]+-\d+\.json$/.test(f));
    if (!files.length) throw Error('No study definitions');
    for (const file of files) {
      const value = validateStudy(readJSON(safePath(root, '.gameprod/studies/' + file)));
      if (file !== value.task + '.json') throw Error('Study filename identity mismatch');
      for (const ref of value.readset)
        if (!fs.statSync(safePath(root, ref)).isFile()) throw Error('Missing study input');
    }
    console.log('STUDY_DEFINITIONS_PASS count=' + files.length);
    return;
  }
  const definitionPath = safePath(root, '.gameprod/studies/' + task + '.json');
  const study = validateStudy(readJSON(definitionPath));
  if (study.task !== task) throw Error('Task identity mismatch');
  const project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  if (process.platform === 'win32')
    process.env.PATH =
      path.join(path.dirname(root), 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  const inputs = () =>
    [
      ...new Set([
        '.gameprod/studies/' + task + '.json',
        'tools/study.mjs',
        'skills/game-production/scripts/study-policy.mjs',
        ...study.readset
      ])
    ]
      .sort()
      .map((ref) => ({ path: ref, sha256: hash(fs.readFileSync(safePath(root, ref))) }));
  const identity = () =>
    hash(
      JSON.stringify({
        inputs: inputs(),
        sourceDigest: fingerprint(root, {
          ...project,
          inputs: project.inputs.filter((p) => p !== '.gameprod/studies')
        })
      })
    );
  const exactInputs = inputs(),
    inputKey = identity();
  const file = inside(root, '.gameprod/evidence/study-' + task + '.json');
  let receipt = fs.existsSync(file) ? readJSON(file) : null;
  const current = stage(study, inputKey, receipt);
  if (mode === 'packet') {
    console.log(
      JSON.stringify(
        {
          ...study,
          inputKey,
          inputs: exactInputs,
          nextStage: current,
          receipt: file,
          sourceScope: 'versioned definition; use focus for live Issue authority',
          next:
            current === 'analysis'
              ? 'study record ' + task + ' .gameprod/studies/results/' + task + '.json'
              : 'study run ' + task
        },
        null,
        2
      )
    );
    return;
  }
  const binding = readJSON(inside(root, '.gameprod/agent.local.json'));
  if (binding.released || binding.task !== task)
    throw Error('Study execution requires its own bound task');
  const release = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
    command: 'study-' + mode,
    task
  });
  try {
    if (mode === 'record') {
      if (
        current !== 'analysis' ||
        !resultFile.startsWith('.gameprod/studies/results/') ||
        !resultFile.endsWith('.json')
      )
        throw Error('Capture/check evidence and explicit result path required');
      receipt.assessment = assessment(readJSON(safePath(root, resultFile)), inputKey, receipt);
      receipt.stage = 'complete';
      receipt.analysisAt = new Date().toISOString();
      writeJSON(file, receipt);
    } else {
      if (!receipt || receipt.inputKey !== inputKey) {
        if (receipt)
          writeJSON(
            inside(root, '.gameprod/evidence/studies/' + task + '-' + Date.now() + '.json'),
            receipt
          );
        receipt = {
          schemaVersion: 1,
          task,
          inputKey,
          inputs: exactInputs,
          sources: [],
          checks: [],
          stage: 'capture',
          startedAt: new Date().toISOString(),
          sourceDigest: fingerprint(root, project)
        };
      }
      const save = () => writeJSON(file, receipt);
      save();
      try {
        if (stage(study, inputKey, receipt) === 'capture') {
          receipt.sources = (receipt.sources || []).filter(
            (s) =>
              study.sources.includes(s.url) &&
              /^[a-f0-9]{64}$/.test(s.sha256 || '') &&
              Date.parse(s.observedAt) <= Date.now() &&
              Date.now() - Date.parse(s.observedAt) <= 7 * 86400000
          );
          receipt.checks = [];
          delete receipt.assessment;
          const missing = study.sources.filter(
            (url) => !receipt.sources.some((s) => s.url === url)
          );
          for (let i = 0; i < missing.length; i += 2) {
            const group = await Promise.allSettled(
              missing.slice(i, i + 2).map((url) => captureSource(url))
            );
            receipt.sources.push(
              ...group.filter((r) => r.status === 'fulfilled').map((r) => r.value)
            );
            save();
            const failure = group.find((r) => r.status === 'rejected');
            if (failure) throw failure.reason;
          }
          receipt.stage = 'checks';
          save();
        }
        if (stage(study, inputKey, receipt) === 'checks') {
          const previous = new Map((receipt.checks || []).map((c) => [c.id, c]));
          receipt.checks = [];
          for (const id of study.checks) {
            const before = fingerprint(root, project),
              spec = CHECKS[id],
              old = previous.get(id);
            if (
              old?.status === 'passed' &&
              old.exitCode === 0 &&
              old.sourceDigest === before &&
              typeof old.log === 'string' &&
              /^\.gameprod\/evidence\/studies\/[A-Z0-9-]+-[a-z-]+\.log$/.test(old.log) &&
              fs.existsSync(inside(root, old.log)) &&
              hash(fs.readFileSync(inside(root, old.log))) === old.logHash
            ) {
              receipt.checks.push(old);
              save();
              continue;
            }
            const result = spawnSync(process.execPath, spec.argv, {
              cwd: root,
              shell: false,
              encoding: 'utf8',
              timeout: 120000,
              maxBuffer: 16000000
            });
            const text = (result.stdout || '') + (result.stderr || '');
            const passed =
              checkPassed(spec, result) &&
              before === fingerprint(root, project) &&
              inputKey === identity();
            const log = '.gameprod/evidence/studies/' + task + '-' + id + '.log';
            fs.mkdirSync(path.dirname(inside(root, log)), { recursive: true });
            fs.writeFileSync(inside(root, log), text);
            receipt.checks.push({
              id,
              status: passed ? 'passed' : 'failed',
              exitCode: result.status,
              log,
              logHash: hash(text),
              sourceDigest: before
            });
            save();
            if (!passed) throw Error('Study check failed: ' + id + '; ' + text.slice(-1500));
          }
        }
        receipt.stage = stage(study, inputKey, receipt);
        delete receipt.error;
        save();
      } catch (error) {
        receipt.error = error.message;
        receipt.stage = stage(study, inputKey, receipt);
        save();
        throw error;
      }
    }
    console.log(
      JSON.stringify(
        {
          task,
          inputKey,
          stage: stage(study, inputKey, receipt),
          sourceHashes: receipt.sources.map((s) => s.sha256),
          checks: receipt.checks.map((c) => ({ id: c.id, status: c.status })),
          evidence: '.gameprod/evidence/study-' + task + '.json',
          automaticSourceUnderstandingClaimed: false
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
    console.error('STUDY_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
