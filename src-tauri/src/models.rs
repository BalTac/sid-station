use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    pub library_path: Option<String>,
    pub library_version: Option<u32>,
    pub library_sid_count: Option<u32>,
    pub db_path: String,
    pub tune_count: i64,
    pub ingested_at: Option<String>,
    pub engine: String,
    pub sid_model: String,
    pub clock: String,
    pub volume: f32,
    pub rom_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stat {
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    /// Stable key, e.g. "MUSICIANS", "MUSICIANS/A", "MUSICIANS/A/Agemixer"
    pub key: String,
    pub label: String,
    pub subtitle: Option<String>,
    pub country: Option<String>,
    pub kind: String,
    pub count: i64,
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TuneRow {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub title: String,
    pub artist: String,
    pub released: String,
    pub collection: String,
    pub composer_dir: Option<String>,
    pub songs: i64,
    pub clock: Option<String>,
    pub sid_model: Option<String>,
    pub format: String,
    pub duration_total: Option<f64>,
    pub is_buggy: bool,
    pub has_stil: bool,
    /// RSID v2+ BASIC tunes: libsidplayfp needs KERNAL/BASIC/CHARGEN ROMs to run them.
    pub needs_roms: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtuneRow {
    pub subtune: i64,
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StilBlock {
    pub subtune: Option<i64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub author: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TuneDetail {
    #[serde(flatten)]
    pub row: TuneRow,
    pub hdr_title: Option<String>,
    pub hdr_author: Option<String>,
    pub hdr_released: Option<String>,
    pub version: i64,
    pub start_song: i64,
    pub load_addr: Option<i64>,
    pub init_addr: Option<i64>,
    pub play_addr: Option<i64>,
    pub md5: Option<String>,
    pub size: i64,
    pub stil_comment: Option<String>,
    pub stil_blocks: Vec<StilBlock>,
    pub subtunes: Vec<SubtuneRow>,
    pub composer: Option<ComposerInfo>,
    pub bug_note: Option<String>,
    pub in_favorites: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerInfo {
    pub dir: String,
    pub handle: Option<String>,
    pub real_name: Option<String>,
    pub country: Option<String>,
    pub groups: Vec<String>,
    pub aliases: Vec<String>,
    pub tune_count: i64,
    pub total_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunePage {
    pub items: Vec<TuneRow>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub scanned: i64,
    pub parsed: i64,
    pub skipped: i64,
    pub stil_entries: i64,
    pub songlength_entries: i64,
    pub musicians: i64,
    pub elapsed_ms: u128,
    pub version: Option<u32>,
    pub sid_count_declared: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub played_at: String,
    pub subtune: i64,
    pub tune: TuneRow,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TuneQuery {
    pub text: String,
    pub node: Option<String>,
    pub collection: Option<String>,
    pub composer_dir: Option<String>,
    pub bucket: Option<String>,
    pub sid_model: Option<String>,
    pub clock: Option<String>,
    pub format: Option<String>,
    pub only_stil: bool,
    pub only_favorites: bool,
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: Option<u32>,
    pub remote_version: Option<u32>,
    pub required_version: Option<u32>,
    pub download_url: Option<String>,
    pub complete_url: Option<String>,
    pub update_available: bool,
    pub kind: String,
    pub message: String,
}
