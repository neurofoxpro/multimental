import { spawnSync } from 'node:child_process';
export function resolveComponent(text, packageName) {
  if (!/^[a-z][\w.]+$/.test(packageName)) throw Error('Invalid package');
  const names = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.startsWith(packageName + '/'));
  if (
    names.length !== 1 ||
    !new RegExp('^' + packageName.replaceAll('.', '\\.') + '/[A-Za-z0-9_.$]+$').test(names[0])
  )
    throw Error('Launcher does not resolve to approved package');
  return names[0];
}
export function launchApplication(c) {
  const display = prepareDisplay(c);
  const start = performance.now();
  const r = spawnSync(
    c.adb,
    [
      '-s',
      c.serial,
      'shell',
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      c.package
    ],
    { encoding: 'utf8', timeout: 10000 }
  );
  if (r.status !== 0 || r.error) throw Error('Launcher resolution failed');
  const component = resolveComponent(r.stdout, c.package);
  const launch = spawnSync(c.adb, ['-s', c.serial, 'shell', 'am', 'start', '-W', '-n', component], {
    encoding: 'utf8',
    timeout: 30000
  });
  const log = (launch.stdout || '') + (launch.stderr || '');
  if (
    launch.status !== 0 ||
    launch.error ||
    /Error:|Exception|Permission Denial/.test(log) ||
    !log.includes('Status: ok')
  )
    throw Error('Activity launch failed: ' + log.slice(-400));
  return {
    method: 'am_start_explicit_component',
    display,
    durationMs: Math.round(performance.now() - start)
  };
}

/** Wake the requested device for a foreground test; Android still enforces its credential lock. */
export function prepareDisplay(c, { invoke, wait, attempts = 5 } = {}) {
  const run =
    invoke ||
    ((args) => {
      const r = spawnSync(c.adb, ['-s', c.serial, 'shell', ...args], {
        shell: false,
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 1000000
      });
      if (r.error || r.status !== 0) throw Error('Cannot observe or wake display');
      return r.stdout || '';
    });
  const sleep = wait || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
    throw Error('Bounded display attempts required');
  const power = run(['dumpsys', 'power']);
  const wakeRequested = /mWakefulness=(?:Asleep|Dozing)/.test(power);
  if (wakeRequested) run(['input', 'keyevent', 'KEYCODE_WAKEUP']);
  let dismissRequested = false;
  for (let n = 0; n < attempts; n++) {
    const policy = run(['dumpsys', 'window', 'policy']);
    const blocked = /^\s*showing=true\s*$/m.test(policy) || /mKeyguardShowing=true/.test(policy);
    if (!blocked) return { wakeRequested, dismissRequested, credentialBypass: false };
    if (!dismissRequested) {
      run(['wm', 'dismiss-keyguard']);
      dismissRequested = true;
    }
    sleep(200);
  }
  throw Error(
    'Device screen requires user unlock; credentials are never entered by the test runner'
  );
}
