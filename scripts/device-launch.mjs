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
    durationMs: Math.round(performance.now() - start)
  };
}
