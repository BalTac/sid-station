# Security policy

## Supported versions

Only the latest release receives fixes. SID Station is a local desktop
application: it has no server component and no account system.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private reporting: **Security → Report a vulnerability** on the
repository. If that is unavailable, contact the maintainer through their GitHub
profile.

Include the version, the affected component (Tauri shell, updater, HVSC
parsing, ROM scanning) and reproduction steps. You will get an acknowledgement
when the report is read; there is no guaranteed response time.

## Relevant attack surface

- **HVSC updates** — the updater downloads over HTTPS from the official
  hvsc.c64.org endpoints, verifies the expected version and string match of the
  official update tool, keeps a full backup and rolls back on failure.
- **SID parsing** — tune headers are parsed by Rust code; the audio engine runs
  in WebAssembly inside the WebView sandbox.
- **Local files** — the app reads the collection folder and the configured ROM
  folder. It does not open arbitrary URLs from tune data.

## Out of scope

- Issues that require an already-compromised machine.
- Missing code signing of the installers (SmartScreen warnings are expected).
- Copyright questions about HVSC content or Commodore ROMs; see
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
