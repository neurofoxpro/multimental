const HASH = /^[a-f0-9]{64}$/;
export function installDisposition({
  version,
  versionCode,
  actualHash,
  originalHash,
  signedHash,
  certificate,
  expectedCertificate,
  previous,
  force = false
}) {
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    !HASH.test(originalHash || '')
  )
    throw Error('Invalid installation identity');
  if (version > versionCode || (previous?.versionCode || 0) > versionCode)
    throw Error('Downgrade refused');
  if (version !== versionCode) return 'install';
  if (!HASH.test(actualHash || '')) throw Error('Same-version actual APK is not observed');
  if (
    force &&
    previous?.readyMarker === true &&
    previous.originalSha256 === originalHash &&
    previous.installedSha256 === actualHash &&
    previous.certificateSha256 === certificate &&
    HASH.test(certificate || '') &&
    certificate === expectedCertificate &&
    HASH.test(signedHash || '')
  )
    return 'reinstall_explicit';
  if (
    !force &&
    previous?.originalSha256 === originalHash &&
    previous.installedSha256 === actualHash &&
    previous.readyMarker === true
  )
    return 'already_current';
  if (
    !HASH.test(signedHash || '') ||
    actualHash !== signedHash ||
    !HASH.test(certificate || '') ||
    certificate !== expectedCertificate
  )
    throw Error('Same-version APK differs from verified signed artifact; preserve it');
  return force ? 'reinstall_explicit' : 'resume_launch';
}
/** The system may finish installing even when the shell response is lost. */
export async function confirmInstallEffect({ perform, observe, expectedHash, expectedVersion }) {
  if (
    !HASH.test(expectedHash || '') ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1
  )
    throw Error('Exact installation expectation required');
  let acknowledged = false,
    problem = null;
  try {
    acknowledged = /\bSuccess\b/.test(String(await perform()));
  } catch (e) {
    problem = e;
  }
  const actual = await observe();
  if (actual?.version !== expectedVersion || actual.hash !== expectedHash)
    throw problem || Error('Actual APK did not confirm the installation effect');
  return { acknowledged, recoveredReply: !acknowledged, readback: true };
}
