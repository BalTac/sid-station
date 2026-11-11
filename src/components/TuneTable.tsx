import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TuneRow } from "../lib/api";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { formatTime, yearOf } from "../lib/format";
import { Icon } from "./Icon";
import { useVirtualizer } from "@tanstack/react-virtual";

interface Props {
  tunes: TuneRow[];
  onPlay?: (tune: TuneRow) => void;
  emptyLabel?: string;
  /** When set, rows can be removed from this playlist (row id = playlist item id). */
  playlistId?: number;
  onChanged?: () => void;
}

export function TuneTable({ tunes, onPlay, emptyLabel = "No tunes", playlistId, onChanged }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const romActive = usePlayer((s) => s.romActive);
  const playTune = usePlayer((s) => s.playTune);
  const navigate = useApp((s) => s.navigate);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (menuFor !== null) {
      api.listPlaylists().then((list) => setPlaylists(list.filter((p) => p.kind !== "favorites")));
    }
  }, [menuFor]);

  const virtualizer = useVirtualizer({
    count: tunes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 14,
  });

  const gridTemplate = useMemo(
    () => "grid grid-cols-[38px_minmax(0,3.2fr)_minmax(0,2fr)_64px_48px_66px_34px] items-center gap-2",
    [],
  );

  if (tunes.length === 0) {
    return <div className="px-6 py-10 text-sm text-muted">{emptyLabel}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`${gridTemplate} border-b border-line/80 px-4 pb-2 text-[11px] font-medium tracking-wide text-muted uppercase`}>
        <span />
        <span>Title</span>
        <span>Artist</span>
        <span>Year</span>
        <span className="text-right">Sub</span>
        <span className="text-right">Length</span>
        <span />
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const tune = tunes[item.index];
            const active = current?.id === tune.id;
            return (
              <div
                key={tune.id}
                data-testid="tune-row"
                className={`${gridTemplate} absolute left-0 w-full px-4 text-sm ${
                  active ? "bg-accent/12 text-white" : "text-soft hover:bg-white/[0.04]"
                }`}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                onDoubleClick={() => {
                  if (onPlay) onPlay(tune);
                  else playTune(tune.id, 1, tunes, item.index);
                }}
              >
                <button
                  data-testid="play-tune"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-white"
                  onClick={() => {
                    if (onPlay) onPlay(tune);
                    else playTune(tune.id, 1, tunes, item.index);
                  }}
                  title="Play"
                >
                  <Icon
                    name={active && playing ? "pause" : "play"}
                    className="h-3.5 w-3.5"
                  />
                </button>
                <button
                  className="min-w-0 truncate text-left"
                  onClick={() => navigate({ kind: "tune", id: tune.id })}
                  title={tune.path}
                >
                  <span className={active ? "text-accent2" : ""}>{tune.title}</span>
                  {tune.isBuggy && (
                    <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                      bug
                    </span>
                  )}
                  {tune.needsRoms && romActive !== true && (
                    <span
                      className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300"
                      title="BASIC/RSID tune: requires the C64 ROMs (missing)"
                    >
                      ROM
                    </span>
                  )}
                </button>
                <span className="truncate text-muted">{tune.artist}</span>
                <span className="truncate text-muted" title={tune.released || undefined}>
                  {yearOf(tune.released)}
                </span>
                <span className="text-right text-muted">{tune.songs > 1 ? tune.songs : "·"}</span>
                <span className="text-right font-mono text-xs text-muted">
                  {formatTime(tune.durationTotal)}
                </span>
                <div className="relative flex justify-end">
                  <button
                    className="rounded-md px-1.5 py-1 text-muted hover:bg-white/10 hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === tune.id ? null : tune.id);
                    }}
                    title="Add to playlist"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                  </button>
                  {menuFor === tune.id && (
                    <div className="panel absolute top-8 right-0 z-30 w-56 p-1.5 text-xs shadow-2xl">
                      {playlistId !== undefined && (
                        <button
                          className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-rose-300 hover:bg-white/5"
                          onClick={async () => {
                            await api.removePlaylistItem(tune.id);
                            setMenuFor(null);
                            onChanged?.();
                          }}
                        >
                          Remove from this playlist
                        </button>
                      )}
                      {playlists.length === 0 && (
                        <div className="px-2 py-1.5 text-muted">No playlists</div>
                      )}
                      {playlists.map((p) => (
                        <button
                          key={p.id}
                          className="w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                          onClick={async () => {
                            await api.addToPlaylist(p.id, tune.path, 1);
                            useApp.getState().toast(`Added to ${p.name}`, "success");
                            setMenuFor(null);
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                      <button
                        className="mt-1 w-full rounded-lg border-t border-line px-2 py-1.5 text-left text-accent2 hover:bg-white/5"
                        onClick={() => {
                          const name = window.prompt("New playlist name");
                          if (name) {
                            api.createPlaylist(name).then(async (id) => {
                              await api.addToPlaylist(id, tune.path, 1);
                              useApp.getState().toast(`Playlist "${name}" created`, "success");
                            });
                          }
                          setMenuFor(null);
                        }}
                      >
                        + New playlist…
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
