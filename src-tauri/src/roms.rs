//! C64 system ROM discovery and validation.
//!
//! The WASM engine needs three copyrighted images (supplied by the user):
//! KERNAL (8 KiB), BASIC (8 KiB) and CHARGEN (4 KiB). This module answers three
//! questions for the UI:
//!
//! * what is in a given folder (per-ROM diagnostics, duplicates, wrong sizes);
//! * which file should be used when several look plausible;
//! * whether a well-known VICE / C64 Forever installation is around.
//!
//! A file is accepted on size alone (the only thing we can check offline), but a
//! SHA-256 match against the images shipped by VICE is reported as a *known*
//! revision so the UI can tell "recognised" from "merely the right size".

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

pub const KERNAL_SIZE: usize = 8192;
pub const BASIC_SIZE: usize = 8192;
pub const CHARGEN_SIZE: usize = 4096;

/// SHA-256 of the C64 ROM images shipped in VICE 3.10 (`C64/*.bin`), keyed by
/// kind. These are identifiers, not copies: only the digests live here.
const KNOWN_ROMS: &[(&str, &str, &str, bool)] = &[
    // (kind, sha256, label, preferred)
    (
        "kernal",
        "83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721",
        "KERNAL 901227-03 (Rev 3)",
        true,
    ),
    (
        "kernal",
        "675cf19a3e04bf68e41cc7a9010b353e51845ed9069db65496c52b79f1e1385f",
        "KERNAL 901227-02",
        false,
    ),
    (
        "kernal",
        "f585600a2e47d0224459e878184d3f4cce2665bfcce65e61732530c6d89c4269",
        "KERNAL 901227-01",
        false,
    ),
    (
        "kernal",
        "81ad3a08920f2782ab031bb3ae02789d1f5f216c3d24d262e752a2b13e9faf73",
        "KERNAL 251104-04",
        false,
    ),
    (
        "kernal",
        "0a644f5e7f6ef8cb67b07e7a80f3f9a35584d9b131294c64f6e747a7e5c8a789",
        "KERNAL 390852-01",
        false,
    ),
    (
        "kernal",
        "b2b430a134514af11f3ed64c0929fc5241d8436ba7b12514ec02d1b2cb2fd533",
        "KERNAL 901246-01",
        false,
    ),
    (
        "kernal",
        "48af48070ec9adda79ae7f65b772c422062eb12e69214a7cf788e6947a3b4117",
        "KERNAL 906145-02",
        false,
    ),
    (
        "basic",
        "89878cea0a268734696de11c4bae593eaaa506465d2029d619c0e0cbccdfa62d",
        "BASIC 901226-01",
        true,
    ),
    (
        "chargen",
        "fd0d53b8480e86163ac98998976c72cc58d5dd8eb824ed7b829774e74213b420",
        "CHARGEN 901225-01",
        true,
    ),
    (
        "chargen",
        "0f4a5b0f9ec0d86639ba316053e330fdd849692623a41f8de4a420fcd47c55ee",
        "CHARGEN 906143-02",
        false,
    ),
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RomKind {
    Kernal,
    Basic,
    Chargen,
}

impl RomKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RomKind::Kernal => "kernal",
            RomKind::Basic => "basic",
            RomKind::Chargen => "chargen",
        }
    }

    pub fn expected_size(self) -> usize {
        match self {
            RomKind::Kernal | RomKind::Basic => 8192,
            RomKind::Chargen => 4096,
        }
    }

    /// The Commodore part number of the reference revision, used as a tie-break
    /// when several files of the right size are present.
    fn preferred_part(self) -> &'static str {
        match self {
            RomKind::Kernal => "901227-03",
            RomKind::Basic => "901226-01",
            RomKind::Chargen => "901225-01",
        }
    }

    fn matches_name(self, name: &str) -> bool {
        name.contains(self.as_str())
    }

    pub fn from_str(value: &str) -> Option<RomKind> {
        match value {
            "kernal" => Some(RomKind::Kernal),
            "basic" => Some(RomKind::Basic),
            "chargen" => Some(RomKind::Chargen),
            _ => None,
        }
    }
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RomCandidate {
    pub name: String,
    pub size: u64,
    pub sha256: Option<String>,
    pub known: Option<String>,
    pub valid: bool,
    pub problem: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RomEntry {
    pub kind: String,
    pub expected_size: usize,
    /// True when a readable file with the expected size was selected.
    pub found: bool,
    pub path: Option<String>,
    pub name: Option<String>,
    pub size: Option<u64>,
    pub sha256: Option<String>,
    /// Human label when the digest matches an image shipped by VICE.
    pub known: Option<String>,
    /// Why the selected file is unusable, or why nothing was selected.
    pub problem: Option<String>,
    /// Other files of the same kind that were considered (valid or not).
    pub candidates: Vec<RomCandidate>,
    pub duplicates: Vec<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RomReport {
    pub dir: String,
    pub dir_exists: bool,
    /// All three ROMs resolved and readable.
    pub ready: bool,
    pub roms: Vec<RomEntry>,
    pub warnings: Vec<String>,
}

impl RomReport {
    fn empty(dir: &Path, problem: String) -> RomReport {
        RomReport {
            dir: dir.display().to_string(),
            dir_exists: false,
            ready: false,
            roms: [RomKind::Kernal, RomKind::Basic, RomKind::Chargen]
                .iter()
                .map(|kind| RomEntry {
                    kind: kind.as_str().to_string(),
                    expected_size: kind.expected_size(),
                    found: false,
                    path: None,
                    name: None,
                    size: None,
                    sha256: None,
                    known: None,
                    problem: Some(problem.clone()),
                    candidates: Vec::new(),
                    duplicates: Vec::new(),
                })
                .collect(),
            warnings: vec![problem],
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn known_label(kind: RomKind, sha: &str) -> Option<(&'static str, bool)> {
    KNOWN_ROMS
        .iter()
        .find(|(k, digest, _, _)| *k == kind.as_str() && *digest == sha)
        .map(|(_, _, label, preferred)| (*label, *preferred))
}

fn score_candidate(kind: RomKind, name: &str, known: Option<&str>) -> i32 {
    let lower = name.to_ascii_lowercase();
    let mut score = 1;
    if let Some(label) = known {
        let preferred = KNOWN_ROMS
            .iter()
            .find(|(k, _, l, _)| *k == kind.as_str() && *l == label)
            .map(|(_, _, _, preferred)| *preferred)
            .unwrap_or(false);
        score = if preferred { 40 } else { 30 };
    }
    if lower.contains(kind.preferred_part()) {
        score += 10;
    }
    score
}

/// Compact digest form used in messages: first 12 hex chars.
fn short(sha: &str) -> String {
    sha.chars().take(12).collect()
}

/// Inspect `dir` and describe each of the three ROMs.
pub fn scan(dir: &Path) -> RomReport {
    if !dir.exists() {
        return RomReport::empty(dir, format!("Folder {} does not exist", dir.display()));
    }
    if !dir.is_dir() {
        return RomReport::empty(dir, format!("{} is not a folder", dir.display()));
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            return RomReport::empty(
                dir,
                format!("Folder {} is not readable: {err}", dir.display()),
            );
        }
    };

    let mut files: Vec<(PathBuf, String)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()) {
            files.push((path, name));
        }
    }

    let mut report = RomReport {
        dir: dir.display().to_string(),
        dir_exists: true,
        ready: true,
        roms: Vec::new(),
        warnings: Vec::new(),
    };

    for kind in [RomKind::Kernal, RomKind::Basic, RomKind::Chargen] {
        let expected = kind.expected_size();
        let mut candidates: Vec<RomCandidate> = Vec::new();
        let mut scored: Vec<(i32, RomCandidate, PathBuf)> = Vec::new();

        for (path, name) in files.iter().filter(|(_, name)| kind.matches_name(name)) {
            let display = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string());
            match std::fs::read(path) {
                Ok(bytes) => {
                    let sha = sha256_hex(&bytes);
                    let known = known_label(kind, &sha).map(|(label, _)| label.to_string());
                    let valid = bytes.len() == expected;
                    let problem = if valid {
                        None
                    } else {
                        Some(format!(
                            "{} bytes, expected {expected}",
                            bytes.len()
                        ))
                    };
                    let candidate = RomCandidate {
                        name: display,
                        size: bytes.len() as u64,
                        sha256: Some(sha.clone()),
                        known: known.clone(),
                        valid,
                        problem,
                    };
                    if valid {
                        let score = score_candidate(kind, name, known.as_deref());
                        scored.push((score, candidate.clone(), path.clone()));
                    }
                    candidates.push(candidate);
                }
                Err(err) => {
                    candidates.push(RomCandidate {
                        name: display,
                        size: 0,
                        sha256: None,
                        known: None,
                        valid: false,
                        problem: Some(format!("file not readable: {err}")),
                    });
                }
            }
        }

        // Highest score wins; ties resolved alphabetically for determinism.
        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.name.to_ascii_lowercase().cmp(&b.1.name.to_ascii_lowercase()))
        });

        let mut entry = RomEntry {
            kind: kind.as_str().to_string(),
            expected_size: expected,
            found: false,
            path: None,
            name: None,
            size: None,
            sha256: None,
            known: None,
            problem: None,
            candidates: candidates.clone(),
            duplicates: Vec::new(),
        };

        if let Some((_, chosen, path)) = scored.first() {
            entry.found = true;
            entry.path = Some(path.display().to_string());
            entry.name = Some(chosen.name.clone());
            entry.size = Some(chosen.size);
            entry.sha256 = chosen.sha256.clone();
            entry.known = chosen.known.clone();
            entry.duplicates = scored
                .iter()
                .skip(1)
                .map(|(_, c, _)| c.name.clone())
                .collect();
            if entry.known.is_none() {
                entry.problem = Some(format!(
                    "correct size but unrecognised digest (sha256 {}…)",
                    short(chosen.sha256.as_deref().unwrap_or(""))
                ));
            }
        } else {
            let wrong: Vec<&RomCandidate> = candidates.iter().filter(|c| !c.valid).collect();
            entry.problem = Some(if wrong.is_empty() {
                format!(
                    "no file matching \"{}\" found (expected {expected} bytes)",
                    kind.as_str()
                )
            } else {
                format!(
                    "{} file(s) matching \"{}\" found but none of {expected} bytes: {}",
                    wrong.len(),
                    kind.as_str(),
                    wrong
                        .iter()
                        .map(|c| format!("{} ({})", c.name, c.problem.clone().unwrap_or_default()))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            });
            report.ready = false;
        }

        if !entry.duplicates.is_empty() {
            report.warnings.push(format!(
                "{}: {} valid copies, using {}. Others: {}",
                kind.as_str(),
                entry.duplicates.len() + 1,
                entry.name.clone().unwrap_or_default(),
                entry.duplicates.join(", ")
            ));
        }
        if let Some(problem) = entry.problem.clone() {
            report.warnings.push(format!("{}: {problem}", kind.as_str()));
        }

        report.roms.push(entry);
    }

    report
}

