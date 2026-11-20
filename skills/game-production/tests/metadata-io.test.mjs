import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJSON, readJSON } from '../scripts/lib.mjs';
function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-json-'));
  return {
    file: path.join(root, 'state.json'),
    close: () => fs.rmSync(root, { recursive: true, force: true })
  };
}
test('metadata rename sharing violation retries without changing meaning', () => {
  const t = tmp();
  try {
    let count = 0;
    writeJSON(t.file, { before: 1 });
    writeJSON(
      t.file,
      { after: 2 },
      {
        platform: 'win32',
        sleep: () => {},
        rename: (a, b) => {
          if (count++ < 2) throw Object.assign(Error('reader sharing'), { code: 'EPERM' });
          fs.renameSync(a, b);
        }
      }
    );
    assert.equal(count, 3);
    assert.deepEqual(readJSON(t.file), { after: 2 });
    assert.equal(fs.existsSync(t.file + '.write-recovery.local.json'), false);
  } finally {
    t.close();
  }
});
test('persistent Windows sharing fallback is verified and recoverable, not labelled atomic', () => {
  const t = tmp();
  try {
    writeJSON(t.file, { old: 1 });
    writeJSON(
      t.file,
      { new: 2 },
      {
        platform: 'win32',
        retries: 0,
        rename: () => {
          throw Object.assign(Error('reader'), { code: 'EPERM' });
        }
      }
    );
    assert.deepEqual(readJSON(t.file), { new: 2 });
    assert.deepEqual(readJSON(t.file + '.previous.local.json'), { old: 1 });
    assert.equal(
      readJSON(t.file + '.write-recovery.local.json').mode,
      'journaled_windows_in_place'
    );
  } finally {
    t.close();
  }
});
test('permission and disk errors are not treated as transient sharing', () => {
  for (const code of ['EACCES', 'ENOSPC']) {
    const t = tmp();
    try {
      writeJSON(t.file, { old: 1 });
      assert.throws(() =>
        writeJSON(
          t.file,
          { new: 2 },
          {
            platform: 'win32',
            rename: () => {
              throw Object.assign(Error(code), { code });
            }
          }
        )
      );
      assert.deepEqual(readJSON(t.file), { old: 1 });
    } finally {
      t.close();
    }
  }
});
test('another writer cannot be overwritten by a fallback', () => {
  const t = tmp();
  try {
    writeJSON(t.file, { old: 1 });
    assert.throws(
      () =>
        writeJSON(
          t.file,
          { new: 2 },
          {
            platform: 'win32',
            retries: 0,
            rename: () => {
              fs.writeFileSync(t.file, '{"other":3}');
              throw Object.assign(Error('reader'), { code: 'EPERM' });
            }
          }
        ),
      /concurrently/
    );
    assert.deepEqual(readJSON(t.file), { other: 3 });
  } finally {
    t.close();
  }
});
