import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const src = "node_modules/libsidplayfp-wasm/dist";
const targets = [
  [join(src, "libsidplayfp.wasm"), "public/wasm/libsidplayfp.wasm"],
  [join(src, "sidlite", "libsidplayfp.wasm"), "public/wasm/sidlite/libsidplayfp.wasm"],
];
for (const [from, to] of targets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log("copied", to);
}
