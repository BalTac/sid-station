# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-11

First public release.

### Added

- Native Tauri 2 shell for Windows 10/11 with a React 19 interface.
- HVSC indexing into a portable SQLite database (61,157 SID in HVSC #85),
  including STIL, Songlengths, Musicians and BUGlist data.
- Full-text search over title, artist and STIL text (FTS5 trigram) with
  collection filters and relevance/title/artist/year/length sorting.
- Composer browsing by collection and letter, with composer pages.
- Tune pages with header fields, subtune lengths, STIL notes, BUGlist warning
  and CSDb search.
- Playback through libsidplayfp-wasm (libsidplayfp 3.1.1, libresidfp 1.2.3)
  with reSIDfp/SIDLite engines, 6581/8580 models, PAL/NTSC, subtune switching,
  seek, repeat and shuffle modes, and a live oscilloscope.
- Favourites, named playlists and listening history stored per tune path.
- In-app HVSC updater: official API check, mirror download, full backup,
  official HVS update tool, verification and automatic rollback.
- C64 system ROM support for RSID/BASIC tunes, with per-ROM diagnostics
  (size, SHA-256, known revision, duplicates) and bounded detection of VICE and
  C64 Forever installations.
- NSIS and MSI installers; database stored next to the executable.

[Unreleased]: https://github.com/BalTac/sid-station/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BalTac/sid-station/releases/tag/v0.1.0
