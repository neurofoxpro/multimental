import { spawnSync } from 'node:child_process';
import { adbRows, describeDevice, primaryTlsCandidates, selectLabTarget } from './lab-policy.mjs';
/** Resolve only the already configured physical primary; never rewrites its saved identity. */
export function primaryTransport(config, { invoke, reconnect = true } = {}) {
  if (
    config?.repository !== 'neurofoxpro/multimental' ||
    config.package !== 'pro.neurofox.multimental.dev' ||
    typeof config.serial !== 'string'
  )
    throw Error('Wrong primary transport scope');
  if (/^emulator-(5554|5556)$/.test(config.serial)) return { ...config };
  const physicalSerial = config.physicalSerial || config.serial;
  if (!/^[A-Za-z0-9_.-]{4,96}$/.test(physicalSerial))
    throw Error('Wireless target requires its saved physical identity');
  const run =
    invoke ||
    ((args, optional = false) => {
      const r = spawnSync(config.adb, args, {
        shell: false,
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 262144
      });
      if (r.error || r.status !== 0) {
        if (optional) return null;
        throw Error('Primary transport read failed');
      }
      return (r.stdout || '').trim();
    });
  function candidates() {
    const rows = adbRows(run(['devices', '-l'])),
      found = [];
    for (const row of rows) {
      if (row.kind === 'emulator' || row.state !== 'device') continue;
      try {
        const get = (k) => run(['-s', row.serial, 'shell', 'getprop', k]);
        const identity = get('ro.serialno');
        if (identity !== physicalSerial) continue;
        const match = describeDevice(
          row,
          { serial: identity, qemu: get('ro.kernel.qemu'), boot: get('sys.boot_completed') },
          physicalSerial
        );
        if (match.ready) found.push(match);
      } catch {
        /* An unreadable candidate is never promoted to a known phone. */
      }
    }
    return found;
  }
  let found = candidates();
  if (!found.length && reconnect) {
    const text = run(['mdns', 'services'], true);
    if (text !== null) {
      for (const endpoint of primaryTlsCandidates(text, physicalSerial)) {
        run(['connect', endpoint], true);
        found = candidates();
        if (found.length) break;
      }
    }
  }
  const choice = selectLabTarget(found, 'phone');
  return { ...config, physicalSerial, serial: choice.serial };
}
