use std::path::{Path, PathBuf};

/// Directory that holds the portable database and app-local files.
///
/// Preference order:
/// 1. `<exe dir>/data` when it is writable (portable install).
/// 2. `%LOCALAPPDATA%/SID Station` (installed under Program Files, read-only).
/// 3. `<cwd>/data` as last resort.
pub fn data_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    if let Some(dir) = &exe_dir {
        let candidate = dir.join("data");
        if ensure_writable(&candidate) {
            return candidate;
        }
    }

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let candidate = PathBuf::from(local).join("SID Station");
        if ensure_writable(&candidate) {
            return candidate;
        }
    }

    let candidate = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data");
    ensure_writable(&candidate);
    candidate
}

fn ensure_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-test");
    match std::fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

pub fn db_path() -> PathBuf {
    data_dir().join("sid-station.db")
}

/// Look for a HVSC collection on the usual Windows drive letters.
/// A collection is identified by `DOCUMENTS/HVSC.txt`.
pub fn detect_library() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("C64Music"));
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("C64Music"));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("C64Music"));
    }

    for letter in b'A'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        if Path::new(&drive).exists() {
            candidates.push(Path::new(&drive).join("C64Music"));
            candidates.push(Path::new(&drive).join("HVSC").join("C64Music"));
            candidates.push(Path::new(&drive).join("hvsc").join("C64Music"));
        }
    }

    candidates
        .into_iter()
        .find(|p| is_library(p))
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

pub fn is_library(path: &Path) -> bool {
    path.join("DOCUMENTS").join("HVSC.txt").is_file()
        && path.join("MUSICIANS").is_dir()
}

/// Parse "Release 85" out of DOCUMENTS/HVSC.txt.
pub fn library_version(root: &Path) -> Option<u32> {
    let text = std::fs::read(root.join("DOCUMENTS").join("HVSC.txt")).ok()?;
    let text = String::from_utf8_lossy(&text);
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Release ") {
            if let Ok(v) = rest.trim().parse::<u32>() {
                return Some(v);
            }
            // "Release 5.0" style fallback
            if let Some(first) = rest.split('.').next() {
                if let Ok(v) = first.trim().parse::<u32>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Parse the "should contain N SID files" claim from the latest update script.
pub fn declared_sid_count(root: &Path, version: Option<u32>) -> Option<u32> {
    let version = version?;
    let path = root
        .join("DOCUMENTS")
        .join(format!("Update{:02}.hvs", version));
    let text = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&text);
    for line in text.lines() {
        if let Some(idx) = line.find("should contain") {
            let rest = &line[idx + "should contain".len()..];
            let digits: String = rest.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit() || *c == ',').collect();
            let cleaned = digits.replace(',', "");
            if let Ok(v) = cleaned.parse::<u32>() {
                return Some(v);
            }
        }
    }
    None
}
