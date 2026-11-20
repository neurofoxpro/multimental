import { summarizeUi } from './ux-metrics.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verificationRuntime } from './godot-runtime.mjs';
import {
  findRoot,
  inside,
  readJSON,
  writeJSON,
  fingerprint,
  sha,
  context
} from '../skills/game-production/scripts/lib.mjs';
export async function main(args = process.argv.slice(2)) {
  if (args.length) throw Error('ux-audit takes no arguments');
  const root = findRoot(),
    project = readJSON(inside(root, '.gameprod/project.json'));
  context(root, project);
  let binary = process.env.GODOT_BIN || 'godot';
  if (!process.env.GODOT_BIN && process.platform === 'win32') {
    const dir = path.join(path.dirname(root), 'tools/godot');
    const name = fs.readdirSync(dir).find((n) => /console.exe$/i.test(n));
    if (!name) throw Error('Pinned station Godot missing');
    binary = path.join(dir, name);
  }
  const exe = verificationRuntime(root, binary);
  const imported = spawnSync(exe, ['--headless', '--editor', '--path', 'game', '--quit'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    shell: false
  });
  if (
    imported.status !== 0 ||
    /SCRIPT ERROR|Parse Error/.test((imported.stdout || '') + (imported.stderr || ''))
  )
    throw Error('UI measurement cache preparation failed');
  const before = fingerprint(root, project);
  const run = spawnSync(
    exe,
    ['--headless', '--path', 'game', '--script', 'res://tests/ux_audit.gd'],
    { cwd: root, encoding: 'utf8', timeout: 90000, shell: false, maxBuffer: 16000000 }
  );
  const text = (run.stdout || '') + (run.stderr || '');
  const after = fingerprint(root, project);
  const line = text.split(/\r?\n/).find((row) => row.startsWith('MULTIMENTAL_UX_AUDIT_JSON '));
  if (
    run.error ||
    run.status !== 0 ||
    before !== after ||
    !line ||
    /SCRIPT ERROR|Parse Error|^ERROR:/m.test(text)
  )
    throw Error('UX measurement failed: ' + text.slice(-5000));
  const report = JSON.parse(line.slice('MULTIMENTAL_UX_AUDIT_JSON '.length));
  const { summary } = summarizeUi(report);
  writeJSON(inside(root, '.gameprod/evidence/ux-audit.json'), {
    ...report,
    at: new Date().toISOString(),
    sourceDigest: before,
    sourceDigestAfter: after,
    logHash: sha(text),
    summary
  });
  console.log(
    JSON.stringify(
      { status: 'measured_not_accessibility_certified', sourceDigest: before, summary },
      null,
      2
    )
  );
}
