//! Environment detection smoke test.
//!
//! With `HVSC_ROOT` set to a real collection, the detected library is checked
//! against it; otherwise only the "does not panic" part runs.

use std::path::PathBuf;

#[test]
fn detection_does_not_panic() {
    let _ = sid_station_lib::paths::detect_library();
    let db = sid_station_lib::paths::db_path();
    assert!(db.to_string_lossy().ends_with("sid-station.db"));

    let Some(root) = std::env::var_os("HVSC_ROOT").map(PathBuf::from) else {
        eprintln!("HVSC_ROOT not set, skipping library checks");
        return;
    };
    assert!(sid_station_lib::paths::is_library(&root), "not an HVSC root");
    assert!(sid_station_lib::paths::library_version(&root).is_some());
}
