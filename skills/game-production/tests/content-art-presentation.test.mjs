import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { compileArtPresentation, validateCatalog } from '../scripts/content-policy.mjs';

const accepted = JSON.parse(fs.readFileSync('content/accepted/catalog.json', 'utf8'));
const missing = () => {
  throw Error('Art bytes were requested unexpectedly');
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function samplePng() {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(16, 16);
  bytes.writeUInt32BE(16, 20);
  return bytes;
}

test('the accepted 30-card art presentation has 30 empty fallbacks', () => {
  const generated = compileArtPresentation(accepted, missing);
  const stored = fs.readFileSync('game/src/card_art_catalog.gd', 'utf8').replace(/\r\n/g, '\n');
  assert.equal(generated, stored);
  assert.equal((generated.match(/    \{\}/g) || []).length, 30);
  assert.equal(accepted.cards.length, 30);
  assert.ok(accepted.cards.every((c) => c.art.kind === 'none'));
});

test('an owned accepted art file resolves to only a local path and pinned digest', () => {
  const modified = structuredClone(accepted),
    data = samplePng(),
    digest = hash(data);
  modified.cards[0].art = {
    kind: 'owned',
    path: 'game/assets/cards/first.png',
    sha256: digest,
    source: 'Project-owned test fixture',
    license: 'Project-owned',
    author: 'Multimental',
    prompt: '',
    generator: ''
  };
  const render = compileArtPresentation(modified, (path) => {
    assert.equal(path, 'game/assets/cards/first.png');
    return data;
  });
  assert.ok(render.includes('res://assets/cards/first.png'));
  assert.ok(render.includes(digest));
  assert.ok(!render.includes('Project-owned test fixture'));
  assert.ok(!render.includes('license'));
  assert.ok(!render.includes('attack'));
  assert.ok(!render.includes('description'));
});

test('unapproved paths, wrong hashes and missing provenance fail closed', () => {
  const data = samplePng();
  for (const mutation of [
    (art) => {
      art.sha256 = 'a'.repeat(64);
    },
    (art) => {
      art.path = '../../stolen.png';
    },
    (art) => {
      art.license = '';
    },
    (art) => {
      art.source = '';
    },
    (art) => {
      art.author = '';
    },
    (art) => {
      art.prompt = 'code';
    },
    (art) => {
      art.kind = 'generated';
    }
  ]) {
    const c = structuredClone(accepted);
    const art = {
      kind: 'owned',
      path: 'game/assets/cards/first.png',
      sha256: hash(data),
      source: 'Project-owned test fixture',
      license: 'Project-owned',
      author: 'Multimental',
      prompt: '',
      generator: ''
    };
    mutation(art);
    c.cards[0].art = art;
    assert.throws(() => compileArtPresentation(c, () => data), /CONTENT_/);
  }
});

test('art changes do not alter the numeric gameplay row compiler', async () => {
  const { compileRuntime } = await import('../scripts/content-policy.mjs');
  const data = samplePng(),
    changed = structuredClone(accepted);
  changed.cards[0].art = {
    kind: 'owned',
    path: 'game/assets/cards/first.png',
    sha256: hash(data),
    source: 'Project-owned test fixture',
    license: 'Project-owned',
    author: 'Multimental',
    prompt: '',
    generator: ''
  };
  const baseline = compileRuntime(accepted, missing);
  const next = compileRuntime(changed, () => data);
  assert.equal(
    next.replace(
      /const CONTENT_HASH: String = "[a-f0-9]+"/,
      'const CONTENT_HASH: String = "ignored"'
    ),
    baseline.replace(
      /const CONTENT_HASH: String = "[a-f0-9]+"/,
      'const CONTENT_HASH: String = "ignored"'
    )
  );
});
