use crate::db;
use crate::ingest;
use crate::models::*;
use crate::paths;
use crate::roms;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub scanning: Arc<AtomicBool>,
    pub updating: Arc<AtomicBool>,
}

pub fn lock<'a>(db: &'a Arc<Mutex<Connection>>) -> std::sync::MutexGuard<'a, Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

fn display_name(dir: &str) -> String {
    let base = dir.rsplit('/').next().unwrap_or(dir);
    base.replace('_', " ")
}

fn pretty_real_name(raw: &str) -> String {
    match raw.split_once(',') {
        Some((last, first)) => format!("{} {}", first.trim(), last.trim()),
        None => raw.trim().to_string(),
    }
}

// ---------------------------------------------------------------- boot

#[tauri::command]
pub fn boot(state: State<'_, AppState>) -> Result<BootInfo, String> {
    let conn = lock(&state.db);
    let mut library = db::get_setting(&conn, "library_path");
    let valid = library
        .as_deref()
        .map(|p| paths::is_library(Path::new(p)))
        .unwrap_or(false);
    if !valid {
        library = paths::detect_library();
        if let Some(p) = &library {
            let _ = db::set_setting(&conn, "library_path", p);
        }
    }

    let version = library
        .as_deref()
        .and_then(|p| paths::library_version(Path::new(p)))
        .or_else(|| db::meta(&conn, "version").and_then(|v| v.parse().ok()));
    let declared = library
        .as_deref()
        .and_then(|p| paths::declared_sid_count(Path::new(p), version));

    let tune_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tunes", [], |r| r.get(0))
        .unwrap_or(0);

    Ok(BootInfo {
        library_path: library.filter(|p| paths::is_library(Path::new(p))),
        library_version: version,
        library_sid_count: declared,
        db_path: paths::db_path().to_string_lossy().to_string(),
        tune_count,
        ingested_at: db::meta(&conn, "ingested_at"),
        engine: db::get_setting(&conn, "engine").unwrap_or_else(|| "residfp".into()),
        sid_model: db::get_setting(&conn, "sid_model").unwrap_or_else(|| "auto".into()),
        clock: db::get_setting(&conn, "clock").unwrap_or_else(|| "auto".into()),
        volume: db::get_setting(&conn, "volume")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.8),
        rom_dir: db::get_setting(&conn, "rom_dir"),
    })
}

#[tauri::command]
pub fn set_library(path: String, state: State<'_, AppState>) -> Result<BootInfo, String> {
    let p = Path::new(&path);
    if !paths::is_library(p) {
        return Err(format!(
            "Invalid folder: DOCUMENTS/HVSC.txt is missing in {}",
            path
        ));
    }
    {
        let conn = lock(&state.db);
        db::set_setting(&conn, "library_path", &path).map_err(|e| e.to_string())?;
    }
    boot(state)
}

#[tauri::command]
pub fn detect_library() -> Option<String> {
    paths::detect_library()
}

// ---------------------------------------------------------------- scan

#[derive(Clone, serde::Serialize)]
struct Progress {
    processed: i64,
    total: i64,
}

#[tauri::command(async)]
pub async fn scan_library(app: AppHandle, state: State<'_, AppState>) -> Result<ScanStats, String> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running".into());
    }
    let db = state.db.clone();
    let scanning = state.scanning.clone();

    let library = {
        let conn = lock(&db);
        db::get_setting(&conn, "library_path")
    };
    let Some(library) = library else {
        scanning.store(false, Ordering::SeqCst);
        return Err("No HVSC library configured".into());
    };
    let root = std::path::PathBuf::from(&library);

    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<ScanStats, String> {
        let mut conn = lock(&db);
        let progress = |processed: i64, total: i64| {
            let _ = app2.emit(
                "ingest://progress",
                Progress {
                    processed,
                    total,
                },
            );
        };
        let stats = ingest::scan(&root, &mut conn, &progress).map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = db::set_meta(&conn, "ingested_at", &now.to_string());
        if let Some(v) = stats.version {
            let _ = db::set_meta(&conn, "version", &v.to_string());
        }
        let _ = db::set_meta(&conn, "library_path", &root.to_string_lossy());
        let _ = db::set_meta(&conn, "sid_count", &stats.parsed.to_string());
        Ok(stats)
    })
    .await
    .map_err(|e| e.to_string())?;

    scanning.store(false, Ordering::SeqCst);
    result
}

