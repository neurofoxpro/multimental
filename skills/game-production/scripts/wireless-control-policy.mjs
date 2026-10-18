/** A test must never sever its only control path or mislabel the path that carried traffic. */
export function adbControlTransport(serial) {
  if (typeof serial !== 'string' || !serial || serial.length > 160 || /[\s\x00-\x20]/.test(serial))
    throw Error('CONTROL_TRANSPORT_IDENTITY');
  if (/^emulator-\d+$/.test(serial)) return 'emulator';
  if (serial.includes(':') || serial.includes('_adb-tls-connect._tcp')) return 'wifi';
  if (!/^[A-Za-z0-9_.-]+$/.test(serial)) throw Error('CONTROL_TRANSPORT_IDENTITY');
  return 'usb';
}
export function bluetoothControlGuard(serial) {
  const control = adbControlTransport(serial);
  if (control !== 'usb') throw Error('BLUETOOTH_NO_WIFI_TEST_REQUIRES_USB_CONTROL');
  return { control, mayDisableWifi: true };
}
export function tunnelPath(serial) {
  const control = adbControlTransport(serial);
  return control === 'usb'
    ? 'ADB_USB_TUNNEL_NOT_WIFI'
    : control === 'wifi'
      ? 'ADB_WIFI_TUNNEL_NOT_DIRECT_LAN'
      : 'ADB_EMULATOR_TUNNEL_NOT_PHYSICAL_USB';
}