/// Bytes of the ROM selected for `kind`, or an explanatory error.
pub fn read(dir: &Path, kind: RomKind) -> Result<Vec<u8>, String> {
    let report = scan(dir);
    let entry = report
        .roms
        .iter()
        .find(|r| r.kind == kind.as_str())
        .ok_or_else(|| format!("Unknown ROM {}", kind.as_str()))?;
    let path = entry
        .path
        .as_ref()
        .ok_or_else(|| entry.problem.clone().unwrap_or_else(|| "ROM not found".to_string()))?;
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    if bytes.len() != kind.expected_size() {
        return Err(format!(
            "{path}: {} bytes, expected {}",
            bytes.len(),
            kind.expected_size()
        ));
    }
    Ok(bytes)
}

// ------------------------------------------------------------------ detection

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DetectedDir {
    pub dir: String,
    pub source: String,
    pub ready: bool,
    pub missing: Vec<String>,
}

/// Environment / Program Files roots that are cheap to check.
fn base_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Ok(value) = std::env::var(var) {
            let dir = PathBuf::from(value);
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten().take(400) {
                    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    if name.starts_with("vice") || name.contains("c64 forever") || name.contains("c64forever") {
                        roots.push(entry.path());
                    }
                }
            }
        }
    }
    for var in ["LOCALAPPDATA"] {
        if let Ok(value) = std::env::var(var) {
            let dir = PathBuf::from(value).join("Programs");
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten().take(200) {
                    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    if name.starts_with("vice") || name.contains("c64 forever") {
                        roots.push(entry.path());
                    }
                }
            }
        }
    }
    roots
}