// ---------------------------------------------------------------- browse

#[tauri::command]
pub fn browse_nodes(parent: String, state: State<'_, AppState>) -> Result<Vec<Node>, String> {
    let conn = lock(&state.db);
    let parent = parent.trim_matches('/').to_string();
    let mut nodes = Vec::new();

    if parent.is_empty() {
        let mut stmt = conn
            .prepare("SELECT collection, COUNT(*) FROM tunes GROUP BY collection ORDER BY collection")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (key, count) = row;
            let label = match key.as_str() {
                "MUSICIANS" => "Musicisti".to_string(),
                "DEMOS" => "Demo".to_string(),
                "GAMES" => "Giochi".to_string(),
                other => other.to_string(),
            };
            nodes.push(Node {
                key: key.clone(),
                label,
                subtitle: None,
                country: None,
                kind: "collection".into(),
                count,
                has_children: true,
            });
        }
        return Ok(nodes);
    }

    let parts: Vec<&str> = parent.split('/').collect();
    if parts.len() == 1 {
        let mut stmt = conn
            .prepare(
                "SELECT bucket, COUNT(*) FROM tunes WHERE collection = ?1
                 GROUP BY bucket ORDER BY bucket",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![parts[0]], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (bucket, count) = row;
            nodes.push(Node {
                key: format!("{}/{}", parts[0], bucket),
                label: bucket.clone(),
                subtitle: None,
                country: None,
                kind: "bucket".into(),
                count,
                has_children: parts[0] == "MUSICIANS",
            });
        }
        return Ok(nodes);
    }

    if parts.len() == 2 && parts[0] == "MUSICIANS" {
        let mut stmt = conn
            .prepare(
                "SELECT t.composer_dir, COUNT(*), MAX(m.handle), MAX(m.real_name), MAX(m.country)
                 FROM tunes t LEFT JOIN musicians m ON m.dir = t.composer_dir
                 WHERE t.collection = 'MUSICIANS' AND t.bucket = ?1 AND t.composer_dir IS NOT NULL
                 GROUP BY t.composer_dir ORDER BY t.composer_dir COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![parts[1]], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (dir, count, handle, real_name, country) = row;
            let label = real_name
                .as_deref()
                .map(pretty_real_name)
                .filter(|s| !s.is_empty())
                .or_else(|| handle.clone())
                .unwrap_or_else(|| display_name(&dir));
            let subtitle = handle
                .clone()
                .filter(|h| !label.eq_ignore_ascii_case(h))
                .or_else(|| Some(display_name(&dir)).filter(|d| d != &label));
            nodes.push(Node {
                key: dir,
                label,
                subtitle,
                country,
                kind: "composer".into(),
                count,
                has_children: false,
            });
        }
        return Ok(nodes);
    }

    Ok(nodes)
}

// ---------------------------------------------------------------- queries

const TUNE_COLS: &str = "t.id, t.path, t.filename, t.title, t.artist, COALESCE(t.released,''), \
     t.collection, t.composer_dir, t.songs, t.clock, t.sid_model, t.format, \
     t.duration_total, t.is_buggy, t.has_stil, \
     CASE WHEN t.format = 'RSID' AND COALESCE(t.init_addr, 0) = 0 THEN 1 ELSE 0 END";

fn row_to_tune(r: &rusqlite::Row<'_>) -> rusqlite::Result<TuneRow> {
    row_to_tune_at(r, 0)
}

fn row_to_tune_at(r: &rusqlite::Row<'_>, base: usize) -> rusqlite::Result<TuneRow> {
    Ok(TuneRow {
        id: r.get(base)?,
        path: r.get(base + 1)?,
        filename: r.get(base + 2)?,
        title: r.get(base + 3)?,
        artist: r.get(base + 4)?,
        released: r.get(base + 5)?,
        collection: r.get(base + 6)?,
        composer_dir: r.get(base + 7)?,
        songs: r.get(base + 8)?,
        clock: r.get(base + 9)?,
        sid_model: r.get(base + 10)?,
        format: r.get(base + 11)?,
        duration_total: r.get(base + 12)?,
        is_buggy: r.get::<_, i64>(base + 13)? != 0,
        has_stil: r.get::<_, i64>(base + 14)? != 0,
        needs_roms: r.get::<_, i64>(base + 15)? != 0,
    })
}

