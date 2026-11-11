import { invoke } from "@tauri-apps/api/core";

export interface BootInfo {
  libraryPath?: string | null;
  libraryVersion?: number | null;
  librarySidCount?: number | null;
  dbPath: string;
  tuneCount: number;
  ingestedAt?: string | null;
  engine: string;
  sidModel: string;
  clock: string;
  volume: number;
  romDir?: string | null;
}

export interface ScanStats {
  scanned: number;
  parsed: number;
  skipped: number;
  stilEntries: number;
  songlengthEntries: number;
  musicians: number;
  elapsedMs: number;
  version?: number | null;
  sidCountDeclared?: number | null;
}

export interface Node {
  key: string;
  label: string;
  subtitle?: string | null;
  country?: string | null;
  kind: string;
  count: number;
  hasChildren: boolean;
}

export interface TuneRow {
  id: number;
  path: string;
  filename: string;
  title: string;
  artist: string;
  released: string;
  collection: string;
  composerDir?: string | null;
  songs: number;
  clock?: string | null;
  sidModel?: string | null;
  format: string;
  durationTotal?: number | null;
  isBuggy: boolean;
  hasStil: boolean;
  /** RSID BASIC tune: needs C64 KERNAL/BASIC/CHARGEN ROMs to produce sound. */
  needsRoms: boolean;
}

export interface SubtuneRow {
  subtune: number;
  duration?: number | null;
}

export interface StilBlock {
  subtune?: number | null;
  title?: string | null;
  artist?: string | null;
  author?: string | null;
  comment?: string | null;
}

export interface ComposerInfo {
  dir: string;
  handle?: string | null;
  realName?: string | null;
  country?: string | null;
  groups: string[];
  aliases: string[];
  tuneCount: number;
  totalSeconds: number;
}

export interface TuneDetail extends TuneRow {
  hdrTitle?: string | null;
  hdrAuthor?: string | null;
  hdrReleased?: string | null;
  version: number;
  startSong: number;
  loadAddr?: number | null;
  initAddr?: number | null;
  playAddr?: number | null;
  md5?: string | null;
  size: number;
  stilComment?: string | null;
  stilBlocks: StilBlock[];
  subtunes: SubtuneRow[];
  composer?: ComposerInfo | null;
  bugNote?: string | null;
  inFavorites: boolean;
}

export interface TunePage {
  items: TuneRow[];
  total: number;
}

export interface TuneQuery {
  text?: string;
  node?: string | null;
  collection?: string | null;
  composerDir?: string | null;
  bucket?: string | null;
  sidModel?: string | null;
  clock?: string | null;
  format?: string | null;
  onlyStil?: boolean;
  onlyFavorites?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface Playlist {
  id: number;
  name: string;
  kind: string;
  count: number;
  createdAt: string;
}

export interface HistoryEntry {
  playedAt: string;
  subtune: number;
  tune: TuneRow;
}

export interface UpdateStatus {
  currentVersion?: number | null;
  remoteVersion?: number | null;
  requiredVersion?: number | null;
  downloadUrl?: string | null;
  completeUrl?: string | null;
  updateAvailable: boolean;
  kind: string;
  message: string;
}

export const api = {
  boot: () => invoke<BootInfo>("boot"),
  setLibrary: (path: string) => invoke<BootInfo>("set_library", { path }),
  detectLibrary: () => invoke<string | null>("detect_library"),
  scanLibrary: () => invoke<ScanStats>("scan_library"),
  browseNodes: (parent: string) => invoke<Node[]>("browse_nodes", { parent }),
  searchTunes: (q: TuneQuery) => invoke<TunePage>("search_tunes", { q }),
  tuneDetail: (id: number) => invoke<TuneDetail>("tune_detail", { id }),
  composerDetail: (dir: string) => invoke<ComposerInfo>("composer_detail", { dir }),
  readTune: (id: number) => invoke<ArrayBuffer>("read_tune", { id }),
  readRom: (kind: "kernal" | "basic" | "chargen") =>
    invoke<ArrayBuffer>("read_system_rom", { kind }),
  romReport: (dir?: string) =>
    invoke<RomReport>("rom_report", { dir: dir ?? null }),
  detectRomDirs: () => invoke<DetectedRomDir[]>("detect_rom_dirs"),

  listPlaylists: () => invoke<Playlist[]>("list_playlists"),
  createPlaylist: (name: string) => invoke<number>("create_playlist", { name }),
  renamePlaylist: (id: number, name: string) =>
    invoke<void>("rename_playlist", { id, name }),
  deletePlaylist: (id: number) => invoke<void>("delete_playlist", { id }),
  addToPlaylist: (playlistId: number, tunePath: string, subtune?: number) =>
    invoke<void>("add_to_playlist", { playlistId, tunePath, subtune: subtune ?? 1 }),
  removePlaylistItem: (itemId: number) => invoke<void>("remove_playlist_item", { itemId }),
  playlistItems: (playlistId: number) =>
    invoke<TunePage>("playlist_items", { playlistId }),
  toggleFavorite: (tunePath: string, on: boolean, subtune?: number) =>
    invoke<boolean>("toggle_favorite", { tunePath, on, subtune: subtune ?? 1 }),

  addHistory: (tunePath: string, subtune: number) =>
    invoke<void>("add_history", { tunePath, subtune }),
  listHistory: (limit = 100) => invoke<HistoryEntry[]>("list_history", { limit }),

  logError: (context: string, message: string) =>
    invoke<void>("log_error", { context, message }),
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  libraryStats: () =>
    invoke<{
      collections: { collection: string; count: number }[];
      composers: number;
      totalSeconds: number;
    }>("library_stats"),

  checkUpdate: () => invoke<UpdateStatus>("check_update"),
  applyUpdate: (skipBackup = false) =>
    invoke<{ success: boolean; message: string; version?: number | null; log: string }>(
      "apply_update",
      { skipBackup },
    ),
};

// ------------------------------------------------------------------ system ROMs

export interface RomCandidate {
  name: string;
  size: number;
  sha256: string | null;
  known: string | null;
  valid: boolean;
  problem: string | null;
}

export interface RomEntry {
  kind: "kernal" | "basic" | "chargen";
  expectedSize: number;
  found: boolean;
  path: string | null;
  name: string | null;
  size: number | null;
  sha256: string | null;
  /** Label of a digest known from the VICE distribution. */
  known: string | null;
  problem: string | null;
  candidates: RomCandidate[];
  duplicates: string[];
}

export interface RomReport {
  dir: string;
  dirExists: boolean;
  ready: boolean;
  roms: RomEntry[];
  warnings: string[];
}

export interface DetectedRomDir {
  dir: string;
  source: string;
  ready: boolean;
  missing: string[];
}
