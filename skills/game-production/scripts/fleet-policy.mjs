import path from 'node:path';
export function adbTransportRows(text) {
  if (typeof text !== 'string' || text.length > 65536) throw Error('Invalid ADB inventory');
  const rows = [],
    seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|unauthorized|offline)(?:\s|$)/.exec(line.trim());
    if (!m || m[1].startsWith('emulator-')) continue;
    if (/[^\x21-\x7e]/.test(m[1]) || m[1].length > 160 || seen.has(m[1]))
      throw Error('Ambiguous ADB inventory');
    seen.add(m[1]);
    const wifi = m[1].includes(':') || m[1].includes('_adb-tls-connect._tcp');
    rows.push({ serial: m[1], state: m[2], transport: wifi ? 'wifi' : 'usb' });
  }
  return rows;
}
export function adbPhysicalRows(text) {
  return adbTransportRows(text)
    .filter((r) => r.transport === 'usb')
    .map(({ serial, state }) => ({ serial, state }));
}
export function collapseFleetDevices(rows, primaryIdentity) {
  if (!Array.isArray(rows) || typeof primaryIdentity !== 'string')
    throw Error('Invalid fleet observations');
  const byIdentity = new Map();
  for (const row of rows) {
    if (row.state !== 'device') continue;
    if (
      !/^[A-Za-z0-9_.-]{4,96}$/.test(row.identity || '') ||
      !['usb', 'wifi'].includes(row.transport)
    )
      throw Error('Invalid physical identity observation');
    const previous = byIdentity.get(row.identity);
    if (previous) {
      for (const key of ['model', 'android', 'version'])
        if (previous[key] && row[key] && previous[key] !== row[key])
          throw Error('Conflicting observations for one physical phone');
      previous.transports.add(row.transport);
      for (const key of ['model', 'android', 'version']) previous[key] ||= row[key] || null;
      continue;
    }
    byIdentity.set(row.identity, {
      identity: row.identity,
      model: row.model || null,
      android: row.android || null,
      version: row.version || null,
      transports: new Set([row.transport])
    });
  }
  return [...byIdentity.values()]
    .sort(
      (a, b) =>
        Number(b.identity === primaryIdentity) - Number(a.identity === primaryIdentity) ||
        a.identity.localeCompare(b.identity)
    )
    .map((r) => ({ ...r, transports: [...r.transports].sort() }));
}
export function selectSecond(rows, primary, existing = null) {
  if (!Array.isArray(rows) || !rows.some((r) => r.serial === primary && r.state === 'device'))
    throw Error('Primary phone unavailable');
  if (existing) {
    if (existing === primary || !rows.some((r) => r.serial === existing && r.state === 'device'))
      throw Error('Bound second phone unavailable; no substitution');
    return existing;
  }
  const others = rows.filter((r) => r.serial !== primary);
  if (others.length !== 1 || others[0].state !== 'device')
    throw Error('Expected exactly one additional authorized physical phone');
  return others[0].serial;
}
export function signingDirectory(c) {
  const own = path.join(c.workDir, 'private-signing');
  if (!c.sharedSigningDirectory) return own;
  if (
    path.basename(c.workDir) !== 'secondary' ||
    path.resolve(c.sharedSigningDirectory) !==
      path.resolve(path.dirname(c.workDir), 'private-signing') ||
    !/^[a-f0-9]{64}$/.test(c.expectedCertificate || '')
  )
    throw Error('Invalid shared signing identity');
  return c.sharedSigningDirectory;
}
