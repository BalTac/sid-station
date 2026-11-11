use anyhow::Result;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;

pub const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tunes (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  collection TEXT NOT NULL,
  bucket TEXT NOT NULL,
  composer_dir TEXT,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  md5 TEXT,
  format TEXT NOT NULL,
  version INTEGER NOT NULL,
  songs INTEGER NOT NULL,
  start_song INTEGER NOT NULL,
  clock TEXT,
  sid_model TEXT,
  load_addr INTEGER,
  init_addr INTEGER,
  play_addr INTEGER,
  hdr_title TEXT,
  hdr_author TEXT,
  hdr_released TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  released TEXT,
  stil_comment TEXT,
  duration_total REAL,
  is_buggy INTEGER NOT NULL DEFAULT 0,
  bug_note TEXT,
  has_stil INTEGER NOT NULL DEFAULT 0,
  stil_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_tunes_collection ON tunes(collection);
CREATE INDEX IF NOT EXISTS idx_tunes_bucket ON tunes(collection, bucket);
CREATE INDEX IF NOT EXISTS idx_tunes_composer ON tunes(composer_dir);
CREATE INDEX IF NOT EXISTS idx_tunes_title ON tunes(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tunes_artist ON tunes(artist COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS subtunes (
  tune_id INTEGER NOT NULL REFERENCES tunes(id) ON DELETE CASCADE,
  subtune INTEGER NOT NULL,
  duration REAL,
  PRIMARY KEY (tune_id, subtune)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS musicians (
  id INTEGER PRIMARY KEY,
  dir TEXT NOT NULL UNIQUE,
  handle TEXT,
  real_name TEXT,
  country TEXT,
  groups TEXT,
  aliases TEXT,
  tune_count INTEGER NOT NULL DEFAULT 0,
  total_seconds REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  tune_path TEXT NOT NULL,
  subtune INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlist_items ON playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_items_path ON playlist_items(tune_path);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  tune_path TEXT,
  subtune INTEGER NOT NULL DEFAULT 1,
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_played ON history(played_at DESC);

CREATE TABLE IF NOT EXISTS update_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS tunes_fts USING fts5(
  title, artist, comment, content='', tokenize='trigram'
);

"#;

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    // One-time rename of the default playlist created by older builds.
    conn.execute(
        "UPDATE playlists SET name = 'Favorites' WHERE kind = 'favorites' AND name = 'Preferiti'",
        [],
    )?;
    Ok(conn)
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

pub fn settings_map(conn: &Connection) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM settings") {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            for row in rows.flatten() {
                out.insert(row.0, row.1);
            }
        }
    }
    out
}

pub fn meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM collection_meta WHERE key = ?1", [key], |r| r.get(0))
        .ok()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO collection_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

pub fn favorites_id(conn: &Connection) -> Result<i64> {
    if let Ok(id) = conn.query_row(
        "SELECT id FROM playlists WHERE kind = 'favorites' ORDER BY id LIMIT 1",
        [],
        |r| r.get(0),
    ) {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO playlists(name, kind) VALUES('Favorites', 'favorites')",
        [],
    )?;
    Ok(conn.last_insert_rowid())
}
