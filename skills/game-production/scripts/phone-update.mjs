import { freshFleetReport, compactPhoneResult } from './phone-update-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findRoot,
  readJSON,
  writeJSON,
  inside,
  context,
  normalizeRepo,
  fingerprint,
  gate,
  sha
} from './lib.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
import { acquireOperation } from './operation-lock.mjs';
import {
  phoneOptions,
  latestPhoneRelease,
  phoneResume,
  updatePhone
} from './phone-update-policy.mjs';
import { HONOR_REQUEST, REPO } from './known-phone-policy.mjs';
import { validateConfig } from '../../../scripts/install-device.mjs';
import { resolveKnownPhone, reviewedPhoneArtifact } from './fleet-ready.mjs';
const CONTROL = 'skills/game-production/scripts/control.mjs';
function safeRead(file) {
  let p = path.resolve(file);
  while (true) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error('PHONE_SYMLINK');
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  const s = fs.statSync(file);
  if (!s.isFile() || s.size > 1048576) throw Error('PHONE_CONFIG_SIZE');
  return fs.readFileSync(file);
}
export async function main(args = process.argv.slice(2)) {
  let opt = phoneOptions(args);
  if (opt.mode === 'help') {
    console.log(
      'scripts\\chat.cmd phone honor | redmi | all [--commit SHA]\nscripts\\chat.cmd phone resume\nAvailability first; exact release; verified manual APK; existing fleet safety gates.'
    );
    return;
  }
  const root = findRoot(),
    workspace = path.dirname(root),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  if (project.repository !== REPO || process.env.GITHUB_ACTIONS === 'true')
    throw Error('PHONE_AUTHORIZED_STATION_ONLY');
  await guardWorktree(root, 'phone', [opt.mode]);
  const binding = readJSON(inside(root, '.gameprod/agent.local.json'));
  const command = (exe, args) => {
    const r = spawnSync(exe, args, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: 25000,
      maxBuffer: 5000000
    });
    if (r.error || r.status !== 0) throw Error('PHONE_READ_FAILED ' + args[0]);
    return r.stdout.trim();
  };
  if (normalizeRepo(command('git', ['remote', 'get-url', 'origin'])) !== REPO)
    throw Error('PHONE_WRONG_ORIGIN');
  const stationFile = inside(workspace, 'station.local.json'),
    honorFile = inside(workspace, HONOR_REQUEST);
  const configHash = () =>
    sha(
      Buffer.concat([
        safeRead(stationFile),
        Buffer.from('\n--secondary--\n'),
        fs.existsSync(honorFile) ? safeRead(honorFile) : Buffer.from('absent')
      ])
    );
  const initialConfig = configHash(),
    station = validateConfig(JSON.parse(safeRead(stationFile))),
    honor = fs.existsSync(honorFile) ? JSON.parse(safeRead(honorFile)) : null;
  const stateFile = inside(root, '.gameprod/evidence/phone-update.local.json');
  if (opt.mode === 'resume')
    opt = phoneResume(readJSON(stateFile), {
      owner: binding.owner,
      configHash: initialConfig,
      sourceHash: fingerprint(root, project)
    });
  const runId = randomUUID(),
    folder = inside(root, '.gameprod/evidence/phone-update/' + runId);
  fs.mkdirSync(folder, { recursive: true });
  const localLock = acquireOperation(inside(root, '.gameprod/evidence/phone-update.lock'), {
    command: 'phone-update',
    runId
  });
  let stationLock = null;
  const state = {
    schemaVersion: 1,
    repository: REPO,
    runId,
    owner: binding.owner,
    name: opt.name,
    target: opt.target,
    configHash: initialConfig,
    sourceHash: fingerprint(root, project),
    startedAt: new Date().toISOString()
  };
  const save = (phase, data = {}) => {
    Object.assign(state, data, {
      phase,
      updatedAt: new Date().toISOString(),
      ...(data.seal ? { sourceHash: data.seal.sourceHash } : {})
    });
    writeJSON(stateFile, state);
    writeJSON(path.join(folder, 'state.local.json'), state);
  };
  const run = (args, label, timeout) => {
    const r = spawnSync(process.execPath, [CONTROL, ...args], {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 32 * 1024 * 1024
    });
    fs.writeFileSync(path.join(folder, label + '.local.log'), (r.stdout || '') + (r.stderr || ''));
    if (r.error || r.signal || r.status !== 0)
      throw Error('PHONE_STAGE_FAILED ' + label + '; private log preserved');
  };
  const unchanged = () => {
    if (configHash() !== initialConfig) throw Error('PHONE_CONFIG_CHANGED');
  };
  try {
    stationLock = acquireOperation(inside(station.workDir, 'phone-update.lock'), {
      command: 'phone-update',
      runId
    });
    const result = await updatePhone(
      {
        selectRelease: async (commit) =>
          latestPhoneRelease(
            JSON.parse(command('gh', ['api', 'repos/' + REPO + '/releases?per_page=100'])),
            commit
          ),
        save: async (phase, data) => {
          unchanged();
          save(phase, data);
          console.log('PHONE_STAGE ' + phase);
        },
        discover: async (targets) =>
          targets.map((alias) => {
            try {
              const { c, identity } = resolveKnownPhone(station, honor, alias, true);
              return {
                alias,
                status: 'available',
                ...identity,
                transport: c.serial.includes(':') || c.serial.includes('_tcp') ? 'wifi' : 'usb'
              };
            } catch (e) {
              if (
                [
                  'Explicit phone unavailable; no substitution',
                  'FLEET_PHONE_NOT_REGISTERED'
                ].includes(e.message)
              )
                return { alias, status: 'unavailable', reason: e.message };
              throw e;
            }
          }),
        isVerified: async () => gate(root, project, 'verified').ok === true,
        verify: async () => run(['check'], 'verify', 600000),
        seal: async () => ({ sourceHash: fingerprint(root, project), configHash: initialConfig }),
        assertSeal: async (seal) => {
          unchanged();
          if (seal.sourceHash !== fingerprint(root, project)) throw Error('PHONE_SOURCE_CHANGED');
        },
        preparedArtifact: async (commit) => {
          try {
            return reviewedPhoneArtifact(root, station, commit);
          } catch (e) {
            if (
              [
                'FLEET_RUN_REVIEW_READY_FIRST',
                'FLEET_NO_PUBLISHED_COMPATIBLE_MANUAL_PACKET'
              ].includes(e.message)
            )
              return null;
            throw e;
          }
        },
        prepareReview: async (commit) =>
          run(['review', 'ready', '--commit', commit], 'review', 1800000),
        deliver: async (target, commit) => {
          const reportFile = inside(root, '.gameprod/evidence/fleet/latest.json');
          const previousRunId = fs.existsSync(reportFile) ? readJSON(reportFile).runId : null;
          const startedAt = Date.now();
          const child = spawnSync(
            process.execPath,
            [CONTROL, 'fleet', 'ready', '--target', target, '--commit', commit],
            { cwd: root, shell: false, encoding: 'utf8', timeout: 1800000, maxBuffer: 16000000 }
          );
          fs.writeFileSync(
            path.join(folder, 'fleet.local.log'),
            (child.stdout || '') + (child.stderr || '')
          );
          if (child.error || child.signal || ![0, 2].includes(child.status))
            throw Error('PHONE_STAGE_FAILED fleet; private log preserved');
          return freshFleetReport(readJSON(reportFile), {
            previousRunId,
            startedAt,
            exitCode: child.status,
            commit
          });
        }
      },
      opt
    );
    writeJSON(path.join(folder, 'result.json'), result);
    console.log(
      JSON.stringify(
        compactPhoneResult(result, '.gameprod/evidence/phone-update/' + runId + '/result.json'),
        null,
        2
      )
    );
    if (result.status !== 'ready') process.exitCode = 2;
    return result;
  } catch (e) {
    save('blocked', { error: e.message });
    throw e;
  } finally {
    if (stationLock) stationLock();
    localLock();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('PHONE_UPDATE_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
