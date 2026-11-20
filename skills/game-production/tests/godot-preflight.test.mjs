import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGodotProject } from '../../../tools/godot-preflight.mjs';
test('cold project imports the per-root class cache before standalone tests', () => {
  let call;
  const result = prepareGodotProject('/workspace/project', 'godot', (exe, args, opts) => {
    call = { exe, args, opts };
    return { status: 0, stdout: 'Godot ready' };
  });
  assert.equal(result.status, 'prepared');
  assert.equal(call.opts.cwd, '/workspace/project');
  assert.equal(call.opts.shell, false);
  assert.equal(call.opts.timeout, 60000);
  assert.deepEqual(call.args, ['--headless', '--editor', '--path', 'game', '--quit']);
});
for (const [name, result] of [
  ['nonzero', { status: 1 }],
  ['spawn failure', { status: 0, error: Error('spawn') }],
  ['signal', { status: 0, signal: 'SIGTERM' }],
  ['script parse', { status: 0, stderr: 'SCRIPT ERROR: Parse Error: missing type' }],
  ['engine error', { status: 0, stdout: 'ERROR: unknown project' }]
])
  test('preflight rejects ' + name, () =>
    assert.throws(() => prepareGodotProject('/p', 'godot', () => result))
  );
test('warning alone is not a fake parser error', () =>
  assert.equal(
    prepareGodotProject('/p', 'g', () => ({ status: 0, stderr: 'WARNING: headless platform' }))
      .status,
    'prepared'
  ));
