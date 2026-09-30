import { checkedRelease } from './manual-review-policy.mjs';
export const TARGETS = Object.freeze({ redmi: 'phone-A', honor: 'phone-B', all: 'all' });
const SHA = /^[a-f0-9]{40}$/;
export function phoneOptions(args) {
  const [name = 'help', ...rest] = args;
  if (['help', 'resume'].includes(name)) {
    if (rest.length) throw Error('PHONE_NO_EXTRA_OPTIONS');
    return { mode: name };
  }
  if (!Object.hasOwn(TARGETS, name)) throw Error('PHONE_KNOWN_NAME_REQUIRED');
  if (
    rest.length !== 0 &&
    (rest.length !== 2 || rest[0] !== '--commit' || !SHA.test(rest[1] || ''))
  )
    throw Error('PHONE_EXACT_COMMIT_OR_LATEST');
  return { mode: 'update', name, target: TARGETS[name], commit: rest[1] || null };
}
export function latestPhoneRelease(releases, commit = null) {
  if (!Array.isArray(releases) || releases.length > 100 || (commit !== null && !SHA.test(commit)))
    throw Error('PHONE_RELEASE_INPUT');
  const rows = releases.filter(
    (r) =>
      r.draft === false &&
      r.prerelease === true &&
      /^v\d+\.\d+\.\d+-alpha\.\d+\.\d+$/.test(r.tag_name || '') &&
      SHA.test(r.target_commitish || '') &&
      (!commit || r.target_commitish === commit)
  );
  if (!rows.length || (commit && rows.length !== 1)) throw Error('PHONE_RELEASE_NOT_UNIQUE');
  for (const r of rows) {
    checkedRelease(r, r.target_commitish);
    if (!Number.isFinite(Date.parse(r.published_at))) throw Error('PHONE_RELEASE_TIME');
  }
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    new Set(rows.map((r) => r.tag_name)).size !== rows.length
  )
    throw Error('PHONE_DUPLICATE_RELEASE');
  rows.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || b.id - a.id);
  const r = rows[0];
  return {
    id: r.id,
    commit: r.target_commitish,
    tag: r.tag_name,
    url: r.html_url,
    publishedAt: r.published_at
  };
}
export function phoneResume(saved, identity) {
  if (
    !saved ||
    saved.schemaVersion !== 1 ||
    saved.repository !== 'neurofoxpro/multimental' ||
    saved.owner !== identity.owner ||
    saved.configHash !== identity.configHash ||
    saved.sourceHash !== identity.sourceHash ||
    !SHA.test(saved.release?.commit || '') ||
    !Object.hasOwn(TARGETS, saved.name) ||
    saved.target !== TARGETS[saved.name]
  )
    throw Error('PHONE_RESUME_INPUTS_CHANGED');
  return {
    mode: 'update',
    name: saved.name,
    target: saved.target,
    commit: saved.release.commit,
    resumedRelease: { ...saved.release }
  };
}
export async function updatePhone(a, options) {
  if (options.mode !== 'update' || options.target !== TARGETS[options.name])
    throw Error('PHONE_EXPLICIT_UPDATE_REQUIRED');
  const targets = options.target === 'all' ? ['phone-A', 'phone-B'] : [options.target];
  const release = await a.selectRelease(options.commit);
  if (
    options.resumedRelease &&
    (release.id !== options.resumedRelease.id ||
      release.commit !== options.resumedRelease.commit ||
      release.tag !== options.resumedRelease.tag)
  )
    throw Error('PHONE_RESUMED_RELEASE_CHANGED');
  await a.save('discover', { options, release });
  const observed = await a.discover(targets);
  if (
    !Array.isArray(observed) ||
    observed.length !== targets.length ||
    observed.some(
      (r, i) => r.alias !== targets[i] || !['available', 'unavailable'].includes(r.status)
    )
  )
    throw Error('PHONE_DISCOVERY_INCOMPLETE');
  if (!observed.some((r) => r.status === 'available')) {
    const result = {
      status: 'not_ready',
      release,
      phones: observed,
      reason: 'requested_phone_unavailable',
      verificationRun: false,
      reviewPrepared: false,
      installationRun: false,
      otherPhoneSubstituted: false
    };
    await a.save('unavailable', { result });
    return result;
  }
  const verified = await a.isVerified();
  if (typeof verified !== 'boolean') throw Error('PHONE_VERIFICATION_UNKNOWN');
  if (!verified) {
    await a.save('verify');
    await a.verify();
    if ((await a.isVerified()) !== true) throw Error('PHONE_VERIFY_FAILED');
  }
  const seal = await a.seal();
  await a.save('artifact', { seal });
  let artifact = await a.preparedArtifact(release.commit),
    prepared = false;
  if (artifact === null) {
    await a.save('review');
    await a.prepareReview(release.commit);
    artifact = await a.preparedArtifact(release.commit);
    prepared = true;
  }
  if (
    !artifact ||
    artifact.release.id !== release.id ||
    artifact.release.target_commitish !== release.commit
  )
    throw Error('PHONE_PREPARED_RELEASE_CHANGED');
  await a.assertSeal(seal);
  await a.save('deliver');
  const fleet = await a.deliver(options.target, release.commit);
  await a.assertSeal(seal);
  if (
    !fleet ||
    fleet.schemaVersion !== 1 ||
    fleet.repository !== 'neurofoxpro/multimental' ||
    fleet.commit !== release.commit ||
    fleet.sourceDigest !== seal.sourceHash ||
    !Array.isArray(fleet.phones) ||
    fleet.phones.length !== targets.length ||
    fleet.phones.some((r, i) => r.alias !== targets[i]) ||
    !['ready', 'partially_ready', 'not_ready'].includes(fleet.status)
  )
    throw Error('PHONE_FLEET_RESULT_MISMATCH');
  const ready = fleet.phones.filter((r) => r.status === 'ready');
  if (
    fleet.readyPhones !== ready.length ||
    fleet.requestedPhones !== targets.length ||
    fleet.twoPhysicalPhonesReady !== (ready.length === 2) ||
    fleet.status !==
      (ready.length === targets.length ? 'ready' : ready.length ? 'partially_ready' : 'not_ready')
  )
    throw Error('PHONE_FLEET_COUNTS');
  for (const r of ready)
    if (
      r.version !== release.tag.slice(1) ||
      r.homeIcon?.home?.launchConfirmed !== true ||
      r.actualApkVerified !== true ||
      r.profilePreserved !== true ||
      r.suite?.status !== 'passed' ||
      r.homeIcon?.status !== 'passed' ||
      r.apkSha256 !== artifact.expected.sha256 ||
      r.certificateSha256 !== artifact.expected.certificate
    )
      throw Error('PHONE_READY_PROOF_INCOMPLETE');
  const result = {
    status: fleet.status,
    release,
    phones: fleet.phones,
    verificationReused: verified,
    reviewReused: !prepared,
    installationDelegatedToVerifiedFleet: true,
    report: fleet.report,
    runId: fleet.runId,
    humanAcceptance: 'pending',
    radioTestPassed: false
  };
  await a.save('complete', { result });
  return result;
}

export function freshFleetReport(value, { previousRunId, startedAt, exitCode, commit }) {
  if (
    ![0, 2].includes(exitCode) ||
    !value ||
    value.commit !== commit ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    Date.parse(value.observedAt) < startedAt ||
    !/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(value.runId || '') ||
    value.runId === previousRunId ||
    (exitCode === 0) !== (value.status === 'ready')
  )
    throw Error('PHONE_FLEET_NOT_A_FRESH_COMPLETED_RUN');
  return value;
}
export function compactPhoneResult(result, requestReport) {
  return {
    status: result.status,
    version: result.release.tag.slice(1),
    release: result.release.url,
    verificationReused: result.verificationReused ?? null,
    reviewReused: result.reviewReused ?? null,
    phones: result.phones.map((r) => ({
      device: r.alias === 'phone-A' ? 'Redmi' : 'Honor',
      status: r.status,
      version: r.version || null,
      installation: r.install?.disposition || 'not_attempted',
      apkVerified: r.actualApkVerified === true,
      profilePreserved: r.profilePreserved === true,
      homeLaunchConfirmed: r.homeIcon?.home?.launchConfirmed === true,
      reason: r.reason || null
    })),
    humanAcceptance: 'pending',
    requestReport
  };
}
