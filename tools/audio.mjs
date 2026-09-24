import fs from 'node:fs';
import path from 'node:path';
import { generatedAudio, inspectWav } from './audio-lib.mjs';
const write = process.argv[2] === 'write';
const assets = generatedAudio();
for (const [name, content] of Object.entries(assets)) {
  const file = path.join('game/audio', name);
  if (write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  } else if (!fs.existsSync(file) || !content.equals(fs.readFileSync(file)))
    throw Error('Generated audio stale: ' + name);
  const meta = inspectWav(content);
  if (meta.peak > 16384) throw Error('Generated mix peak too high');
  console.log('AUDIO_ASSET ' + name + ' duration=' + meta.duration + ' peak=' + meta.peak);
}
console.log(write ? 'AUDIO_GENERATED' : 'AUDIO_ASSETS_PASS');
