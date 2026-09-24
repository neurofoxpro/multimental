import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateResearch } from '../../../scripts/research.mjs';
test('research requires primary-source claims, verifiable tests and limits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-research-'));
  try {
    fs.writeFileSync(path.join(root, 'test.mjs'), '');
    const r = {
      id: 'R-TEST',
      question: 'Вопрос',
      recommendation: 'Проверяемая рекомендация',
      status: 'proposed',
      sources: [
        {
          url: 'https://docs.godotengine.org/en/stable/classes/class_tlsoptions.html',
          claim: 'Проверка TLS'
        }
      ],
      tests: ['test.mjs'],
      limits: []
    };
    assert.equal(validateResearch({ schemaVersion: 1, records: [r] }, root), true);
    assert.throws(() => validateResearch({ schemaVersion: 1, records: [r, r] }, root));
    assert.throws(() =>
      validateResearch(
        {
          schemaVersion: 1,
          records: [{ ...r, sources: [{ url: 'http://example.org', claim: 'x' }] }]
        },
        root
      )
    );
    assert.throws(() =>
      validateResearch({ schemaVersion: 1, records: [{ ...r, tests: ['../outside.mjs'] }] }, root)
    );
    assert.throws(() =>
      validateResearch(
        { schemaVersion: 1, records: [{ ...r, status: 'automatically_owner_approved' }] },
        root
      )
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
