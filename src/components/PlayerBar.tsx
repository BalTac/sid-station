import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../state/player";
import { formatMs, formatTime } from "../lib/format";
import { Icon } from "./Icon";
import { Waveform } from "./Waveform";
import { useApp } from "../state/app";

export function PlayerBar() {
  const {
    current,
    playing,
    loading,
    timeMs,
    durationMs,
    subtune,
    toggle,
    next,
    prev,
    seek,
    selectSubtune,
    toggleFavorite,
  } = usePlayer();
  const volume = useApp((s) => s.settings.volume);
  const romActive = usePlayer((s) => s.romActive);
  const repeatMode = useApp((s) => s.settings.repeatMode);
  const shuffle = useApp((s) => s.settings.shuffle);
  const updateSetting = useApp((s) => s.updateSetting);
  const navigate = useApp((s) => s.navigate);
  const [drag, setDrag] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const displayed = drag ?? timeMs;
  const progress = durationMs > 0 ? Math.min(1, displayed / durationMs) : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        void toggle();
      } else if (e.code === "ArrowRight" && e.shiftKey) {
        void seek(Math.min(durationMs, timeMs + 5000));
      } else if (e.code === "ArrowLeft" && e.shiftKey) {
        void seek(Math.max(0, timeMs - 5000));
      } else if (e.key === "n") {
        void next();
      } else if (e.key === "p") {
        void prev();
      } else if (e.key === "r") {
        void updateSetting(
          "repeat_mode",
          repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off",
        );
      } else if (e.key === "s") {
        void updateSetting("shuffle", shuffle ? "0" : "1");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, next, prev, timeMs, durationMs, repeatMode, shuffle, updateSetting]);

  const seekTo = (clientX: number) => {
    const el = barRef.current;
    if (!el || durationMs <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setDrag(ratio * durationMs);
  };

  return (
    <footer className="grid shrink-0 grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,300px)] items-center gap-6 border-t border-line bg-panel/90 px-5 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={() => current && navigate({ kind: "tune", id: current.id })}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-gradient-to-br from-accent/30 via-panel2 to-accent2/20"
          title="Open details"
        >
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Icon name="chip" className="h-6 w-6" />
          </div>
          <div className="absolute inset-x-0 bottom-0">
            <Waveform playing={playing} />
          </div>
        </button>
        <div className="min-w-0">
          <button
            className="block max-w-full truncate text-left text-sm font-medium text-white hover:text-accent2"
            onClick={() => current && navigate({ kind: "tune", id: current.id })}
          >
            {current ? current.title : "No tune selected"}
          </button>
          <div className="truncate text-xs text-muted">
            {current ? current.artist : "Pick a SID to get started"}
            {current && current.songs > 1 ? ` · ${current.songs} sub` : ""}
          </div>
          {current && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {current.sidModel && (
                <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {current.sidModel.replace("MOS", "")}
                </span>
              )}
              {current.clock && (
                <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {current.clock}
                </span>
              )}
              {current.format === "RSID" && (
                <span className="rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[10px] text-gold">
                  RSID
                </span>
              )}
              {current.needsRoms && (
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                  BASIC
                </span>
              )}
              {current.needsRoms && romActive !== true && (
                <button
                  className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-amber-300 hover:bg-amber-500/25"
                  onClick={() => navigate({ kind: "settings" })}
                  title="C64 ROMs are missing (kernal, basic, chargen): BASIC tunes stay silent. Click to configure them."
                >
                  ROMs missing
                </button>
              )}
            </div>
          )}
        </div>
        <button
          className={`btn-ghost ml-auto ${current?.inFavorites ? "text-rose-400" : ""}`}
          onClick={() => void toggleFavorite()}
          title="Favorite"
          disabled={!current}
        >
          <Icon name="heart" className="h-4.5 w-4.5" />
        </button>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <button
            className={`btn-ghost ${shuffle ? "text-accent2" : "text-muted"}`}
            onClick={() => void updateSetting("shuffle", shuffle ? "0" : "1")}
            title={shuffle ? "Shuffle: on" : "Shuffle: off"}
          >
            <Icon name="shuffle" className="h-4 w-4" />
          </button>
          <button className="btn-ghost" onClick={() => void prev()} title="Previous">
            <Icon name="prev" className="h-4 w-4" />
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink transition-transform hover:scale-105 disabled:opacity-40"
            onClick={() => void toggle()}
            disabled={loading}
            title="Play / Pause (space)"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
            ) : (
              <Icon name={playing ? "pause" : "play"} className="h-4 w-4" />
            )}
          </button>
          <button className="btn-ghost" onClick={() => void next()} title="Next">
            <Icon name="next" className="h-4 w-4" />
          </button>
          <button
            className={`btn-ghost ${repeatMode === "off" ? "text-muted" : "text-accent2"}`}
            onClick={() =>
              void updateSetting(
                "repeat_mode",
                repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off",
              )
            }
            title={
              repeatMode === "off"
                ? "Repeat: off"
                : repeatMode === "all"
                  ? "Repeat: queue and single-tune loop"
                  : "Repeat: single tune"
            }
          >
            <Icon
              name={repeatMode === "one" ? "repeat-one" : "repeat"}
              className="h-4 w-4"
            />
          </button>
          {current && current.subtunes.length > 1 && (
            <select
              className="ml-2 rounded-lg border border-line bg-panel2 px-2 py-1 font-mono text-[11px] text-soft"
              value={subtune}
              onChange={(e) => void selectSubtune(Number(e.target.value))}
              title="Subtune"
            >
              {current.subtunes.map((s) => (
                <option key={s.subtune} value={s.subtune}>
                  #{s.subtune}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex w-full items-center gap-2">
          <span className="w-10 text-right font-mono text-[10px] text-muted">
            {formatMs(displayed)}
          </span>
          <div
            ref={barRef}
            className="group relative h-4 flex-1 cursor-pointer"
            onPointerDown={(e) => {
              setDrag(null);
              seekTo(e.clientX);
              const move = (ev: PointerEvent) => seekTo(ev.clientX);
              const up = (ev: PointerEvent) => {
                const el = barRef.current;
                if (el && durationMs > 0) {
                  const rect = el.getBoundingClientRect();
                  const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
                  void seek(ratio * durationMs);
                }
                setDrag(null);
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent2 via-accent to-gold"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div
              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover:opacity-100"
              style={{ left: `calc(${progress * 100}% - 5px)` }}
            />
          </div>
          <span className="w-10 font-mono text-[10px] text-muted">
            {durationMs > 0 ? formatMs(durationMs) : "--:--"}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Icon name="volume" className="h-4 w-4 text-muted" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => void updateSetting("volume", e.target.value)}
          className="h-1 w-24 accent-[var(--color-accent)]"
          title={`Volume ${Math.round(volume * 100)}%`}
        />
        {current && (
          <span className="hidden font-mono text-[10px] text-muted/70 xl:block">
            {formatTime(current.durationTotal)}
          </span>
        )}
      </div>
    </footer>
  );
}
