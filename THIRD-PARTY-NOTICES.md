# Third-party notices

SID Station is distributed under the GNU General Public License, version 2 or
any later version (GPL-2.0-or-later). This file lists the third-party
components it uses, their licences, and the obligations that come with
redistributing them.

SID Station ships **no** SID tunes, no HVSC documents and no Commodore ROM
images. Those remain the property of their respective authors and are supplied
by the user.

## Bundled components

### libsidplayfp-wasm 1.1.1 — GPL-2.0-or-later

The audio engine in the renderer is the WebAssembly build of
[libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) 3.1.1 and
[libresidfp](https://github.com/libsidplayfp/libresidfp) 1.2.3, packaged by
[@chrisgleissner/libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm).

The package is GPL-2.0-or-later. Its own `LICENSE`, `THIRD-PARTY-NOTICES.md` and
`MODIFICATIONS.md` (which records the changes applied to upstream before
compiling the `.wasm` files) are distributed inside the npm package and are
installed under `node_modules/libsidplayfp-wasm/` when building from source.

Because SID Station links this code, the complete corresponding source of SID
Station is published in this repository under the same licence. The source of
the engine is available from the package above and from the upstream projects.

### libsidplayfp 3.1.1 — GPL-2.0-or-later

Commodore 64 emulation core: CPU, CIA, VIC timing and the SID player
environment. <https://github.com/libsidplayfp/libsidplayfp>

### libresidfp 1.2.3 — GPL-2.0-or-later

Cycle-accurate SID chip emulation used by the reSIDfp engine.
<https://github.com/libsidplayfp/libresidfp>

### 7-Zip 26.01 — LGPL-2.1-or-later, with the unRAR restriction in `7z.dll`

`src-tauri/resources/7z/7z.exe` and `7z.dll` are the unmodified 7-Zip
executables, bundled because HVSC update packages use PPMd + BCJ2, which the
standalone `7zr.exe` cannot decode. The full licence text ships next to the
binaries as `src-tauri/resources/7z/License.txt` and is included in the
installed application (`resources/7z/License.txt`).

The unRAR restriction applies only to RAR decompression code inside `7z.dll`;
SID Station never uses RAR archives. 7-Zip is not modified.
<https://www.7-zip.org/>

### SQLite (via `rusqlite` with the `bundled` feature) — public domain

The SQLite amalgamation is compiled into the Rust binary.
<https://www.sqlite.org/copyright.html>

### WebView2

SID Station uses the WebView2 runtime that ships with Windows 10/11. Microsoft
Edge WebView2 is not redistributed with this application.

## Rust dependencies

Direct dependencies (`src-tauri/Cargo.toml`) and their licences:

| Crate | Licence |
|---|---|
| tauri 2 | MIT OR Apache-2.0 |
| tauri-plugin-log | MIT OR Apache-2.0 |
| tauri-plugin-dialog | MIT OR Apache-2.0 |
| tauri-plugin-opener | MIT OR Apache-2.0 |
| serde, serde_json | MIT OR Apache-2.0 |
| log | MIT OR Apache-2.0 |
| walkdir | Unlicense OR MIT |
| anyhow | MIT OR Apache-2.0 |
| thiserror | MIT OR Apache-2.0 |
| rusqlite | MIT |
| sevenz-rust | Apache-2.0 |
| sha2 | MIT OR Apache-2.0 |
| hex | MIT OR Apache-2.0 |
| reqwest | MIT OR Apache-2.0 |
| encoding_rs | Apache-2.0 OR MIT |
| md-5 | Apache-2.0 OR MIT |

Transitive dependencies are permissive (MIT, Apache-2.0, BSD-2/3-Clause, ISC,
Zlib, Unicode-3.0, CDLA-Permissive-2.0) or MPL-2.0 (CSS parsing crates used by
Tauri's HTML renderer). MPL-2.0 is file-level copyleft and is compatible with
the GPL through its secondary-licence clause; no MPL-licensed file is modified.

Apache-2.0 components are compatible with this project because it is licensed
**GPL-2.0-or-later**: the combined work can be distributed under GPLv3 terms.
The project is not GPL-2.0-only for this reason.

## npm dependencies

Runtime: React 19 (MIT), Zustand (MIT), @tanstack/react-virtual (MIT),
@tauri-apps/api and plugins (MIT OR Apache-2.0), libsidplayfp-wasm
(GPL-2.0-or-later).

Build only: Vite (MIT), TypeScript (Apache-2.0), Tailwind CSS (MIT),
lightningcss (MPL-2.0), @vitejs/plugin-react (MIT), @tauri-apps/cli
(MIT OR Apache-2.0). Build tools are not part of the distributed application.

## Content and data

### HVSC — the High Voltage SID Collection

HVSC is **not** included in this repository or in the installers. Every file
of the collection (`*.sid`, `DOCUMENTS/STIL.txt`, `Songlengths.md5`,
`Musicians.txt`, `HVSC.faq`, …) remains © its authors and is distributed under
the terms that ship with the collection itself.

The authoritative terms are the file `DOCUMENTS/Disclaimer.txt` inside every
HVSC release. The parts that matter for an application like this one, quoted
verbatim:

> All of the tunes available in the High Voltage SID Collection (HVSC) are
> copyrighted.
>
> Use of the SIDs in this collection for any purpose other than private
> enjoyment is subject to relevant copyright law. […] any other use (including
> YouTube use) requires additional permissions.
>
> Please note that the creators of this collection do not have (and neither do
> they claim) the legal authority to grant licences or collect royalties or
> other contributions to permit any use.

In practice:

* SID Station is a **player and indexer**. It reads a collection you already
  own, does not redistribute tunes and does not grant any right over them.
* The in-app updater only automates the official workflow: it queries the
  official API, downloads from the official mirror, and runs the official HVSC
  Update Tool on your own copy.
* The name "HVSC" and "High Voltage SID Collection" are used descriptively, to
  say what the application browses. SID Station is not affiliated with,
  sponsored or endorsed by the HVSC team, and does not use its logo.
* Commercial use of the tunes, remixes and inclusion in Creative Commons works
  are outside the scope of this software and require permission from the
  rights holders (see `DOCUMENTS/Disclaimer.txt` and
  <https://hvsc.c64.org/>).

### SID tunes

© their composers and publishers. Attribution in the SID header or in STIL is
not proof of current copyright ownership; the disclaimer above explains why.
* **Commodore 64 ROMs** — KERNAL, BASIC and CHARGEN are © Commodore/Cloanto.
  SID Station never downloads or bundles them; the user supplies images they
  are entitled to use. The SHA-256 digests in `src-tauri/src/roms.rs` are
  identifiers of the images distributed with VICE 3.10, used only to label a
  revision in the UI.

## Trademarks

Commodore 64 and SID are trademarks of their respective owners. SID Station is
an independent project, not affiliated with or endorsed by Commodore, Cloanto,
the HVSC team, or the libsidplayfp maintainers.
