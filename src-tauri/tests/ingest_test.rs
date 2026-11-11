//! Full ingest of a real HVSC checkout.
//!
//! Set `HVSC_ROOT` to the collection root and run:
//!   cargo test --test ingest_test -- --nocapture
//! Without it the test is skipped instead of failing on a clean machine.

use sid_station_lib::{db, ingest};
use std::path::{Path, PathBuf};

fn hvsc_root() -> Option<PathBuf> {
    let root = PathBuf::from(std::env::var_os("HVSC_ROOT")?);
    root.join("DOCUMENTS").join("HVSC.txt").is_file().then_some(root)
}

#[test]
fn ingest_real_hvsc() {
    let Some(root) = hvsc_root() else {
        eprintln!("HVSC_ROOT not set, skipping");
        return;
    };
    let root = root.as_path();
    let db_path = Path::new("target").join("test-ingest.db");
    let _ = std::fs::remove_file(&db_path);
    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));

    let mut conn = db::open(&db_path).expect("open db");
    let stats = ingest::scan(root, &mut conn, &|done, total| {
        if done % 20000 == 0 || done == total {
            eprintln!("  scan {done}/{total}");
        }
    })
    .expect("scan");

    println!(
        "scanned={} parsed={} skipped={} stil={} songlengths={} musicians={} elapsed={}ms version={:?} declared={:?}",
        stats.scanned,
        stats.parsed,
        stats.skipped,
        stats.stil_entries,
        stats.songlength_entries,
        stats.musicians,
        stats.elapsed_ms,
        stats.version,
        stats.sid_count_declared
    );

    // Release-independent invariants: every SID parses, documents are complete.
    assert_eq!(stats.parsed, stats.scanned, "all scanned SIDs have a valid header");
    assert_eq!(stats.skipped, 0);
    assert!(stats.songlength_entries > 60_000);
    assert!(stats.sid_count_declared.is_some_and(|n| n > 60_000));
    assert!(stats.version.is_some());
    assert!(stats.stil_entries > 18_000);

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM tunes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(total, stats.parsed as i64);

    let with_duration: i64 = conn
        .query_row("SELECT COUNT(*) FROM tunes WHERE duration_total IS NOT NULL", [], |r| r.get(0))
        .unwrap();
    println!("with_duration={with_duration}");
    assert_eq!(with_duration, total);

    let sample: (String, String, i64) = conn
        .query_row(
            "SELECT title, artist, songs FROM tunes WHERE path = 'MUSICIANS/H/Hubbard_Rob/Commando.sid'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("Commando");
    println!("Commando: {:?}", sample);
    assert!(sample.0.to_lowercase().contains("commando"));
    assert!(sample.1.to_lowercase().contains("hubbard"));

    let multi: i64 = conn
        .query_row("SELECT COUNT(*) FROM tunes WHERE songs > 1", [], |r| r.get(0))
        .unwrap();
    println!("multi-subtune={multi}");

    let composers: i64 = conn
        .query_row("SELECT COUNT(*) FROM musicians", [], |r| r.get(0))
        .unwrap();
    println!("composers={composers}");

    let named: i64 = conn
        .query_row("SELECT COUNT(*) FROM musicians WHERE handle IS NOT NULL", [], |r| r.get(0))
        .unwrap();
    println!("composers with handle={named}");

    let bayliss: (String, String, i64) = conn
        .query_row(
            "SELECT handle, country, tune_count FROM musicians WHERE dir = 'MUSICIANS/B/Bayliss_Richard'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("Bayliss");
    println!("Bayliss: {:?}", bayliss);
    assert!(bayliss.1.contains("UNITED KINGDOM"));
}
