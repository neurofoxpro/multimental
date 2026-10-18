import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateChange,
  validateChanges,
  baseVersion,
  renderChangelog,
  renderReleaseNotes
} from '../scripts/changelog-lib.mjs';
const entry = {
  id: 'test-russian-entry',
  version: '0.1.2',
  kind: 'fixed',
  scope: 'tests',
  text: 'Исправлена проверка допустимого игрового действия.',
  breaking: false
};
const commit = 'a'.repeat(40),
  manifest = { sha256: 'b'.repeat(64), workflowRun: '123', versionCode: 15101 };
test('Russian change entry accepts approved schema only', () => {
  assert.equal(validateChange(entry), entry);
  for (const x of [
    { ...entry, text: 'English only changelog' },
    { ...entry, text: 'Русский\nскрытая строка' },
    { ...entry, breaking: undefined },
    { ...entry, kind: 'invented' },
    { ...entry, id: '../bad' },
    { ...entry, version: '0.1.2-alpha.1' }
  ])
    assert.throws(() => validateChange(x));
});
test('duplicate change identities rejected', () =>
  assert.throws(() => validateChanges([entry, entry]), /Повтор/));
test('SemVer normalization rejects loose versions and leading zeros', () => {
  assert.equal(baseVersion('1.2.3-alpha.7.1'), '1.2.3');
  for (const x of ['1.2', '01.2.3', 'v1.2.3', '1.2.3\nX']) assert.throws(() => baseVersion(x));
});
test('generation is deterministic and sorted by semantic version', () => {
  const changes = [entry, { ...entry, id: 'old-entry', version: '0.1.1', kind: 'added' }];
  const a = renderChangelog(changes, { currentVersion: '0.1.2-alpha.1', repository: 'org/game' }),
    b = renderChangelog(changes.toReversed(), {
      currentVersion: '0.1.2-alpha.1',
      repository: 'org/game'
    });
  assert.equal(a, b);
  assert.ok(a.indexOf('## 0.1.2') < a.indexOf('## 0.1.1'));
  assert.ok(a.includes('### Исправлено'));
  assert.ok(!a.includes('### Устаревает'));
});
test('release notes contain Russian text and exact artifact identity', () => {
  const text = renderReleaseNotes([entry], {
    version: '0.1.2-alpha.1',
    commit,
    repository: 'org/game',
    manifest
  });
  assert.ok(text.includes(entry.text));
  assert.ok(text.includes(commit));
  assert.ok(text.includes(manifest.sha256));
  assert.ok(text.includes('сама по себе не доказывает установку'));
});
test('same fragment is not repeated on a rebuild', () => {
  const text = renderReleaseNotes([entry], {
    version: '0.1.2-alpha.2',
    commit,
    repository: 'org/game',
    manifest,
    baseChanges: [entry]
  });
  assert.ok(!text.includes(entry.text));
  assert.ok(text.includes('Пересборка'));
});
test('amended fragment is visible since previous published commit', () => {
  const text = renderReleaseNotes(
    [{ ...entry, text: 'Уточнена проверка допустимого игрового действия.' }],
    { version: '0.1.2-alpha.2', commit, repository: 'org/game', manifest, baseChanges: [entry] }
  );
  assert.ok(text.includes('Уточнена'));
});
test('release notes do not include unrelated version entries', () => {
  const text = renderReleaseNotes(
    [entry, { ...entry, id: 'future', version: '0.2.0', text: 'Будущий механизм не реализован.' }],
    { version: '0.1.2-alpha.1', commit, repository: 'org/game', manifest }
  );
  assert.ok(!text.includes('Будущий механизм'));
});
test('release identity and unsafe text fail closed', () => {
  assert.throws(() =>
    renderReleaseNotes([entry], {
      version: '0.1.2',
      commit: 'head',
      repository: 'org/game',
      manifest
    })
  );
  assert.throws(() =>
    validateChange({ ...entry, text: 'Русская запись <script>alert(1)</script>' })
  );
});
