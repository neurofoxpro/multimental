import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inside, readJSON, writeJSON, fingerprint, receipt, sha } from '../scripts/lib.mjs';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-review-'));
  fs.mkdirSync(path.join(root, 'source'));
  fs.writeFileSync(path.join(root, 'source/a.txt'), 'a');
  const p = { inputs: ['source'], steps: { test: { outputs: [] } } };
  return { root, p, close: () => fs.rmSync(root, { force: true, recursive: true }) };
}
test('Windows absolute paths are rejected on all operating systems', () => {
  const f = fixture();
  try {
    for (const rel of ['C:\\private\\x', '\\\\server\\share\\x', '../secret', '\0'])
      assert.throws(() => inside(f.root, rel));
  } finally {
    f.close();
  }
});
test('nonexistent output under junction/symlink cannot leave workspace', () => {
  const f = fixture(),
    external = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-outside-'));
  try {
    fs.symlinkSync(
      external,
      path.join(f.root, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.throws(() => inside(f.root, 'link/not-yet-created.txt'));
  } finally {
    f.close();
    fs.rmSync(external, { force: true, recursive: true });
  }
});
test('directory named evidence inside source is not silently excluded', () => {
  const f = fixture();
  try {
    const first = fingerprint(f.root, f.p);
    fs.mkdirSync(path.join(f.root, 'source/evidence'));
    fs.writeFileSync(path.join(f.root, 'source/evidence/real-code.txt'), 'code');
    assert.notEqual(fingerprint(f.root, f.p), first);
  } finally {
    f.close();
  }
});
test('receipt requires every declared output hash and forbids source mutation', () => {
  const f = fixture();
  try {
    const log = '.gameprod/evidence/test.log';
    fs.mkdirSync(path.join(f.root, '.gameprod/evidence'), { recursive: true });
    fs.writeFileSync(path.join(f.root, log), 'ok');
    const file = path.join(f.root, '.gameprod/evidence/test.json');
    const good = {
      step: 'test',
      status: 'passed',
      exitCode: 0,
      sourceDigest: fingerprint(f.root, f.p),
      log,
      logHash: sha('ok'),
      outputs: []
    };
    writeJSON(file, good);
    assert.equal(receipt(f.root, f.p, 'test').ok, true);
    writeJSON(file, { ...good, sourceChanged: true });
    assert.equal(receipt(f.root, f.p, 'test').ok, false);
    writeJSON(file, good);
    f.p.steps.test.outputs = ['app.apk'];
    assert.equal(receipt(f.root, f.p, 'test').reason, 'missing_or_unexpected_output');
    fs.writeFileSync(path.join(f.root, 'app.apk'), 'apk');
    writeJSON(file, { ...good, outputs: [{ path: 'app.apk', sha256: sha('apk') }] });
    assert.equal(receipt(f.root, f.p, 'test').ok, true);
    fs.writeFileSync(path.join(f.root, 'app.apk'), 'changed');
    assert.equal(receipt(f.root, f.p, 'test').ok, false);
  } finally {
    f.close();
  }
});
