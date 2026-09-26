import { spawnSync } from 'node:child_process';
/** Generate the per-project script class cache before a standalone Godot test. */
export function prepareGodotProject(root, executable, runner = spawnSync) {
  const result = runner(executable, ['--headless', '--editor', '--path', 'game', '--quit'], {
    cwd: root,
    shell: false,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024
  });
  const output = (result.stdout || '') + (result.stderr || '');
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    /SCRIPT ERROR:|Parse Error:|^ERROR:/m.test(output)
  )
    throw Error('GODOT_PROJECT_IMPORT_FAILED: ' + output.slice(-2500));
  return { status: 'prepared', output };
}
