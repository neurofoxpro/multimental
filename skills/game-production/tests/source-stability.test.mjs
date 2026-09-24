import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeJSON, readJSON, gate } from '../scripts/lib.mjs';
const cli = fileURLToPath(new URL('../scripts/gameprod.mjs', import.meta.url));

function fixture(mutates) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multimental-source-step-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/input.txt'), 'original');
  const code = mutates
    ? "require('node:fs').writeFileSync('src/input.txt','changed');console.log('STEP_DONE')"
    : "console.log('STEP_DONE')";
  const p = {
    schemaVersion: 1,
    repository: 'fixture/game',
    authorizedHosts: [os.hostname()],
    inputs: ['src'],
    steps: { test: { command: ['node', '-e', code], timeoutSeconds: 10, markers: ['STEP_DONE'] } },
    gates: { verified: { steps: ['test'] } }
  };
  writeJSON(path.join(root, '.gameprod/project.json'), p);
  writeJSON(path.join(root, '.gameprod/state.json'), { repository: p.repository });
  writeJSON(path.join(root, '.gameprod/decisions.json'), []);
  writeJSON(
    path.join(root, '.gameprod/lifecycle.json'),
    Array.from({ length: 25 }, (_, i) => ({ stage: i }))
  );
  writeJSON(path.join(root, '.gameprod/source.json'), {
    repository: p.repository,
    commit: 'a'.repeat(40)
  });
  return { root, p, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

for (const mutates of [true, false]) {
  test(
    mutates
      ? 'zero-exit source-mutating step is FAILED, not passed'
      : 'unchanged source yields a valid passing gate',
    () => {
      const f = fixture(mutates);
      try {
        const r = spawnSync(process.execPath, [cli, 'run', 'test'], {
          cwd: f.root,
          encoding: 'utf8',
          timeout: 20000,
          env: { ...process.env, GITHUB_ACTIONS: 'false', GIT_DIR: '', GIT_WORK_TREE: '' }
        });
        const receipt = readJSON(path.join(f.root, '.gameprod/evidence/test.json'));
        assert.equal(receipt.exitCode, 0);
        assert.equal(receipt.sourceChanged, mutates);
        assert.equal(receipt.status, mutates ? 'failed' : 'passed');
        assert.equal(r.status, mutates ? 1 : 0);
        assert.equal(gate(f.root, f.p, 'verified').ok, !mutates);
        if (mutates) assert.match(r.stdout, /PRODUCTION_SOURCE_CHANGED/);
        assert.equal(fs.existsSync(path.join(f.root, '.gameprod/evidence/execution.lock')), false);
      } finally {
        f.close();
      }
    }
  );
}
