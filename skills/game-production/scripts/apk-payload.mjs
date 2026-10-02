import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
const digest = (b) => createHash('sha256').update(b).digest('hex');
/** Compare APK contents independently of ZIP offsets and v1/v2 signing envelopes. */
export function apkPayload(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 250 * 1024 * 1024)
    throw Error('APK size invalid');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0)
    throw Error('Single-disk ZIP required');
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (
    count !== bytes.readUInt16LE(end + 8) ||
    !count ||
    count === 65535 ||
    count > 20000 ||
    start + size !== end
  )
    throw Error('Unsupported ZIP directory');
  const entries = [],
    names = new Set();
  let cursor = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw Error('Invalid ZIP entry');
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      packed = bytes.readUInt32LE(cursor + 20),
      length = bytes.readUInt32LE(cursor + 24),
      n = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32),
      offset = bytes.readUInt32LE(cursor + 42);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      !n ||
      cursor + 46 + n + extra + comment > end ||
      length > 150 * 1024 * 1024 ||
      offset + 30 > start ||
      bytes.readUInt32LE(offset) !== 0x04034b50
    )
      throw Error('Unsafe or unsupported APK entry');
    const name = bytes.subarray(cursor + 46, cursor + 46 + n).toString('utf8');
    if (
      name.includes('\0') ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').includes('..') ||
      names.has(name)
    )
      throw Error('Ambiguous APK path');
    names.add(name);
    if (
      bytes.readUInt16LE(offset + 6) !== flags ||
      (!(flags & 8) &&
        (bytes.readUInt32LE(offset + 18) !== packed ||
          bytes.readUInt32LE(offset + 22) !== length ||
          bytes.readUInt32LE(offset + 14) !== bytes.readUInt32LE(cursor + 16)))
    )
      throw Error('Inconsistent ZIP local sizes or flags');
    const localName = bytes.readUInt16LE(offset + 26),
      localExtra = bytes.readUInt16LE(offset + 28),
      data = offset + 30 + localName + localExtra;
    if (
      data + packed > start ||
      bytes.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== name ||
      bytes.readUInt16LE(offset + 8) !== method
    )
      throw Error('APK local header mismatch');
    total += length;
    if (total > 450 * 1024 * 1024) throw Error('APK inflated payload limit');
    const compressed = bytes.subarray(data, data + packed),
      content =
        method === 0
          ? compressed
          : inflateRawSync(compressed, { maxOutputLength: Math.max(1, length) });
    if (content.length !== length) throw Error('APK entry length mismatch');
    if (!/^META-INF\/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))$/i.test(name))
      entries.push({ name, size: length, sha256: digest(content) });
    cursor += 46 + n + extra + comment;
  }
  if (cursor !== end || !names.has('AndroidManifest.xml') || !entries.length)
    throw Error('Not a complete Android package');
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    sha256: digest(JSON.stringify(entries)),
    files: entries.length,
    uncompressedBytes: entries.reduce((n, x) => n + x.size, 0)
  };
}
