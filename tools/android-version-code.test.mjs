import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { androidVersionCode, parseCIAndroidCode } from './android-version-code.mjs';

test('Android code matches existing CI sequence and increases across runs', () => {
  assert.equal(androidVersionCode(342, 1), 44201);
  assert.equal(androidVersionCode(342, 2), 44202);
  assert.equal(androidVersionCode(343, 1), 44301);
  assert.equal(parseCIAndroidCode('342.1'), 44201);
  assert.ok(androidVersionCode(342, 99) < androidVersionCode(343, 1));
});
test('invalid or ambiguous code labels are rejected', () => {
  for (const label of ['', '0.1', '01.1', '1.0', '1.100', '1.01', '1.2abc', '999999999.1']) {
    assert.throws(() => parseCIAndroidCode(label), /ANDROID_/);
  }
  for (const args of [
    [0, 1],
    [1, 0],
    [1, 100],
    [1.5, 1],
    [NaN, 1]
  ]) {
    assert.throws(() => androidVersionCode(...args), /ANDROID_/);
  }
});
test('CI uses shared version code calculation and pin-matched templates', () => {
  const workflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');
  const setup = fs.readFileSync('scripts/setup-godot.sh', 'utf8');
  const presets = fs.readFileSync('game/export_presets.cfg', 'utf8');
  const lock = JSON.parse(fs.readFileSync('.gameprod/toolchain.json', 'utf8'));
  assert.ok(
    workflow.includes(
      'CODE=$(node tools/android-version-code.mjs "$GITHUB_RUN_NUMBER" "$GITHUB_RUN_ATTEMPT")'
    )
  );
  assert.ok(workflow.includes("GODOT_VERSION: '4.7.2'"));
  assert.ok(workflow.includes("'build-tools;35.0.1'"));
  assert.match(setup, /GODOT_BINARY_SHA256:=[a-f0-9]{64}/);
  assert.match(setup, /GODOT_TEMPLATES_SHA256:=[a-f0-9]{64}/);
  assert.equal(lock.offlineWindows.godot, '4.7.2');
  assert.equal(lock.offlineWindows.androidBuildTools, '35.0.1');
  assert.ok(presets.includes('package/unique_name="pro.neurofox.multimental.dev"'));
  assert.ok(presets.includes('architectures/arm64-v8a=true'));
  assert.equal((presets.match(/^version\/code=/gm) || []).length, 1);
  assert.equal((presets.match(/^version\/name=/gm) || []).length, 1);
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-stamp-'));
  const tools = path.join(root, 'tools');
  const src = path.join(root, 'game', 'src');
  fs.mkdirSync(tools, { recursive: true });
  fs.mkdirSync(src, { recursive: true });
  for (const name of ['stamp-build.mjs', 'android-version-code.mjs'])
    fs.copyFileSync(path.join('tools', name), path.join(tools, name));
  const paths = {
    build: path.join(src, 'build_info.gd'),
    preset: path.join(root, 'game', 'export_presets.cfg'),
    project: path.join(root, 'game', 'project.godot')
  };
  fs.writeFileSync(paths.build, 'ORIGINAL_BUILD_INFO\n');
  fs.writeFileSync(
    paths.preset,
    '[preset.0.options]\nversion/code=10001\nversion/name="0.1.0-alpha.1"\n'
  );
  fs.writeFileSync(paths.project, '[application]\nconfig/version="0.1.0-alpha.1"\n');
  const snapshot = () =>
    Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')]));
  const run = (code = '44201') =>
    spawnSync(
      process.execPath,
      [path.join(tools, 'stamp-build.mjs'), '0.14.3-alpha.342.1', '77e9a85', '342.1', code],
      { cwd: root, encoding: 'utf8' }
    );
  return { root, paths, snapshot, run };
}
test('one valid stamp writes matching APK and project versions', () => {
  const f = fixture();
  try {
    const p = f.run();
    assert.equal(p.status, 0, p.stderr);
    const after = f.snapshot();
    assert.match(after.preset, /^version\/code=44201$/m);
    assert.match(after.preset, /^version\/name="0\.14\.3-alpha\.342\.1"$/m);
    assert.match(after.project, /^config\/version="0\.14\.3-alpha\.342\.1"$/m);
    assert.match(after.build, /342\.1/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test('wrong code cannot mutate any source file', () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    const p = f.run('44200');
    assert.notEqual(p.status, 0);
    assert.deepEqual(f.snapshot(), before);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test('missing or duplicate stamp field fails before any writes', () => {
  for (const mutation of ['missing-version', 'duplicate-code']) {
    const f = fixture();
    try {
      if (mutation === 'missing-version') fs.writeFileSync(f.paths.project, '[application]\n');
      else fs.appendFileSync(f.paths.preset, 'version/code=10001\n');
      const before = f.snapshot();
      const p = f.run();
      assert.notEqual(p.status, 0, mutation);
      assert.deepEqual(f.snapshot(), before);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});
