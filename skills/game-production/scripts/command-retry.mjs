import path from 'node:path';
/** Only known reads may be retried. Writes require readback, never blind replay. */
export function readOnlyCommand(executable, args) {
  const name = path
    .basename(executable)
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (name === 'git') return args[0] === 'ls-remote';
  if (name !== 'gh') return false;
  if (args[0] === 'api')
    return (
      !args.some(
        (x) =>
          ['--method', '-X', '--field', '-f', '--raw-field', '-F', '--input'].includes(x) ||
          /^(?:--method=|--field=|--raw-field=|--input=|-X.+|-f.+|-F.+)/.test(x)
      ) && args[1] !== 'graphql'
    );
  return (
    ['pr', 'run', 'repo', 'release'].includes(args[0]) &&
    ['view', 'list', 'checks'].includes(args[1])
  );
}
export function transientTransport(result) {
  const text = String(result?.stderr || '') + ' ' + String(result?.error?.message || '');
  if (
    /(?:401|403|404|409|422|429)|rate limit|bad credentials|permission|certificate.*(?:invalid|mismatch)/i.test(
      text
    )
  )
    return false;
  return /TLS handshake timeout|connection reset|ECONNRESET|ETIMEDOUT|EAI_AGAIN|unexpected EOF|i\/o timeout|(?:HTTP |status code |status )50[234]\b/i.test(
    text
  );
}
export function executeWithReadRetry(
  executable,
  args,
  {
    invoke,
    wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    attempts = 3,
    onRetry = () => {}
  }
) {
  for (let attempt = 1; ; attempt++) {
    const result = invoke();
    if (result.status === 0 && !result.error) return result;
    if (attempt >= attempts || !readOnlyCommand(executable, args) || !transientTransport(result))
      return result;
    const delay = 1000 * attempt * attempt;
    onRetry({ attempt, delay, command: args.slice(0, 2) });
    wait(delay);
  }
}
export async function confirmMerge({
  expectedHead,
  read,
  write,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 4
}) {
  let writeError;
  try {
    await write();
  } catch (e) {
    writeError = e;
  }
  for (let n = 0; n < attempts; n++) {
    try {
      const p = await read();
      if (p.headRefOid !== expectedHead || p.baseRefName !== 'dev')
        throw Error('MERGE_SCOPE_CHANGED');
      if (p.state === 'MERGED' && /^[a-f0-9]{40}$/.test(p.mergeCommit?.oid || ''))
        return { ...p, recoveredAfterWriteError: !!writeError };
    } catch (e) {
      if (e.message === 'MERGE_SCOPE_CHANGED') throw e;
      if (n === attempts - 1)
        throw Error('Merge outcome unknown: readback failed; do not repeat the write');
    }
    if (n < attempts - 1) await wait(1000 * (n + 1));
  }
  throw Error(
    'Merge not confirmed; preserve state and inspect before retrying a mutation' +
      (writeError ? ': ' + writeError.message : '')
  );
}
