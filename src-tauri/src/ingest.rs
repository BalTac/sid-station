use crate::models::ScanStats;
use crate::paths;
use anyhow::Result;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::WalkDir;

#[derive(Debug, Clone, Default)]
pub struct StilBlock {
    pub subtune: Option<i64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub author: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Musician {
    pub dir: String,
    pub handle: Option<String>,
    pub real_name: Option<String>,
    pub country: Option<String>,
    pub groups: Vec<String>,
    pub aliases: Vec<String>,
}


fn normalize_name(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

// ---------------------------------------------------------------- STIL

pub fn parse_stil(text: &str) -> HashMap<String, Vec<StilBlock>> {
    let mut out: HashMap<String, Vec<StilBlock>> = HashMap::new();
    let mut current_path: Option<String> = None;
    let mut blocks: Vec<StilBlock> = Vec::new();
    let mut current_block: Option<usize> = None;
    let mut current_field: Option<String> = None;

    let mut flush = |path: &mut Option<String>, blocks: &mut Vec<StilBlock>| {
        if let Some(p) = path.take() {
            if !blocks.is_empty() {
                out.insert(p, std::mem::take(blocks));
            }
        }
    };

    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('/') {
            flush(&mut current_path, &mut blocks);
            current_path = Some(line.trim().to_string());
            blocks.push(StilBlock::default());
            current_block = Some(0);
            current_field = None;
            continue;
        }
        if current_path.is_none() {
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("(#") && trimmed.ends_with(')') {
            let inner = &trimmed[2..trimmed.len() - 1];
            if let Ok(n) = inner.trim().parse::<i64>() {
                blocks.push(StilBlock {
                    subtune: Some(n),
                    ..Default::default()
                });
                current_block = Some(blocks.len() - 1);
                current_field = None;
                continue;
            }
        }
        let indent = line.len() - line.trim_start().len();
        let is_field = indent <= 2 && trimmed.contains(':');
        if is_field {
            let (name, value) = trimmed.split_once(':').unwrap();
            let name = name.trim().to_ascii_uppercase();
            if name.chars().all(|c| c.is_ascii_uppercase() || c == '_' || c == ' ') && !name.is_empty() {
                let value = value.trim().to_string();
                if let Some(idx) = current_block {
                    match name.as_str() {
                        "TITLE" => blocks[idx].title = Some(value),
                        "ARTIST" => blocks[idx].artist = Some(value),
                        "AUTHOR" => blocks[idx].author = Some(value),
                        "COMMENT" => blocks[idx].comment = Some(value),
                        _ => {}
                    }
                    current_field = Some(name);
                    continue;
                }
            }
        }
        // continuation line of the previous field
        if indent > 2 {
            if let (Some(idx), Some(field)) = (current_block, current_field.as_deref()) {
                let add = trimmed.trim().to_string();
                if add.is_empty() {
                    continue;
                }
                let slot = match field {
                    "TITLE" => &mut blocks[idx].title,
                    "ARTIST" => &mut blocks[idx].artist,
                    "AUTHOR" => &mut blocks[idx].author,
                    "COMMENT" => &mut blocks[idx].comment,
                    _ => continue,
                };
                match slot {
                    Some(existing) => {
                        if !existing.is_empty() {
                            existing.push(' ');
                        }
                        existing.push_str(&add);
                    }
                    None => *slot = Some(add),
                }
            }
        }
    }
    flush(&mut current_path, &mut blocks);
    out
}

// ---------------------------------------------------------------- Songlengths

fn parse_duration(token: &str) -> Option<f64> {
    let (min, rest) = token.split_once(':')?;
    let minutes: f64 = min.trim().parse().ok()?;
    let seconds: f64 = rest.trim().replace(',', ".").parse().ok()?;
    Some(minutes * 60.0 + seconds)
}

pub fn parse_songlengths(text: &str) -> HashMap<String, Vec<f64>> {
    let mut out = HashMap::new();
    let mut pending: Option<String> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        if let Some(path) = line.strip_prefix(';') {
            pending = Some(path.trim().to_string());
            continue;
        }
        let Some((_hash, value)) = line.split_once('=') else {
            continue;
        };
        let Some(path) = pending.take() else { continue };
        let durations: Vec<f64> = value
            .split_whitespace()
            .filter_map(parse_duration)
            .collect();
        if !durations.is_empty() {
            out.insert(path, durations);
        }
    }
    out
}

// ---------------------------------------------------------------- Musicians

fn split_country(line: &str) -> (String, Option<String>) {
    if let Some(idx) = line.rfind(" - ") {
        (
            line[..idx].trim().to_string(),
            Some(line[idx + 3..].trim().to_string()),
        )
    } else {
        (line.trim().to_string(), None)
    }
}

pub fn parse_musicians(text: &str) -> Vec<Musician> {
    let mut out = Vec::new();
    let mut in_list = false;
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.contains("SID Musicians in total") {
            in_list = true;
            continue;
        }
        if !in_list {
            continue;
        }
        if line.starts_with("****") {
            if !out.is_empty() {
                break;
            }
            continue;
        }
        if line.trim().is_empty() || line.trim_start().len() != line.len() {
            continue;
        }
        if line.contains(".....") || line.ends_with(':') {
            continue;
        }
        let (left, country) = split_country(line);
        if country.is_none() && !left.contains('/') {
            continue;
        }

        let mut parts = left.split(" / ").map(|s| s.trim().to_string());
        let person = parts.next().unwrap_or_default();
        let groups: Vec<String> = parts.filter(|s| !s.is_empty()).collect();

        let (head, paren) = match person.find('(') {
            Some(idx) => {
                let head = person[..idx].trim().to_string();
                let rest = person[idx..].trim();
                let rest = rest.trim_start_matches('(').trim_end_matches(')').trim();
                (head, Some(rest.to_string()))
            }
            None => (person.clone(), None),
        };

        let mut real_name = None;
        let mut aliases: Vec<String> = Vec::new();
        if let Some(paren) = paren {
            let mut main = paren.clone();
            // pull {alias, alias} groups out
            while let (Some(start), Some(end)) = (main.find('{'), main.find('}')) {
                if end > start {
                    let inner = &main[start + 1..end];
                    for a in inner.split(',') {
                        let a = a.trim();
                        if !a.is_empty() {
                            aliases.push(a.to_string());
                        }
                    }
                    main.replace_range(start..=end, "");
                } else {
                    break;
                }
            }
            let main = main.trim().trim_end_matches(',').trim();
            if !main.is_empty() {
                // "Last, First" style real names carry a comma and no digits.
                if main.contains(',') && !main.chars().any(|c| c.is_ascii_digit()) {
                    real_name = Some(main.to_string());
                } else {
                    aliases.push(main.to_string());
                }
            }
        }

        out.push(Musician {
            dir: String::new(),
            handle: Some(head),
            real_name,
            country,
            groups,
            aliases,
        });
    }
    out
}

