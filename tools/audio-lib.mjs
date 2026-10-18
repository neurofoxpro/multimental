// Original generated audio; integer triangle oscillators keep generation reproducible.
export const RATE = 16000;
export function wav(pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++)
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i]))), 44 + i * 2);
  return b;
}
function triangle(phase) {
  const p = phase % 65536;
  return p < 32768 ? p / 16384 - 1 : 3 - p / 16384;
}
function tone(samples, start, length, frequency, amplitude) {
  const phaseStep = Math.round((frequency * 65536) / RATE);
  const attack = Math.max(1, Math.floor(RATE * 0.025)),
    release = Math.max(1, Math.floor(RATE * 0.14));
  for (let n = 0; n < length && start + n < samples.length; n++) {
    const envelope = Math.min(1, n / attack, (length - 1 - n) / release);
    samples[start + n] += triangle(n * phaseStep) * amplitude * Math.max(0, envelope);
  }
}
export function generatedAudio() {
  const music = new Float64Array(RATE * 16);
  const chords = [
    [220, 262, 330],
    [175, 220, 262],
    [196, 262, 330],
    [196, 247, 294]
  ];
  for (let bar = 0; bar < 4; bar++) {
    for (const f of chords[bar]) tone(music, bar * RATE * 4, RATE * 4, f / 2, 850);
    const notes = [0, 1, 2, 1, 0, 2, 1, 2];
    for (let beat = 0; beat < 8; beat++)
      tone(
        music,
        bar * RATE * 4 + (beat * RATE) / 2,
        RATE * 0.47,
        chords[bar][notes[beat]] * 2,
        1900
      );
  }
  const action = new Float64Array(Math.floor(RATE * 0.18));
  tone(action, 0, action.length, 660, 4200);
  tone(action, 0, action.length, 990, 1000);
  return { 'ambient.wav': wav(music), 'action.wav': wav(action) };
}
export function inspectWav(b) {
  if (
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WAVE' ||
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt16LE(34) !== 16
  )
    throw Error('Unsupported generated WAV');
  if (b.readUInt32LE(40) !== b.length - 44) throw Error('WAV length mismatch');
  let peak = 0;
  for (let i = 44; i < b.length; i += 2) peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
  return { sampleRate: b.readUInt32LE(24), duration: (b.length - 44) / (RATE * 2), peak };
}
