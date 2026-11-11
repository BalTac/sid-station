pub mod api;
pub mod db;
pub mod ingest;
pub mod models;
pub mod paths;
pub mod roms;
pub mod update;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub fn run() {
    let db_path = paths::db_path();
    let conn = db::open(&db_path).unwrap_or_else(|e| panic!("cannot open {}: {e}", db_path.display()));

    let state = api::AppState {
        db: Arc::new(Mutex::new(conn)),
        scanning: Arc::new(AtomicBool::new(false)),
        updating: Arc::new(AtomicBool::new(false)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::boot,
            api::set_library,
            api::detect_library,
            api::scan_library,
            api::browse_nodes,
            api::search_tunes,
            api::composer_detail,
            api::tune_detail,
            api::read_tune,
            api::read_system_rom,
            api::list_playlists,
            api::create_playlist,
            api::rename_playlist,
            api::delete_playlist,
            api::add_to_playlist,
            api::remove_playlist_item,
            api::playlist_items,
            api::toggle_favorite,
            api::add_history,
            api::list_history,
            api::log_error,
            api::rom_report,
            api::detect_rom_dirs,
            api::get_settings,
            api::set_setting,
            api::library_stats,
            update::check_update,
            update::apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
