const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
export const PACKAGE = 'pro.neurofox.multimental.dev';
const TARGETS = ['phone', 'emulator-A', 'emulator-B'];
const MODES = [
  'close',
  'launch',
  'install',
  'reinstall',
  'clean-install',
  'jni',
  'profile',
  'collection',
  'ui',
  'tutorial',
  'tcp-usb',
  'tcp-lan',
  'tcp-peer',
  'bluetooth'
];
const SUITES = {
  ui: ['ui'],
  profile: ['profile'],
  collection: ['collection'],
  lifecycle: ['close', 'launch', 'ui'],
  smoke: ['close', 'launch', 'jni', 'tutorial', 'ui'],
  hardware: ['tcp-usb', 'tcp-lan', 'bluetooth'],
  usb: ['tcp-usb'],
  bluetooth: ['bluetooth']
};
export function tapTarget(prompt, expected) {
  if (
    !/^[a-f0-9]{48}$/.test(expected?.nonce || '') ||
    !/^waiting_[a-z_]{1,70}$/.test(expected?.stage || '')
  )
    throw Error('Invalid tap request identity');
  if (
    prompt?.nonce !== expected.nonce ||
    prompt.stage !== expected.stage ||
    prompt.status !== 'running' ||
    !Array.isArray(prompt.tap) ||
    prompt.tap.length !== 2 ||
    prompt.tap.some((n) => !Number.isInteger(n) || n < 0 || n > 16384)
  )
    throw Error('Invalid, stale or completed tap target');
  return [...prompt.tap];
}
export function suiteOptions(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !['--config', '--target', '--suite'].includes(key) ||
      Object.hasOwn(values, key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw Error('Invalid or duplicate suite option');
    values[key] = args[i + 1];
  }
  const config = values['--config'],
    target = values['--target'] || 'emulator-A',
    suite = values['--suite'] || 'ui';
  if (!config || !TARGETS.includes(target) || !Object.hasOwn(SUITES, suite))
    throw Error('Explicit config and known target/suite required');
  if (['hardware', 'bluetooth'].includes(suite) && target !== 'phone')
    throw Error('Physical radio suite requires phone');
  return { config, target, suite, modes: [...SUITES[suite]] };
}
export function receiptName(runId, target, mode) {
  if (!UUID.test(runId || '') || !TARGETS.includes(target) || !MODES.includes(mode))
    throw Error('Invalid device step identity');
  return 'device-' + target + '-' + mode + '-' + runId + '.json';
}
export function assessDeviceStep(process, receipt, expected) {
  receiptName(expected.runId, expected.target, expected.mode);
  if (process.error || process.signal || process.status !== 0) return 'process_failed';
  if (!receipt || receipt.status !== 'passed') return 'missing_or_failed_receipt';
  if (
    receipt.runId !== expected.runId ||
    receipt.target !== expected.target ||
    receipt.mode !== expected.mode ||
    receipt.package !== PACKAGE
  )
    return 'wrong_step_identity';
  const observed = Date.parse(receipt.observedAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(expected.start) ||
    !Number.isFinite(expected.end) ||
    expected.end < expected.start ||
    observed < expected.start - 1000 ||
    observed > expected.end + 1000
  )
    return 'stale_or_invalid_time';
  if (receipt.lab?.version && receipt.lab.version !== expected.version) return 'wrong_app_version';
  return 'passed';
}
export function installationIdentity(record, observed) {
  if (
    record?.schemaVersion !== 1 ||
    record.repository !== 'neurofoxpro/multimental' ||
    record.package !== PACKAGE ||
    record.readyMarker !== true ||
    !SHA.test(record.sourceCommit || '') ||
    !HASH.test(record.originalSha256 || '') ||
    !HASH.test(record.installedSha256 || '') ||
    !HASH.test(record.certificateSha256 || '')
  )
    throw Error('Missing verified installation identity');
  if (
    !Number.isSafeInteger(record.versionCode) ||
    record.versionCode < 1 ||
    typeof record.version !== 'string' ||
    !record.version
  )
    throw Error('Invalid installed version');
  if (
    record.version !== observed.version ||
    record.versionCode !== observed.versionCode ||
    record.installedSha256 !== observed.apkSha256
  )
    throw Error('Actual APK does not match installation receipt');
  return {
    package: PACKAGE,
    sourceCommit: record.sourceCommit,
    version: record.version,
    versionCode: record.versionCode,
    originalSha256: record.originalSha256,
    installedSha256: record.installedSha256,
    certificateSha256: record.certificateSha256
  };
}
export function completeSuite(results, expectedModes, before, after, sourceBefore, sourceAfter) {
  if (
    !Array.isArray(results) ||
    !Array.isArray(expectedModes) ||
    !expectedModes.length ||
    results.length !== expectedModes.length
  )
    return false;
  if (
    !HASH.test(sourceBefore || '') ||
    sourceBefore !== sourceAfter ||
    !before ||
    !after ||
    JSON.stringify(before) !== JSON.stringify(after)
  )
    return false;
  return results.every(
    (row, i) => row.mode === expectedModes[i] && row.status === 'passed' && row.exitCode === 0
  );
}
