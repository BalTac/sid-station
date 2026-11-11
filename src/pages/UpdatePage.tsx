import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type UpdateStatus } from "../lib/api";
import { useApp } from "../state/app";
import { Icon } from "../components/Icon";

interface Progress {
  phase: string;
  message: string;
  percent?: number | null;
  logLine?: string | null;
}

interface Report {
  success: boolean;
  message: string;
  version?: number | null;
  log: string;
}

export function UpdatePage() {
  const boot = useApp((s) => s.boot);
  const toast = useApp((s) => s.toast);
  const refreshBoot = useApp((s) => s.refreshBoot);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<Progress>("update://progress", (event) => {
      const data = event.payload;
      if (data.phase === "log") {
        if (data.logLine) {
          setLog((prev) => [...prev.slice(-500), data.logLine as string]);
        }
      } else {
        setProgress(data);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const check = async () => {
    setChecking(true);
    try {
      const s = await api.checkUpdate();
      setStatus(s);
      if (s.kind === "error") toast(s.message, "error");
    } catch (err) {
      toast(String(err), "error");
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    setReport(null);
    setProgress({ phase: "start", message: "Starting…" });
    try {
      const rep = await api.applyUpdate(false);
      setReport(rep);
      if (rep.success) {
        toast(rep.message, "success");
        await refreshBoot();
      } else {
        toast(rep.message, "error");
      }
    } catch (err) {
      toast(String(err), "error");
      setReport({ success: false, message: String(err), log: "" });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const ready = status?.updateAvailable ?? false;

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold text-white">HVSC updates</h1>
          <p className="text-xs text-muted">
            Checks hvsc.c64.org, downloads from the official mirror, backs up, runs the HVS script and verifies.
          </p>
        </header>

        <section className="panel p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] tracking-wider text-muted uppercase">Installed version</div>
              <div className="text-3xl font-semibold text-white">#{boot?.libraryVersion ?? "?"}</div>
              <div className="truncate text-xs text-muted">
                {boot?.tuneCount.toLocaleString("en-US") ?? 0} SID · {boot?.libraryPath ?? "not set"}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => void check()} disabled={checking || running}>
                <Icon name="refresh" className="h-4 w-4" />
                {checking ? "Checking…" : "Check"}
              </button>
              <button
                className="btn-primary"
                onClick={() => void apply()}
                disabled={!ready || running}
                title={ready ? "Download and apply the update" : "No update available"}
              >
                <Icon name="download" className="h-4 w-4" />
                {running ? "Updating…" : "Update now"}
              </button>
            </div>
          </div>

          {status && (
            <div className="mt-5 space-y-3 border-t border-line/70 pt-4 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${status.updateAvailable ? "bg-gold" : "bg-emerald-400"}`} />
                <span className="text-soft">{status.message}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-4">
                <div>
                  <dt className="text-muted uppercase">Remote</dt>
                  <dd className="font-mono text-soft">#{status.remoteVersion ?? "?"}</dd>
                </div>
                <div>
                  <dt className="text-muted uppercase">Required base</dt>
                  <dd className="font-mono text-soft">#{status.requiredVersion ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted uppercase">Type</dt>
                  <dd className="text-soft">{status.kind === "full" ? "full package" : "incremental"}</dd>
                </div>
                <div>
                  <dt className="text-muted uppercase">Size</dt>
                  <dd className="text-soft">{status.kind === "full" ? "~85 MB" : "~3.5 MB"}</dd>
                </div>
              </dl>
              <div className="text-[11px] break-all text-muted/80">
                {status.kind === "full" ? status.completeUrl : status.downloadUrl}
              </div>
            </div>
          )}
        </section>

        {(running || progress) && (
          <section className="panel p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-soft">{progress?.message || "Preparing…"}</span>
              <span className="font-mono text-xs text-muted">{progress?.phase}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent2 to-accent transition-[width]"
                style={{ width: `${Math.max(3, Math.min(100, progress?.percent ?? 8))}%` }}
              />
            </div>
            <div
              ref={logRef}
              className="mt-3 h-44 overflow-auto rounded-xl border border-line/70 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-muted"
            >
              {log.length === 0 && <div className="text-muted/60">Waiting for output…</div>}
              {log.map((line, i) => (
                <div key={i} className={line.includes("ERROR") || line.includes("Error") ? "text-rose-300" : ""}>
                  {line}
                </div>
              ))}
            </div>
          </section>
        )}

        {report && (
          <section
            className={`panel p-5 ${report.success ? "border-emerald-500/40" : "border-rose-500/40"}`}
          >
            <div className="flex items-start gap-3">
              <Icon
                name={report.success ? "check" : "trash"}
                className={`h-5 w-5 ${report.success ? "text-emerald-400" : "text-rose-400"}`}
              />
              <div>
                <div className="text-sm text-white">{report.message}</div>
                {report.version && (
                  <div className="text-xs text-muted">Resulting version: #{report.version}</div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="panel space-y-2 p-5 text-xs leading-relaxed text-muted">
          <h2 className="text-xs font-medium tracking-wider text-muted uppercase">What the updater does</h2>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>Reads the official API and compares versions; picks the incremental or the full package.</li>
            <li>Downloads the package and extracts it into <span className="font-mono">&lt;HVSC&gt;/update</span> with the bundled 7-Zip.</li>
            <li>Full backup of MUSICIANS/DEMOS/GAMES/DOCUMENTS (~375 MB) before touching anything.</li>
            <li>Runs the official Update Tool with <span className="font-mono">HVSC_NO_PROMPT</span> and non-interactive stdin.</li>
            <li>Verifies version and SID count; restores the backup if anything goes wrong.</li>
            <li>Removes backup and package, then reindexes the database.</li>
          </ol>
          <button
            className="btn mt-2"
            onClick={() => {
              const url = status?.kind === "full" ? status?.completeUrl : status?.downloadUrl;
              if (url) void openUrl(url);
            }}
          >
            <Icon name="external" className="h-4 w-4" /> Open the package in the browser
          </button>
        </section>
      </div>
    </div>
  );
}
