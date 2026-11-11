import { useApp } from "../state/app";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-28 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
            t.kind === "error"
              ? "border-rose-500/40 bg-rose-950/80 text-rose-100"
              : t.kind === "success"
                ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-100"
                : "border-line bg-panel/95 text-soft"
          }`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