/// Build an FTS5 MATCH expression that survives punctuation (hyphens, commas…).
/// Trigram needs tokens of at least 3 characters, so short queries fall back to LIKE.
fn fts_query_for(text: &str) -> Option<String> {
    let tokens: Vec<&str> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() || tokens.iter().any(|t| t.chars().count() < 3) {
        return None;
    }
    Some(
        tokens
            .iter()
            .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

fn build_filters(q: &TuneQuery, fts: Option<&str>) -> (String, Vec<Value>) {
    let mut sql = String::from(" WHERE 1=1");
    let mut args: Vec<Value> = Vec::new();

    if let Some(node) = q.node.as_deref().filter(|n| !n.is_empty()) {
        let parts: Vec<&str> = node.split('/').filter(|p| !p.is_empty()).collect();
        if !parts.is_empty() {
            sql.push_str(" AND t.collection = ?");
            args.push(Value::Text(parts[0].to_string()));
        }
        if parts.len() >= 2 {
            sql.push_str(" AND t.bucket = ?");
            args.push(Value::Text(parts[1].to_string()));
        }
        if parts.len() >= 3 {
            sql.push_str(" AND t.composer_dir = ?");
            args.push(Value::Text(parts[..3].join("/")));
        }
    }
    if let Some(c) = q.collection.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND t.collection = ?");
        args.push(Value::Text(c.to_string()));
    }
    if let Some(b) = q.bucket.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND t.bucket = ?");
        args.push(Value::Text(b.to_string()));
    }
    if let Some(d) = q.composer_dir.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND t.composer_dir = ?");
        args.push(Value::Text(d.to_string()));
    }
    if let Some(m) = q.sid_model.as_deref().filter(|s| !s.is_empty() && *s != "auto") {
        sql.push_str(" AND t.sid_model = ?");
        args.push(Value::Text(m.to_string()));
    }
    if let Some(c) = q.clock.as_deref().filter(|s| !s.is_empty() && *s != "auto") {
        sql.push_str(" AND t.clock = ?");
        args.push(Value::Text(c.to_string()));
    }
    if let Some(f) = q.format.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND t.format = ?");
        args.push(Value::Text(f.to_string()));
    }
    if q.only_stil {
        sql.push_str(" AND t.has_stil = 1");
    }
    if q.only_favorites {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
                          WHERE p.kind = 'favorites' AND pi.tune_path = t.path)",
        );
    }
    let text = q.text.trim();
    if !text.is_empty() {
        match fts {
            Some(expression) => {
                sql.push_str(" AND t.id IN (SELECT rowid FROM tunes_fts WHERE tunes_fts MATCH ?)");
                args.push(Value::Text(expression.to_string()));
            }
            None => {
                sql.push_str(" AND (t.title LIKE ? OR t.artist LIKE ? OR t.filename LIKE ?)");
                let like = format!("%{text}%");
                args.push(Value::Text(like.clone()));
                args.push(Value::Text(like.clone()));
                args.push(Value::Text(like));
            }
        }
    }
    (sql, args)
}

fn order_clause(sort: Option<&str>) -> &'static str {
    match sort.unwrap_or("path") {
        "relevance" => " ORDER BY t.title COLLATE NOCASE ASC",
        "title" => " ORDER BY t.title COLLATE NOCASE ASC, t.path ASC",
        "artist" => " ORDER BY t.artist COLLATE NOCASE ASC, t.title COLLATE NOCASE ASC",
        "year" => " ORDER BY COALESCE(t.released,'zzzz') ASC, t.title COLLATE NOCASE ASC",
        "duration" => " ORDER BY COALESCE(t.duration_total, 0) DESC",
        "longest" => " ORDER BY COALESCE(t.duration_total, 0) DESC",
        _ => " ORDER BY t.path COLLATE NOCASE ASC",
    }
}

