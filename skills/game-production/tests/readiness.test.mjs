import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness } from '../../../scripts/readiness.mjs';
const row = {
  id: 'GAME-01',
  text: 'Коллекция карт',
  source: 'Этап 6',
  evidence: [],
  kind: 'game',
  status: 'planned',
  version: '0.4.0',
  requiredForBeta: true
};
test('missing implementation remains an automatic blocker, not manual', () => {
  const r = readiness({ schemaVersion: 1, requirements: [row] });
  assert.equal(r.status, 'not_beta_ready');
  assert.equal(r.remaining.length, 1);
  assert.throws(() =>
    readiness({ schemaVersion: 1, requirements: [{ ...row, status: 'manual' }] })
  );
});
test('verified status needs evidence and duplicates are rejected', () => {
  assert.throws(() =>
    readiness({ schemaVersion: 1, requirements: [{ ...row, status: 'verified' }] })
  );
  assert.throws(() => readiness({ schemaVersion: 1, requirements: [row, row] }));
});
test('human fun acceptance remains separate from finished automated scope', () => {
  const r = readiness({
    schemaVersion: 1,
    requirements: [
      { ...row, status: 'verified', evidence: ['test.gd'] },
      { ...row, id: 'BETA-01', text: 'Интерес игры', kind: 'subjective', status: 'manual' }
    ]
  });
  assert.equal(r.status, 'automatic_beta_scope_complete');
  assert.equal(r.manual.length, 1);
});
