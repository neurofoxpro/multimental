export function wlanAddress(text) {
  return String(text).match(/\binet (\d+\.\d+\.\d+\.\d+)\//)?.[1] || null;
}
export async function waitWifiAddress({
  probe,
  timeoutMs = 25000,
  now = () => performance.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
}) {
  const end = now() + timeoutMs;
  while (now() < end) {
    const address = wlanAddress(await probe());
    if (address) return address;
    await sleep(250);
  }
  throw Error('Wi-Fi enabled but no associated IPv4 address before deadline');
}
