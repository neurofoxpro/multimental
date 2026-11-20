import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ensurePublicationCommit, clearPublicationCommit } from '../scripts/publication-commit.mjs';
const H = (x) => createHash('sha256').update(x).digest('hex');
function fixture(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pubcommit-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const git = (a) => {
    const r = spawnSync('git', a, { cwd: d, encoding: 'utf8' });
    if (r.status !== 0) throw Error(r.stderr);
    return r.stdout.trim();
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(d, 'a.txt'), 'base');
  fs.writeFileSync(path.join(d, '.gitignore'), '.gameprod/evidence/\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  fs.mkdirSync(path.join(d, '.gameprod/evidence'), { recursive: true });
  return {
    d,
    git,
    file: path.join(d, '.gameprod/evidence/publication-commit.json'),
    digest: H('source')
  };
}
test('dirty tree commits once and journal can be cleared after publication', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.d, 'a.txt'), 'next');
  const r = ensurePublicationCommit({
    file: f.file,
    branch: 'feature/x',
    message: 'feat: x',
    sourceDigest: f.digest,
    runGit: f.git
  });
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '2');
  assert.equal(
    ensurePublicationCommit({
      file: f.file,
      branch: 'feature/x',
      message: 'feat: x',
      sourceDigest: f.digest,
      runGit: f.git
    }).head,
    r.head
  );
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '2');
  assert.equal(clearPublicationCommit(f.file, r.head), true);
});
test('crash before commit resumes prepared exact tree once', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.d, 'a.txt'), 'next');
  f.git(['add', '--all', '--', '.']);
  const base = f.git(['rev-parse', 'HEAD']),
    tree = f.git(['write-tree']);
  fs.writeFileSync(
    f.file,
    JSON.stringify({
      schemaVersion: 1,
      status: 'prepared',
      branch: 'feature/x',
      message: 'feat: x',
      sourceDigest: f.digest,
      baseHead: base,
      expectedTree: tree
    })
  );
  ensurePublicationCommit({
    file: f.file,
    branch: 'feature/x',
    message: 'feat: x',
    sourceDigest: f.digest,
    runGit: f.git
  });
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '2');
});
test('lost acknowledgement after commit reuses exact commit without second commit', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.d, 'a.txt'), 'next');
  f.git(['add', '--all', '--', '.']);
  const base = f.git(['rev-parse', 'HEAD']),
    tree = f.git(['write-tree']);
  fs.writeFileSync(
    f.file,
    JSON.stringify({
      schemaVersion: 1,
      status: 'prepared',
      branch: 'feature/x',
      message: 'feat: x',
      sourceDigest: f.digest,
      baseHead: base,
      expectedTree: tree
    })
  );
  f.git(['commit', '-qm', 'feat: x']);
  const head = f.git(['rev-parse', 'HEAD']);
  const r = ensurePublicationCommit({
    file: f.file,
    branch: 'feature/x',
    message: 'feat: x',
    sourceDigest: f.digest,
    runGit: f.git
  });
  assert.equal(r.head, head);
  assert.equal(r.recovered, true);
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '2');
});
test('foreign descendant with same branch is rejected', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.d, 'a.txt'), 'next');
  f.git(['add', '--all', '--', '.']);
  const base = f.git(['rev-parse', 'HEAD']),
    tree = f.git(['write-tree']);
  fs.writeFileSync(
    f.file,
    JSON.stringify({
      schemaVersion: 1,
      status: 'prepared',
      branch: 'feature/x',
      message: 'feat: x',
      sourceDigest: f.digest,
      baseHead: base,
      expectedTree: tree
    })
  );
  f.git(['commit', '-qm', 'other']);
  assert.throws(() =>
    ensurePublicationCommit({
      file: f.file,
      branch: 'feature/x',
      message: 'feat: x',
      sourceDigest: f.digest,
      runGit: f.git
    })
  );
});
test('source identity or branch change rejects stale journal', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.d, 'a.txt'), 'next');
  ensurePublicationCommit({
    file: f.file,
    branch: 'feature/x',
    message: 'feat: x',
    sourceDigest: f.digest,
    runGit: f.git
  });
  assert.throws(() =>
    ensurePublicationCommit({
      file: f.file,
      branch: 'feature/y',
      message: 'feat: x',
      sourceDigest: f.digest,
      runGit: f.git
    })
  );
  assert.throws(() =>
    ensurePublicationCommit({
      file: f.file,
      branch: 'feature/x',
      message: 'feat: x',
      sourceDigest: 'e'.repeat(64),
      runGit: f.git
    })
  );
});
