import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
test('source recovery is routed without the ordinary stale workflow guard', () => {
  const control = read('skills/game-production/scripts/control.mjs'),
    guard = read('skills/game-production/scripts/collaboration-guard.mjs');
  assert.match(control, /entry === 'source-recover'/);
  assert.match(control, /import\('\.\/source-lock-recovery\.mjs'\)/);
  assert.match(guard, /entry === 'source-recover'\) return false/);
});
test('publication commit helper is wired into ops publish and cleared only by readback path', () => {
  const source = read('skills/game-production/scripts/ops.mjs');
  assert.match(source, /ensurePublicationCommit/);
  assert.match(source, /publication-commit\.json/);
  assert.match(source, /clearPublicationCommit\(commitJournal, head\)/);
  assert.doesNotMatch(source, /git\('commit', '-m', message\)/);
});
test('manual review uses signed candidate lifecycle instead of blind staging reuse', () => {
  const source = read('skills/game-production/scripts/manual-review.mjs');
  assert.match(source, /ensureSignedCandidate/);
  assert.match(source, /stagingFile: temporary/);
  assert.match(source, /verify: validSignedCandidate/);
  assert.doesNotMatch(source, /if \(!fs\.existsSync\(temporary\)\) signManualArtifact/);
});
test('device recovery self-heals only its own exact recovery barrier', () => {
  const source = read('skills/game-production/scripts/device-lock-recovery.mjs');
  assert.match(source, /acquireRecoverableBarrier/);
  assert.match(source, /command: 'dead-device-owner-recovery'/);
  assert.match(source, /lock-recovery', 'barriers'/);
});
test('production skill documents explicit plan/apply recovery and proof limits', () => {
  const skill = read('skills/game-production/SKILL.md');
  assert.match(skill, /Game Production v9\.5/);
  assert.match(skill, /source-recover plan/);
  assert.match(skill, /source-recover apply/);
  assert.match(skill, /RECOVERY_EFFECTS\.ru\.md/);
});
