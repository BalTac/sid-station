# Release procedure

Releases are manual. Nothing in CI publishes to GitHub Releases.

## 1. Prepare

1. Update the version in **all three** places, keeping them in sync:
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
2. Move the `[Unreleased]` entries of [CHANGELOG.md](CHANGELOG.md) under the new
   version heading with today's date.
3. Rebuild and check the About/version strings in the window header.

```powershell
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

## 2. Verify the artifacts

```
src-tauri/target/release/bundle/nsis/SID Station_x.y.z_x64-setup.exe
src-tauri/target/release/bundle/msi/SID Station_x.y.z_x64_en-US.msi
```

Smoke test on a clean Windows profile if possible: install, point at HVSC,
search a title, play a PSID, play an RSID with and without ROMs, change the SID
model, restart and confirm the settings survived.

## 3. Tag and publish

```powershell
git tag -a v0.1.0 -m "SID Station 0.1.0"
git push origin v0.1.0
```

Then create the GitHub release from the tag, attach both installers and a
`SHA256SUMS.txt` produced with:

```powershell
Get-ChildItem "SID Station*.exe","SID Station*.msi" | ForEach-Object {
  "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
}
```

Write release notes from the changelog: what is new, what is fixed, and any
known limitation (for example: unsigned installers, RSID tunes needing ROMs).
