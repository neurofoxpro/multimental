import test from 'node:test';
import assert from 'node:assert/strict';
import { installDisposition, confirmInstallEffect } from '../scripts/install-recovery-policy.mjs';
const h = 'a'.repeat(64),
  cert = 'b'.repeat(64);
const input = () => ({
  version: 100,
  versionCode: 100,
  actualHash: h,
  originalHash: 'c'.repeat(64),
  signedHash: h,
  certificate: cert,
  expectedCertificate: cert,
  previous: { versionCode: 90 }
});
test('already installed exact artifact with missing readiness receipt resumes launch only', () =>
  assert.equal(installDisposition(input()), 'resume_launch'));
test('matching final receipt skips installation only when actual signed bytes match', () => {
  const x = input();
  x.previous = {
    versionCode: 100,
    originalSha256: x.originalHash,
    installedSha256: h,
    readyMarker: true
  };
  assert.equal(installDisposition(x), 'already_current');
  assert.throws(() => installDisposition({ ...x, actualHash: 'd'.repeat(64) }));
});
test('a deliberately requested same-version reinstall remains explicit', () =>
  assert.equal(installDisposition({ ...input(), force: true }), 'reinstall_explicit'));
test('older app needs install, newer app never downgraded', () => {
  assert.equal(installDisposition({ ...input(), version: 90 }), 'install');
  assert.throws(() => installDisposition({ ...input(), version: 101 }));
  assert.throws(() => installDisposition({ ...input(), previous: { versionCode: 101 } }));
});
for (const changes of [
  { signedHash: null },
  { certificate: 'd'.repeat(64) },
  { expectedCertificate: null },
  { actualHash: null },
  { version: 1.5 },
  { versionCode: 0 }
])
  test('ambiguous recovery rejected ' + JSON.stringify(changes), () =>
    assert.throws(() => installDisposition({ ...input(), ...changes }))
  );
test('lost install reply is reconciled by actual full signed APK hash without a second install', async () => {
  let calls = 0;
  const r = await confirmInstallEffect({
    perform: async () => {
      calls++;
      throw Error('lost reply');
    },
    observe: async () => ({ version: 100, hash: h }),
    expectedHash: h,
    expectedVersion: 100
  });
  assert.equal(calls, 1);
  assert.equal(r.recoveredReply, true);
});
test('Success text is not enough when actual APK is different', async () => {
  await assert.rejects(
    confirmInstallEffect({
      perform: async () => 'Success',
      observe: async () => ({ version: 100, hash: 'd'.repeat(64) }),
      expectedHash: h,
      expectedVersion: 100
    })
  );
});
test('failure before install does not silently repeat a mutation', async () => {
  let calls = 0;
  await assert.rejects(
    confirmInstallEffect({
      perform: async () => {
        calls++;
        throw Error('preinstall fail');
      },
      observe: async () => ({ version: 90, hash: h }),
      expectedHash: h,
      expectedVersion: 100
    }),
    /preinstall fail/
  );
  assert.equal(calls, 1);
});

test('explicit reinstall can refresh a verified same-certificate signature but cannot override unknown data', () => {
  const x = input();
  x.force = true;
  x.signedHash = 'e'.repeat(64);
  x.previous = {
    versionCode: 100,
    readyMarker: true,
    originalSha256: x.originalHash,
    installedSha256: x.actualHash,
    certificateSha256: x.certificate
  };
  assert.equal(installDisposition(x), 'reinstall_explicit');
  assert.throws(() =>
    installDisposition({ ...x, previous: { ...x.previous, installedSha256: 'f'.repeat(64) } })
  );
});