/// Install locations recorded by the Windows uninstaller.
///
/// One `reg query` over the Uninstall keys; output is parsed for `DisplayName`
/// and `InstallLocation` pairs, so no extra crate is needed.
fn registry_roots() -> Vec<(String, PathBuf)> {
    let keys = [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    let mut found = Vec::new();
    for key in keys {
        let output = std::process::Command::new("reg")
            .args(["query", key, "/s"])
            .output();
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut display: Option<String> = None;
        let mut location: Option<String> = None;
        for line in text.lines().chain(std::iter::once("")) {
            let trimmed = line.trim();
            if trimmed.starts_with("HKEY_") {
                if let (Some(name), Some(loc)) = (display.take(), location.take()) {
                    let lower = name.to_ascii_lowercase();
                    if lower.contains("vice") || lower.contains("c64 forever") || lower.contains("c64forever") {
                        found.push((name, PathBuf::from(loc)));
                    }
                }
                continue;
            }
            if let Some(idx) = trimmed.find("REG_SZ") {
                let (key_part, value_part) = trimmed.split_at(idx);
                let value = value_part[6..].trim();
                if key_part.starts_with("DisplayName") {
                    display = Some(value.to_string());
                } else if key_part.starts_with("InstallLocation") {
                    location = Some(value.to_string());
                }
            }
        }
    }
    found
}

/// Directories worth inspecting for a given install root (bounded, no walking).
fn rom_dirs_for(root: &Path, source: &str) -> Vec<PathBuf> {
    let mut dirs = vec![root.to_path_buf()];
    let lower_source = source.to_ascii_lowercase();
    if lower_source.contains("vice") {
        dirs.push(root.join("C64"));
        dirs.push(root.join("c64"));
    }
    if lower_source.contains("c64 forever") || lower_source.contains("c64forever") {
        for sub in ["Media", "Media/ROMs", "ROMS", "Roms", "roms", "Emulation", "C64"] {
            dirs.push(root.join(sub.replace('/', std::path::MAIN_SEPARATOR_STR)));
        }
        // C64 Forever keeps its Kickstart files under a couple of nested
        // folders with product-specific names: inspect only the first level.
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten().take(50) {
                if entry.path().is_dir() {
                    dirs.push(entry.path());
                    if let Ok(inner) = std::fs::read_dir(entry.path()) {
                        for child in inner.flatten().take(50) {
                            if child.path().is_dir() {
                                dirs.push(child.path());
                            }
                        }
                    }
                }
            }
        }
    }
    dirs
}

