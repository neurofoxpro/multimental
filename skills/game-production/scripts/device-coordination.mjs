import fs from 'node:fs';
export async function waitForPathsGone(
  paths,
  {
    timeoutMs = 120000,
    now = () => performance.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    exists = fs.existsSync
  } = {}
) {
  const start = now();
  while (paths.some((p) => exists(p))) {
    if (now() - start >= timeoutMs)
      throw Error('Station busy beyond bounded wait; active deployment was not interrupted');
    await sleep(250);
  }
  return { waitedMs: Math.round(now() - start) };
}
