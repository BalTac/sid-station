import { create } from "zustand";
import { api, type BootInfo, type DetectedRomDir, type RomReport } from "../lib/api";
import { sidPlayer } from "../lib/audio";

export type View =
  | { kind: "browse" }
  | { kind: "composer"; dir: string }
  | { kind: "tune"; id: number }
  | { kind: "search"; text?: string }
  | { kind: "playlist"; id: number; name: string }
  | { kind: "favorites" }
  | { kind: "history" }
  | { kind: "settings" }
  | { kind: "update" };

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
}

export type RepeatMode = "off" | "all" | "one";

interface Settings {
  engine: "residfp" | "sidlite";
  sidModel: string;
  clock: string;
  volume: number;
  romDir?: string | null;
  repeatMode: RepeatMode;
  shuffle: boolean;
}

interface AppState {
  boot: BootInfo | null;
  ready: boolean;
  settings: Settings;
  view: View;
  history: View[];
  browseState: { collection: string; bucket: string; filter: string };
  searchState: { text: string; collection: string; sort: string; onlyStil: boolean };
  toasts: Toast[];
  scan: { running: boolean; processed: number; total: number } | null;
  /** Latest per-ROM diagnostics for the configured folder. */
  romReport: RomReport | null;
  romsBusy: boolean;
  /** Incremented after every successful ingest so views can re-query. */
  dataVersion: number;
  init: () => Promise<void>;
  refreshBoot: () => Promise<void>;
  navigate: (view: View) => void;
  back: () => void;
  setBrowseState: (patch: Partial<{ collection: string; bucket: string; filter: string }>) => void;
  setSearchState: (patch: Partial<{ text: string; collection: string; sort: string; onlyStil: boolean }>) => void;
  rescan: () => Promise<void>;
  setScanProgress: (p: { processed: number; total: number }) => void;
  chooseLibrary: (path: string) => Promise<void>;
  updateSetting: (key: string, value: string) => Promise<void>;
  loadRoms: (verbose?: boolean) => Promise<void>;
  detectRoms: (silent?: boolean) => Promise<DetectedRomDir | null>;
  toast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

const defaultSettings: Settings = {
  engine: "residfp",
  sidModel: "auto",
  clock: "auto",
  volume: 0.8,
  romDir: null,
  repeatMode: "all",
  shuffle: false,
};

export const useApp = create<AppState>((set, get) => ({
  boot: null,
  ready: false,
  settings: defaultSettings,
  view: { kind: "browse" },
  history: [],
  browseState: { collection: "MUSICIANS", bucket: "", filter: "" },
  searchState: { text: "", collection: "", sort: "relevance", onlyStil: false },
  toasts: [],
  scan: null,
  romReport: null,
  romsBusy: false,
  dataVersion: 0,

  init: async () => {
    try {
      const boot = await api.boot();
      const stored = await api.getSettings().catch(() => ({} as Record<string, string>));
      const repeat = stored["repeat_mode"];
      const settings: Settings = {
        engine: boot.engine === "sidlite" ? "sidlite" : "residfp",
        sidModel: boot.sidModel || "auto",
        clock: boot.clock || "auto",
        volume: boot.volume ?? 0.8,
        romDir: boot.romDir ?? null,
        repeatMode: repeat === "off" || repeat === "one" ? repeat : "all",
        shuffle: stored["shuffle"] === "1",
      };
      set({ boot, settings, ready: true });
      sidPlayer.setVolume(settings.volume);
      await get().loadRoms();
      if (!settings.romDir) {
        // Bounded background search: VICE / C64 Forever, only when unset.
        void get().detectRoms(true);
      }
      if (boot.libraryPath && boot.tuneCount === 0) {
        void get().rescan();
      }
    } catch (err) {
      set({ ready: true, boot: null });
      get().toast(`Startup failed: ${String(err)}`, "error");
    }
  },

  refreshBoot: async () => {
    try {
      const boot = await api.boot();
      set({ boot });
    } catch {
      /* ignore */
    }
  },

  navigate: (view) =>
    set((state) => ({
      view,
      searchState:
        view.kind === "search" && view.text !== undefined
          ? { ...state.searchState, text: view.text }
          : state.searchState,
      history:
        JSON.stringify(state.view) === JSON.stringify(view)
          ? state.history
          : [...state.history, state.view].slice(-60),
    })),

  back: () => {
    const history = [...get().history];
    const previous = history.pop();
    set({ history, view: previous ?? { kind: "browse" } });
  },

  setBrowseState: (patch) => set({ browseState: { ...get().browseState, ...patch } }),

  setSearchState: (patch) => set({ searchState: { ...get().searchState, ...patch } }),

  rescan: async () => {
    if (get().scan?.running) return;
    set({ scan: { running: true, processed: 0, total: 0 } });
    try {
      const stats = await api.scanLibrary();
      set({ scan: null, dataVersion: get().dataVersion + 1 });
      await get().refreshBoot();
      get().toast(
        `Library indexed: ${stats.parsed.toLocaleString("en-US")} SID in ${(
          stats.elapsedMs / 1000
        ).toFixed(1)} s`,
        "success",
      );
    } catch (err) {
      set({ scan: null });
      get().toast(`Scan failed: ${String(err)}`, "error");
    }
  },

  setScanProgress: (p) => {
    const scan = get().scan;
    set({ scan: scan ? { ...scan, ...p } : { running: true, ...p } });
  },

  chooseLibrary: async (path) => {
    try {
      const boot = await api.setLibrary(path);
      set({ boot });
      get().toast(`Library set: ${path}`, "success");
      await get().rescan();
    } catch (err) {
      get().toast(String(err), "error");
    }
  },

  updateSetting: async (key, value) => {
    const FIELD: Record<string, keyof Settings> = {
      engine: "engine",
      sid_model: "sidModel",
      clock: "clock",
      volume: "volume",
      rom_dir: "romDir",
      repeat_mode: "repeatMode",
      shuffle: "shuffle",
    };
    const field = FIELD[key] ?? (key as keyof Settings);
    const normalized: unknown = key === "shuffle" ? value === "1" : value;
    const settings = { ...get().settings, [field]: normalized } as Settings;
    set({ settings });
    try {
      await api.setSetting(key, String(value));
      if (key === "volume") sidPlayer.setVolume(Number(value));
      if (key === "engine") {
        sidPlayer.stop();
        await sidPlayer.init(settings.engine);
      } else if (key === "sid_model" || key === "clock") {
        await sidPlayer.setEmulation(settings.sidModel, settings.clock);
      } else if (key === "rom_dir") {
        await get().loadRoms(true);
      }
    } catch (err) {
      get().toast(String(err), "error");
    }
  },

  loadRoms: async (verbose = false) => {
    const romDir = get().settings.romDir;
    if (!romDir) {
      set({ romReport: null });
      await sidPlayer.setRoms(null);
      return;
    }
    set({ romsBusy: true });
    try {
      const report = await api.romReport(romDir);
      set({ romReport: report });
      if (!report.ready) {
        // Keep whatever the engine had out of the equation: no ROMs means no
        // half-configured state, and PSID tunes keep working as before.
        await sidPlayer.setRoms(null);
        if (verbose) {
          get().toast(
            `Incomplete C64 ROMs in ${romDir}: ${report.warnings[0] ?? "missing files"}`,
            "error",
          );
        }
        return;
      }
      const [kernal, basic, chargen] = await Promise.all([
        api.readRom("kernal"),
        api.readRom("basic"),
        api.readRom("chargen"),
      ]);
      await sidPlayer.setRoms({
        kernal: new Uint8Array(kernal),
        basic: new Uint8Array(basic),
        chargen: new Uint8Array(chargen),
      });
      const detail = sidPlayer.getRomDetail();
      const accepted = !!detail?.active && detail.kernal && detail.basic && detail.chargen;
      if (!accepted) {
        const missing = !detail
          ? "kernal, basic, chargen"
          : (["kernal", "basic", "chargen"] as const).filter((k) => !detail[k]).join(", ");
        get().toast(
          `The audio engine rejected the ROMs (missing: ${missing || "none"}). Check the three files: 8,192 + 8,192 + 4,096 bytes, not corrupted.`,
          "error",
        );
        return;
      }
      if (verbose) {
        const labels = report.roms.map((r) => r.known ?? r.name ?? r.kind);
        get().toast(`C64 ROMs loaded: ${labels.join(" · ")}`, "success");
      }
    } catch (err) {
      set({ romReport: null });
      await sidPlayer.setRoms(null).catch(() => undefined);
      get().toast(`ROM loading failed: ${String(err)}`, "error");
    } finally {
      set({ romsBusy: false });
    }
  },

  detectRoms: async (silent = false) => {
    try {
      const found = await api.detectRomDirs();
      const best = found.find((f) => f.ready) ?? null;
      if (best) {
        if (get().settings.romDir !== best.dir) {
          await get().updateSetting("rom_dir", best.dir);
        }
        if (!silent) {
          get().toast(`C64 ROMs found in ${best.dir} (${best.source})`, "success");
        }
        return best;
      }
      if (!silent) {
        get().toast(
          found.length > 0
            ? `Incomplete ROM folders found: ${found
                .slice(0, 3)
                .map((f) => f.dir)
                .join(", ")}. Pick the right one or choose the folder manually.`
            : "No VICE or C64 Forever installation found. Select the folder containing kernal, basic and chargen.",
          "info",
        );
      }
      return null;
    } catch (err) {
      if (!silent) get().toast(`ROM search failed: ${String(err)}`, "error");
      return null;
    }
  },

  toast: (message, kind = "info") => {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, message, kind }] });
    window.setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast: (id) =>
    set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function useSettings() {
  return useApp((s) => s.settings);
}
