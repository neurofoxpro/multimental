// Bounded readiness polling; injectable probes allow tests without a phone.
export async function waitReady({
  pid,
  log,
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => performance.now(),
  timeoutMs = 60000
}) {
  const deadline = now() + timeoutMs;
  let lastLog = '';
  while (now() < deadline) {
    const id = String(await pid())
      .trim()
      .split(/\s+/)[0];
    if (/^\d+$/.test(id)) {
      lastLog = String(await log(id));
      if (/SCRIPT ERROR:|FATAL EXCEPTION|Parse Error:/.test(lastLog))
        throw Error('Application error in launch log');
      if (lastLog.includes('MULTIMENTAL_READY')) return { pid: id, log: lastLog };
    }
    await delay(1000);
  }
  throw Error('Application did not become ready within bounded timeout');
}
