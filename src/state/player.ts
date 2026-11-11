import { create } from "zustand";
import { api, type TuneDetail, type TuneRow } from "../lib/api";
import { sidPlayer } from "../lib/audio";
import { useApp } from "./app";

interface PlayerState {
  current: TuneDetail | null;
  subtune: number;
  playing: boolean;
  loading: boolean;
  timeMs: number;
  durationMs: number;
  queue: TuneRow[];
  queueIndex: number;
  queueSig: string;
  /** Indices already played in the current shuffle pass. */
  shuffleSeen: number[];
  romActive: boolean | null;

  playTune: (
    id: number,
    subtune?: number,
    queue?: TuneRow[],
    index?: number,
    manual?: boolean,
  ) => Promise<void>;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  /** Called when a tune reaches its Songlengths duration. */
  handleEnded: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  selectSubtune: (n: number) => Promise<void>;
  setVolume: (v: number) => Promise<void>;
  toggleFavorite: () => Promise<void>;
  setPlaying: (v: boolean) => void;
  setTime: (ms: number) => void;
  setRomActive: (v: boolean | null) => void;
  clear: () => void;
}

function durationFor(detail: TuneDetail, subtune: number): number {
  const row = detail.subtunes.find((s) => s.subtune === subtune);
  const seconds = row?.duration ?? detail.durationTotal ?? 0;
  return (seconds ?? 0) * 1000;
}

const warnedRoms = new Set<string>();

