import fs from 'node:fs';
import crypto from 'node:crypto';
const digest = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export async function resumableDownload({
  file,
  id,
  sha256,
  resolveURL,
  fetcher = fetch,
  requestTimeoutMs = 60000,
  maxDurationMs = 600000,
  maxRequests = 12,
  maxBytes = 300 * 1024 * 1024,
  now = () => performance.now(),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  progress = () => {}
}) {
  if (!/^[a-f0-9]{64}$/.test(sha256 || '') || !id || !file)
    throw Error('Immutable identity and SHA-256 required');
  if (fs.existsSync(file)) {
    if (digest(file) !== sha256) throw Error('Existing final download hash mismatch');
    return { status: 'verified', reused: true, requests: 0, bytes: fs.statSync(file).size };
  }
  const partial = file + '.part',
    meta = partial + '.json';
  if (fs.existsSync(partial)) {
    if (!fs.existsSync(meta)) throw Error('Unidentified partial download refused');
    const old = JSON.parse(fs.readFileSync(meta));
    if (old.id !== String(id) || old.sha256 !== sha256)
      throw Error('Partial download belongs to another artifact');
  } else fs.writeFileSync(partial, Buffer.alloc(0), { flag: 'wx' });
  if (fs.statSync(partial).size > 0 && digest(partial) === sha256) {
    fs.renameSync(partial, file);
    if (fs.existsSync(meta)) fs.unlinkSync(meta);
    return {
      status: 'verified',
      reused: true,
      resumedComplete: true,
      requests: 0,
      bytes: fs.statSync(file).size
    };
  }
  const started = now();
  let total = null,
    etag = null,
    requests = 0,
    resumedBytes = fs.statSync(partial).size;
  fs.writeFileSync(meta, JSON.stringify({ id: String(id), sha256 }));
  while (requests < maxRequests && now() - started < maxDurationMs) {
    requests++;
    let offset = fs.statSync(partial).size;
    if (offset > maxBytes) throw Error('Partial download exceeds size limit');
    const url = new URL(await resolveURL());
    if (url.protocol !== 'https:' || url.username || url.password)
      throw Error('Unsafe signed download URL');
    const headers = offset ? { Range: 'bytes=' + offset + '-' } : {};
    if (offset && etag) headers['If-Range'] = etag;
    let response;
    try {
      response = await fetcher(url.href, {
        headers,
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(requestTimeoutMs, Math.floor(maxDurationMs - (now() - started))))
        )
      });
    } catch (e) {
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(e.name)) throw e;
      progress({ status: 'retry_connection', request: requests, bytes: offset });
      await wait(250);
      continue;
    }
    if (![200, 206].includes(response.status))
      throw Error('Artifact download HTTP ' + response.status);
    if (response.status === 206) {
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range || Number(range[1]) !== offset || Number(range[2]) < offset)
        throw Error('Wrong resumed content range');
      const expected = Number(range[3]);
      if (total !== null && expected !== total) throw Error('Artifact size changed');
      total = expected;
    } else {
      const length = response.headers.get('content-length');
      total = length ? Number(length) : null;
      if (offset) {
        fs.truncateSync(partial, 0);
        offset = 0;
        progress({ status: 'server_restart_required', request: requests });
      }
    }
    if (total !== null && (!Number.isSafeInteger(total) || total > maxBytes || total < offset))
      throw Error('Invalid artifact size');
    etag = response.headers.get('etag') || etag;
    const fd = fs.openSync(partial, 'a');
    let bytes = offset,
      interrupted = false;
    try {
      if (!response.body) throw Error('Missing artifact body');
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes || (total !== null && bytes > total))
          throw Error('Oversized artifact stream');
        fs.writeSync(fd, chunk);
      }
    } catch (e) {
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(e.name)) throw e;
      interrupted = true;
    } finally {
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
    progress({
      status: interrupted ? 'partial_saved' : 'response_finished',
      request: requests,
      bytes,
      total,
      resumedFrom: offset
    });
    if (!interrupted && (total === null || bytes === total)) {
      if (digest(partial) !== sha256) throw Error('Complete artifact SHA-256 mismatch');
      fs.renameSync(partial, file);
      fs.unlinkSync(meta);
      return {
        status: 'verified',
        requests,
        bytes,
        resumedBytes,
        durationMs: Math.round(now() - started)
      };
    }
    if (bytes === offset && !interrupted) throw Error('Artifact server made no progress');
    resumedBytes = Math.max(resumedBytes, bytes);
  }
  throw Error('Bounded download paused; verified-identity partial retained for continuation');
}