#[tauri::command]
pub fn search_tunes(q: TuneQuery, state: State<'_, AppState>) -> Result<TunePage, String> {
    let conn = lock(&state.db);
    let raw_text = q.text.trim().to_string();
    let fts = fts_query_for(&raw_text);
    let (filters, args) = build_filters(&q, fts.as_deref());
    let limit = q.limit.unwrap_or(200).clamp(1, 2000);
    let offset = q.offset.unwrap_or(0).max(0);

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM tunes t{filters}"),
            params_from_iter(args.iter()),
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let use_relevance = fts.is_some()
        && matches!(q.sort.as_deref(), None | Some("") | Some("relevance"));
    let order = if use_relevance {
        " ORDER BY (SELECT bm25(tunes_fts) FROM tunes_fts WHERE tunes_fts MATCH ? AND rowid = t.id) ASC, t.title COLLATE NOCASE ASC".to_string()
    } else {
        order_clause(q.sort.as_deref()).to_string()
    };

    let sql = format!("SELECT {TUNE_COLS} FROM tunes t{filters}{order} LIMIT ? OFFSET ?");
    let mut all = args;
    if use_relevance {
        all.push(Value::Text(fts.clone().unwrap_or_default()));
    }
    all.push(Value::Integer(limit));
    all.push(Value::Integer(offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params_from_iter(all.iter()), row_to_tune)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    Ok(TunePage { items, total })
}

fn composer_info(conn: &Connection, dir: &str) -> Option<ComposerInfo> {
    let row = conn.query_row(
        "SELECT dir, handle, real_name, country, groups, aliases, tune_count, total_seconds
         FROM musicians WHERE dir = ?1",
        [dir],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, f64>(7)?,
            ))
        },
    )
    .ok();

    match row {
        Some((dir, handle, real_name, country, groups, aliases, count, seconds)) => {
            Some(ComposerInfo {
                dir,
                handle,
                real_name: real_name.map(|r| pretty_real_name(&r)),
                country,
                groups: groups
                    .and_then(|g| serde_json::from_str::<Vec<String>>(&g).ok())
                    .unwrap_or_default(),
                aliases: aliases
                    .and_then(|a| serde_json::from_str::<Vec<String>>(&a).ok())
                    .unwrap_or_default(),
                tune_count: count,
                total_seconds: seconds,
            })
        }
        None => {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tunes WHERE composer_dir = ?1",
                    [dir],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if count == 0 {
                return None;
            }
            Some(ComposerInfo {
                dir: dir.to_string(),
                handle: None,
                real_name: None,
                country: None,
                groups: vec![],
                aliases: vec![],
                tune_count: count,
                total_seconds: 0.0,
            })
        }
    }
}

#[tauri::command]
pub fn composer_detail(dir: String, state: State<'_, AppState>) -> Result<ComposerInfo, String> {
    let conn = lock(&state.db);
    composer_info(&conn, &dir).ok_or_else(|| "Composer not found".to_string())
}

