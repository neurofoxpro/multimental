import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  adbControlTransport,
  bluetoothControlGuard,
  tunnelPath
} from '../scripts/wireless-control-policy.mjs';
for (const value of [
  '192.168.0.2:43001',
  '[fe80::1]:43001',
  'adb-HONOR123-abc._adb-tls-connect._tcp.'
])
  test('Wi-Fi ADB cannot be disabled by its own legacy radio test ' + value, () => {
    assert.equal(adbControlTransport(value), 'wifi');
    assert.throws(() => bluetoothControlGuard(value), /REQUIRES_USB/);
    assert.equal(tunnelPath(value), 'ADB_WIFI_TUNNEL_NOT_DIRECT_LAN');
  });
test('physical USB remains a valid independent control path', () => {
  assert.deepEqual(bluetoothControlGuard('REDA123456'), { control: 'usb', mayDisableWifi: true });
  assert.equal(tunnelPath('REDA123456'), 'ADB_USB_TUNNEL_NOT_WIFI');
});
test('emulator loopback forwarding is not described as a physical cable', () => {
  assert.equal(adbControlTransport('emulator-5556'), 'emulator');
  assert.throws(() => bluetoothControlGuard('emulator-5556'));
  assert.equal(tunnelPath('emulator-5556'), 'ADB_EMULATOR_TUNNEL_NOT_PHYSICAL_USB');
});
for (const value of ['', null, 'bad target', 'A\nB'])
  test('unknown transport rejected ' + String(value), () =>
    assert.throws(() => adbControlTransport(value))
  );
test('radio guard is evaluated before any Wi-Fi disable or Bluetooth permission change', () => {
  const src = fs.readFileSync('scripts/device-test.mjs', 'utf8'),
    guard = src.indexOf('bluetoothControlGuard(c.serial)');
  assert.ok(guard >= 0);
  assert.ok(guard < src.indexOf("adb('shell', 'svc', 'wifi', 'disable')"));
  assert.ok(guard < src.indexOf("'android.permission.BLUETOOTH_CONNECT'"));
  assert.ok(src.includes('result.path = tunnelPath(c.serial)'));
});
