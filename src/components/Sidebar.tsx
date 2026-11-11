import { useEffect, useState } from "react";
import { api, type Playlist } from "../lib/api";
import { useApp } from "../state/app";
import { Icon } from "./Icon";

interface NavItem {
  label: string;
  icon: "browse" | "search" | "heart" | "list" | "clock" | "settings" | "download";
  view: Parameters<ReturnType<typeof useApp.getState>["navigate"]>[0];
}

const nav: NavItem[] = [
  { label: "Browse", icon: "browse", view: { kind: "browse" } },
  { label: "Search", icon: "search", view: { kind: "search" } },
  { label: "Favorites", icon: "heart", view: { kind: "favorites" } },
  { label: "History", icon: "clock", view: { kind: "history" } },
  { label: "Updates", icon: "download", view: { kind: "update" } },
  { label: "Settings", icon: "settings", view: { kind: "settings" } },
];

export function Sidebar() {
  const { view, navigate, boot, scan, rescan } = useApp();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    api.listPlaylists().then(setPlaylists).catch(() => setPlaylists([]));
  }, [view, boot?.tuneCount]);

  const isActive = (target: NavItem["view"]) => {
    if (target.kind === view.kind) return true;
    if (view.kind === "playlist" && target.kind === "favorites") return false;
    return false;
  };

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-panel/70">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="glow flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-white">
          <Icon name="wave" className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[0.18em] text-white">SID STATION</div>
          <div className="truncate text-[11px] text-muted">
            {boot?.libraryVersion ? `HVSC #${boot.libraryVersion}` : "library not set"}
            {boot?.tuneCount ? ` · ${boot.tuneCount.toLocaleString("en-US")} SID` : ""}
          </div>
        </div>
      </div>

      <nav className="space-y-1 px-3">
        {nav.map((item) => (
          <button
            key={item.label}
            onClick={() => navigate(item.view)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              isActive(item.view)
                ? "bg-accent/15 text-white"
                : "text-muted hover:bg-white/[0.04] hover:text-soft"
            }`}
          >
            <Icon name={item.icon} className="h-4.5 w-4.5" />
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-6 flex items-center justify-between px-5 pb-2">
        <span className="text-[11px] font-medium tracking-wider text-muted uppercase">Playlist</span>
        <button
          className="btn-ghost !p-1"
          title="New playlist"
          onClick={async () => {
            const name = window.prompt("Playlist name");
            if (name) {
              await api.createPlaylist(name);
              const list = await api.listPlaylists();
              setPlaylists(list);
            }
          }}
        >
          <Icon name="plus" className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-3 pb-4">
        {playlists.length === 0 && (
          <p className="px-2 text-xs text-muted/70">No playlists yet</p>
        )}
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() =>
              navigate(
                p.kind === "favorites"
                  ? { kind: "favorites" }
                  : { kind: "playlist", id: p.id, name: p.name },
              )
            }
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
              (view.kind === "playlist" && view.id === p.id) ||
              (view.kind === "favorites" && p.kind === "favorites")
                ? "bg-white/[0.07] text-white"
                : "text-muted hover:bg-white/[0.04] hover:text-soft"
            }`}
          >
            <Icon name={p.kind === "favorites" ? "heart" : "list"} className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="font-mono text-[10px] text-muted/80">{p.count}</span>
          </button>
        ))}
      </div>

      <div className="border-t border-line/80 px-4 py-3">
        {scan ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>Indexing…</span>
              <span className="font-mono">
                {scan.total > 0
                  ? `${Math.round((scan.processed / scan.total) * 100)}%`
                  : "…"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-all"
                style={{
                  width: scan.total > 0 ? `${(scan.processed / scan.total) * 100}%` : "10%",
                }}
              />
            </div>
          </div>
        ) : (
          <button
            className="btn w-full !justify-start text-xs"
            onClick={() => void rescan()}
            title="Re-reads STIL, Songlengths and headers for every SID"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Reindex library
          </button>
        )}
        <p className="mt-2 truncate text-[10px] text-muted/60" title={boot?.dbPath}>
          Portable DB · {boot?.dbPath?.split(/[\\/]/).slice(-2).join("/")}
        </p>
      </div>
    </aside>
  );
}
