import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
export const LAB_SUITES = [
  'smoke',
  'handoff',
  'ui',
  'tutorial',
  'inspector',
  'collection',
  'profile',
  'shop',
  'crafting',
  'rewards'
];
const TARGETS = ['auto', 'available', 'phone', 'emulator-A', 'emulator-B'];
const hash = (s) => createHash('sha256').update(s).digest('hex');
export function labOptions(args) {
  const [mode = 'probe', ...rest] = args;
  if (!['probe', 'test', 'deliver', 'resume'].includes(mode))
    throw Error('lab probe|test|deliver|resume');
  if (['probe', 'resume'].includes(mode)) {
    if (rest.length) throw Error('No arguments for ' + mode);
    return { mode };
  }
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = rest.slice(i, i + 2);
    if (
      !['--target', '--suite', '--commit'].includes(k) ||
      Object.hasOwn(values, k) ||
      !v ||
      v.startsWith('--')
    )
      throw Error('Invalid or duplicate lab option');
    values[k] = v;
  }
  const target = values['--target'] || (mode === 'deliver' ? 'phone' : 'auto'),
    suite = values['--suite'] || 'handoff',
    commit = values['--commit'] || null;
  if (
    !TARGETS.includes(target) ||
    !LAB_SUITES.includes(suite) ||
    (commit && !/^[a-f0-9]{40}$/.test(commit)) ||
    (mode === 'deliver' && (target !== 'phone' || values['--suite']))
  )
    throw Error('Unsupported lab target, suite or release identity');
  return { mode, target, suite, commit };
}
export function adbRows(text) {
  if (typeof text !== 'string' || text.length > 65536)
    throw Error('Bounded ADB inventory required');
  const out = [],
    seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|offline|unauthorized)(?:\s|$)/.exec(line.trim());
    if (!m) continue;
    if (!/^[A-Za-z0-9_.:\[\]%-]{1,180}$/.test(m[1]) || seen.has(m[1]) || out.length >= 16)
      throw Error('Ambiguous ADB inventory');
    seen.add(m[1]);
    out.push({
      serial: m[1],
      state: m[2],
      kind: m[1].startsWith('emulator-')
        ? 'emulator'
        : m[1].includes(':') || m[1].includes('._tcp')
          ? 'wifi'
          : 'usb'
    });
  }
  return out;
}
export function describeDevice(row, facts, primary) {
  if (row.state !== 'device') return { ...row, ready: false, alias: 'unavailable', identity: null };
  if (!facts || typeof facts !== 'object') throw Error('Device facts required');
  if (row.kind === 'emulator') {
    const slot = row.serial === 'emulator-5554' ? 'A' : row.serial === 'emulator-5556' ? 'B' : null;
    const recognized = !!slot && facts.qemu === '1' && facts.avd === 'Multimental_Test_' + slot;
    return {
      ...row,
      ready: recognized && facts.boot === '1',
      alias: recognized ? 'emulator-' + slot : 'unmanaged-emulator',
      identity: recognized ? hash('avd:' + facts.avd) : null,
      model: facts.model || 'unknown',
      physical: false
    };
  }
  const physical =
    ['', '0'].includes(facts.qemu) && /^[A-Za-z0-9_.-]{4,96}$/.test(facts.serial || '');
  const primaryMatch = physical && facts.serial === primary;
  return {
    ...row,
    ready: physical && facts.boot === '1',
    alias: primaryMatch ? 'phone-A' : 'unregistered-phone',
    identity: physical ? hash('physical:' + facts.serial) : null,
    model: facts.model || 'unknown',
    physical,
    primaryMatch
  };
}
export function publicInventory(rows) {
  const groups = new Map();
  let unready = 0;
  for (const r of rows) {
    if (!r.identity) {
      unready++;
      continue;
    }
    if (!groups.has(r.identity))
      groups.set(r.identity, {
        alias: r.alias,
        physical: r.physical,
        ready: r.ready,
        model: r.model,
        transports: []
      });
    const g = groups.get(r.identity);
    g.ready ||= r.ready;
    if (!g.transports.includes(r.kind)) g.transports.push(r.kind);
  }
  return {
    devices: [...groups.values()],
    unavailableTransports: unready,
    physicalDevices: [...groups.values()].filter((g) => g.physical).length,
    primaryAvailable: [...groups.values()].some((g) => g.alias === 'phone-A' && g.ready),
    secondaryRegistration: 'separate_task_not_inferred'
  };
}
export function selectLabTarget(rows, requested = 'auto') {
  if (!Array.isArray(rows) || !TARGETS.includes(requested)) throw Error('Known target required');
  const primaries = rows.filter((r) => r.alias === 'phone-A' && r.ready);
  if (new Set(primaries.map((r) => r.identity)).size > 1)
    throw Error('Ambiguous primary physical identity');
  if (requested === 'phone' || (requested === 'available' && primaries.length)) {
    if (!primaries.length) throw Error('Explicit phone unavailable; no substitution');
    const selected = primaries.sort(
      (a, b) =>
        (a.kind === 'wifi' ? 0 : 1) - (b.kind === 'wifi' ? 0 : 1) ||
        a.serial.localeCompare(b.serial)
    )[0];
    return {
      target: 'phone',
      serial: selected.serial,
      identity: selected.identity,
      boot: false,
      reason: 'verified_primary_physical_identity'
    };
  }
  const slots = requested.startsWith('emulator-') ? [requested] : ['emulator-A', 'emulator-B'];
  for (const target of slots) {
    const current = rows.find((r) => r.alias === target && r.ready);
    if (current)
      return {
        target,
        serial: current.serial,
        identity: current.identity,
        boot: false,
        reason: 'software_tests_prefer_dedicated_emulator'
      };
  }
  for (const target of slots) {
    const serial = target === 'emulator-A' ? 'emulator-5554' : 'emulator-5556';
    if (!rows.some((r) => r.serial === serial))
      return {
        target,
        serial,
        identity: hash('avd:Multimental_Test_' + target.at(-1)),
        boot: true,
        reason: 'no_ready_phone_required_start_unoccupied_avd'
      };
  }
  throw Error('Dedicated emulator slots occupied but not ready; no process killed');
}
export function primaryTlsCandidates(text, primary) {
  if (
    typeof text !== 'string' ||
    text.length > 65536 ||
    !/^[A-Za-z0-9_.-]{4,96}$/.test(primary || '')
  )
    throw Error('Invalid mDNS observation');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (
      parts.length !== 3 ||
      parts[1] !== '_adb-tls-connect._tcp' ||
      !parts[0].startsWith('adb-' + primary + '-')
    )
      continue;
    const m = /^([0-9.]+):(\d{1,5})$/.exec(parts[2]);
    if (!m || isIP(m[1]) !== 4) continue;
    const p = m[1].split('.').map(Number),
      port = Number(m[2]);
    if (
      !(
        p[0] === 10 ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      ) ||
      port < 1024 ||
      port > 65535
    )
      continue;
    if (!out.includes(parts[2])) out.push(parts[2]);
  }
  if (out.length > 2) throw Error('Too many advertised endpoints for primary');
  return out;
}
export function canReuseSuite(checkpoint, actual, sourceHash, readHash) {
  if (
    checkpoint?.status !== 'passed' ||
    checkpoint.sourceHash !== sourceHash ||
    JSON.stringify(checkpoint.installation) !== JSON.stringify(actual) ||
    !Array.isArray(checkpoint.proofs) ||
    !checkpoint.proofs.length
  )
    return false;
  return checkpoint.proofs.every(
    (p) =>
      typeof p.path === 'string' &&
      p.path.startsWith('.gameprod/evidence/') &&
      !p.path.includes('..') &&
      /^[a-f0-9]{64}$/.test(p.sha256 || '') &&
      readHash(p.path) === p.sha256
  );
}
export async function restoreManual(a) {
  if (await a.requestExists())
    throw Error('Pending diagnostic request preserved; finish its owner first');
  const before = await a.snapshot();
  if (
    !Array.isArray(before) ||
    before.length !== 2 ||
    before.some((h) => h !== null && !/^[a-f0-9]{64}$/.test(h))
  )
    throw Error('Invalid profile snapshot');
  await a.stop();
  const readiness = await a.launch();
  if (await a.requestExists()) throw Error('Diagnostic request appeared during manual handoff');
  if (JSON.stringify(before) !== JSON.stringify(await a.snapshot()))
    throw Error('Personal profile changed during handoff');
  if (!(await a.foreground())) throw Error('Normal app is not foreground');
  return {
    normalStartup: true,
    automationRequestAbsent: true,
    personalProfilePreserved: true,
    profileFilesChecked: before.filter(Boolean).length,
    readiness,
    deletedData: false
  };
}
