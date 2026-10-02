import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha } from '../scripts/lib.mjs';
import { resumableDownload } from '../scripts/resumable-download.mjs';
const url = async () => 'https://storage.example.test/artifact';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-resume-'));
  return {
    file: path.join(root, 'artifact.zip'),
    close: () => fs.rmSync(root, { recursive: true, force: true })
  };
}
test('interrupted artifact download resumes exact byte range instead of restarting', async () => {
  const t = fixture();
  try {
    let n = 0;
    const r = await resumableDownload({
      file: t.file,
      id: '1',
      sha256: sha('abcdef'),
      resolveURL: url,
      wait: async () => {},
      fetcher: async (_url, options) => {
        n++;
        if (n === 1) {
          let pull = 0;
          return new Response(
            new ReadableStream({
              pull(c) {
                if (pull++ === 0) c.enqueue(new TextEncoder().encode('abc'));
                else c.error(new TypeError('connection lost'));
              }
            }),
            { headers: { 'content-length': '6', etag: 'stable' } }
          );
        }
        assert.equal(options.headers.Range, 'bytes=3-');
        return new Response('def', {
          status: 206,
          headers: { 'content-range': 'bytes 3-5/6', 'content-length': '3', etag: 'stable' }
        });
      }
    });
    assert.equal(r.requests, 2);
    assert.equal(fs.readFileSync(t.file, 'utf8'), 'abcdef');
  } finally {
    t.close();
  }
});
test('partial from another artifact and wrong range are rejected', async () => {
  const t = fixture();
  try {
    fs.writeFileSync(t.file + '.part', 'abc');
    fs.writeFileSync(t.file + '.part.json', JSON.stringify({ id: 'old', sha256: sha('abcdef') }));
    await assert.rejects(
      () => resumableDownload({ file: t.file, id: 'new', sha256: sha('abcdef'), resolveURL: url }),
      /another artifact/
    );
    fs.writeFileSync(t.file + '.part.json', JSON.stringify({ id: 'new', sha256: sha('abcdef') }));
    await assert.rejects(
      () =>
        resumableDownload({
          file: t.file,
          id: 'new',
          sha256: sha('abcdef'),
          resolveURL: url,
          fetcher: async () =>
            new Response('def', { status: 206, headers: { 'content-range': 'bytes 2-4/6' } })
        }),
      /content range/
    );
  } finally {
    t.close();
  }
});
test('completed corrupt file and denied download never become success', async () => {
  for (const type of ['corrupt', 'denied']) {
    const t = fixture();
    try {
      await assert.rejects(() =>
        resumableDownload({
          file: t.file,
          id: 'id',
          sha256: sha('right'),
          resolveURL: url,
          fetcher: async () =>
            type === 'denied'
              ? new Response('', { status: 403 })
              : new Response('wrong', { headers: { 'content-length': '5' } })
        })
      );
      assert.equal(fs.existsSync(t.file), false);
    } finally {
      t.close();
    }
  }
});
test('already verified archive is reused without a network request', async () => {
  const t = fixture();
  try {
    fs.writeFileSync(t.file, 'good');
    const r = await resumableDownload({
      file: t.file,
      id: 'id',
      sha256: sha('good'),
      resolveURL: url,
      fetcher: async () => {
        throw Error('unnecessary network');
      }
    });
    assert.equal(r.reused, true);
  } finally {
    t.close();
  }
});
