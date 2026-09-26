/** Bounded retries for GET metadata only. Authentication/rate-limit failures are never bypassed. */
export async function readJSONHTTP(
  url,
  {
    fetcher = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = 3,
    timeoutMs = 20000,
    maxBytes = 4194304,
    headers = {}
  } = {}
) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password)
    throw Error('HTTPS metadata URL required');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetcher(u.href, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      const transient =
        e?.name === 'TimeoutError' ||
        e?.name === 'AbortError' ||
        e?.name === 'TypeError' ||
        /ECONNRESET|EAI_AGAIN|ETIMEDOUT/.test(e?.cause?.code || '');
      if (!transient || attempt === attempts)
        throw Error('Metadata connection failed after ' + attempt + ' attempt(s): ' + u.hostname);
      await sleep(attempt * 750);
      continue;
    }
    if ([502, 503, 504].includes(response.status) && attempt < attempts) {
      await response.body?.cancel();
      await sleep(attempt * 750);
      continue;
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      throw Error(
        'Metadata HTTP ' +
          response.status +
          (retry ? ' (Retry-After ' + retry + ')' : '') +
          ' at ' +
          u.hostname
      );
    }
    if (Number(response.headers.get('content-length') || 0) > maxBytes)
      throw Error('Metadata response too large');
    let bytes = 0;
    const chunks = [];
    if (!response.body) throw Error('Empty metadata response');
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw Error('Metadata response too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  throw Error('Metadata retry budget exhausted');
}
