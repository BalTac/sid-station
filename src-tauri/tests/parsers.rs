//! Parser tests against a real HVSC checkout.
//!
//! Point `HVSC_ROOT` at the collection root (the folder containing
//! `DOCUMENTS/HVSC.txt`). Without it the tests are skipped, so a clean
//! `cargo test` on a machine without HVSC stays green.

use sid_station_lib::ingest::{parse_musicians, parse_songlengths, parse_stil};
use std::path::{Path, PathBuf};

fn hvsc_root() -> Option<PathBuf> {
    let root = std::env::var_os("HVSC_ROOT")?;
    let root = PathBuf::from(root);
    root.join("DOCUMENTS").join("HVSC.txt").is_file().then_some(root)
}

fn read_doc(root: &Path, name: &str) -> String {
    let bytes = std::fs::read(root.join("DOCUMENTS").join(name)).expect("HVSC document");
    String::from_utf8_lossy(&bytes).to_string()
}

#[test]
fn songlengths_lookup() {
    let Some(root) = hvsc_root() else {
        eprintln!("HVSC_ROOT not set, skipping");
        return;
    };
    let map = parse_songlengths(&read_doc(&root, "Songlengths.md5"));
    assert!(map.len() > 60_000, "entries: {}", map.len());
    // Keys are collection-relative paths and every entry resolves.
    let (key, value) = map.iter().next().expect("at least one songlength");
    assert!(key.starts_with('/'), "unexpected key: {key}");
    assert_eq!(map.get(key), Some(value));
    assert!(!value.is_empty() && value.iter().all(|v| v.is_finite()));
}

#[test]
fn stil_lookup() {
    let Some(root) = hvsc_root() else {
        eprintln!("HVSC_ROOT not set, skipping");
        return;
    };
    let map = parse_stil(&read_doc(&root, "STIL.txt"));
    assert!(map.len() > 18_000, "entries: {}", map.len());
    assert!(map.contains_key("/MUSICIANS/H/Hubbard_Rob/Commando.sid"));
}

#[test]
fn musicians_lookup() {
    let Some(root) = hvsc_root() else {
        eprintln!("HVSC_ROOT not set, skipping");
        return;
    };
    let list = parse_musicians(&read_doc(&root, "Musicians.txt"));
    assert!(list.len() > 1_750, "musicians: {}", list.len());
    assert!(list
        .iter()
        .any(|m| m.handle.as_deref().unwrap_or("").contains("Bayliss")));
}
