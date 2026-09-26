import { allowedBranch } from './hub-client.mjs';
import { classify } from './policy.mjs';
export const REPO = 'neurofoxpro/multimental';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Z]+-\d+$/;
const HUMAN = ['product', 'subjective', 'physical_consent', 'release_approval', 'external'];
export function assertTaskContext(c, task) {
  if (
    !c ||
    c.repository !== REPO ||
    !allowedBranch(c.branch) ||
    !SHA.test(c.head || '') ||
    !ID.test(task?.id || '') ||
    HUMAN.includes(task.kind)
  )
    throw Error('SHIP_SCOPE');
  if (
    !c.binding ||
    c.binding.released ||
    c.binding.branch !== c.branch ||
    c.binding.task !== task.id ||
    !c.binding.token ||
    !c.binding.owner
  )
    throw Error('SHIP_OWNERSHIP');
  if (task.blockedBy?.length) throw Error('SHIP_DEPENDENCIES');
}
export function assertPull(pr, branch, head) {
  if (
    !Number.isSafeInteger(pr?.number) ||
    pr.number < 1 ||
    pr.base?.ref !== 'dev' ||
    pr.base?.repo?.full_name !== REPO ||
    pr.head?.repo?.full_name !== REPO ||
    pr.head?.ref !== branch ||
    pr.head?.sha !== head ||
    !SHA.test(head || '') ||
    pr.draft
  )
    throw Error('SHIP_PR_IDENTITY');
  if (pr.merged_at) {
    if (!SHA.test(pr.merge_commit_sha || '')) throw Error('SHIP_MERGE_IDENTITY');
  } else if (pr.state !== 'open') throw Error('SHIP_CLOSED_UNMERGED');
  return pr;
}
export function assertBuild(build, merge) {
  if (
    build?.headSha !== merge ||
    build.status !== 'completed' ||
    build.conclusion !== 'success' ||
    build.workflowName !== 'Build Android' ||
    !Number.isSafeInteger(build.databaseId) ||
    build.databaseId < 1
  )
    throw Error('SHIP_DEV_BUILD_NOT_PROVEN');
  return build;
}
export function releaseEvidence(releases, merge, required) {
  if (!SHA.test(merge || '') || !Array.isArray(releases)) throw Error('SHIP_RELEASE_INPUT');
  if (!required) return { status: 'not_required_docs_only', sourceCommit: merge };
  const rows = releases.filter(
    (r) => r.target_commitish === merge && r.prerelease === true && r.draft === false
  );
  if (rows.length !== 1) throw Error('SHIP_RELEASE_NOT_UNIQUE');
  const r = rows[0];
  const assets = r.assets || [];
  const manifests = assets.filter((a) => a.name === 'build-manifest.json');
  const apks = assets.filter((a) => typeof a.name === 'string' && a.name.endsWith('.apk'));
  if (
    manifests.length !== 1 ||
    apks.length !== 1 ||
    !Number.isSafeInteger(r.id) ||
    r.id < 1 ||
    typeof r.tag_name !== 'string' ||
    !r.tag_name.startsWith('v')
  )
    throw Error('SHIP_RELEASE_ASSETS');
  for (const asset of [manifests[0], apks[0]])
    if (
      asset.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')
    )
      throw Error('SHIP_RELEASE_DIGEST');
  return {
    status: 'published',
    sourceCommit: merge,
    id: r.id,
    tag: r.tag_name,
    apkSha256: apks[0].digest.slice(7),
    manifestSha256: manifests[0].digest.slice(7),
    verification: 'successful_dev_build_and_github_asset_metadata',
    installation: 'not_inferred'
  };
}
export function compactPacket({ snapshot, task, comments, source, files, previous, claims = [] }) {
  if (snapshot.repository !== REPO || !Array.isArray(comments) || !Array.isArray(files))
    throw Error('FOCUS_INPUT');
  const old = new Map((previous?.files || []).map((f) => [f.path, f.sha256]));
  const history = comments.slice(-3).map((c) => ({
    id: c.id,
    author: c.user?.login,
    updatedAt: c.updated_at,
    excerpt: String(c.body || '').slice(0, 1200),
    truncated: String(c.body || '').length > 1200
  }));
  return {
    repository: REPO,
    observedAt: snapshot.observedAt,
    authority: 'live Issues; excerpts are not the full discussion',
    task,
    source,
    claims,
    history,
    historyCount: comments.length,
    historyOmitted: Math.max(0, comments.length - history.length),
    files,
    changedInputs: files.filter((f) => old.get(f.path) !== f.sha256).map((f) => f.path),
    details: '.gameprod/evidence/focus.local.json',
    fullCommand: 'npm run game -- task ' + task.id,
    nextCommands: {
      edit: 'npm run game -- apply BUNDLE.json',
      verify: 'npm run game -- check',
      ship: 'npm run game -- ship ' + task.id
    },
    productionAuthorized: false
  };
}
export function assertProof(proof, task) {
  if (
    proof?.schemaVersion !== 1 ||
    proof.repository !== REPO ||
    proof.taskId !== task.id ||
    !SHA.test(proof.sourceCommit || '') ||
    !Number.isSafeInteger(proof.implementation?.pr) ||
    proof.implementation.pr < 1 ||
    !SHA.test(proof.implementation.head || '')
  )
    throw Error('ACCEPT_PROOF_IDENTITY');
  if (
    HUMAN.includes(task.kind) ||
    task.blockedBy?.length ||
    !Array.isArray(task.acceptance) ||
    !task.acceptance.length ||
    JSON.stringify(proof.acceptance) !== JSON.stringify(task.acceptance)
  )
    throw Error('ACCEPT_CRITERIA_CHANGED_OR_HUMAN');
  const v = proof.verification;
  if (
    v?.status !== 'passed' ||
    v.exitCode !== 0 ||
    v.sourceChanged === true ||
    !HASH.test(v.sourceDigest || '') ||
    v.sourceDigestAfter !== v.sourceDigest ||
    !HASH.test(v.logHash || '')
  )
    throw Error('ACCEPT_VERIFICATION');
  if (
    !Array.isArray(proof.evidence) ||
    !proof.evidence.length ||
    proof.evidence.some(
      (p) =>
        typeof p !== 'string' ||
        !/^docs\/[A-Za-z0-9_./-]+$/.test(p) ||
        p.includes('..') ||
        p.includes('.local.')
    )
  )
    throw Error('ACCEPT_EVIDENCE_PATHS');
  if (!Number.isFinite(Date.parse(proof.observedAt))) throw Error('ACCEPT_OBSERVATION_TIME');
  return true;
}
export async function shipFlow(a, task) {
  let c = await a.current();
  assertTaskContext(c, task);
  let j = await a.load();
  if (j) {
    if (
      j.schemaVersion !== 1 ||
      j.repository !== REPO ||
      j.task !== task.id ||
      j.branch !== c.branch ||
      j.owner !== c.binding.owner ||
      j.token !== c.binding.token ||
      !['checking', 'publish_pending', 'ci', 'release', 'record', 'complete'].includes(j.phase)
    )
      throw Error('SHIP_CHECKPOINT_IDENTITY');
    if (j.head && (c.head !== j.head || c.dirty)) throw Error('SHIP_SOURCE_MOVED');
    if (j.sourceDigest && a.digest() !== j.sourceDigest) throw Error('SHIP_SOURCE_CHANGED');
  } else {
    j = {
      schemaVersion: 1,
      repository: REPO,
      task: task.id,
      branch: c.branch,
      owner: c.binding.owner,
      token: c.binding.token,
      phase: 'checking',
      startedAt: a.now(),
      productionAuthorized: false
    };
    await a.save(j);
  }
  const assertFrozen = async () => {
    const observed = await a.current();
    assertTaskContext(observed, task);
    if (j.head && (observed.head !== j.head || observed.dirty || a.digest() !== j.sourceDigest))
      throw Error('SHIP_SOURCE_MOVED_DURING_STAGE');
  };
  const phase = async (name) => {
    await assertFrozen();
    j.phase = name;
    j.updatedAt = a.now();
    await a.save(j);
    a.progress(name);
    await a.renew();
  };
  if (!j.head) {
    if (j.phase !== 'publish_pending') {
      await phase('checking');
      await a.check();
      if (!a.verified()) throw Error('SHIP_LOCAL_VERIFICATION_MISSING');
      j.sourceDigest = a.digest();
      await phase('publish_pending');
    } else if (!a.verified()) throw Error('SHIP_LOCAL_VERIFICATION_MISSING');
    let existing = await a.findPublished();
    if (!existing) {
      await a.publish(task);
      existing = await a.findPublished();
    }
    c = await a.current();
    if (c.dirty || a.digest() !== j.sourceDigest || !existing)
      throw Error('SHIP_PUBLICATION_NOT_PROVEN');
    const pr = assertPull(existing, c.branch, c.head);
    j.head = pr.head.sha;
    j.pr = pr.number;
    await phase('ci');
  }
  let pr = assertPull(await a.pull(j.pr), j.branch, j.head);
  if (!pr.merged_at) {
    await a.settle(j.pr, j.head);
    pr = assertPull(await a.pull(j.pr), j.branch, j.head);
    if (!pr.merged_at) throw Error('SHIP_NOT_MERGED');
  }
  if (j.merge && j.merge !== pr.merge_commit_sha) throw Error('SHIP_MERGE_CHANGED');
  j.merge = pr.merge_commit_sha;
  const paths = await a.changedFiles(j.pr);
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string'))
    throw Error('SHIP_NO_CHANGED_FILES');
  j.needsApk = classify(paths).needsApk;
  const wasComplete = j.phase === 'complete';
  if (!wasComplete) await phase('release');
  j.build = assertBuild(await a.waitDev(j.merge), j.merge);
  j.release = releaseEvidence(await a.releases(), j.merge, j.needsApk);
  await assertFrozen();
  if (!wasComplete) {
    await phase('record');
    await a.record(j);
    await assertFrozen();
    j.phase = 'complete';
    j.finishedAt = a.now();
    await a.save(j);
  }
  return {
    ...j,
    replayedCompletion: wasComplete,
    installation: 'separate_device_stage',
    humanAcceptance: 'not_inferred'
  };
}
