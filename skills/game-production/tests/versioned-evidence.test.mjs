import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gitBlobId, canonicalEvidenceBytes } from '../scripts/versioned-evidence.mjs';
const text = Buffer.from('{"example":true}\n');
test('canonical Git bytes are used for public evidence hash', () => {
  const id = gitBlobId(text);
  const r = canonicalEvidenceBytes(text, text, id, id);
  assert.equal(r.sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(r.gitCleanTransformation, false);
});
test('Git-clean CRLF working copy does not become a false uncommitted error', () => {
  const local = Buffer.from('{"example":true}\r\n');
  const id = gitBlobId(text);
  const clean = gitBlobId(Buffer.from(local.toString().replaceAll('\r\n', '\n')));
  const r = canonicalEvidenceBytes(local, text, id, clean);
  assert.equal(r.gitCleanTransformation, true);
  assert.ok(r.bytes.equals(text));
  assert.notEqual(r.workingSha256, r.sha256);
});
test('real changed content is rejected even when line endings are normalized', () => {
  const local = Buffer.from('{"example":false}\r\n');
  assert.throws(
    () =>
      canonicalEvidenceBytes(
        local,
        text,
        gitBlobId(text),
        gitBlobId(Buffer.from(local.toString().replaceAll('\r\n', '\n')))
      ),
    /UNCOMMITTED/
  );
});
test('wrong Git blob bytes cannot be passed under the expected object ID', () => {
  const other = Buffer.from('other');
  assert.throws(
    () => canonicalEvidenceBytes(text, other, gitBlobId(text), gitBlobId(text)),
    /UNCOMMITTED/
  );
});
test('oversized or non-byte evidence is rejected', () => {
  assert.throws(() => gitBlobId(Buffer.alloc(1048577)));
  assert.throws(() => canonicalEvidenceBytes('text', text, gitBlobId(text), gitBlobId(text)));
});
