use crate::api::{lock, AppState};
use crate::db;
use crate::ingest;
use crate::models::{ScanStats, UpdateStatus};
use crate::paths;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Deserialize)]
pub struct Release {
    #[serde(default)]
    pub requiredversion: Option<u32>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VersionResponse {
    pub version: u32,
    #[serde(default)]
    pub update: Option<Release>,
    #[serde(default)]
    pub complete: Option<Release>,
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("SID-Station/0.1 (+local HVSC player)")
        .build()
        .map_err(|e| e.to_string())
}

pub fn fetch_version() -> Result<VersionResponse, String> {
    let client = http_client()?;
    let body = client
        .get("https://hvsc.c64.org/api/v1/version/7z")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("API hvsc.c64.org non raggiungibile: {e}"))?
        .text()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| format!("Invalid API response: {e}"))
}

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    pub phase: String,
    pub message: String,
    pub percent: Option<f32>,
    pub log_line: Option<String>,
}

fn emit(app: &AppHandle, phase: &str, message: &str, percent: Option<f32>) {
    let _ = app.emit(
        "update://progress",
        UpdateProgress {
            phase: phase.into(),
            message: message.into(),
            percent,
            log_line: None,
        },
    );
}

fn emit_log(app: &AppHandle, line: &str) {
    let _ = app.emit(
        "update://progress",
        UpdateProgress {
            phase: "log".into(),
            message: String::new(),
            percent: None,
            log_line: Some(line.to_string()),
        },
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReport {
    pub success: bool,
    pub message: String,
    pub version: Option<u32>,
    pub log: String,
    pub stats: Option<ScanStats>,
}

fn tool_path(app: &AppHandle) -> Option<PathBuf> {
    let candidates = [
        app.path().resource_dir().ok().map(|d| d.join("resources/7z/7z.exe")),
        app.path().resource_dir().ok().map(|d| d.join("7z/7z.exe")),
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.join("resources/7z/7z.exe"))),
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.join("7z/7z.exe"))),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/7z/7z.exe")),
        Some(PathBuf::from(r"C:\Program Files\7-Zip\7z.exe")),
    ];
    candidates.into_iter().flatten().find(|p| p.is_file())
}

fn download(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let client = http_client()?;
    let mut resp = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download failed: {e}"))?;
    let total = resp.content_length();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut written: u64 = 0;
    loop {
        let n = resp.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        written += n as u64;
        if let Some(total) = total {
            let percent = (written as f32 / total as f32) * 100.0;
            emit(app, "download", &format!("{:.0}%", percent), Some(percent));
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn run_process(
    app: &AppHandle,
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
) -> Result<(bool, String), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.env("HVSC_NO_PROMPT", "1");

    let mut child = cmd.spawn().map_err(|e| format!("Launch failed: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"y\ny\ny\ny\n");
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    let normalized = text.replace('\r', "\n");
    for line in normalized
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .take(600)
    {
        emit_log(app, line);
    }
    Ok((output.status.success(), text))
}

fn copy_dir(app: &AppHandle, from: &Path, to: &Path, done: &mut u64, total: u64) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in walkdir::WalkDir::new(from).into_iter().filter_map(|e| e.ok()) {
        let target = to.join(entry.path().strip_prefix(from).map_err(|e| e.to_string())?);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
            *done += 1;
            if *done % 2000 == 0 && total > 0 {
                let percent = (*done as f32 / total as f32) * 100.0;
                emit(app, "backup", &format!("backup {done}/{total}"), Some(percent));
            }
        }
    }
    Ok(())
}

fn copy_entry(
    app: &AppHandle,
    from: &Path,
    to: &Path,
    done: &mut u64,
    total: u64,
) -> Result<(), String> {
    if from.is_dir() {
        copy_dir(app, from, to, done, total)
    } else if from.is_file() {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(from, to).map_err(|e| e.to_string())?;
        *done += 1;
        Ok(())
    } else {
        Ok(())
    }
}

fn count_files(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .count() as u64
}

fn count_sids(root: &Path) -> u64 {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .map(|x| x.eq_ignore_ascii_case("sid"))
                    .unwrap_or(false)
        })
        .count() as u64
}

fn read_version(root: &Path) -> Option<u32> {
    paths::library_version(root)
}