function pickNextIndex(length: number, current: number, shuffle: boolean): number {
  if (!shuffle || length <= 1) return (current + 1) % length;
  // Random, never the same track twice in a row.
  let index = current;
  while (index === current) {
    index = Math.floor(Math.random() * length);
  }
  return index;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  subtune: 1,
  playing: false,
  loading: false,
  timeMs: 0,
  durationMs: 0,
  queue: [],
  queueIndex: -1,
  queueSig: "",
  shuffleSeen: [],
  romActive: null,

  playTune: async (id, subtune, queue, index, manual = true) => {
    const app = useApp.getState();
    set({ loading: true });
    try {
      const settings = app.settings;
      await sidPlayer.init(settings.engine);
      const [detail, buffer] = await Promise.all([api.tuneDetail(id), api.readTune(id)]);
      const sub = subtune ?? detail.startSong ?? 1;
      const durationMs = durationFor(detail, sub);
      await sidPlayer.load(new Uint8Array(buffer), {
        subtune: sub,
        model: settings.sidModel,
        clock: settings.clock,
        durationMs,
      });
      await sidPlayer.play();
      const nextQueue = queue ?? [];
      const sig = nextQueue.map((t) => t.id).join(",");
      const sameQueue = sig === get().queueSig;
      const idx = index ?? -1;
      let shuffleSeen: number[];
      if (!sameQueue) {
        shuffleSeen = idx >= 0 ? [idx] : [];
      } else if (manual) {
        shuffleSeen = idx >= 0 ? [idx] : [];
      } else {
        shuffleSeen = [...new Set([...get().shuffleSeen, idx])];
      }
      set({
        current: detail,
        subtune: sub,
        durationMs,
        timeMs: 0,
        playing: true,
        loading: false,
        queue: nextQueue,
        queueIndex: idx,
        queueSig: sig,
        shuffleSeen,
        romActive: sidPlayer.getRomStatus(),
      });
      void api.addHistory(detail.path, sub);
      document.title = `${detail.title} — SID Station`;
      if (detail.needsRoms && sidPlayer.getRomStatus() !== true && !warnedRoms.has(detail.path)) {
        warnedRoms.add(detail.path);
        app.toast(
          "BASIC/RSID tune: without the C64 ROMs (kernal, basic, chargen) it stays silent. Add them in Settings.",
          "info",
        );
      }
    } catch (err) {
      set({ loading: false, playing: false });
      app.toast(`Playback failed: ${String(err)}`, "error");
    }
  },

  toggle: async () => {
    if (!get().current) {
      const q = get().queue;
      if (q.length > 0) {
        await get().playTune(q[0].id, 1, q, 0);
      }
      return;
    }
    if (get().playing) {
      sidPlayer.pause();
      set({ playing: false });
    } else {
      await sidPlayer.play();
      set({ playing: true });
    }
  },

  next: async () => {
    const { queue, queueIndex, current } = get();
    const { shuffle } = useApp.getState().settings;
    if (queue.length > 0) {
      const nextIndex = pickNextIndex(queue.length, queueIndex, shuffle);
      await get().playTune(queue[nextIndex].id, 1, queue, nextIndex);
      return;
    }
    if (current && current.subtunes.length > 1) {
      const list = current.subtunes.map((s) => s.subtune);
      const pos = list.indexOf(get().subtune);
      const nextSub = list[(pos + 1) % list.length];
      await get().selectSubtune(nextSub);
      return;
    }
    // Manual "next" on a single tune restarts it.
    await get().seek(0);
  },

  handleEnded: async () => {
    const { queue, queueIndex, current } = get();
    const { repeatMode, shuffle } = useApp.getState().settings;

    // Repeat one: replay the same tune (or the same subtune).
    if (repeatMode === "one") {
      await get().seek(0);
      return;
    }

    if (queue.length > 0) {
      if (shuffle) {
        const seenAll = new Set([...get().shuffleSeen, queueIndex]);
        const remaining = Array.from({ length: queue.length }, (_, i) => i).filter(
          (i) => !seenAll.has(i),
        );
        if (remaining.length === 0 && repeatMode === "off") {
          sidPlayer.pause();
          set({ playing: false, shuffleSeen: [] });
          await get().seek(0);
          return;
        }
        const pool = remaining.length > 0 ? remaining : Array.from({ length: queue.length }, (_, i) => i);
        const nextIndex = pool[Math.floor(Math.random() * pool.length)];
        await get().playTune(queue[nextIndex].id, 1, queue, nextIndex, false);
        return;
      }
      const nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeatMode === "off") {
          sidPlayer.pause();
          set({ playing: false });
          await get().seek(0);
          return;
        }
        await get().playTune(queue[0].id, 1, queue, 0, false);
        return;
      }
      await get().playTune(queue[nextIndex].id, 1, queue, nextIndex, false);
      return;
    }

    if (current && current.subtunes.length > 1) {
      const list = current.subtunes.map((s) => s.subtune);
      const pos = list.indexOf(get().subtune);
      const last = pos === list.length - 1;
      if (repeatMode === "off" && last) {
        sidPlayer.pause();
        set({ playing: false });
        await get().seek(0);
        return;
      }
      await get().selectSubtune(list[(pos + 1) % list.length]);
      return;
    }

    if (repeatMode === "all") {
      await get().seek(0);
      return;
    }
    sidPlayer.pause();
    set({ playing: false });
    await get().seek(0);
  },

  prev: async () => {
    const { queue, queueIndex } = get();
    if (queue.length > 0 && queueIndex > 0) {
      await get().playTune(queue[queueIndex - 1].id, 1, queue, queueIndex - 1);
      return;
    }
    if (get().timeMs > 3000) {
      await get().seek(0);
    }
  },

  seek: async (ms) => {
    await sidPlayer.seek(ms);
    set({ timeMs: ms });
  },

  selectSubtune: async (n) => {
    const current = get().current;
    if (!current) return;
    const wasPlaying = get().playing;
    await sidPlayer.selectSong(n);
    set({ subtune: n, durationMs: durationFor(current, n), timeMs: 0 });
    if (wasPlaying) {
      await sidPlayer.play();
      set({ playing: true });
    }
  },

  setVolume: async (v) => {
    sidPlayer.setVolume(v);
  },

  toggleFavorite: async () => {
    const current = get().current;
    if (!current) return;
    const app = useApp.getState();
    try {
      const on = await api.toggleFavorite(current.path, !current.inFavorites, get().subtune);
      set({ current: { ...current, inFavorites: on } });
      app.toast(on ? "Added to favorites" : "Removed from favorites", "success");
    } catch (err) {
      app.toast(String(err), "error");
    }
  },

  setPlaying: (v) => set({ playing: v }),
  setTime: (ms) => set({ timeMs: ms }),
  setRomActive: (v) => set({ romActive: v }),
  clear: () => set({ current: null, playing: false, timeMs: 0, durationMs: 0 }),
}));

