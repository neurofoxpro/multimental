import crypto from 'node:crypto';
import { exec } from './install-device.mjs';
export function immersivePrompt(xml) {
  if (!xml.includes('resource-id="android:id/immersive_cling_title"')) return null;
  const nodes = xml.match(/<node\b[^>]*>/g) || [];
  const ok = nodes.filter(
    (n) =>
      n.includes('resource-id="android:id/ok"') &&
      n.includes('package="android"') &&
      n.includes('class="android.widget.Button"') &&
      n.includes('clickable="true"')
  );
  if (ok.length !== 1) throw Error('Unexpected immersive tutorial hierarchy');
  const b = ok[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!b) throw Error('Prompt bounds absent');
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  if (x2 <= x1 || y2 <= y1 || x2 > 8192 || y2 > 8192) throw Error('Invalid prompt bounds');
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
}
export function dismissEmulatorTutorial(c) {
  if (
    !/^emulator-(5554|5556)$/.test(c.serial) ||
    exec(c.adb, ['-s', c.serial, 'shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1'
  )
    throw Error('Onboarding automation only on dedicated emulators');
  const expected = c.serial === 'emulator-5554' ? 'Multimental_Test_A' : 'Multimental_Test_B';
  if (
    !exec(c.adb, ['-s', c.serial, 'emu', 'avd', 'name'])
      .split(/\r?\n/)
      .some((x) => x.trim() === expected)
  )
    throw Error('Wrong dedicated emulator');
  const file = '/sdcard/multimental-ui-' + crypto.randomBytes(8).toString('hex') + '.xml';
  try {
    exec(c.adb, ['-s', c.serial, 'shell', 'uiautomator', 'dump', file]);
    const xml = exec(c.adb, ['-s', c.serial, 'shell', 'cat', file]);
    const point = immersivePrompt(xml);
    if (!point) return { status: 'not_shown' };
    exec(c.adb, ['-s', c.serial, 'shell', 'input', 'tap', ...point.map(String)]);
    exec(c.adb, ['-s', c.serial, 'shell', 'uiautomator', 'dump', file]);
    const after = exec(c.adb, ['-s', c.serial, 'shell', 'cat', file]);
    if (immersivePrompt(after)) throw Error('Immersive tutorial remained after confirmation');
    return { status: 'confirmed', resource: 'android:id/immersive_cling_title' };
  } finally {
    exec(c.adb, ['-s', c.serial, 'shell', 'rm', '-f', file], { allowFailure: true });
  }
}
