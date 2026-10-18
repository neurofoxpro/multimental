import test from 'node:test';
import assert from 'node:assert/strict';
import { assertQualification, updateDisposition } from '../scripts/qualification-policy.mjs';
const names = [
  'emulator-A-install',
  'emulator-A-ui',
  'emulator-A-tutorial',
  'emulator-A-jni',
  'emulator-A-reinstall',
  'emulator-B-install',
  'emulator-B-ui',
  'emulator-B-tutorial',
  'emulator-B-jni',
  'emulator-B-reinstall',
  'emulator-pair',
  'pvp-emulators'
];
const config = { head: 'h', apkHash: 'a', toolDigest: 'd' };
const report = () => ({
  status: 'passed',
  candidateHead: 'h',
  apk: { sha256: 'a' },
  toolDigest: 'd',
  results: names.map((name) => ({ name, status: 'passed' }))
});
test('device qualification is bound to exact inputs and every required case', () => {
  assert.equal(assertQualification(report(), config), true);
  for (const field of ['candidateHead', 'toolDigest', 'status']) {
    const r = report();
    r[field] = 'changed';
    assert.throws(() => assertQualification(r, config));
  }
  const r = report();
  r.results.pop();
  assert.throws(() => assertQualification(r, config));
  assert.throws(() => assertQualification(report(), { ...config, physical: true }));
});
test('newer candidate is never downgraded, same-version conflict is never overwritten', () => {
  assert.equal(
    updateDisposition({ currentCode: 20, candidateCode: 10 }),
    'newer_candidate_installed'
  );
  assert.equal(
    updateDisposition({ currentCode: 20, candidateCode: 20, currentHash: 'a', candidateHash: 'a' }),
    'already_current'
  );
  assert.equal(
    updateDisposition({ currentCode: 20, candidateCode: 20, currentHash: 'a', candidateHash: 'b' }),
    'same_version_conflict'
  );
  assert.equal(updateDisposition({ currentCode: 20, candidateCode: 21 }), 'install');
});
