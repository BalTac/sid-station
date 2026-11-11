// Render a SID file with the same WASM engine the app uses and print
// peak/RMS levels. Useful to tell "silent because it needs C64 ROMs" from
// "silent because of a bug".
//
//   node scripts/engine-check.mjs <path-to.sid> [seconds] [rom-dir]
//
// When rom-dir is given it must contain kernal (8K), basic (8K), chargen (4K).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SidAudioEngine } from "libsidplayfp-wasm";

const [sidPath, secondsArg, romDir] = process.argv.slice(2);
if (!sidPath) {
  console.error("usage: node scripts/engine-check.mjs <file.sid> [seconds] [rom-dir]");
  process.exit(2);
}
const seconds = Number(secondsArg ?? 3);

const engine = new SidAudioEngine({ engine: "residfp", sampleRate: 48000, stereo: true });

if (romDir) {
  const rom = (name) => new Uint8Array(readFileSync(join(romDir, name)));
  await engine.setSystemROMs(
    rom("kernal-901227-03.bin"),
    rom("basic-901226-01.bin"),
    rom("chargen-901225-01.bin"),
  );
  console.log("rom status:", engine.getRomStatus());
}

await engine.loadSidBuffer(new Uint8Array(readFileSync(sidPath)));
const pcm = await engine.renderSeconds(seconds);

let peak = 0;
let sum = 0;
for (const sample of pcm) {
  const abs = Math.abs(sample);
  if (abs > peak) peak = abs;
  sum += (sample / 32768) ** 2;
}
console.log({
  file: sidPath,
  seconds,
  peak,
  rms: Math.sqrt(sum / pcm.length).toFixed(4),
  timeMs: engine.getTimeMs(),
});
engine.dispose();