#[tauri::command]
pub fn tune_detail(id: i64, state: State<'_, AppState>) -> Result<TuneDetail, String> {
    let conn = lock(&state.db);
    let sql = format!(
        "SELECT {TUNE_COLS}, t.hdr_title, t.hdr_author, t.hdr_released, t.version, t.start_song,
                t.load_addr, t.init_addr, t.play_addr, t.md5, t.size, t.stil_comment,
                t.stil_json, t.bug_note
         FROM tunes t WHERE t.id = ?1"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt.query([id]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Err("Tune not found".into());
    };
    let base = row_to_tune(row).map_err(|e| e.to_string())?;
    let hdr_title: Option<String> = row.get(16).unwrap_or(None);
    let hdr_author: Option<String> = row.get(17).unwrap_or(None);
    let hdr_released: Option<String> = row.get(18).unwrap_or(None);
    let version: i64 = row.get(19).unwrap_or(2);
    let start_song: i64 = row.get(20).unwrap_or(1);
    let load_addr: Option<i64> = row.get(21).ok().flatten();
    let init_addr: Option<i64> = row.get(22).ok().flatten();
    let play_addr: Option<i64> = row.get(23).ok().flatten();
    let md5: Option<String> = row.get(24).ok().flatten();
    let size: i64 = row.get(25).unwrap_or(0);
    let stil_comment: Option<String> = row.get(26).ok().flatten();
    let stil_json: Option<String> = row.get(27).ok().flatten();
    let bug_note: Option<String> = row.get(28).ok().flatten();
    drop(rows);
    drop(stmt);

    let stil_blocks: Vec<StilBlock> = stil_json
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_default();

    let mut sub_stmt = conn
        .prepare("SELECT subtune, duration FROM subtunes WHERE tune_id = ?1 ORDER BY subtune")
        .map_err(|e| e.to_string())?;
    let subtunes: Vec<SubtuneRow> = sub_stmt
        .query_map([id], |r| {
            Ok(SubtuneRow {
                subtune: r.get(0)?,
                duration: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    let composer = base
        .composer_dir
        .as_deref()
        .filter(|_| base.collection == "MUSICIANS")
        .and_then(|d| composer_info(&conn, d));

    let favorites = db::favorites_id(&conn).map_err(|e| e.to_string())?;
    let in_favorites: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?1 AND tune_path = ?2",
            params![favorites, base.path],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(TuneDetail {
        row: base,
        hdr_title,
        hdr_author,
        hdr_released,
        version,
        start_song,
        load_addr,
        init_addr,
        play_addr,
        md5,
        size,
        stil_comment,
        stil_blocks,
        subtunes,
        composer,
        bug_note,
        in_favorites: in_favorites > 0,
    })
}

#[tauri::command]
pub fn read_tune(id: i64, state: State<'_, AppState>) -> Result<Response, String> {
    let path: String = {
        let conn = lock(&state.db);
        conn.query_row("SELECT path FROM tunes WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|_| "Tune not found".to_string())?
    };
    let library = {
        let conn = lock(&state.db);
        db::get_setting(&conn, "library_path").ok_or("Library not configured")?
    };
    let full = std::path::Path::new(&library).join(&path);
    let bytes = std::fs::read(&full).map_err(|e| format!("{}: {}", full.display(), e))?;
    Ok(Response::new(bytes))
}

/// Per-ROM diagnostics for a folder (defaults to the configured one).
#[tauri::command]
pub fn rom_report(dir: Option<String>, state: State<'_, AppState>) -> Result<roms::RomReport, String> {
    let dir = dir.or_else(|| {
        let conn = lock(&state.db);
        db::get_setting(&conn, "rom_dir")
    });
    let Some(dir) = dir else {
        return Ok(roms::RomReport {
            dir: String::new(),
            dir_exists: false,
            ready: false,
            roms: Vec::new(),
            warnings: vec!["No ROM folder configured".to_string()],
        });
    };
    Ok(roms::scan(std::path::Path::new(&dir)))
}

/// Look for VICE / C64 Forever ROM folders in the usual places.
#[tauri::command]
pub fn detect_rom_dirs() -> Vec<roms::DetectedDir> {
    roms::detect()
}

#[tauri::command]
pub fn read_system_rom(kind: String, state: State<'_, AppState>) -> Result<Response, String> {
    let dir = {
        let conn = lock(&state.db);
        db::get_setting(&conn, "rom_dir")
    }
    .ok_or_else(|| "No ROM folder configured".to_string())?;
    let kind = roms::RomKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown ROM type: {kind}"))?;
    let bytes = roms::read(std::path::Path::new(&dir), kind)?;
    Ok(Response::new(bytes))
}

// ---------------------------------------------------------------- playlists

#[tauri::command]
pub fn list_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    let conn = lock(&state.db);
    db::favorites_id(&conn).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.kind,
                    (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id),
                    p.created_at
             FROM playlists p
             ORDER BY CASE p.kind WHEN 'favorites' THEN 0 ELSE 1 END, p.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([], |r| {
            Ok(Playlist {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                count: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(items)
}

#[tauri::command]
pub fn create_playlist(name: String, state: State<'_, AppState>) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Nome vuoto".into());
    }
    let conn = lock(&state.db);
    conn.execute(
        "INSERT INTO playlists(name, kind) VALUES(?1, 'user')",
        [name],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn rename_playlist(id: i64, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = lock(&state.db);
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2 AND kind != 'favorites'",
        params![name.trim(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_playlist(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = lock(&state.db);
    conn.execute(
        "DELETE FROM playlists WHERE id = ?1 AND kind != 'favorites'",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_to_playlist(
    playlist_id: i64,
    tune_path: String,
    subtune: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = lock(&state.db);
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?1 AND tune_path = ?2 AND subtune = ?3",
            params![playlist_id, tune_path, subtune.unwrap_or(1)],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if exists > 0 {
        return Ok(());
    }
    let pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1",
            [playlist_id],
            |r| r.get(0),
        )
        .unwrap_or(1);
    conn.execute(
        "INSERT INTO playlist_items(playlist_id, tune_path, subtune, position) VALUES(?1, ?2, ?3, ?4)",
        params![playlist_id, tune_path, subtune.unwrap_or(1), pos],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_playlist_item(item_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let conn = lock(&state.db);
    conn.execute("DELETE FROM playlist_items WHERE id = ?1", [item_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn playlist_items(playlist_id: i64, state: State<'_, AppState>) -> Result<TunePage, String> {
    let conn = lock(&state.db);
    let sql = format!(
        "SELECT pi.id, {TUNE_COLS} FROM playlist_items pi
         JOIN tunes t ON t.path = pi.tune_path
         WHERE pi.playlist_id = ?1 ORDER BY pi.position ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([playlist_id], |r| {
            let item_id: i64 = r.get(0)?;
            let mut tune = row_to_tune_at(r, 1)?;
            tune.id = item_id; // reuse as item id for list operations
            Ok(tune)
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect::<Vec<TuneRow>>();
    let total = items.len() as i64;
    Ok(TunePage { items, total })
}

#[tauri::command]
pub fn toggle_favorite(
    tune_path: String,
    subtune: Option<i64>,
    on: bool,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let conn = lock(&state.db);
    let fav = db::favorites_id(&conn).map_err(|e| e.to_string())?;
    if on {
        let sub = subtune.unwrap_or(1);
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?1 AND tune_path = ?2 AND subtune = ?3",
                params![fav, tune_path, sub],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            let pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1",
                    [fav],
                    |r| r.get(0),
                )
                .unwrap_or(1);
            conn.execute(
                "INSERT INTO playlist_items(playlist_id, tune_path, subtune, position) VALUES(?1, ?2, ?3, ?4)",
                params![fav, tune_path, sub, pos],
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        conn.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1 AND tune_path = ?2",
            params![fav, tune_path],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(on)
}

#[tauri::command]
pub fn add_history(tune_path: String, subtune: Option<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let conn = lock(&state.db);
    conn.execute(
        "INSERT INTO history(tune_path, subtune) VALUES(?1, ?2)",
        params![tune_path, subtune.unwrap_or(1)],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 500)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_history(limit: Option<i64>, state: State<'_, AppState>) -> Result<Vec<HistoryEntry>, String> {
    let conn = lock(&state.db);
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let sql = format!(
        "SELECT h.played_at, h.subtune, {TUNE_COLS} FROM history h
         JOIN tunes t ON t.path = h.tune_path
         ORDER BY h.id DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([limit], |r| {
            Ok(HistoryEntry {
                played_at: r.get(0)?,
                subtune: r.get(1)?,
                tune: row_to_tune_at(r, 2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(items)
}

// ---------------------------------------------------------------- settings

/// Append a client-side error to `<data>/errors.log` so crashes can be
/// diagnosed after the toast disappears.
#[tauri::command]
pub fn log_error(context: String, message: String) -> Result<(), String> {
    use std::io::Write;
    let dir = paths::data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("errors.log");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "[{stamp}] {context} :: {message}").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = lock(&state.db);
    Ok(db::settings_map(&conn))
}

#[tauri::command]
pub fn set_setting(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = lock(&state.db);
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = lock(&state.db);
    let mut collections = Vec::new();
    let mut stmt = conn
        .prepare("SELECT collection, COUNT(*) FROM tunes GROUP BY collection ORDER BY collection")
        .map_err(|e| e.to_string())?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(|e| e.to_string())?.flatten() {
        collections.push(serde_json::json!({ "collection": row.0, "count": row.1 }));
    }
    let composers: i64 = conn
        .query_row("SELECT COUNT(*) FROM musicians", [], |r| r.get(0))
        .unwrap_or(0);
    let total_seconds: f64 = conn
        .query_row("SELECT COALESCE(SUM(duration_total), 0) FROM tunes", [], |r| r.get(0))
        .unwrap_or(0.0);
    Ok(serde_json::json!({
        "collections": collections,
        "composers": composers,
        "totalSeconds": total_seconds,
    }))
}
