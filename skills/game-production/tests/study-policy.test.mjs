import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStudy,
  sourceUrl,
  stage,
  captureSource,
  checkPassed,
  assessment
} from '../scripts/study-policy.mjs';
const key = 'a'.repeat(64),
  now = Date.parse('2026-09-26T10:00:00Z');
const definition = () => ({
  schemaVersion: 1,
  task: 'AUTO-05',
  question: 'q',
  hypothesis: 'h',
  control: 'c',
  readset: ['AGENTS.md'],
  sources: ['https://docs.github.com/en/rest'],
  checks: ['dispatch'],
  acceptance: ['a'],
  limits: ['l']
});
const receipt = () => ({
  task: 'AUTO-05',
  inputKey: key,
  sources: [
    { url: 'https://docs.github.com/en/rest', sha256: key, observedAt: new Date(now).toISOString() }
  ],
  checks: [{ id: 'dispatch', status: 'passed', exitCode: 0, logHash: key }]
});
for (const url of [
  'http://docs.github.com/x',
  'https://localhost/a',
  'https://docs.github.com.evil.test/a',
  'https://me:secret@docs.github.com/a',
  'https://docs.github.com:444/a',
  'file:///tmp/a'
])
  test('rejects unsafe source ' + url, () => assert.throws(() => sourceUrl(url)));
test('definition does not accept executable test names or unsafe readset', () => {
  assert.equal(validateStudy(definition()).task, 'AUTO-05');
  for (const change of [
    { checks: ['echo secret'] },
    { readset: ['../keys'] },
    { readset: ['.env'] },
    { hypothesis: '' },
    { control: '' },
    { limits: [] },
    { sources: ['https://docs.github.com/en/rest', 'https://docs.github.com/en/rest#x'] }
  ])
    assert.throws(() => validateStudy({ ...definition(), ...change }));
});
test('first unverified stage after interruptions and changed source', () => {
  assert.equal(stage(definition(), key, null, now), 'capture');
  assert.equal(stage(definition(), key, { ...receipt(), checks: [] }, now), 'checks');
  assert.equal(stage(definition(), key, receipt(), now), 'analysis');
  assert.equal(
    stage(
      definition(),
      key,
      { ...receipt(), assessment: { inputKey: key, verdict: 'partial' } },
      now
    ),
    'complete'
  );
  assert.equal(stage(definition(), 'b'.repeat(64), receipt(), now), 'capture');
  assert.equal(stage(definition(), key, receipt(), now + 8 * 86400000), 'capture');
  assert.equal(stage(definition(), key, receipt(), now - 1), 'capture');
});
test('failed, missing or duplicated checks do not qualify', () => {
  const r = receipt();
  r.checks[0].exitCode = 1;
  assert.equal(stage(definition(), key, r, now), 'checks');
  r.checks = [receipt().checks[0], receipt().checks[0]];
  assert.equal(stage(definition(), key, r, now), 'checks');
});
test('PASS followed by runtime error and empty Node suite rejected', () => {
  assert.equal(checkPassed({ marker: 'PASS' }, { status: 0, stdout: 'PASS\nERROR: late' }), false);
  assert.equal(
    checkPassed(
      { nodeTests: true },
      { status: 0, stdout: '# tests 0\n# pass 0\n# fail 0\n# skipped 0' }
    ),
    false
  );
  assert.equal(
    checkPassed(
      { nodeTests: true },
      { status: 0, stdout: '# tests 2\n# pass 2\n# fail 0\n# skipped 0' }
    ),
    true
  );
});
test('capture stores exact metadata without claiming reviewed source', async () => {
  const r = await captureSource(
    'https://docs.github.com/en/rest',
    async () => new Response('public document', { headers: { 'content-type': 'text/html' } })
  );
  assert.equal(r.bytes, 15);
  assert.equal(r.downloadedNotReviewed, true);
  assert.match(r.sha256, /^[a-f0-9]{64}$/);
});
test('redirect destinations checked before next fetch', async () => {
  let calls = 0;
  await assert.rejects(
    captureSource('https://docs.github.com/en/rest', async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    })
  );
  assert.equal(calls, 1);
});
test('oversized body, PDF and empty body refused', async () => {
  for (const response of [
    new Response('longer than limit', { headers: { 'content-type': 'text/html' } }),
    new Response('pdf', { headers: { 'content-type': 'application/pdf' } }),
    new Response('', { headers: { 'content-type': 'text/plain' } })
  ])
    await assert.rejects(
      captureSource('https://docs.github.com/en/rest', async () => response, { maxBytes: 5 })
    );
});
test('analysis explicitly binds captured sources and does not claim human approval', () => {
  const value = {
    schemaVersion: 1,
    inputKey: key,
    verdict: 'partial',
    conclusion: 'Agent analysis',
    limitations: ['Not human acceptance'],
    sourceHashes: [key]
  };
  assert.equal(assessment(value, key, receipt()).independentHumanApproval, false);
  assert.throws(() => assessment({ ...value, sourceHashes: [] }, key, receipt()));
  assert.throws(() => assessment({ ...value, limitations: [] }, key, receipt()));
});
