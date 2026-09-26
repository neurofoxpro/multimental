import path from 'node:path';
export function adbPhysicalRows(text) {
  if (typeof text !== 'string' || text.length > 65536) throw Error('Invalid ADB inventory');
  const rows = [],
    seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|unauthorized|offline)(?:\s|$)/.exec(line.trim());
    if (!m || m[1].startsWith('emulator-') || m[1].includes(':')) continue;
    if (!/^[A-Za-z0-9_.-]{2,96}$/.test(m[1]) || seen.has(m[1]))
      throw Error('Ambiguous physical inventory');
    seen.add(m[1]);
    rows.push({ serial: m[1], state: m[2] });
  }
  return rows;
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
