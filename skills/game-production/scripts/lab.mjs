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
  gate,
  fingerprint,
  sha,
  normalizeRepo
} from './lib.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { readJSONHTTP } from './http-read.mjs';
import { adbLines } from './android-text.mjs';
import { releaseCandidate } from './release-transfer.mjs';
import { installationIdentity, completeSuite } from './device-suite-policy.mjs';
import { validateConfig } from '../../../scripts/install-device.mjs';
import {
  labOptions,
  adbRows,
  describeDevice,
  publicInventory,
  selectLabTarget,
  primaryTlsCandidates,
  canReuseSuite
} from './lab-policy.mjs';
const REPO = 'neurofoxpro/multimental',
  PACKAGE = 'pro.neurofox.multimental.dev';
export async function main(args = process.argv.slice(2)) {
  const options = labOptions(args),
    root = findRoot(),
    workspace = path.dirname(root),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  const git = (argv) => {
    const r = spawnSync('git', argv, { cwd: root, shell: false, encoding: 'utf8', timeout: 15000 });
    if (r.error || r.status !== 0) throw Error('Lab Git identity check failed');
    return r.stdout.trim();
  };
  if (
    project.repository !== REPO ||
    normalizeRepo(git(['remote', 'get-url', 'origin'])) !== REPO ||
    process.env.GITHUB_ACTIONS === 'true'
  )
    throw Error('Lab requires the authorized personal project station');
  const configPath = inside(workspace, 'station.local.json'),
    configBytes = fs.readFileSync(configPath),
    owner = validateConfig(JSON.parse(configBytes));
  if (
    owner.repository !== REPO ||
    owner.package !== PACKAGE ||
    path.resolve(owner.workDir) !== path.resolve(workspace, 'installations')
  )
    throw Error('Unexpected project installation root');
  const adb = (argv, optional = false) => {
    const r = spawnSync(owner.adb, argv, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 524288
    });
    if (r.error || r.status !== 0) {
      if (optional) return null;
      throw Error('ADB observation failed; no successful empty inventory');
    }
    return r.stdout.trim();
  };
  function observe() {
    const raw = adbRows(adb(['devices', '-l'])),
      devices = [],
      errors = [];
    if (process.platform === 'win32') {
      const host = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-File',
          inside(root, 'tools/avd-process-state.ps1'),
          '-Workspace',
          workspace
        ],
        { shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 16384 }
      );
      if (host.error || host.status !== 0)
        throw Error('Assigned AVD process inventory unavailable');
      const occupied = JSON.parse(host.stdout.trim());
      if (
        !Array.isArray(occupied) ||
        occupied.some((x) => !['A', 'B'].includes(x)) ||
        new Set(occupied).size !== occupied.length
      )
        throw Error('Invalid assigned AVD process inventory');
      for (const slot of occupied) {
        const serial = slot === 'A' ? 'emulator-5554' : 'emulator-5556';
        if (!raw.some((r) => r.serial === serial))
          raw.push({ serial, state: 'offline', kind: 'emulator' });
      }
    }
    for (const row of raw) {
      if (row.state !== 'device') {
        devices.push(describeDevice(row, {}, owner.serial));
        continue;
      }
      try {
        const prop = (k) => adb(['-s', row.serial, 'shell', 'getprop', k]);
        const facts = {
          qemu: prop('ro.kernel.qemu'),
          boot: prop('sys.boot_completed'),
          model: prop('ro.product.model')
        };
        if (row.kind === 'emulator')
          facts.avd =
            adbLines(adb(['-s', row.serial, 'emu', 'avd', 'name'])).find((s) => s !== 'OK') || '';
        else facts.serial = prop('ro.serialno');
        devices.push(describeDevice(row, facts, owner.serial));
      } catch {
        devices.push({ ...row, ready: false, alias: 'observation-failed', identity: null });
        errors.push({ kind: row.kind, reason: 'device_facts_unavailable' });
      }
    }
    const mdns = adb(['mdns', 'services'], true);
    const primaryCandidates = mdns === null ? [] : primaryTlsCandidates(mdns, owner.serial);
    return {
      devices,
      primaryCandidates,
      summary: {
        ...publicInventory(devices),
        observedAt: new Date().toISOString(),
        errors,
        mdnsObserved: mdns !== null,
        primaryTlsCandidates: primaryCandidates.length,
        source: git(['rev-parse', 'HEAD']),
        defaultTestTarget: 'dedicated_emulator',
        fallbackDoesNotProvePhysicalRadio: true
      }
    };
  }
  let inventory = observe();
  writeJSON(inside(root, '.gameprod/evidence/lab-probe.json'), inventory.summary);
  if (options.mode === 'probe') {
    console.log(JSON.stringify(inventory.summary, null, 2));
    return;
  }
  const checkpointPath = inside(root, '.gameprod/evidence/lab-session.local.json');
  let record = null,
    sourceRelease = null;
  const run = (argv, limit, label) => {
    const max = Math.max(1, Math.min(limit, deadline - performance.now()));
    if (max < 1000) throw Error('Lab cycle time budget exhausted');
    const r = spawnSync(process.execPath, argv, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout: max,
      maxBuffer: 24000000
    });
    const output = (r.stdout || '') + (r.stderr || '');
    const log = inside(root, '.gameprod/evidence/lab/' + runId + '/' + label + '.local.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, output);
    if (r.error || r.signal || r.status !== 0)
      throw Error('Lab stage ' + label + ' failed; exact private log preserved');
    return {
      path: path.relative(root, log).replaceAll(path.sep, '/'),
      sha256: sha(Buffer.from(output))
    };
  };
  const runId =
    options.mode === 'resume' && fs.existsSync(checkpointPath)
      ? readJSON(checkpointPath).runId
      : randomUUID();
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw Error('Invalid saved lab run identity');
  const deadline = performance.now() + 1500000;
  const save = () => {
    record.updatedAt = new Date().toISOString();
    writeJSON(checkpointPath, record);
    writeJSON(inside(root, '.gameprod/evidence/lab/' + runId + '/checkpoint.local.json'), record);
  };
  const labRelease = acquireOperation(inside(root, '.gameprod/evidence/lab.lock'), {
    command: 'lab',
    mode: options.mode
  });
  let stationRelease = null;
  try {
    stationRelease = acquireOperation(path.join(owner.workDir, 'lab-session.lock'), {
      command: 'lab',
      repository: REPO
    });
    if (options.mode === 'resume') {
      record = readJSON(checkpointPath);
      if (
        record.repository !== REPO ||
        record.configHash !== sha(configBytes) ||
        record.sourceHash !== fingerprint(root, project)
      )
        throw Error('Lab checkpoint inputs changed; start a new explicitly observed test');
    } else {
      if (!gate(root, project, 'verified').ok) {
        console.log('LAB_STAGE verify-tools');
        run(['skills/game-production/scripts/control.mjs', 'check'], 600000, 'verify');
      }
      record = {
        schemaVersion: 1,
        runId,
        repository: REPO,
        options,
        sourceHead: git(['rev-parse', 'HEAD']),
        sourceHash: fingerprint(root, project),
        configHash: sha(configBytes),
        startedAt: new Date().toISOString(),
        phase: 'select',
        status: 'running',
        stages: [],
        selection: null
      };
      save();
    }
    sourceRelease = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
      command: 'lab',
      runId
    });
    inventory = observe();
    const settings = record.options;
    if (!settings || !['test', 'deliver'].includes(settings.mode))
      throw Error('Invalid checkpoint operation');
    if (settings.target === 'phone' || settings.target === 'available') {
      if (!inventory.summary.primaryAvailable && inventory.primaryCandidates.length) {
        for (const endpoint of inventory.primaryCandidates) {
          adb(['connect', endpoint], true);
          inventory = observe();
          if (inventory.summary.primaryAvailable) break;
        }
      }
    }
    if (!record.selection) {
      record.selection = selectLabTarget(inventory.devices, settings.target);
      save();
    }
    const selected = record.selection;
    if (selected.target.startsWith('emulator-')) {
      const live = inventory.devices.find((r) => r.identity === selected.identity && r.ready);
      if (!live) {
        console.log('LAB_STAGE boot ' + selected.target);
        record.phase = 'boot';
        save();
        run(['scripts/emulator.mjs', 'start', selected.target.at(-1)], 275000, 'boot');
        inventory = observe();
      }
    }
    const live = inventory.devices.find(
      (r) =>
        r.identity === selected.identity &&
        r.ready &&
        (selected.target === 'phone' ? r.primaryMatch : r.alias === selected.target)
    );
    if (!live)
      throw Error(
        'Selected physical identity or assigned emulator is not ready; no device substitution'
      );
    selected.serial = live.serial;
    selected.transport = live.kind;
    selected.boot = false;
    record.inventory = inventory.summary;
    save();
    const suiteOwner = {
      ...owner,
      physicalSerial: owner.serial,
      serial: selected.target === 'phone' ? live.serial : owner.serial
    };
    const targetConfig = {
      ...owner,
      physicalSerial: owner.serial,
      serial: live.serial,
      workDir:
        selected.target === 'phone'
          ? owner.workDir
          : path.join(owner.workDir, 'emulators', selected.target)
    };
    const privateRoot = inside(root, '.gameprod/evidence/lab/' + runId);
    fs.mkdirSync(privateRoot, { recursive: true });
    const installConfig = path.join(privateRoot, 'install.config.local.json'),
      suiteConfig = path.join(privateRoot, 'suite.config.local.json');
    writeJSON(installConfig, targetConfig);
    writeJSON(suiteConfig, suiteOwner);
    function installation(allowPendingReadback = false) {
      const current = observe().devices.find(
        (r) => r.serial === live.serial && r.identity === selected.identity && r.ready
      );
      if (!current)
        throw Error('Device transport changed; resume only after readback of the same identity');
      const recordFile = path.join(targetConfig.workDir, 'installed.local.json');
      if (!fs.existsSync(recordFile)) return null;
      const dump = adb(['-s', live.serial, 'shell', 'dumpsys', 'package', PACKAGE]);
      const paths = adb(['-s', live.serial, 'shell', 'pm', 'path', PACKAGE])
        .split(/\r?\n/)
        .filter(Boolean);
      if (!paths.length) return null;
      if (
        paths.length !== 1 ||
        !/^package:\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk$/.test(paths[0])
      )
        throw Error('Expected one exact installed universal APK');
      const digest = adb(['-s', live.serial, 'shell', 'sha256sum', paths[0].slice(8)]).split(
        /\s+/
      )[0];
      try {
        return installationIdentity(readJSON(recordFile), {
          version: dump.match(/versionName=(\S+)/)?.[1],
          versionCode: Number(dump.match(/versionCode=(\d+)/)?.[1]),
          apkSha256: digest
        });
      } catch (error) {
        if (
          allowPendingReadback &&
          error.message === 'Actual APK does not match installation receipt'
        )
          return null;
        throw error;
      }
    }
    if (!record.releaseCommit) {
      const releases = await readJSONHTTP(
        'https://api.github.com/repos/' + REPO + '/releases?per_page=20',
        { headers: { 'User-Agent': 'multimental-lab' }, timeoutMs: 15000 }
      );
      const candidate = releaseCandidate(releases, settings.commit);
      if (!candidate || !/^[a-f0-9]{40}$/.test(candidate.target_commitish))
        throw Error('No eligible pinned dev release');
      record.releaseCommit = candidate.target_commitish;
      record.releaseTag = candidate.tag_name;
      save();
    }
    let actual = installation(true);
    if (!actual || actual.sourceCommit !== record.releaseCommit) {
      record.phase = 'delivery';
      save();
      console.log('LAB_STAGE delivery ' + selected.target);
      run(
        ['scripts/update-device.mjs', '--config', installConfig, '--commit', record.releaseCommit],
        900000,
        'delivery'
      );
      actual = installation();
    }
    if (!actual || actual.sourceCommit !== record.releaseCommit)
      throw Error('Pinned release installation is not confirmed');
    record.installation = actual;
    save();
    if (settings.mode === 'test') {
      const readHash = (p) => {
        try {
          return sha(fs.readFileSync(inside(root, p)));
        } catch {
          return null;
        }
      };
      if (!canReuseSuite(record.suite, actual, record.sourceHash, readHash)) {
        record.phase = 'testing';
        save();
        console.log('LAB_STAGE suite ' + settings.suite + ' on ' + selected.target);
        const proof = run(
          [
            'scripts/device-suite.mjs',
            '--config',
            suiteConfig,
            '--target',
            selected.target,
            '--suite',
            settings.suite,
            '--finish',
            'normal'
          ],
          600000,
          'suite'
        );
        const summaryPath =
          '.gameprod/evidence/suite-' + selected.target + '-' + settings.suite + '.json';
        const report = readJSON(inside(root, summaryPath));
        if (
          report.status !== 'passed' ||
          JSON.stringify(report.installation) !== JSON.stringify(actual) ||
          !completeSuite(
            report.results,
            report.modes,
            report.installation,
            report.installationAfter,
            report.toolDigest,
            report.toolDigestAfter
          )
        )
          throw Error('Suite evidence or installed artifact mismatch');
        const proofs = [
          proof,
          { path: summaryPath, sha256: readHash(summaryPath) },
          ...report.results.map((r) => ({
            path: '.gameprod/evidence/' + r.receipt,
            sha256: r.receiptSha256
          }))
        ];
        record.suite = {
          status: 'passed',
          runId: report.runId,
          sourceHash: record.sourceHash,
          installation: actual,
          proofs
        };
        save();
      }
    }
    if (
      record.sourceHash !== fingerprint(root, project) ||
      record.configHash !== sha(fs.readFileSync(configPath)) ||
      JSON.stringify(actual) !== JSON.stringify(installation())
    )
      throw Error('Inputs or installed APK changed across the lab cycle');
    record.phase = 'complete';
    record.status = 'passed';
    record.finishedAt = new Date().toISOString();
    save();
    const publicResult = {
      status: 'passed',
      runId,
      operation: settings.mode,
      target: selected.target,
      transport: selected.transport,
      sourceHead: record.sourceHead,
      testerSourceHash: record.sourceHash,
      release: record.releaseTag,
      installation: record.installation,
      suite: record.suite ? { runId: record.suite.runId, status: record.suite.status } : null,
      normalStartupEvidence:
        settings.mode === 'test' ? 'passed_in_recorded_restore_step' : 'not_checked',
      homeIcon: 'not_asserted_by_lab',
      secondaryPhone: 'registration_and_radio_not_inferred',
      report: '.gameprod/evidence/lab/' + runId + '/result.json'
    };
    writeJSON(inside(root, publicResult.report), publicResult);
    console.log(JSON.stringify(publicResult, null, 2));
  } catch (error) {
    if (record) {
      record.status = 'paused_or_failed';
      record.error = error.message;
      save();
    }
    throw error;
  } finally {
    if (sourceRelease) sourceRelease();
    if (stationRelease) stationRelease();
    labRelease();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('LAB_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