fn build_musician_index(list: &[Musician]) -> HashMap<String, usize> {
    let mut index = HashMap::new();
    for (i, m) in list.iter().enumerate() {
        let mut keys: Vec<String> = Vec::new();
        if let Some(h) = &m.handle {
            keys.push(normalize_name(h));
        }
        if let Some(r) = &m.real_name {
            keys.push(normalize_name(r));
            if let Some((last, first)) = r.split_once(',') {
                keys.push(normalize_name(&format!("{}{}", first, last)));
                keys.push(normalize_name(&format!("{}_{}", last.trim(), first.trim())));
            }
        }
        for a in &m.aliases {
            keys.push(normalize_name(a));
        }
        for g in &m.groups {
            keys.push(normalize_name(g));
        }
        for k in keys {
            if k.len() >= 3 {
                index.entry(k).or_insert(i);
            }
        }
    }
    index
}

fn dir_basename(dir: &str) -> &str {
    dir.rsplit('/').next().unwrap_or(dir)
}

// ---------------------------------------------------------------- BUGlist

pub fn parse_buglist(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut pending: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('/') && trimmed.to_ascii_lowercase().ends_with(".sid") {
            pending = Some(trimmed.to_string());
            continue;
        }
        if let Some(path) = pending.as_ref() {
            if !trimmed.is_empty() && !trimmed.starts_with('-') && !trimmed.starts_with('=') {
                out.insert(path.clone(), trimmed.to_string());
                pending = None;
            }
        }
    }
    out
}

