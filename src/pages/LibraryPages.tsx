import { useEffect, useState } from "react";
import { api, type Playlist, type TuneRow } from "../lib/api";
import { TuneTable } from "../components/TuneTable";
import { formatDate } from "../lib/format";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { Icon } from "../components/Icon";

export function FavoritesPage() {
  const [items, setItems] = useState<TuneRow[]>([]);
  const [name, setName] = useState("Favorites");

  useEffect(() => {
    let alive = true;
    api.listPlaylists().then(async (list) => {
      const fav = list.find((p) => p.kind === "favorites");
      if (!fav) return;
      setName(fav.name);
      const page = await api.playlistItems(fav.id);
      if (alive) setItems(page.items);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SimpleList title={name} subtitle={`${items.length} tunes`} icon="heart" tunes={items} />
  );
}

export function PlaylistPage({ id, name }: { id: number; name: string }) {
  const [items, setItems] = useState<TuneRow[]>([]);

  useEffect(() => {
    let alive = true;
    api.playlistItems(id).then((p) => alive && setItems(p.items));
    return () => {
      alive = false;
    };
  }, [id]);

  const reload = async () => {
    const p = await api.playlistItems(id);
    setItems(p.items);
  };

  return (
    <SimpleList
      title={name}
      subtitle={`${items.length} tunes`}
      icon="list"
      tunes={items}
      playlistId={id}
      onRefresh={reload}
    />
  );
}

function SimpleList({
  title,
  subtitle,
  icon,
  tunes,
  onRefresh,
  playlistId,
}: {
  title: string;
  subtitle: string;
  icon: "heart" | "list";
  tunes: TuneRow[];
  onRefresh?: () => Promise<void>;
  playlistId?: number;
}) {
  const playTune = usePlayer((s) => s.playTune);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-end justify-between border-b border-line/70 px-6 py-5">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] tracking-wider text-muted uppercase">
            <Icon name={icon} className="h-3.5 w-3.5" /> Playlist
          </div>
          <h1 className="text-2xl font-semibold text-white">{title}</h1>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          {onRefresh && (
            <button className="btn" onClick={() => void onRefresh()}>
              <Icon name="refresh" className="h-4 w-4" /> Refresh
            </button>
          )}
          <button
            className="btn-primary"
            disabled={tunes.length === 0}
            onClick={() => tunes.length > 0 && playTune(tunes[0].id, 1, tunes, 0)}
          >
            <Icon name="play" className="h-3.5 w-3.5" /> Play
          </button>
        </div>
      </div>
      <TuneTable
        tunes={tunes}
        playlistId={playlistId}
        onChanged={() => void onRefresh?.()}
        emptyLabel="No tunes yet: add SIDs from search results or the player"
      />
    </div>
  );
}

export function HistoryPage() {
  const navigate = useApp((s) => s.navigate);
  const playTune = usePlayer((s) => s.playTune);
  const [entries, setEntries] = useState<import("../lib/api").HistoryEntry[]>([]);

  useEffect(() => {
    api.listHistory(200).then(setEntries).catch(() => setEntries([]));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line/70 px-6 py-5">
        <div className="mb-1 flex items-center gap-2 text-[11px] tracking-wider text-muted uppercase">
          <Icon name="clock" className="h-3.5 w-3.5" /> History
        </div>
        <h1 className="text-2xl font-semibold text-white">Recently played</h1>
        <p className="text-xs text-muted">{entries.length} tunes</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="space-y-1">
          {entries.map((entry, i) => (
            <button
              key={`${entry.tune.id}-${i}`}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/[0.04]"
              onClick={() => playTune(entry.tune.id, entry.subtune)}
            >
              <span className="w-24 shrink-0 font-mono text-[10px] text-muted">
                {formatDate(entry.playedAt)}
              </span>
              <span className="min-w-0 flex-1 truncate text-white">{entry.tune.title}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{entry.tune.artist}</span>
              <span className="font-mono text-[10px] text-muted">#{entry.subtune}</span>
            </button>
          ))}
          {entries.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing here yet</p>}
        </div>
      </div>
      <div className="border-t border-line/60 px-6 py-3 text-right">
        <button className="btn" onClick={() => navigate({ kind: "browse" })}>
          Back to browse
        </button>
      </div>
    </div>
  );
}

export function playlistsToOptions(list: Playlist[]) {
  return list.filter((p) => p.kind !== "favorites").map((p) => ({ id: p.id, name: p.name }));
}
