import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedAudio, inspectWav, RATE } from '../../../tools/audio-lib.mjs';
test('generated audio is reproducible and bounded, with valid PCM containers', () => {
  const a = generatedAudio(),
    b = generatedAudio();
  for (const n of Object.keys(a)) {
    assert.ok(a[n].equals(b[n]));
    const m = inspectWav(a[n]);
    assert.equal(m.sampleRate, RATE);
    assert.ok(m.peak > 0 && m.peak < 16384);
    assert.equal(a[n].readInt16LE(44), 0);
    assert.equal(a[n].readInt16LE(a[n].length - 2), 0);
  }
  assert.equal(inspectWav(a['ambient.wav']).duration, 16);
});
