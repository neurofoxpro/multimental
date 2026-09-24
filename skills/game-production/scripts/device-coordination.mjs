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

/** Nonblocking ownership claim. Existing locks are left untouched and reported as busy. */
export function claimUpdateLock(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') return null;
    throw e;
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
  fs.closeSync(fd);
  return true;
}