#[tauri::command]
pub fn check_update(state: State<'_, AppState>) -> Result<UpdateStatus, String> {
    let current: Option<u32> = {
        let conn = lock(&state.db);
        db::meta(&conn, "version").and_then(|v| v.parse().ok())
    };

    let remote = match fetch_version() {
        Ok(v) => v,
        Err(err) => {
            return Ok(UpdateStatus {
                current_version: current,
                remote_version: None,
                required_version: None,
                download_url: None,
                complete_url: None,
                update_available: false,
                kind: "error".into(),
                message: err,
            })
        }
    };

    let required = remote.update.as_ref().and_then(|u| u.requiredversion);
    let update_url = remote.update.as_ref().and_then(|u| u.url.clone());
    let complete_url = remote.complete.as_ref().and_then(|u| u.url.clone());
    let available = current.map(|c| remote.version > c).unwrap_or(true);
    let kind = match (current, required) {
        (Some(c), Some(r)) if c == r => "incremental",
        (Some(_), Some(_)) => "full",
        (None, _) => "full",
        _ => "incremental",
    };

    Ok(UpdateStatus {
        current_version: current,
        remote_version: Some(remote.version),
        required_version: required,
        download_url: update_url,
        complete_url,
        update_available: available,
        kind: kind.into(),
        message: if available {
            match current {
                Some(c) => format!("Update available: {c} → {}", remote.version),
                None => format!("HVSC {} disponibile", remote.version),
            }
        } else {
            "Collection already up to date".into()
        },
    })
}

#[tauri::command(async)]
pub async fn apply_update(
    app: AppHandle,
    state: State<'_, AppState>,
    skip_backup: bool,
) -> Result<UpdateReport, String> {
    let db = state.db.clone();
    let updating = state.updating.clone();
    if updating.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err("An update is already running".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        apply_update_inner(&app, &db, skip_backup)
    })
    .await
    .map_err(|e| e.to_string())?;
    updating.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}