// ---------------------------------------------------------------- PSID header

#[derive(Debug, Clone)]
pub struct SidHeader {
    pub magic: String,
    pub version: u16,
    pub load_addr: u16,
    pub init_addr: u16,
    pub play_addr: u16,
    pub songs: u16,
    pub start_song: u16,
    pub clock: Option<String>,
    pub sid_model: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub released: Option<String>,
    pub is_rsid: bool,
}

fn cstr32(bytes: &[u8]) -> Option<String> {
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    let raw = &bytes[..end];
    if raw.is_empty() {
        return None;
    }
    let text = match std::str::from_utf8(raw) {
        Ok(v) => v.to_string(),
        Err(_) => {
            let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(raw);
            cow.into_owned()
        }
    };
    let s = text.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

pub fn parse_header(bytes: &[u8]) -> Result<SidHeader> {
    if bytes.len() < 0x76 {
        anyhow::bail!("file too short");
    }
    let magic = String::from_utf8_lossy(&bytes[0..4]).to_string();
    if magic != "PSID" && magic != "RSID" {
        anyhow::bail!("bad magic");
    }
    let be = |off: usize| u16::from_be_bytes([bytes[off], bytes[off + 1]]);
    let version = be(4);
    if version > 4 {
        anyhow::bail!("unsupported version {version}");
    }
    let load_addr = be(8);
    let init_addr = be(10);
    let play_addr = be(12);
    let songs = be(14).max(1);
    let start_song = be(16).max(1);

    let mut clock = None;
    let mut sid_model = None;
    if version >= 2 && bytes.len() >= 0x7A {
        let flags = be(0x76);
        clock = match (flags >> 2) & 0x3 {
            1 => Some("PAL".to_string()),
            2 => Some("NTSC".to_string()),
            3 => Some("PAL/NTSC".to_string()),
            _ => None,
        };
        sid_model = match (flags >> 4) & 0x3 {
            1 => Some("MOS6581".to_string()),
            2 => Some("MOS8580".to_string()),
            3 => Some("6581/8580".to_string()),
            _ => None,
        };
    }

    Ok(SidHeader {
        magic: magic.clone(),
        version,
        load_addr,
        init_addr,
        play_addr,
        songs,
        start_song,
        clock,
        sid_model,
        title: cstr32(&bytes[0x16..0x36]),
        author: cstr32(&bytes[0x36..0x56]),
        released: cstr32(&bytes[0x56..0x76]),
        is_rsid: magic == "RSID",
    })
}

// ---------------------------------------------------------------- Scan

pub fn scan(root: &Path, conn: &mut Connection, progress: &dyn Fn(i64, i64)) -> Result<ScanStats> {
    let started = Instant::now();
    let docs = root.join("DOCUMENTS");

    let stil = std::fs::read(docs.join("STIL.txt"))
        .ok()
        .map(|b| decode_bytes(&b))
        .map(|t| parse_stil(&t))
        .unwrap_or_default();
    let songlengths = std::fs::read(docs.join("Songlengths.md5"))
        .ok()
        .map(|b| decode_bytes(&b))
        .map(|t| parse_songlengths(&t))
        .unwrap_or_default();
    let musicians = std::fs::read(docs.join("Musicians.txt"))
        .ok()
        .map(|b| decode_bytes(&b))
        .map(|t| parse_musicians(&t))
        .unwrap_or_default();
    let buglist = std::fs::read(docs.join("BUGlist.txt"))
        .ok()
        .map(|b| decode_bytes(&b))
        .map(|t| parse_buglist(&t))
        .unwrap_or_default();

    let mut sid_paths: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            name != "documents" && name != "graphify-out" && !name.starts_with('.')
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .map(|e| e.eq_ignore_ascii_case("sid"))
                .unwrap_or(false)
        {
            sid_paths.push(entry.into_path());
        }
    }
    sid_paths.sort();
    let total = sid_paths.len() as i64;

    let tx = conn.transaction()?;
    tx.execute_batch(
        "DELETE FROM subtunes;
         DELETE FROM tunes;
         DELETE FROM musicians;
         DROP TABLE IF EXISTS tunes_fts;
         CREATE VIRTUAL TABLE tunes_fts USING fts5(
             title, artist, comment, content='', tokenize='trigram'
         );",
    )?;

    let mut stmt = tx.prepare(
        "INSERT INTO tunes (
            path, collection, bucket, composer_dir, filename, size, mtime, md5, format, version,
            songs, start_song, clock, sid_model, load_addr, init_addr, play_addr,
            hdr_title, hdr_author, hdr_released, title, artist, released, stil_comment,
            duration_total, is_buggy, bug_note, has_stil, stil_json
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29)",
    )?;
    let mut stmt_sub = tx.prepare(
        "INSERT INTO subtunes (tune_id, subtune, duration) VALUES (?1, ?2, ?3)",
    )?;
    let mut stmt_fts = tx.prepare(
        "INSERT INTO tunes_fts (rowid, title, artist, comment) VALUES (?1, ?2, ?3, ?4)",
    )?;

    let miss = std::sync::atomic::AtomicI64::new(0);
    let parsed = std::sync::atomic::AtomicI64::new(0);

    for (idx, path) in sid_paths.iter().enumerate() {
        let rel = match path.strip_prefix(root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                miss.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                continue;
            }
        };
        let key = format!("/{rel}");
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => {
                miss.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                continue;
            }
        };
        let header = match parse_header(&bytes) {
            Ok(h) => h,
            Err(_) => {
                miss.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                continue;
            }
        };
        let meta = std::fs::metadata(path).ok();
        let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(bytes.len() as i64);
        let mtime = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let mut comps = rel.split('/');
        let collection = comps.next().unwrap_or("").to_string();
        let bucket = comps.next().unwrap_or("").to_string();
        let filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let composer_dir = if collection == "MUSICIANS" {
            let parent = rel.rsplit_once('/').map(|(p, _)| p.to_string());
            parent
        } else {
            rel.rsplit_once('/').map(|(p, _)| p.to_string())
        };

        let blocks = stil.get(&key);
        let main_block = blocks.and_then(|b| {
            b.iter()
                .find(|x| x.subtune.is_none())
                .or_else(|| b.iter().find(|x| x.subtune == Some(1)))
        });
        let title = main_block
            .and_then(|b| b.title.clone())
            .or_else(|| header.title.clone())
            .unwrap_or_else(|| {
                filename
                    .trim_end_matches(".sid")
                    .trim_end_matches(".SID")
                    .replace('_', " ")
            });
        // The SID header author is who made this rip; STIL ARTIST names the
        // original composer of a cover, so it is only a fallback here.
        let header_author = header
            .author
            .clone()
            .filter(|a| !a.trim().is_empty() && a.trim() != "<?>");
        let artist = header_author
            .or_else(|| main_block.and_then(|b| b.artist.clone()))
            .unwrap_or_else(|| {
                composer_dir
                    .as_deref()
                    .map(dir_basename)
                    .unwrap_or("Unknown")
                    .replace('_', " ")
            });
        let released = header.released.clone();
        let comment = main_block.and_then(|b| b.comment.clone());

        let durations = songlengths.get(&key).cloned().unwrap_or_default();
        let duration_total: Option<f64> = if durations.is_empty() {
            None
        } else {
            Some(durations.iter().sum())
        };

        let bug_note = buglist.get(&key).cloned();
        let stil_json = blocks.map(|b| {
            let rows: Vec<crate::models::StilBlock> = b
                .iter()
                .map(|x| crate::models::StilBlock {
                    subtune: x.subtune,
                    title: x.title.clone(),
                    artist: x.artist.clone(),
                    author: x.author.clone(),
                    comment: x.comment.clone(),
                })
                .collect();
            serde_json::to_string(&rows).unwrap_or_default()
        });

        stmt.execute(params![
            rel,
            collection,
            bucket,
            composer_dir,
            filename,
            size,
            mtime,
            Option::<String>::None,
            header.magic,
            header.version as i64,
            header.songs as i64,
            header.start_song as i64,
            header.clock,
            header.sid_model,
            header.load_addr as i64,
            header.init_addr as i64,
            header.play_addr as i64,
            header.title,
            header.author,
            header.released,
            title,
            artist,
            released,
            comment,
            duration_total,
            bug_note.is_some() as i64,
            bug_note,
            blocks.is_some() as i64,
            stil_json,
        ])?;
        let tune_id = tx.last_insert_rowid();

        if !durations.is_empty() {
            for (i, d) in durations.iter().enumerate() {
                stmt_sub.execute(params![tune_id, (i + 1) as i64, d])?;
            }
        } else if header.songs > 1 {
            for i in 1..=header.songs as i64 {
                stmt_sub.execute(params![tune_id, i, Option::<f64>::None])?;
            }
        }
        let search_comment = blocks
            .map(|b| {
                b.iter()
                    .filter_map(|x| x.comment.clone())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();
        stmt_fts.execute(params![tune_id, title, artist, search_comment])?;

        parsed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if idx % 500 == 0 {
            progress(idx as i64, total);
        }
    }
    progress(total, total);
    drop(stmt);
    drop(stmt_sub);
    drop(stmt_fts);

    // musicians + per-composer aggregates
    let index = build_musician_index(&musicians);
    let mut stmt_mus = tx.prepare(
        "INSERT INTO musicians (dir, handle, real_name, country, groups, aliases, tune_count, total_seconds)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
    )?;
    let mut dir_agg: HashMap<String, (i64, f64)> = HashMap::new();
    {
        let mut q = tx.prepare(
            "SELECT composer_dir, COUNT(*), COALESCE(SUM(duration_total), 0) FROM tunes
             WHERE collection = 'MUSICIANS' AND composer_dir IS NOT NULL GROUP BY composer_dir",
        )?;
        let rows = q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, f64>(2)?,
            ))
        })?;
        for row in rows.flatten() {
            dir_agg.insert(row.0, (row.1, row.2));
        }
    }
    let mut inserted = 0i64;
    let mut known_dirs: HashMap<String, String> = HashMap::new();
    for (dir, (count, seconds)) in &dir_agg {
        let base = dir_basename(dir);
        let key = normalize_name(base);
        let m = index
            .get(&key)
            .and_then(|i| musicians.get(*i))
            .or_else(|| {
                // try first token of the dir, e.g. "Adrock_and_Deadeye"
                base.split('_')
                    .next()
                    .map(normalize_name)
                    .and_then(|k| index.get(&k))
                    .and_then(|i| musicians.get(*i))
            });
        let (handle, real_name, country, groups, aliases) = match m {
            Some(m) => (
                m.handle.clone(),
                m.real_name.clone(),
                m.country.clone(),
                serde_json::to_string(&m.groups).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&m.aliases).unwrap_or_else(|_| "[]".into()),
            ),
            None => (None, None, None, "[]".to_string(), "[]".to_string()),
        };
        stmt_mus.execute(params![dir, handle, real_name, country, groups, aliases, count, seconds])?;
        known_dirs.insert(dir.clone(), dir.clone());
        inserted += 1;
    }
    drop(stmt_mus);
    tx.commit()?;

    let version = paths::library_version(root);
    let declared = paths::declared_sid_count(root, version);
    let parsed_count = parsed.load(std::sync::atomic::Ordering::Relaxed);
    let skipped = miss.load(std::sync::atomic::Ordering::Relaxed);

    {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO tunes_fts (tunes_fts) VALUES('optimize')",
            [],
        )?;
        tx.commit()?;
    }

    Ok(ScanStats {
        scanned: total,
        parsed: parsed_count,
        skipped,
        stil_entries: stil.len() as i64,
        songlength_entries: songlengths.len() as i64,
        musicians: inserted,
        elapsed_ms: started.elapsed().as_millis(),
        version,
        sid_count_declared: declared,
    })
}

fn decode_bytes(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
            cow.into_owned()
        }
    }
}
