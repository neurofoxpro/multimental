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
  gate,
  fingerprint,
  normalizeRepo,
  verifyManifest
} from './lib.mjs';
import { guardWorktree } from './collaboration-guard.mjs';
import { acquireOperation } from './operation-lock.mjs';
import { HubClient } from './hub-client.mjs';
import { upsertComment } from './issue-memory.mjs';
import { releaseCandidate } from './release-transfer.mjs';
import { validateConfig, exec, signManualArtifact } from '../../../scripts/install-device.mjs';
import { apkPayload } from './apk-payload.mjs';
import { ensureSignedCandidate } from './signed-candidate.mjs';
import {
  REPO,
  PACKAGE,
  hash,
  reviewOptions,
  checkedRelease,
  checkedPcEvidence,
  manualNames,
  publishAsset,
  packetMarkdown
} from './manual-review-policy.mjs';
const CONTROL = 'skills/game-production/scripts/control.mjs';
function noLinks(file) {
  let p = path.resolve(file);
  while (true) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink())
      throw Error('Symlink review path refused');
    const up = path.dirname(p);
    if (up === p) return;
    p = up;
  }
}
function bytes(file, max = 250 * 1024 * 1024) {
  noLinks(file);
  const s = fs.statSync(file);
  if (!s.isFile() || s.size > max) throw Error('Review file size/type');
  return fs.readFileSync(file);
}
function json(file, max = 8 * 1024 * 1024) {
  return JSON.parse(bytes(file, max));
}
function immutableFile(file, content) {
  noLinks(file);
  if (fs.existsSync(file)) {
    if (!bytes(file).equals(Buffer.from(content)))
      throw Error('Existing review file differs; preserved');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { flag: 'wx' });
  }
}
export async function main(args = process.argv.slice(2)) {
  const opt = reviewOptions(args),
    root = findRoot(),
    workspace = path.dirname(root),
    project = readJSON(inside(root, '.gameprod/project.json'));
  if (process.platform === 'win32')
    process.env.PATH = path.join(workspace, 'tools/mingit/cmd') + path.delimiter + process.env.PATH;
  context(root, project);
  if (project.repository !== REPO || process.env.GITHUB_ACTIONS === 'true')
    throw Error('Manual review requires authorized station');
  const call = (exe, argv, timeout = 30000) => {
    const r = spawnSync(exe, argv, {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024
    });
    if (r.error || r.status !== 0)
      throw Error('Review command failed: ' + path.basename(exe) + ' ' + argv[0]);
    return r.stdout.trim();
  };
  if (normalizeRepo(call('git', ['remote', 'get-url', 'origin'])) !== REPO)
    throw Error('Wrong review origin');
  const stateFile = inside(root, '.gameprod/evidence/manual-review.local.json');
  if (opt.mode === 'status') {
    if (!fs.existsSync(stateFile)) {
      console.log(JSON.stringify({ status: 'not_prepared', next: 'review ready' }));
      return;
    }
    const r = json(stateFile);
    console.log(
      JSON.stringify(
        {
          status: r.phase,
          release: r.releaseTag,
          links: r.packet?.links || null,
          manualAcceptance: 'pending',
          liveAssetsRechecked: false
        },
        null,
        2
      )
    );
    return;
  }
  await guardWorktree(root, 'review', [opt.mode]);
  const binding = json(inside(root, '.gameprod/agent.local.json'));
  if (binding.released) throw Error('Active task required');
  const c = validateConfig(json(inside(workspace, 'station.local.json')));
  if (
    c.repository !== REPO ||
    c.package !== PACKAGE ||
    path.resolve(c.workDir) !== path.resolve(workspace, 'installations')
  )
    throw Error('Unexpected primary signing store');
  const client = new HubClient(
    process.env.GH_TOKEN || process.env.GITHUB_TOKEN || call('gh', ['auth', 'token'])
  );
  const lock = acquireOperation(inside(root, '.gameprod/evidence/manual-review.lock'), {
    command: 'review',
    task: binding.task
  });
  let storeLock = null,
    sourceLock = null,
    state = null;
  const game = (argv, label, timeout = 1800000) => {
    const r = spawnSync(process.execPath, [CONTROL, ...argv], {
      cwd: root,
      shell: false,
      encoding: 'utf8',
      timeout,
      maxBuffer: 32 * 1024 * 1024
    });
    const log = inside(
      root,
      '.gameprod/evidence/reviews/' + label + '-' + Date.now() + '.local.log'
    );
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, (r.stdout || '') + (r.stderr || ''));
    if (r.error || r.signal || r.status !== 0)
      throw Error('Review stage ' + label + ' failed; ' + path.relative(root, log));
  };
  const source = () => fingerprint(root, project);
  const readHash = (p) => {
    try {
      if (!/^\.gameprod\/evidence\/[A-Za-z0-9_.\/-]+$/.test(p) || p.includes('..')) return null;
      return hash(bytes(inside(root, p)));
    } catch {
      return null;
    }
  };
  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeJSON(stateFile, state);
    writeJSON(
      inside(
        root,
        '.gameprod/evidence/reviews/' + state.releaseId + '-' + state.sourceHash + '.json'
      ),
      state
    );
  };
  try {
    storeLock = acquireOperation(path.join(c.workDir, 'manual-review.lock'), {
      command: 'manual-release-packet',
      task: binding.task
    });
    if (opt.mode === 'ready' && !gate(root, project, 'verified').ok) {
      console.log('REVIEW_STAGE verify-tools');
      game(['check'], 'verify', 600000);
    }
    const previous = fs.existsSync(stateFile) ? json(stateFile) : null;
    if (
      opt.mode === 'resume' &&
      (!previous ||
        previous.sourceHash !== source() ||
        previous.configHash !== hash(bytes(inside(workspace, 'station.local.json'))))
    )
      throw Error('Review resume inputs changed');
    const releases = await client.list('/releases');
    const chosen = releaseCandidate(
      releases,
      opt.mode === 'resume' ? previous.sourceCommit : opt.commit
    );
    if (!chosen) throw Error('No matching published development release');
    checkedRelease(chosen, chosen.target_commitish);
    const target = opt.mode === 'resume' ? previous.target : opt.target;
    if (
      previous &&
      previous.releaseId === chosen.id &&
      previous.sourceHash === source() &&
      previous.target === target &&
      previous.configHash === hash(bytes(inside(workspace, 'station.local.json')))
    )
      state = previous;
    else
      state = {
        schemaVersion: 1,
        repository: REPO,
        sourceCommit: chosen.target_commitish,
        releaseId: chosen.id,
        releaseTag: chosen.tag_name,
        sourceHash: source(),
        testerHead: call('git', ['rev-parse', 'HEAD']),
        configHash: hash(bytes(inside(workspace, 'station.local.json'))),
        target,
        phase: 'computer-tests',
        createdAt: new Date().toISOString(),
        uploads: {}
      };
    save();
    let lab = null;
    if (state.labResultFile) {
      try {
        const r = json(inside(root, state.labResultFile));
        if (
          r.status === 'passed' &&
          r.reviewOnly &&
          r.testerSourceHash === state.sourceHash &&
          r.installation?.sourceCommit === state.sourceCommit
        )
          lab = r;
      } catch {
        /* Incomplete evidence is not reused. */
      }
    }
    if (!lab) {
      console.log('REVIEW_STAGE computer-tests ' + state.releaseTag);
      game(
        [
          'lab',
          'test',
          '--target',
          target,
          '--suite',
          'handoff',
          '--commit',
          state.sourceCommit,
          '--readiness',
          'software'
        ],
        'computer-tests'
      );
      const session = json(inside(root, '.gameprod/evidence/lab-session.local.json'));
      if (
        session.options?.reviewOnly !== true ||
        session.releaseCommit !== state.sourceCommit ||
        session.sourceHash !== state.sourceHash ||
        !session.selection?.target?.startsWith('emulator-')
      )
        throw Error('Wrong computer test session');
      state.labResultFile = '.gameprod/evidence/lab/' + session.runId + '/result.json';
      lab = json(inside(root, state.labResultFile));
      save();
    }
    sourceLock = acquireOperation(inside(root, '.gameprod/evidence/ops.lock'), {
      command: 'manual-review-publication',
      task: binding.task
    });
    if (state.sourceHash !== source() || !gate(root, project, 'verified').ok)
      throw Error('Review tooling changed after checks');
    const releaseNow = async () => {
      const all = await client.list('/releases');
      return checkedRelease(
        all.find((r) => r.id === state.releaseId),
        state.sourceCommit
      );
    };
    let release = await releaseNow();
    const artifactDir = path.join(
      c.workDir,
      'emulators',
      lab.target,
      'releases',
      String(release.id)
    );
    const manifestBytes = bytes(path.join(artifactDir, 'build-manifest.json'), 100000),
      manifest = JSON.parse(manifestBytes);
    if (
      manifest.repository !== REPO ||
      manifest.package !== PACKAGE ||
      manifest.sourceBranch !== 'dev' ||
      manifest.commit !== state.sourceCommit ||
      !/^\d+$/.test(String(manifest.workflowRun))
    )
      throw Error('Wrong tested build manifest');
    const manifestAsset = release.assets.filter((a) => a.name === 'build-manifest.json');
    const inputAssets = release.assets.filter((a) => a.name === manifest.apk);
    if (
      manifestAsset.length !== 1 ||
      manifestAsset[0].digest !== 'sha256:' + hash(manifestBytes) ||
      inputAssets.length !== 1 ||
      inputAssets[0].digest !== 'sha256:' + manifest.sha256
    )
      throw Error('Published build assets differ from tested bytes');
    const run = await client.api('GET', '/actions/runs/' + manifest.workflowRun);
    if (
      run.status !== 'completed' ||
      run.conclusion !== 'success' ||
      run.event !== 'push' ||
      run.head_branch !== 'dev' ||
      run.head_sha !== manifest.commit ||
      run.path !== '.github/workflows/build.yml' ||
      run.repository?.full_name !== REPO
    )
      throw Error('Canonical successful dev build required');
    const tagLine = call('git', ['ls-remote', 'origin', 'refs/tags/' + release.tag_name]);
    if (tagLine.split(/\s+/)[0] !== state.sourceCommit) throw Error('Release tag moved');
    const original = verifyManifest(artifactDir, manifest),
      sourceBytes = bytes(original);
    const suite = json(
      inside(root, '.gameprod/evidence/suites/' + lab.suite.runId + '/report.json')
    );
    const pc = checkedPcEvidence(lab, suite, release, manifest, readHash);
    const tested = path.join(artifactDir, 'local-development.apk');
    if (hash(bytes(tested)) !== lab.installation.installedSha256)
      throw Error('Tested signed APK changed');
    const payload = apkPayload(sourceBytes);
    if (apkPayload(bytes(tested)).sha256 !== payload.sha256)
      throw Error('Tested APK payload differs from published original');
    const identityPath = path.join(c.workDir, 'private-signing/identity.local.json'),
      identity = json(identityPath, 10000);
    if (!/^[a-f0-9]{64}$/.test(identity.certificate || ''))
      throw Error('Established primary signing certificate required');
    const identityHash = hash(bytes(identityPath)),
      names = manualNames(manifest, identity.certificate),
      outputDir = path.join(c.workDir, 'manual-review', String(release.id));
    noLinks(outputDir);
    fs.mkdirSync(outputDir, { recursive: true });
    const output = path.join(outputDir, names.apk);
    console.log('REVIEW_STAGE signed-candidate');
    const temporary = path.join(outputDir, names.apk + '.staging.apk');
    const validSignedCandidate = (file) => {
      const data = bytes(file),
        candidateCertificate = exec(c.java, ['-jar', c.apksigner, 'verify', '--print-certs', file])
          .match(/certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]
          ?.toLowerCase();
      return (
        candidateCertificate === identity.certificate && apkPayload(data).sha256 === payload.sha256
      );
    };
    ensureSignedCandidate({
      finalFile: output,
      stagingFile: temporary,
      verify: validSignedCandidate,
      sign: (file) => signManualArtifact(c, original, file)
    });
    const manualBytes = bytes(output),
      certificate = exec(c.java, ['-jar', c.apksigner, 'verify', '--print-certs', output])
        .match(/certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]
        ?.toLowerCase();
    if (
      certificate !== identity.certificate ||
      hash(bytes(identityPath)) !== identityHash ||
      apkPayload(manualBytes).sha256 !== payload.sha256
    )
      throw Error('Manual APK or persistent identity changed');
    const upload = async (file) => {
      const data = bytes(file),
        name = path.basename(file),
        expected = { name, size: data.length, sha256: hash(data) };
      if (
        !/^(?:multimental-[A-Za-z0-9._-]+-manual-[a-f0-9]{12}\.apk|MANUAL_REVIEW-[a-f0-9]{20}\.(?:md|json))$/.test(
          name
        )
      )
        throw Error('Only explicit public review assets may be uploaded');
      const result = await publishAsset(
        {
          list: async () => {
            release = await releaseNow();
            return release.assets;
          },
          load: async () => state.uploads[name] || null,
          save: async (value) => {
            state.uploads[name] = value;
            save();
          },
          immutable: async () => {
            release = await releaseNow();
            return release.immutable === true;
          },
          upload: async () => {
            if (hash(bytes(file)) !== expected.sha256 || state.sourceHash !== source())
              throw Error('Review upload inputs changed');
            const r = spawnSync(
              'gh',
              ['release', 'upload', release.tag_name, file, '--repo', REPO],
              { cwd: root, shell: false, encoding: 'utf8', timeout: 240000, maxBuffer: 1000000 }
            );
            if (r.error || r.signal || r.status !== 0)
              throw Error('Upload response uncertain; exact remote asset readback required');
          }
        },
        expected
      );
      const canonical =
        'https://github.com/' + REPO + '/releases/download/' + release.tag_name + '/' + name;
      if (result.asset.browser_download_url !== canonical)
        throw Error('Published download URL differs');
      return {
        id: result.asset.id,
        name,
        url: canonical,
        sha256: expected.sha256,
        size: expected.size
      };
    };
    state.phase = 'publishing';
    save();
    const publishedApk = await upload(output);
    const packetKey = hash(
      JSON.stringify({ release: release.id, apk: publishedApk.sha256, pc })
    ).slice(0, 20);
    const prefix = 'MANUAL_REVIEW-' + packetKey,
      assetBase = 'https://github.com/' + REPO + '/releases/download/' + release.tag_name + '/';
    const feedbackBody = [
      'Версия: ' + manifest.version,
      'Commit: ' + manifest.commit,
      'APK SHA-256: ' + publishedApk.sha256,
      '',
      'Устройство / Android:',
      'Результат: пройдено / проблема / не проверено',
      'Шаги воспроизведения:',
      'Ожидалось:',
      'Получилось:',
      'Скриншот/видео:'
    ].join('\n');
    const packet = {
      schemaVersion: 1,
      repository: REPO,
      kind: 'developer-manual-review',
      status: 'ready_for_human_review',
      reviewId: packetKey,
      preparedAt: pc.finishedAt,
      version: manifest.version,
      sourceCommit: manifest.commit,
      build: {
        runId: String(manifest.workflowRun),
        url: 'https://github.com/' + REPO + '/actions/runs/' + manifest.workflowRun
      },
      computer: pc,
      manualApk: {
        ...publishedApk,
        certificateSha256: certificate,
        originalSha256: manifest.sha256,
        payloadSha256: payload.sha256,
        payloadFiles: payload.files,
        signatureOnlyTransformation: true,
        manualSignedVariantInstalledByThisCommand: false
      },
      links: {
        apk: publishedApk.url,
        release: release.html_url,
        source: 'https://github.com/' + REPO + '/tree/' + manifest.commit,
        packet: assetBase + prefix + '.json',
        instructions: assetBase + prefix + '.md',
        feedback:
          'https://github.com/' +
          REPO +
          '/issues/new?' +
          new URLSearchParams({
            title: '[PLAYTEST ' + manifest.version + '] Результат проверки',
            body: feedbackBody
          }).toString()
      },
      manualAcceptance: 'pending',
      physicalPhoneMutations: false,
      keysOrPersonalDataPublished: false
    };
    const packetFile = path.join(outputDir, prefix + '.json'),
      textFile = path.join(outputDir, prefix + '.md');
    immutableFile(packetFile, JSON.stringify(packet, null, 2) + '\n');
    immutableFile(textFile, packetMarkdown(packet));
    await upload(packetFile);
    await upload(textFile);
    if (
      state.sourceHash !== source() ||
      state.configHash !== hash(bytes(inside(workspace, 'station.local.json')))
    )
      throw Error('Review inputs changed during publication');
    state.packet = packet;
    state.phase = 'ready_for_human_review';
    delete state.error;
    save();
    const text =
      '## Сборка для ручной проверки без подключения телефона\n\n' + packetMarkdown(packet);
    await upsertComment(
      client,
      29,
      'manual-review-' + release.id + '-' + certificate.slice(0, 12),
      text
    );
    if (Number.isSafeInteger(binding.issue) && binding.issue !== 29)
      await upsertComment(
        client,
        binding.issue,
        'manual-review-' + release.id + '-' + certificate.slice(0, 12),
        text
      );
    console.log(
      JSON.stringify(
        {
          status: state.phase,
          version: packet.version,
          sourceCommit: packet.sourceCommit,
          links: packet.links,
          apkSha256: publishedApk.sha256,
          certificateSha256: certificate,
          computer: pc.target,
          computerSuite: pc.suiteRunId,
          manualAcceptance: 'pending',
          physicalPhoneRequired: false,
          commandToRepeat: 'scripts\\chat.cmd review resume'
        },
        null,
        2
      )
    );
  } catch (error) {
    if (state) {
      state.error = error.message;
      save();
    }
    throw error;
  } finally {
    if (sourceLock) sourceLock();
    if (storeLock) storeLock();
    lock();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error('REVIEW_BLOCKED: ' + e.message);
    process.exitCode = 1;
  });
