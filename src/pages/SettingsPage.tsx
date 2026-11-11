import { useEffect, useState } from "react";
import type { RomEntry } from "../lib/api";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "../state/app";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";

export function SettingsPage() {
  const {
    boot,
    settings,
    updateSetting,
    rescan,
    chooseLibrary,
    scan,
    romReport,
    romsBusy,
    loadRoms,
    detectRoms,
  } = useApp();
  const [stats, setStats] = useState<{ composers: number; totalSeconds: number } | null>(null);

  useEffect(() => {
    api
      .libraryStats()
      .then((s) => setStats({ composers: s.composers, totalSeconds: s.totalSeconds }))
      .catch(() => setStats(null));
  }, [boot?.tuneCount]);

  const pickLibrary = async () => {
    const dir = await open({ directory: true, title: "Select the C64Music folder (HVSC)" });
    if (typeof dir === "string") await chooseLibrary(dir);
  };

  const pickRoms = async () => {
    const dir = await open({ directory: true, title: "Folder containing kernal / basic / chargen" });
    if (typeof dir === "string") await updateSetting("rom_dir", dir);
  };

  const clearRoms = async () => {
    await updateSetting("rom_dir", "");
  };

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <p className="text-xs text-muted">Library, emulation and data</p>
        </header>

        <section className="panel space-y-4 p-5">
          <h2 className="text-xs font-medium tracking-wider text-muted uppercase">HVSC library</h2>
          <div>
            <label className="field-label">Collection path</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" value={boot?.libraryPath ?? ""} readOnly placeholder="not set" />
              <button className="btn" onClick={() => void pickLibrary()}>
                <Icon name="folder" className="h-4 w-4" /> Choose
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              The folder must contain <span className="font-mono">DOCUMENTS/HVSC.txt</span>. The path is
              stored in the portable database, not in the code.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>
              Version: <strong className="text-soft">{boot?.libraryVersion ?? "?"}</strong>
            </span>
            <span>
              Declared SIDs:{" "}
              <strong className="text-soft">{boot?.librarySidCount?.toLocaleString("en-US") ?? "?"}</strong>
            </span>
            <span>
              Indexed:{" "}
              <strong className="text-soft">{boot?.tuneCount.toLocaleString("en-US") ?? 0}</strong>
            </span>
            {stats && (
              <span>
                Composers: <strong className="text-soft">{stats.composers.toLocaleString("en-US")}</strong>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => void rescan()} disabled={!!scan}>
              <Icon name="refresh" className="h-4 w-4" />
              {scan ? "Indexing…" : "Reindex everything"}
            </button>
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Emulation</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="field-label">Engine</label>
              <select
                className="input"
                value={settings.engine}
                onChange={(e) => void updateSetting("engine", e.target.value)}
              >
                <option value="residfp">reSIDfp (accurate)</option>
                <option value="sidlite">SIDLite (fast)</option>
              </select>
            </div>
            <div>
              <label className="field-label">SID model</label>
              <select
                className="input"
                value={settings.sidModel}
                onChange={(e) => void updateSetting("sid_model", e.target.value)}
              >
                <option value="auto">From header</option>
                <option value="MOS6581">6581</option>
                <option value="MOS8580">8580</option>
              </select>
            </div>
            <div>
              <label className="field-label">Clock</label>
              <select
                className="input"
                value={settings.clock}
                onChange={(e) => void updateSetting("clock", e.target.value)}
              >
                <option value="auto">From header</option>
                <option value="PAL">PAL</option>
                <option value="NTSC">NTSC</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="field-label mb-0">System ROMs (for RSID / BASIC tunes)</label>
              <div className="flex gap-2">
                <button className="btn" onClick={() => void detectRoms(false)} disabled={romsBusy}>
                  <Icon name="search" className="h-4 w-4" /> Detect
                </button>
                <button className="btn" onClick={() => void pickRoms()} disabled={romsBusy}>
                  <Icon name="folder" className="h-4 w-4" /> Choose
                </button>
                <button
                  className="btn"
                  onClick={() => void loadRoms(true)}
                  disabled={romsBusy || !settings.romDir}
                >
                  <Icon name="refresh" className="h-4 w-4" /> Verify
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                value={settings.romDir ?? ""}
                readOnly
                placeholder="folder with kernal, basic, chargen (8K, 8K, 4K)"
              />
              {settings.romDir && (
                <button className="btn" onClick={() => void clearRoms()} title="Remove the ROM folder">
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              )}
            </div>

            {settings.romDir && (
              <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px]">
                  <StatusDot report={romReport} />
                  <span className="text-muted">
                    {romsBusy
                      ? "Checking…"
                      : romReport
                        ? romReport.ready
                          ? "All three ROMs are present and readable"
                          : `Incomplete configuration: ${romReport.warnings[0] ?? "missing files"}`
                        : "No check performed yet"}
                  </span>
                </div>
                <div className="space-y-1">
                  {(romReport?.roms ?? []).map((rom) => (
                    <RomRow key={rom.kind} rom={rom} />
                  ))}
                </div>
                {romReport && romReport.warnings.length > 0 && (
                  <details className="mt-2 text-[11px] text-muted">
                    <summary className="cursor-pointer select-none">
                      Diagnostics ({romReport.warnings.length})
                    </summary>
                    <ul className="mt-1 space-y-1 pl-4">
                      {romReport.warnings.map((w, i) => (
                        <li key={i} className="list-disc">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {romReport?.roms.some((r) => r.candidates.some((c) => !c.valid)) && (
                  <details className="mt-1 text-[11px] text-muted">
                    <summary className="cursor-pointer select-none">Rejected files</summary>
                    <ul className="mt-1 space-y-1 pl-4">
                      {romReport.roms.flatMap((r) =>
                        r.candidates
                          .filter((c) => !c.valid)
                          .map((c) => (
                            <li key={`${r.kind}-${c.name}`} className="list-disc">
                              <span className="font-mono">{c.name}</span> — {c.problem}
                            </li>
                          )),
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted">
              The ROMs are copyrighted by Commodore: supply your own (for example from the{" "}
              <span className="font-mono">C64/</span> folder of VICE). Without them PSID tunes work as
              usual, while RSID/BASIC tunes stay silent.
            </p>
          </div>
        </section>

        <section className="panel space-y-2 p-5 text-xs text-muted">
          <h2 className="text-xs font-medium tracking-wider text-muted uppercase">Data</h2>
          <p>
            Database: <span className="font-mono text-soft">{boot?.dbPath}</span> (portable, next to
            the executable when that folder is writable).
          </p>
          {stats && (
            <p>
              Total length of the indexed collection:{" "}
              <span className="text-soft">{Math.round(stats.totalSeconds / 3600)} hours</span>.
            </p>
          )}
          <p className="pt-2 leading-relaxed">
            SID Station is free software under the GPL-2.0-or-later and uses libsidplayfp via WebAssembly
            (GPL-2.0-or-later). SID files and HVSC texts remain © of their respective authors.
          </p>
        </section>
      </div>
    </div>
  );
}

function StatusDot({ report }: { report: { ready: boolean } | null }) {
  const color = !report ? "bg-white/20" : report.ready ? "bg-emerald-400" : "bg-amber-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function RomRow({ rom }: { rom: RomEntry }) {
  const expected = rom.expectedSize.toLocaleString("en-US");
  const size = rom.size ? `${rom.size.toLocaleString("en-US")} B` : `expected ${expected} B`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className="w-16 shrink-0 font-mono uppercase text-soft">{rom.kind}</span>
      {rom.found ? (
        <>
          <Icon name="check" className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-mono text-soft">{rom.name}</span>
          <span className="text-muted">{size}</span>
          {rom.known ? (
            <span className="chip !px-1.5 !py-0 !text-[10px] !text-emerald-300">{rom.known}</span>
          ) : (
            <span className="chip !px-1.5 !py-0 !text-[10px] !text-amber-300">unknown digest</span>
          )}
        </>
      ) : (
        <>
          <span className="text-rose-400">✕</span>
          <span className="text-muted">{rom.problem ?? "not found"}</span>
        </>
      )}
      {rom.duplicates.length > 0 && (
        <span className="text-muted">· copies: {rom.duplicates.join(", ")}</span>
      )}
    </div>
  );
}
