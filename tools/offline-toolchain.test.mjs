import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertArchiveLock, assertPackageLicenses, assertPolicy } from './offline-toolchain.mjs';

const sums = ['a', 'b', 'c', 'd'].map((x) => x.repeat(64));
const archives = ['godot.zip', 'adb.zip', 'build-tools.zip', 'jre17.zip'].map((name, i) => ({
  name,
  sha256: sums[i]
}));
const sample = () => {
  const packageLock = JSON.stringify({
    name: 'multimental',
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/prettier': {
        version: '3.9.9',
        license: 'MIT',
        integrity: 'sha512-AAAA'
      }
    }
  });
  const x = {
    schemaVersion: 1,
    node: '24.21.0',
    ciNode: '22',
    npm: '11.19.0',
    godot: '4.7.2',
    androidBuildTools: '35.0.1',
    archives,
    allowedLicenses: ['MIT'],
    packageLockSha256: createHash('sha256').update(packageLock).digest('hex')
  };
  return {
    lock: { schemaVersion: 1, offlineWindows: x },
    source: {
      nvmrc: '22\n',
      workflow: "GODOT_VERSION: '4.7.2'\n'build-tools;35.0.1'",
      bootstrap: '4.7.2-stable ' + sums.join(' '),
      packageLock
    }
  };
};
test('locked source policy accepts only matching CLI/CI/cache identity', () => {
  const { lock, source } = sample();
  assert.equal(assertPolicy(lock, source).packages, 1);
});
for (const field of ['node', 'ciNode', 'npm', 'godot', 'androidBuildTools', 'packageLockSha256'])
  test('reject altered lock: ' + field, () => {
    const { lock, source } = sample();
    lock.offlineWindows[field] = 'invalid';
    assert.throws(() => assertPolicy(lock, source), /OFFLINE_/);
  });
for (const field of ['nvmrc', 'workflow', 'bootstrap', 'packageLock'])
  test('reject altered source: ' + field, () => {
    const { lock, source } = sample();
    source[field] = 'changed';
    assert.throws(() => assertPolicy(lock, source), /OFFLINE_/);
  });
test('only four distinct exact archive names and valid hashes are allowed', () => {
  assert.equal(assertArchiveLock(archives), true);
  assert.throws(() => assertArchiveLock([...archives, archives[0]]), /OFFLINE_ARCHIVE_LIST/);
  assert.throws(
    () =>
      assertArchiveLock(archives.map((x, i) => (i === 1 ? { ...x, name: '../outside.zip' } : x))),
    /OFFLINE_ARCHIVE_NAMES/
  );
  assert.throws(
    () => assertArchiveLock(archives.map((x, i) => (i === 2 ? { ...x, sha256: '0' } : x))),
    /OFFLINE_ARCHIVE_HASH/
  );
});
test('reject unpinned package integrity and unauthorized licenses', () => {
  const ok = { 'node_modules/a': { version: '1.2.3', integrity: 'sha512-AAAA', license: 'MIT' } };
  assert.equal(assertPackageLicenses(ok, ['MIT']), 1);
  assert.throws(() => assertPackageLicenses(ok, ['Apache-2.0']), /OFFLINE_LICENSE/);
  assert.throws(
    () =>
      assertPackageLicenses({ 'node_modules/a': { ...ok['node_modules/a'], integrity: '' } }, [
        'MIT'
      ]),
    /OFFLINE_PACKAGE_IDENTITY/
  );
});
