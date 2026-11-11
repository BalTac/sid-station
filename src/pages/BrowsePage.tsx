import { useEffect, useMemo, useState } from "react";
import { api, type Node, type TuneRow } from "../lib/api";
import { useApp } from "../state/app";
import { TuneTable } from "../components/TuneTable";
import { countryFlag, formatLong } from "../lib/format";
import { Icon } from "../components/Icon";
import { usePlayer } from "../state/player";

const tabs = [
  { key: "MUSICIANS", label: "Musicians" },
  { key: "DEMOS", label: "Demos" },
  { key: "GAMES", label: "Games" },
];

export function BrowsePage() {
  const navigate = useApp((s) => s.navigate);
  const { collection, bucket, filter } = useApp((s) => s.browseState);
  const setBrowseState = useApp((s) => s.setBrowseState);
  const setCollection = (value: string) => setBrowseState({ collection: value, bucket: "" });
  const setBucket = (value: string) => setBrowseState({ bucket: value });
  const setFilter = (value: string) => setBrowseState({ filter: value });
  const dataVersion = useApp((s) => s.dataVersion);
  const [buckets, setBuckets] = useState<Node[]>([]);
  const [composers, setComposers] = useState<Node[]>([]);
  const [tunes, setTunes] = useState<TuneRow[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let alive = true;
    setComposers([]);
    setTunes([]);
    api
      .browseNodes(collection)
      .then((nodes) => {
        if (!alive) return;
        setBuckets(nodes);
        const current = useApp.getState().browseState.bucket;
        const stillValid = nodes.some((n) => (n.key.split("/").pop() ?? "") === current);
        if (!stillValid && nodes.length > 0) {
          setBucket(nodes[0].key.split("/").pop() ?? "");
        }
      })
      .catch(() => setBuckets([]));
    return () => {
      alive = false;
    };
  }, [collection, dataVersion]);

  useEffect(() => {
    if (!bucket) return;
    let alive = true;
    const node = `${collection}/${bucket}`;
    if (collection === "MUSICIANS") {
      api
        .browseNodes(node)
        .then((nodes) => alive && setComposers(nodes))
        .catch(() => setComposers([]));
      setTunes([]);
    } else {
      api
        .searchTunes({ node, sort: "title", limit: 2000 })
        .then((page) => {
          if (!alive) return;
          setTunes(page.items);
          setTotal(page.total);
        })
        .catch(() => setTunes([]));
    }
    return () => {
      alive = false;
    };
  }, [collection, bucket, dataVersion]);

  const filteredComposers = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return composers;
    return composers.filter(
      (c) =>
        c.label.toLowerCase().includes(f) ||
        (c.subtitle ?? "").toLowerCase().includes(f),
    );
  }, [composers, filter]);

  const totalComposers = useMemo(
    () => composers.reduce((acc, c) => acc + c.count, 0),
    [composers],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line/70 px-6 py-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`chip ${collection === t.key ? "chip-active" : ""}`}
            onClick={() => setCollection(t.key)}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-muted/70" />
            <input
              className="input w-56 pl-8"
              placeholder="Filter composers…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={collection !== "MUSICIANS"}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/50 px-6 py-2.5">
        {buckets.map((b) => {
          const key = b.key.split("/").pop() ?? b.key;
          return (
            <button
              key={b.key}
              className={`min-w-9 rounded-lg px-2.5 py-1 font-mono text-xs transition-colors ${
                bucket === key
                  ? "bg-accent text-white"
                  : "bg-white/[0.04] text-muted hover:bg-white/10 hover:text-soft"
              }`}
              onClick={() => setBucket(key)}
              title={`${b.count} items`}
            >
              {key === "0-9" ? "0-9" : key}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted">
          {collection === "MUSICIANS"
            ? `${composers.length} composers · ${totalComposers} SID`
            : `${total.toLocaleString("en-US")} SID`}
        </span>
      </div>

      {collection === "MUSICIANS" ? (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
            {filteredComposers.map((c) => (
              <button
                key={c.key}
                onClick={() => navigate({ kind: "composer", dir: c.key })}
                className="group panel flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:border-accent/50 hover:bg-panel2"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent/25 to-accent2/15 text-sm font-semibold text-white">
                  {c.label.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white group-hover:text-accent2">{c.label}</div>
                  <div className="truncate text-[11px] text-muted">
                    {c.country ? `${countryFlag(c.country)} ` : ""}
                    {c.subtitle ?? c.key.split("/").pop()?.replace(/_/g, " ")}
                  </div>
                </div>
                <span className="font-mono text-[11px] text-muted/80">{c.count}</span>
              </button>
            ))}
          </div>
          {filteredComposers.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">No composers under this letter</p>
          )}
        </div>
      ) : (
        <TuneTable tunes={tunes} emptyLabel={`No tunes in ${collection}/${bucket}`} />
      )}
    </div>
  );
}

export function ComposerPage({ dir }: { dir: string }) {
  const playTune = usePlayerPlay();
  const [info, setInfo] = useState<import("../lib/api").ComposerInfo | null>(null);
  const [tunes, setTunes] = useState<TuneRow[]>([]);
  const [sort, setSort] = useState("title");

  useEffect(() => {
    let alive = true;
    api.composerDetail(dir).then((i) => alive && setInfo(i)).catch(() => setInfo(null));
    return () => {
      alive = false;
    };
  }, [dir]);

  useEffect(() => {
    let alive = true;
    api
      .searchTunes({ composerDir: dir, sort, limit: 2000 })
      .then((p) => alive && setTunes(p.items))
      .catch(() => setTunes([]));
    return () => {
      alive = false;
    };
  }, [dir, sort]);

  const name =
    info?.realName ?? info?.handle ?? dir.split("/").pop()?.replace(/_/g, " ") ?? dir;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line/70 px-6 pt-5 pb-4">
        <button
          className="mb-3 text-xs text-muted hover:text-soft"
          onClick={() => useApp.getState().back()}
        >
          ← Back
        </button>
        <div className="flex items-start gap-4">
          <div className="glow flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/40 to-accent2/25 text-xl font-semibold text-white">
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold text-white">{name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {info?.handle && info.handle !== name && <span className="font-mono">{info.handle}</span>}
              {info?.country && (
                <span>
                  {countryFlag(info.country)} {info.country}
                </span>
              )}
              {info?.groups?.length ? <span>{info.groups.join(" · ")}</span> : null}
              <span>
                {info?.tuneCount ?? tunes.length} SID · {formatLong(info?.totalSeconds)}
              </span>
            </div>
            {info?.aliases && info.aliases.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {info.aliases.slice(0, 8).map((a) => (
                  <span key={a} className="chip !py-0.5 text-[10px]">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-line bg-panel2 px-2 py-1.5 text-xs text-soft"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="title">Title</option>
              <option value="year">Year</option>
              <option value="duration">Length</option>
            </select>
            <button
              className="btn-primary"
              onClick={() => tunes.length > 0 && playTune(tunes[0].id, 1, tunes, 0)}
            >
              <Icon name="play" className="h-3.5 w-3.5" /> Play all
            </button>
          </div>
        </div>
      </div>
      <TuneTable tunes={tunes} />
    </div>
  );
}

function usePlayerPlay() {
  return usePlayer((s) => s.playTune);
}