fn apply_update_inner(
    app: &AppHandle,
    db: &std::sync::Arc<std::sync::Mutex<Connection>>,
    skip_backup: bool,
) -> Result<UpdateReport, String> {
    let library = {
        let conn = lock(db);
        db::get_setting(&conn, "library_path").ok_or("Library not configured")?
    };
    let root = PathBuf::from(&library);
    if !paths::is_library(&root) {
        return Err("The configured library is not a valid HVSC collection".into());
    }
    let current = read_version(&root);
    let remote = fetch_version()?;
    emit(app, "check", "Remote version read", None);

    if current.map(|c| c >= remote.version).unwrap_or(false) {
        return Ok(UpdateReport {
            success: true,
            message: "No update needed".into(),
            version: current,
            log: String::new(),
            stats: None,
        });
    }

    let incremental = matches!(
        (current, remote.update.as_ref().and_then(|u| u.requiredversion)),
        (Some(c), Some(required)) if c == required
    );
    let url = if incremental {
        remote.update.as_ref().and_then(|u| u.url.clone())
    } else {
        remote.complete.as_ref().and_then(|u| u.url.clone())
    }
    .ok_or("The API does not expose a download URL")?;

    let archive = paths::data_dir().join("updates").join(format!(
        "HVSC_{}.7z",
        if incremental {
            format!("Update_{}", remote.version)
        } else {
            format!("{}-all", remote.version)
        }
    ));
    emit(app, "download", "Download del pacchetto…", Some(0.0));
    download(app, &url, &archive)?;

    let seven_zip = tool_path(app).ok_or(
        "7z.exe not found: reinstall SID Station or install 7-Zip",
    )?;

    let staging = paths::data_dir().join("staging");
    let _ = std::fs::remove_dir_all(&staging);

    let mut log = String::new();
    if incremental {
        // The official update script requires <collection>/update/.
        let update_dir = root.join("update");
        let _ = std::fs::remove_dir_all(&update_dir);
        emit(app, "extract", "Extracting into /update…", None);
        let status = run_process(
            app,
            &seven_zip,
            &[
                "x".into(),
                "-y".into(),
                format!("-o{}", update_dir.display()),
                archive.display().to_string(),
            ],
            None,
        )?;
        if !status.0 {
            return Err("Package extraction failed".into());
        }

        if !skip_backup {
            emit(app, "backup", "Backing up the collection…", Some(0.0));
            let backup = paths::data_dir().join("backup");
            let _ = std::fs::remove_dir_all(&backup);
            std::fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
            let total = ["MUSICIANS", "DEMOS", "GAMES", "DOCUMENTS"]
                .iter()
                .map(|d| count_files(&root.join(d)))
                .sum::<u64>();
            let mut done = 0u64;
            for part in ["MUSICIANS", "DEMOS", "GAMES", "DOCUMENTS", "readme.1st"] {
                let from = root.join(part);
                if from.exists() {
                    copy_entry(app, &from, &backup.join(part), &mut done, total)?;
                }
            }
            emit(app, "backup", "Backup complete", Some(100.0));
        }

        emit(app, "apply", "Running the HVS script…", None);
        let exe = update_dir.join("update.exe");
        if !exe.is_file() {
            return Err("update.exe missing from the package".into());
        }
        let (ok, output) = run_process(app, &exe, &[], Some(&update_dir))?;
        log.push_str(&output);
        if !ok || !output.contains("Update was successful") {
            emit(app, "verify", "Update failed, restoring backup", None);
            restore_backup(app, &root)?;
            return Ok(UpdateReport {
                success: false,
                message: "Lo script HVS ha riportato errori: backup ripristinato".into(),
                version: read_version(&root),
                log,
                stats: None,
            });
        }
        let _ = std::fs::remove_dir_all(&update_dir);
    } else {
        emit(app, "extract", "Extracting the full package…", None);
        let status = run_process(
            app,
            &seven_zip,
            &[
                "x".into(),
                "-y".into(),
                format!("-o{}", staging.display()),
                archive.display().to_string(),
            ],
            None,
        )?;
        if !status.0 {
            return Err("Full package extraction failed".into());
        }
        let new_root = if staging.join("C64Music").is_dir() {
            staging.join("C64Music")
        } else {
            staging.clone()
        };
        let new_version = read_version(&new_root);
        if new_version != Some(remote.version) {
            return Err(format!(
                "Il pacchetto estratto dichiara la versione {:?}, attesa {}",
                new_version, remote.version
            ));
        }
        if !skip_backup {
            emit(app, "backup", "Backing up the collection…", Some(0.0));
            let backup = paths::data_dir().join("backup");
            let _ = std::fs::remove_dir_all(&backup);
            std::fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
            let total = ["MUSICIANS", "DEMOS", "GAMES", "DOCUMENTS"]
                .iter()
                .map(|d| count_files(&root.join(d)))
                .sum::<u64>();
            let mut done = 0u64;
            for part in ["MUSICIANS", "DEMOS", "GAMES", "DOCUMENTS", "readme.1st"] {
                let from = root.join(part);
                if from.exists() {
                    copy_entry(app, &from, &backup.join(part), &mut done, total)?;
                }
            }
        }
        for part in ["MUSICIANS", "DEMOS", "GAMES", "DOCUMENTS", "readme.1st"] {
            let target = root.join(part);
            if target.is_dir() {
                std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
            } else if target.is_file() {
                std::fs::remove_file(&target).map_err(|e| e.to_string())?;
            }
            let source = new_root.join(part);
            if source.exists() {
                let mut done = 0u64;
                copy_entry(app, &source, &target, &mut done, 0)?;
            }
        }
        let _ = std::fs::remove_dir_all(&staging);
    }

    emit(app, "verify", "Verifica della nuova versione…", None);
    let new_version = read_version(&root);
    if new_version != Some(remote.version) {
        restore_backup(app, &root)?;
        return Ok(UpdateReport {
            success: false,
            message: format!("Verifica fallita: versione {:?}, attesa {}", new_version, remote.version),
            version: new_version,
            log,
            stats: None,
        });
    }
    let sids = count_sids(&root);
    emit(
        app,
        "verify",
        &format!("Version {} · {sids} SID", remote.version),
        None,
    );

    emit(app, "cleanup", "Removing backup and package…", None);
    let _ = std::fs::remove_dir_all(paths::data_dir().join("backup"));
    let _ = std::fs::remove_file(&archive);

    emit(app, "reindex", "Reindexing the library…", None);
    let stats = {
        let mut conn = lock(db);
        let progress = |processed: i64, total: i64| {
            let _ = app.emit(
                "ingest://progress",
                serde_json::json!({ "processed": processed, "total": total }),
            );
        };
        ingest::scan(&root, &mut conn, &progress).map_err(|e| e.to_string())?
    };
    {
        let conn = lock(db);
        let _ = db::set_meta(&conn, "version", &remote.version.to_string());
        let _ = db::set_meta(&conn, "sid_count", &stats.parsed.to_string());
        let _ = db::set_meta(
            &conn,
            "ingested_at",
            &std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
                .to_string(),
        );
        let _ = conn.execute(
            "INSERT INTO update_log (phase, status, detail) VALUES ('apply', 'ok', ?1)",
            [format!("HVSC {}", remote.version)],
        );
    }

    Ok(UpdateReport {
        success: true,
        message: format!(
            "Updated to HVSC {} ({} SID)",
            remote.version, stats.parsed
        ),
        version: Some(remote.version),
        log,
        stats: Some(stats),
    })
}

fn restore_backup(app: &AppHandle, root: &Path) -> Result<(), String> {
    let backup = paths::data_dir().join("backup");
    if !backup.is_dir() {
        return Ok(());
    }
    emit(app, "restore", "Restoring the backup…", Some(0.0));
    for part in ["MUSICIANS", "DEMOS", "GAMES", "DOCUMENTS", "readme.1st"] {
        let target = root.join(part);
        if target.is_dir() {
            let _ = std::fs::remove_dir_all(&target);
        } else if target.is_file() {
            let _ = std::fs::remove_file(&target);
        }
        let source = backup.join(part);
        if source.exists() {
            let mut done = 0u64;
            copy_entry(app, &source, &target, &mut done, 0)?;
        }
    }
    Ok(())
}
