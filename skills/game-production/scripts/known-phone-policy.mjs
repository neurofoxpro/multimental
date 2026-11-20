import path from 'node:path';
import { createHash } from 'node:crypto';
export const REPO = 'neurofoxpro/multimental';
export const PACKAGE = 'pro.neurofox.multimental.dev';
export const HONOR_REQUEST = 'device-requests/honor-install-20260927.local.json';
export const sha = (x) => createHash('sha256').update(x).digest('hex');
const ID = /^[A-Za-z0-9_.-]{4,96}$/,
  HASH = /^[a-f0-9]{64}$/;
const samePath = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && path.resolve(a) === path.resolve(b);
export function knownPhones(station, honor = null) {
  const primary = station?.physicalSerial || station?.serial;
  if (
    station?.repository !== REPO ||
    station.package !== PACKAGE ||
    !ID.test(primary || '') ||
    !path.isAbsolute(station.workDir || '')
  )
    throw Error('FLEET_STATION_IDENTITY');
  const rows = [
    {
      alias: 'phone-A',
      physicalSerial: primary,
      workDir: station.workDir,
      request: 'station.local.json',
      model: null,
      brand: null
    }
  ];
  if (honor !== null) {
    if (
      honor.schemaVersion !== 1 ||
      honor.repository !== REPO ||
      honor.brand !== 'HONOR' ||
      honor.manufacturer !== 'HONOR' ||
      honor.model !== 'BRC-NX1' ||
      !ID.test(honor.physicalSerial || '') ||
      honor.physicalSerial === primary ||
      !Number.isFinite(Date.parse(honor.observedAt))
    )
      throw Error('FLEET_KNOWN_HONOR_IDENTITY');
    rows.push({
      alias: 'phone-B',
      physicalSerial: honor.physicalSerial,
      workDir: path.join(
        station.workDir,
        'phones',
        'honor-' + sha(honor.physicalSerial).slice(0, 12)
      ),
      request: HONOR_REQUEST,
      model: honor.model,
      brand: 'HONOR'
    });
  }
  return rows;
}
export function targetConfig(station, honor, alias) {
  const found = knownPhones(station, honor).find((p) => p.alias === alias);
  if (!found) throw Error('FLEET_PHONE_NOT_REGISTERED');
  return {
    ...station,
    serial: found.physicalSerial,
    physicalSerial: found.physicalSerial,
    workDir: found.workDir,
    fleetAlias: found.alias
  };
}
export function assertKnownPhoneConfig(c, station, honor) {
  const known = knownPhones(station, honor).find(
    (p) => p.physicalSerial === (c.physicalSerial || c.serial) && samePath(p.workDir, c.workDir)
  );
  if (
    !known ||
    c.repository !== REPO ||
    c.package !== PACKAGE ||
    c.allowedHost !== station.allowedHost ||
    ['adb', 'java', 'apksigner', 'aapt', 'keytool'].some((k) => c[k] !== station[k]) ||
    c.sharedSigningDirectory
  )
    throw Error('FLEET_TARGET_OUTSIDE_REGISTERED_STATION');
  return known;
}
export function readyOptions(args) {
  const [mode, ...rest] = args;
  if (!['known', 'ready'].includes(mode))
    throw Error('fleet known|ready --target phone-A|phone-B|all [--commit SHA]');
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = rest.slice(i, i + 2);
    if (!['--target', '--commit'].includes(k) || !v || Object.hasOwn(values, k))
      throw Error('FLEET_ARGUMENTS');
    values[k] = v;
  }
  const target = values['--target'] || 'all',
    commit = values['--commit'] || null;
  if (
    !['all', 'phone-A', 'phone-B'].includes(target) ||
    (mode === 'ready' && !/^[a-f0-9]{40}$/.test(commit || '')) ||
    (mode === 'known' && commit)
  )
    throw Error('FLEET_EXACT_TARGET_AND_RELEASE_REQUIRED');
  return { mode, targets: target === 'all' ? ['phone-A', 'phone-B'] : [target], commit };
}
export function actualInstallDisposition(actual, expected) {
  if (
    !Number.isSafeInteger(actual?.versionCode) ||
    actual.versionCode < 0 ||
    !Number.isSafeInteger(expected?.versionCode) ||
    expected.versionCode < 1 ||
    !HASH.test(expected.sha256 || '') ||
    !HASH.test(expected.certificate || '')
  )
    throw Error('FLEET_BAD_INSTALL_IDENTITY');
  if (!actual.versionCode) return 'install';
  if (
    !HASH.test(actual.sha256 || '') ||
    !HASH.test(actual.certificate || '') ||
    actual.certificate !== expected.certificate
  )
    throw Error('FLEET_PRESERVE_FOREIGN_SIGNED_APP');
  if (actual.versionCode > expected.versionCode) throw Error('FLEET_DOWNGRADE_REFUSED');
  if (actual.versionCode === expected.versionCode) {
    if (actual.sha256 !== expected.sha256) throw Error('FLEET_SAME_VERSION_DIFFERENT_BYTES');
    return 'already_installed';
  }
  return 'upgrade';
}
/** Effect readback always precedes a retry. No uninstall, grant, key generation or settings bypass. */
export async function ensureReviewedInstall(a, expected) {
  const before = await a.observe(),
    disposition = actualInstallDisposition(before, expected);
  const previous = await a.load();
  if (
    previous &&
    previous.expected &&
    JSON.stringify(previous.expected) !== JSON.stringify(expected)
  )
    throw Error('FLEET_INSTALL_JOURNAL_CHANGED');
  if (disposition === 'already_installed')
    return { disposition, mutated: false, recoveredPriorCompletion: !!previous?.attempted };
  if (previous?.attempted) throw Error('FLEET_UNCONFIRMED_INSTALL_PRESERVED');
  await a.save({ expected, attempted: true, disposition, phase: 'install_pending' });
  let problem = null;
  try {
    await a.perform();
  } catch (e) {
    problem = e;
  }
  const after = await a.observe();
  if (actualInstallDisposition(after, expected) !== 'already_installed')
    throw problem || Error('FLEET_INSTALL_EFFECT_NOT_CONFIRMED');
  const result = { disposition, mutated: true, recoveredReply: !!problem };
  await a.save({ expected, attempted: true, phase: 'installed_readback', result });
  return result;
}
export function fleetSummary(rows, targets) {
  if (
    !Array.isArray(rows) ||
    rows.length !== targets.length ||
    new Set(targets).size !== targets.length ||
    rows.some((r, i) => r.alias !== targets[i])
  )
    throw Error('FLEET_RESULT_TARGETS');
  const ready = rows.filter((r) => r.status === 'ready');
  const identities = ready.map((r) => r.identityKey);
  if (identities.some((x) => !HASH.test(x || '')) || new Set(identities).size !== identities.length)
    throw Error('FLEET_DUPLICATE_PHYSICAL_PROOF');
  for (const r of ready)
    if (
      !r.actualApkVerified ||
      !r.profilePreserved ||
      r.suite?.status !== 'passed' ||
      r.homeIcon?.status !== 'passed'
    )
      throw Error('FLEET_INCOMPLETE_READY_PROOF');
  if (
    ready.some((r) => !HASH.test(r.apkSha256 || '') || !HASH.test(r.certificateSha256 || '')) ||
    new Set(ready.map((r) => r.apkSha256)).size > 1 ||
    new Set(ready.map((r) => r.certificateSha256)).size > 1
  )
    throw Error('FLEET_MIXED_SIGNED_BUILDS');
  const all = ready.length === targets.length;
  return {
    status: all ? 'ready' : ready.length ? 'partially_ready' : 'not_ready',
    requestedPhones: targets.length,
    readyPhones: ready.length,
    twoPhysicalPhonesReady: ready.length === 2,
    radioTestPassed: false,
    humanAcceptance: 'pending',
    phones: rows.map(({ identityKey, ...r }) => r)
  };
}
