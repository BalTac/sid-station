import { useEffect, useState, type FormEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { Toasts } from "./components/Toasts";
import { BrowsePage, ComposerPage } from "./pages/BrowsePage";
import { SearchPage } from "./pages/SearchPage";
import { TunePage } from "./pages/TunePage";
import { FavoritesPage, HistoryPage, PlaylistPage } from "./pages/LibraryPages";
import { SettingsPage } from "./pages/SettingsPage";
import { UpdatePage } from "./pages/UpdatePage";
import { useApp } from "./state/app";
import { usePlayer } from "./state/player";
import { api } from "./lib/api";
import { sidPlayer } from "./lib/audio";
import { Icon } from "./components/Icon";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  const { ready, init, view, navigate, boot, scan, setScanProgress } = useApp();
  const [quick, setQuick] = useState("");

  useEffect(() => {
    void init();
    sidPlayer.setCallbacks({
      onTime: (ms) => usePlayer.getState().setTime(ms),
      onState: (state) => {
        if (state === "playing") usePlayer.getState().setPlaying(true);
        if (state === "paused" || state === "idle") usePlayer.getState().setPlaying(false);
      },
      onEnded: () => void usePlayer.getState().handleEnded(),
      onError: (message) => useApp.getState().toast(message, "error"),
      onRomStatus: (status) => usePlayer.getState().setRomActive(status.active),
      onFatal: (message) => {
        const current = usePlayer.getState().current;
        const title = current?.title ?? "this tune";
        usePlayer.getState().setPlaying(false);
        void api
          .logError(`${current?.path ?? "?"} | ${current?.format ?? "?"}`, message)
          .catch(() => undefined);
        useApp
          .getState()
          .toast(
            `Audio engine error on “${title}”: ${message}. Playback stopped; retry or skip to the next tune.`,
            "error",
          );
      },
    });
  }, [init]);

  useEffect(() => {
    const unlisten = listen<{ processed: number; total: number }>("ingest://progress", (event) => {
      setScanProgress(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [setScanProgress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("quick-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submitQuick = (e: FormEvent) => {
    e.preventDefault();
    if (quick.trim()) navigate({ kind: "search", text: quick.trim() });
  };

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          Starting SID Station…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line/60 px-6 py-2.5">
            <form onSubmit={submitQuick} className="relative w-72">
              <Icon
                name="search"
                className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-muted/70"
              />
              <input
                id="quick-search"
                className="input !py-1.5 pl-8 text-xs"
                placeholder="Search a SID…  (Ctrl+K)"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
              />
            </form>
            <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
              {scan && (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                  indexing {scan.total > 0 ? `${Math.round((scan.processed / scan.total) * 100)}%` : ""}
                </span>
              )}
              {!boot?.libraryPath && (
                <button className="btn !py-1 text-xs" onClick={() => navigate({ kind: "settings" })}>
                  Set up HVSC library
                </button>
              )}
              <span className="font-mono">SID Station 0.1</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <ErrorBoundary key={JSON.stringify(view)}>
            {view.kind === "browse" && <BrowsePage />}
            {view.kind === "composer" && <ComposerPage dir={view.dir} />}
            {view.kind === "tune" && <TunePage id={view.id} />}
            {view.kind === "search" && <SearchPage initialText={view.text} />}
            {view.kind === "favorites" && <FavoritesPage />}
            {view.kind === "playlist" && <PlaylistPage id={view.id} name={view.name} />}
            {view.kind === "history" && <HistoryPage />}
            {view.kind === "settings" && <SettingsPage />}
            {view.kind === "update" && <UpdatePage />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <PlayerBar />
      <Toasts />
    </div>
  );
}
