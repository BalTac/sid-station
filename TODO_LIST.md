# TODO list

Known gaps, unfinished work and ideas that were deliberately deferred. Nothing
here is promised: this is a hobby project, and the list is ordered by how much
the item actually matters.

## Correctness

- **C64 Forever ROM detection is untested on a real installation.**
  `roms::detect()` looks in the install folder recorded by the uninstaller and
  probes a bounded set of subfolders (`Media`, `ROMS`, `Emulation`, one level of
  nesting). The VICE layout is covered by a unit test; the C64 Forever layout is
  not. To close: run it on a machine with C64 Forever installed and add a test
  case with a fake tree that mirrors what the installer creates.

- **Known ROM digests cover only the images shipped with VICE 3.10.**
  Unknown images of the right size are accepted and labelled "unknown digest"
  instead of being rejected. If another trustworthy source of revision digests
  appears (VICE releases, C64 Forever), extend `KNOWN_ROMS` in
  `src-tauri/src/roms.rs`. Do not add digests from random downloads.

- **`libsidplayfp-wasm` traps on `setSystemROMs(null, null, null)`.**
  SID Station avoids the call by rebuilding the engine when ROMs are cleared
  (`src/lib/audio.ts`), and recovers by marking the engine broken if an injection
  fails. The underlying issue is upstream: a null injection raises
  `RuntimeError: memory access out of bounds` and leaves the instance unusable.
  To close: reproduce in a minimal Node script, report it to
  <https://github.com/chrisgleissner/libsidplayfp-wasm>, and drop the workaround
  if a fixed release lands.

## Hardening

- **Content Security Policy is disabled** (`"csp": null` in
  `src-tauri/tauri.conf.json`). A strict policy would need `wasm-unsafe-eval`
  for the engine, `worker-src`/`script-src` for the AudioWorklet and `blob:`
  where needed. To close: enable it, verify playback, search and ROM loading
  still work, and keep the policy in the Tauri config rather than in HTML.

- **Installers are not code-signed**, so Windows SmartScreen warns on first run.
  Out of scope until a certificate exists; the README says so explicitly.

- **App icon provenance** must be confirmed by the maintainer (original work or a
  compatible licence) before the project grows. Not a code task.

## Testing

- **No automated UI tests.** Playback, navigation, the ROM panel and the updater
  were verified manually through the WebView2 devtools protocol; only Rust logic
  and TypeScript types run in CI. To close: add a small Playwright suite against
  the dev build (the `window.__sid` hook is already dev-only) covering: search →
  play, tune page, ROM status with and without ROMs, repeat/shuffle modes.

- **The HVSC ingest test needs a collection.** It is skipped when `HVSC_ROOT` is
  unset. That is intentional (CI has no HVSC), but it means the full ingest path
  is only checked locally. A tiny synthetic collection (a handful of SID files
  with fabricated headers) could exercise the parser in CI without HVSC.

## Legal and documentation

- **HVSC wording should get a human review.** The notices quote
  `DOCUMENTS/Disclaimer.txt` and state that the name is used descriptively, but
  this is not legal advice. If the HVSC team ever publishes guidance for
  third-party players, follow it.

- **GitHub detects the licence as "GPL-2.0"** because `LICENSE` is the verbatim
  GPLv2 text; the "or later" clause is declared in README, `package.json` and
  `Cargo.toml`. Optional: prepend the standard "either version 2, or (at your
  option) any later version" notice to `LICENSE` so the sidebar matches.

## Packaging and maintenance

- **7-Zip binaries are committed** (`src-tauri/resources/7z/`, ~2.4 MB). They are
  needed by the updater at runtime and their licence ships with them. Alternative:
  download a pinned, checksummed archive during the build. Decide based on whether
  reproducible offline builds matter more than repository size.

- **Demo GIF** for the README: optional, and only worth it if it shows real
  interaction (search → play → subtune switch). No synthetic audio.

- **Localisation**: the UI is English-only. If an Italian (or other) translation
  is wanted, extract the strings first; do not scatter conditionals through the
  components.

## Ideas parked on purpose

- Composer photos from CSDb with a local cache — interesting, but it introduces
  remote content, caching and per-image licensing questions. Not before the core
  is stable.
- Waveform/spectrum options, replay-gain style normalisation, tray mode — nice to
  have, none of them solve a problem the current version actually has.
