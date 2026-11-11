# Contributing to SID Station

Thanks for taking a look. This is a small, single-maintainer project, so the
process is deliberately light.

## Before you open an issue

- Search existing issues first.
- Check that the problem is in SID Station and not in your HVSC copy: the app
  never modifies the collection except through **Updates**.
- For playback problems, note the tune path (`MUSICIANS/.../Name.sid`), the
  subtune, the engine (reSIDfp / SIDLite) and whether the tune needs C64 ROMs.

## Reporting bugs

Use the **Bug report** template and include:

1. SID Station version (Settings footer / installer name).
2. Windows version and, if relevant, your audio device.
3. HVSC release (`DOCUMENTS/HVSC.txt`).
4. Steps to reproduce, expected vs actual behaviour.
5. `data/errors.log` entries if the audio engine reported a fatal error.

Please do not attach SID files, HVSC archives or Commodore ROM images. A path
inside HVSC is enough.

## Pull requests

1. Open an issue first for anything larger than a typo or a small fix.
2. Keep changes focused; this codebase favours small, direct solutions.
3. Match the existing style: TypeScript strict, React function components,
   Rust with `rustfmt`, no new dependency unless it clearly pays for itself.
4. Run before pushing:

   ```powershell
   npm run typecheck
   cargo test --manifest-path src-tauri/Cargo.toml
   npm run tauri build     # for changes that touch the shell or the updater
   ```

5. Describe *why* in the PR: the behaviour being fixed and how you verified it.
   Screenshots help for UI changes.

## Scope

In scope: HVSC browsing and search, playback, library management, the HVSC
updater, C64 ROM handling, Windows packaging.

Out of scope: bundling SID tunes, HVSC documents, ROM images or any other
copyrighted content; downloading content from unofficial sources; emulating
the full C64.

## Licence

By contributing you agree that your contribution is licensed under the
GPL-2.0-or-later, the licence of this project.
