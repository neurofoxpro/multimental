import { createHash } from 'node:crypto';
export function gitBlobId(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1048576) throw Error('EVIDENCE_BYTES');
  return createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
}
export function canonicalEvidenceBytes(local, committed, expectedBlob, cleanBlob) {
  if (
    !Buffer.isBuffer(local) ||
    !Buffer.isBuffer(committed) ||
    local.length > 1048576 ||
    committed.length > 1048576 ||
    !/^[a-f0-9]{40}$/.test(expectedBlob || '')
  )
    throw Error('EVIDENCE_BYTES');
  if (expectedBlob !== cleanBlob || gitBlobId(committed) !== expectedBlob)
    throw Error('ACCEPT_UNCOMMITTED_EVIDENCE');
  return {
    bytes: Buffer.from(committed),
    sha256: createHash('sha256').update(committed).digest('hex'),
    workingSha256: createHash('sha256').update(local).digest('hex'),
    gitBlob: expectedBlob,
    gitCleanTransformation: !local.equals(committed)
  };
}
