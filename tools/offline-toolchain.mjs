import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ARCHIVE_NAMES = ['godot.zip', 'adb.zip', 'build-tools.zip', 'jre17.zip'];
const SHA = /^[a-f0-9]{64}$/;
const offlineEnv = (env) => ({
  ...env,
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9'
});
const hashBytes = (buffer) => createHash('sha256').update(buffer).digest('hex');
export function hashFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 200000000)
    throw Error('OFFLINE_ARCHIVE_UNSAFE');
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
export function assertArchiveLock(archives) {
  if (!Array.isArray(archives) || archives.length !== ARCHIVE_NAMES.length)
    throw Error('OFFLINE_ARCHIVE_LIST');
  const names = archives.map((a) => a.name);
  if (new Set(names).size !== names.length || ARCHIVE_NAMES.some((x) => !names.includes(x)))
    throw Error('OFFLINE_ARCHIVE_NAMES');
  for (const item of archives)
    if (!SHA.test(item.sha256 || '') || !ARCHIVE_NAMES.includes(item.name))
      throw Error('OFFLINE_ARCHIVE_HASH');
  return true;
}
export function assertPackageLicenses(packages, allowed) {
  if (
    !packages ||
    typeof packages !== 'object' ||
    Array.isArray(packages) ||
    !Array.isArray(allowed) ||
    !allowed.length ||
    allowed.some((x) => typeof x !== 'string')
  )
    throw Error('OFFLINE_LICENSE_INPUT');
  const rows = Object.entries(packages).filter(([key]) => key);
  if (!rows.length) throw Error('OFFLINE_NO_PACKAGES');
  for (const [name, info] of rows) {
    if (
      !name.startsWith('node_modules/') ||
      !info ||
      !/^\d+\.\d+\.\d+/.test(info.version || '') ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(info.integrity || '')
    )
      throw Error('OFFLINE_PACKAGE_IDENTITY:' + name);
    if (!allowed.includes(info.license)) throw Error('OFFLINE_LICENSE_NOT_ALLOWED:' + name);
  }
  return rows.length;
}
export function assertPolicy(lock, source) {
  const x = lock?.offlineWindows;
  if (
    lock?.schemaVersion !== 1 ||
    x?.schemaVersion !== 1 ||
    x.node !== '24.21.0' ||
    x.ciNode !== '22' ||
    x.npm !== '11.19.0' ||
    x.godot !== '4.7.2' ||
    x.androidBuildTools !== '35.0.1' ||
    !SHA.test(x.packageLockSha256 || '')
  )
    throw Error('OFFLINE_PIN_POLICY');
  assertArchiveLock(x.archives);
  if (
    source.nvmrc.trim() !== x.ciNode ||
    !source.workflow.includes("GODOT_VERSION: '4.7.2'") ||
    !source.workflow.includes("'build-tools;35.0.1'") ||
    !source.bootstrap.includes('4.7.2-stable')
  )
    throw Error('OFFLINE_CI_STATION_DRIFT');
  for (const item of x.archives)
    if (!source.bootstrap.includes(item.sha256))
      throw Error('OFFLINE_BOOTSTRAP_DRIFT:' + item.name);
  if (hashBytes(Buffer.from(source.packageLock)) !== x.packageLockSha256)
    throw Error('OFFLINE_NPM_LOCK_DRIFT');
  const npm = JSON.parse(source.packageLock);
  if (npm.lockfileVersion !== 3 || npm.name !== 'multimental')
    throw Error('OFFLINE_NPM_LOCK_INVALID');
  const count = assertPackageLicenses(npm.packages, x.allowedLicenses);
  return {
    packages: count,
    archives: x.archives.length,
    node: x.node,
    ciNode: x.ciNode,
    godot: x.godot
  };
}
function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout || 90000,
    maxBuffer: 24 * 1024 * 1024
  });
  if (result.error || result.signal || result.status !== 0)
    throw Error(
      'OFFLINE_PROCESS_FAILED:' +
        path.basename(exe) +
        ':' +
        args[0] +
        ':' +
        ((result.stdout || '') + '\n' + (result.stderr || '')).slice(-2200)
    );
  return (result.stdout || '').trim();
}
export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const mode = argv[0] || 'policy';
  if (argv.length > 1 || !['policy', 'check', 'verify'].includes(mode))
    throw Error('offline-toolchain: policy|check|verify');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const lock = JSON.parse(read('.gameprod/toolchain.json'));
  const source = {
    nvmrc: read('.nvmrc'),
    workflow: read('.github/workflows/build.yml'),
    bootstrap: read('scripts/bootstrap-station.ps1'),
    packageLock: read('package-lock.json')
  };
  const proof = assertPolicy(lock, source);
  if (mode === 'policy') {
    console.log('OFFLINE_TOOLCHAIN_POLICY_PASS ' + JSON.stringify(proof));
    return proof;
  }
  if (process.platform !== 'win32' || os.hostname().toUpperCase() !== 'VENEL-SENDRIK')
    throw Error('OFFLINE_STATION_ONLY');
  const toolDir = path.resolve(root, '..', 'tools');
  for (const item of lock.offlineWindows.archives) {
    const actual = hashFile(path.join(toolDir, item.name));
    if (actual !== item.sha256) throw Error('OFFLINE_ARCHIVE_MISMATCH:' + item.name);
  }
  if (process.version !== 'v' + lock.offlineWindows.node) throw Error('OFFLINE_NODE_VERSION');
  const npmCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
  if (run(process.execPath, [npmCli, '--version']) !== lock.offlineWindows.npm)
    throw Error('OFFLINE_NPM_VERSION');
  const godot = path.join(toolDir, 'godot', 'Godot_v4.7.2-stable_win64_console.exe');
  if (!run(godot, ['--version']).startsWith('4.7.2.stable')) throw Error('OFFLINE_GODOT_VERSION');
  console.log('OFFLINE_TOOLCHAIN_CACHE_PASS ' + JSON.stringify(proof));
  if (mode === 'check') return proof;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-offline-'));
  try {
    for (const file of ['package.json', 'package-lock.json'])
      fs.copyFileSync(path.join(root, file), path.join(temp, file));
    run(
      process.execPath,
      [npmCli, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: temp, env: offlineEnv(process.env), timeout: 120000 }
    );
    console.log('OFFLINE_NPM_INSTALL_PASS');
    const output = run(process.execPath, ['tools/verify.mjs'], {
      cwd: root,
      env: { ...offlineEnv(process.env), GODOT_BIN: godot },
      timeout: 300000
    });
    if (!output.includes('ARCHITECTURE_PASS') || !output.includes('PRODUCTION_TESTS_PASS'))
      throw Error('OFFLINE_VERIFY_MARKERS');
    console.log('OFFLINE_TOOLCHAIN_VERIFY_PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return proof;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error('OFFLINE_TOOLCHAIN_BLOCKED: ' + error.message);
    process.exitCode = 1;
  });
