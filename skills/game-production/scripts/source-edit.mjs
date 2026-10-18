import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inside, sha, writeJSON } from './lib.mjs';
/** Guarded source replacement. Windows fallback is journaled, not advertised as atomic. */
export function replaceSource(
  root,
  relative,
  content,
  { expectedHash, rename = fs.renameSync, windows = process.platform === 'win32', retries = 4 } = {}
) {
  if (typeof content !== 'string' || typeof expectedHash === 'undefined')
    throw Error('Expected source hash and text required');
  if (
    !/^[\w./-]+$/.test(relative) ||
    relative.split('/').some((x) => !x || x === '..') ||
    /^\.git(?:\/|$)/i.test(relative) ||
    /\.local\.|\.(p12|jks|keystore)$|(?:^|\/)\.env/.test(relative)
  )
    throw Error('Unsafe source path');
  const target = inside(root, relative),
    before = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if ((before === null ? null : sha(before)) !== expectedHash)
    throw Error('Source changed before replacement');
  const lease = path.join(root, '.gameprod/evidence/ops.lock');
  if (fs.existsSync(lease) && JSON.parse(fs.readFileSync(lease, 'utf8')).pid !== process.pid)
    throw Error('Production operation owns source');
  const dir = path.join(
    root,
    '.gameprod/evidence/source-edits',
    Date.now() + '-' + crypto.randomBytes(6).toString('hex')
  );
  fs.mkdirSync(dir, { recursive: true });
  if (before !== null) fs.writeFileSync(path.join(dir, 'before.local.txt'), before);
  fs.writeFileSync(path.join(dir, 'intended.local.txt'), content);
  const record = {
    path: relative,
    beforeHash: expectedHash,
    afterHash: sha(content),
    status: 'prepared',
    mode: 'atomic_rename'
  };
  const journal = path.join(dir, 'journal.json');
  writeJSON(journal, record);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.source-tmp-' + process.pid;
  fs.writeFileSync(temporary, content, { flag: 'wx' });
  for (let n = 0; ; n++) {
    try {
      rename(temporary, target);
      break;
    } catch (e) {
      if (!windows || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        record.error = e.code;
        writeJSON(journal, record);
        throw e;
      }
      if (n < retries) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        continue;
      }
      const now = fs.existsSync(target) ? sha(fs.readFileSync(target)) : null;
      if (now !== expectedHash) throw Error('Concurrent write; Windows fallback refused');
      if (fs.existsSync(lease) && JSON.parse(fs.readFileSync(lease, 'utf8')).pid !== process.pid)
        throw Error('Source operation ownership changed');
      // The old and intended source are retained for recovery before this guarded fallback.
      fs.writeFileSync(target, content);
      record.mode = 'journaled_windows_in_place';
      break;
    }
  }
  if (sha(fs.readFileSync(target)) !== record.afterHash) throw Error('Written source hash differs');
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  record.status = 'verified';
  writeJSON(journal, record);
  return record;
}