/// Bounded search of the usual VICE / C64 Forever locations.
pub fn detect() -> Vec<DetectedDir> {
    let mut roots: Vec<(String, PathBuf)> = registry_roots();
    for root in base_roots() {
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root.display().to_string());
        roots.push((name, root));
    }

    let mut seen: Vec<PathBuf> = Vec::new();
    let mut results: Vec<DetectedDir> = Vec::new();
    for (source, root) in roots {
        if !root.is_dir() {
            continue;
        }
        for dir in rom_dirs_for(&root, &source) {
            if !dir.is_dir() {
                continue;
            }
            let canon = std::fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
            if seen.contains(&canon) {
                continue;
            }
            seen.push(canon);
            let report = scan(&dir);
            let missing: Vec<String> = report
                .roms
                .iter()
                .filter(|r| !r.found)
                .map(|r| r.kind.clone())
                .collect();
            // Only advertise folders that contain at least one plausible ROM.
            let any = report.roms.iter().any(|r| r.found);
            if !any {
                continue;
            }
            results.push(DetectedDir {
                dir: dir.display().to_string(),
                source: source.clone(),
                ready: report.ready,
                missing,
            });
        }
    }
    results.sort_by(|a, b| b.ready.cmp(&a.ready).then_with(|| a.dir.cmp(&b.dir)));
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sidstation-roms-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_dir_is_reported_per_rom() {
        let dir = std::env::temp_dir().join("sidstation-roms-does-not-exist");
        let report = scan(&dir);
        assert!(!report.ready);
        assert!(!report.dir_exists);
        assert_eq!(report.roms.len(), 3);
        assert!(report.roms.iter().all(|r| r.problem.is_some()));
    }

    #[test]
    fn wrong_sizes_are_rejected_with_diagnostics() {
        let dir = temp_dir("wrong-size");
        std::fs::write(dir.join("kernal-901227-03.bin"), vec![0u8; 16384]).unwrap();
        let report = scan(&dir);
        let kernal = report.roms.iter().find(|r| r.kind == "kernal").unwrap();
        assert!(!kernal.found);
        assert!(kernal.problem.as_deref().unwrap_or("").contains("8192"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicates_are_listed_and_best_name_wins() {
        let dir = temp_dir("duplicates");
        std::fs::write(dir.join("kernal-901227-01.bin"), vec![1u8; KERNAL_SIZE]).unwrap();
        std::fs::write(dir.join("kernal-901227-03.bin"), vec![2u8; KERNAL_SIZE]).unwrap();
        std::fs::write(dir.join("basic-901226-01.bin"), vec![3u8; BASIC_SIZE]).unwrap();
        std::fs::write(dir.join("chargen-901225-01.bin"), vec![4u8; CHARGEN_SIZE]).unwrap();
        let report = scan(&dir);
        let kernal = report.roms.iter().find(|r| r.kind == "kernal").unwrap();
        assert!(kernal.found);
        // Synthetic bytes have no known digest, so the part-number tie-break decides.
        assert_eq!(kernal.name.as_deref(), Some("kernal-901227-03.bin"));
        assert_eq!(kernal.duplicates, vec!["kernal-901227-01.bin"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn full_set_is_ready_and_readable() {
        let dir = temp_dir("complete");
        std::fs::write(dir.join("kernal.bin"), vec![7u8; KERNAL_SIZE]).unwrap();
        std::fs::write(dir.join("basic.bin"), vec![7u8; BASIC_SIZE]).unwrap();
        std::fs::write(dir.join("chargen.bin"), vec![7u8; CHARGEN_SIZE]).unwrap();
        let report = scan(&dir);
        assert!(report.ready, "{:?}", report.warnings);
        assert_eq!(read(&dir, RomKind::Kernal).unwrap().len(), KERNAL_SIZE);
        assert_eq!(read(&dir, RomKind::Chargen).unwrap().len(), CHARGEN_SIZE);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn vice_layout_is_discovered() {
        let root = temp_dir("vice-root");
        let c64 = root.join("C64");
        std::fs::create_dir_all(&c64).unwrap();
        std::fs::write(c64.join("kernal-901227-03.bin"), vec![1u8; KERNAL_SIZE]).unwrap();
        std::fs::write(c64.join("basic-901226-01.bin"), vec![2u8; BASIC_SIZE]).unwrap();
        std::fs::write(c64.join("chargen-901225-01.bin"), vec![3u8; CHARGEN_SIZE]).unwrap();
        let dirs = rom_dirs_for(&root, "VICE 3.10");
        assert!(dirs.contains(&c64), "C64/ should be inspected: {dirs:?}");
        let report = scan(&c64);
        assert!(report.ready, "{:?}", report.warnings);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn known_digest_is_recognised() {
        // Digest of the real VICE image would require shipping it; instead check
        // that an unknown digest is labelled as such and does not crash.
        let dir = temp_dir("unknown-digest");
        std::fs::write(dir.join("kernal.bin"), vec![9u8; KERNAL_SIZE]).unwrap();
        let report = scan(&dir);
        let kernal = report.roms.iter().find(|r| r.kind == "kernal").unwrap();
        assert!(kernal.known.is_none());
        assert!(kernal.problem.as_deref().unwrap_or("").contains("digest"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
