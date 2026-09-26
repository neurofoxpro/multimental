import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { readJSON, writeJSON, chooseDevice } from '../skills/game-production/scripts/lib.mjs';
import { exec, validateConfig } from './install-device.mjs';
const a = process.argv.slice(2);
if (!a.includes('--config')) throw Error('Explicit --config required');
const c = validateConfig(readJSON(a[a.indexOf('--config') + 1]));
chooseDevice(exec(c.adb, ['devices', '-l']), c.serial);
const adb = (...args) => exec(c.adb, ['-s', c.serial, ...args], { allowFailure: true });
const wifi = adb('shell', 'ip', '-4', '-o', 'addr', 'show', 'wlan0'),
  phoneIp = wifi.match(/inet (\d+\.\d+\.\d+\.\d+)\//)?.[1];
const ps = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    '@(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | Where-Object Status -eq OK | Select-Object FriendlyName,Status) | ConvertTo-Json -Compress'
  ],
  { encoding: 'utf8', timeout: 20000 }
);
let devices = [];
try {
  devices = JSON.parse(ps.stdout || '[]');
  if (!Array.isArray(devices)) devices = [devices];
} catch {}
const adapters = Object.entries(os.networkInterfaces()).flatMap(([name, items]) =>
  items
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => ({ name, address: i.address, netmask: i.netmask }))
);
const result = {
  observedAt: new Date().toISOString(),
  usb: { authorized: true, purpose: 'control_only_not_LAN' },
  lan: {
    phoneWifiEnabled: adb('shell', 'settings', 'get', 'global', 'wifi_on').trim() === '1',
    phoneHasWifiAddress: !!phoneIp,
    hardwareStatus: phoneIp ? 'ready_for_transport_probe' : 'blocked_phone_not_on_wifi',
    gameSession: 'not_implemented'
  },
  bluetooth: {
    windowsPresent: devices.some((d) => !/Enumerator|TDI|Перечислитель/i.test(d.FriendlyName)),
    phoneEnabled: adb('shell', 'settings', 'get', 'global', 'bluetooth_on').trim() === '1',
    phoneFeature: adb('shell', 'pm', 'list', 'features').includes('android.hardware.bluetooth'),
    radioTransfer: 'not_tested',
    gameSession: 'not_implemented'
  },
  emulator: { note: 'virtual radio/loopback tests are not proof of physical Wi-Fi or Bluetooth' }
};
writeJSON(path.join(c.workDir, 'network-private.local.json'), {
  ...result,
  phoneIp,
  adapters,
  devices
});
writeJSON('.gameprod/evidence/network-capabilities.json', result);
console.log(JSON.stringify(result, null, 2));
