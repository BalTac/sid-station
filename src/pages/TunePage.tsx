import { useEffect, useState } from "react";
import { api, type TuneDetail } from "../lib/api";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { csdbSearchUrl, formatTime, humanBytes } from "../lib/format";
import { Icon } from "../components/Icon";

export function TunePage({ id }: { id: number }) {
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const playTune = usePlayer((s) => s.playTune);
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const romActive = usePlayer((s) => s.romActive);
  const toggle = usePlayer((s) => s.toggle);
  const [detail, setDetail] = useState<TuneDetail | null>(null);
  const [playlists, setPlaylists] = useState<{ id: number; name: string }[]>([]);
  const [showPlaylists, setShowPlaylists] = useState(false);

  useEffect(() => {
    let alive = true;
    api.tuneDetail(id).then((d) => alive && setDetail(d)).catch(() => setDetail(null));
    api.listPlaylists().then((p) => setPlaylists(p.filter((x) => x.kind !== "favorites")));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!detail) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Loading…</div>;
  }

  const isCurrent = current?.id === detail.id;
  const blocks = detail.stilBlocks ?? [];
  const mainComment = detail.stilComment ?? blocks.find((b) => !b.subtune)?.comment;
  const subtuneBlocks = blocks.filter((b) => b.subtune !== null && b.subtune !== undefined);

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-4xl space-y-5">
        <button className="text-xs text-muted hover:text-soft" onClick={() => useApp.getState().back()}>
          ← Back
        </button>

        <header className="panel relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative flex flex-wrap items-start gap-5">
            <button
              className="glow flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/50 to-accent2/30 text-white"
              onClick={() => void (isCurrent ? toggle() : playTune(detail.id))}
              title="Play"
            >
              <Icon name={isCurrent && playing ? "pause" : "play"} className="h-7 w-7" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold text-white">{detail.title}</h1>
              <div className="mt-1 text-sm text-muted">{detail.artist}</div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="chip">{detail.collection}</span>
                {detail.released && <span className="chip">{detail.released}</span>}
                {detail.sidModel && <span className="chip font-mono">{detail.sidModel}</span>}
                {detail.clock && <span className="chip font-mono">{detail.clock}</span>}
                <span className="chip font-mono">{detail.format} v{detail.version}</span>
                {detail.songs > 1 && <span className="chip">{detail.songs} subtune</span>}
                {detail.durationTotal ? (
                  <span className="chip">length {formatTime(detail.durationTotal)}</span>
                ) : null}
                {detail.isBuggy && <span className="chip !text-amber-300">buggy rip</span>}
                {detail.needsRoms && <span className="chip !text-sky-300">requires C64 ROMs</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                className="btn"
                onClick={async () => {
                  await api.toggleFavorite(detail.path, !detail.inFavorites, detail.startSong);
                  const fresh = await api.tuneDetail(detail.id);
                  setDetail(fresh);
                  toast(fresh.inFavorites ? "Added to favorites" : "Removed", "success");
                }}
              >
                <Icon name="heart" className="h-4 w-4" />
                {detail.inFavorites ? "In favorites" : "Favorite"}
              </button>
              <div className="relative">
                <button className="btn w-full" onClick={() => setShowPlaylists((v) => !v)}>
                  <Icon name="plus" className="h-4 w-4" /> Playlist
                </button>
                {showPlaylists && (
                  <div className="panel absolute right-0 z-30 mt-1 w-56 p-1.5 text-xs shadow-2xl">
                    {playlists.length === 0 && <div className="px-2 py-1.5 text-muted">No playlists</div>}
                    {playlists.map((p) => (
                      <button
                        key={p.id}
                        className="w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                        onClick={async () => {
                          await api.addToPlaylist(p.id, detail.path, detail.startSong);
                          toast(`Added to ${p.name}`, "success");
                          setShowPlaylists(false);
                        }}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <a
                className="btn"
                href={csdbSearchUrl(detail.title)}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="external" className="h-4 w-4" /> CSDb
              </a>
            </div>
          </div>
        </header>

        {detail.needsRoms && romActive !== true && (
          <section className="panel border-sky-500/40 bg-sky-500/5 p-4 text-sm text-sky-100">
            <div className="font-medium">This tune is a C64 BASIC program</div>
            <p className="mt-1 text-xs leading-relaxed text-sky-200/80">
              libsidplayfp can only run it with the system ROMs (KERNAL 8K, BASIC 8K, CHARGEN 4K).
              Without them the clock runs but no audio comes out. Point the settings to the folder that
              contains <span className="font-mono">kernal</span> (8,192 B),{" "}
              <span className="font-mono">basic</span> (8,192 B) and{" "}
              <span className="font-mono">chargen</span> (4,096 B).
            </p>
            <button className="btn mt-3" onClick={() => navigate({ kind: "settings" })}>
              <Icon name="settings" className="h-4 w-4" /> Configure ROMs
            </button>
          </section>
        )}

        {detail.bugNote && (
          <div className="panel border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-200">
            <strong className="mr-2">BUGlist note:</strong>
            {detail.bugNote}
          </div>
        )}

        {mainComment && (
          <section className="panel p-5">
            <h2 className="mb-2 text-xs font-medium tracking-wider text-muted uppercase">STIL notes</h2>
            <p className="text-sm leading-relaxed whitespace-pre-line text-soft">{mainComment}</p>
          </section>
        )}

        {subtuneBlocks.length > 0 && (
          <section className="panel p-5">
            <h2 className="mb-3 text-xs font-medium tracking-wider text-muted uppercase">Subtune</h2>
            <div className="space-y-2">
              {subtuneBlocks.map((b, i) => (
                <div key={i} className="rounded-xl border border-line/70 bg-panel2/60 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-[11px] text-accent2">#{b.subtune}</span>
                    <span className="text-white">{b.title ?? "—"}</span>
                    <button
                      className="btn-ghost ml-auto !p-1"
                      onClick={() => playTune(detail.id, b.subtune ?? 1)}
                      title="Play subtune"
                    >
                      <Icon name="play" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {b.artist && <div className="text-xs text-muted">cover by {b.artist}</div>}
                  {b.comment && <p className="mt-1 text-xs leading-relaxed text-muted">{b.comment}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="panel p-5">
          <h2 className="mb-3 text-xs font-medium tracking-wider text-muted uppercase">Specifications</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            <Spec label="Path" value={detail.path} mono wide />
            <Spec label="File" value={detail.filename} mono />
            <Spec label="Size" value={humanBytes(detail.size)} />
            <Spec label="Load" value={hex(detail.loadAddr)} />
            <Spec label="Init" value={hex(detail.initAddr)} />
            <Spec label="Play" value={hex(detail.playAddr)} />
            <Spec label="MD5" value={detail.md5 ?? "—"} mono />
            <Spec label="Title (header)" value={detail.hdrTitle ?? "—"} />
            <Spec label="Author (header)" value={detail.hdrAuthor ?? "—"} />
            {detail.subtunes.length > 0 && (
              <Spec
                label="Lengths"
                value={detail.subtunes
                  .map((s) => `${s.subtune} · ${formatTime(s.duration)}`)
                  .join("   ")}
                wide
              />
            )}
          </dl>
        </section>

        {detail.composer && (
          <section className="panel flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent/30 to-accent2/20 text-sm font-semibold text-white">
              {(detail.composer.realName ?? detail.composer.handle ?? "?")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <button
                className="text-sm text-white hover:text-accent2"
                onClick={() => navigate({ kind: "composer", dir: detail.composer!.dir })}
              >
                {detail.composer.realName ?? detail.composer.handle ?? detail.composer.dir}
              </button>
              <div className="text-xs text-muted">
                {detail.composer.country ?? "unknown country"} · {detail.composer.tuneCount} SID
              </div>
            </div>
            <Icon name="external" className="h-4 w-4 text-muted" />
          </section>
        )}
      </div>
    </div>
  );
}

function Spec({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 md:col-span-3" : ""}>
      <dt className="text-[11px] tracking-wide text-muted uppercase">{label}</dt>
      <dd className={`truncate text-soft ${mono ? "font-mono text-xs" : "text-sm"}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function hex(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toString(16).toUpperCase().padStart(4, "0")}`;
}
