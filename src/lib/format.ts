export function formatTime(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatMs(ms: number): string {
  return formatTime(ms / 1000);
}

export function formatLong(seconds?: number | null): string {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function composerLabel(path?: string | null): string {
  if (!path) return "";
  const base = path.split("/").pop() ?? path;
  return base.replace(/_/g, " ");
}

export function csdbSearchUrl(title: string): string {
  return `https://csdb.dk/search/?seinsel=all&search=${encodeURIComponent(title)}`;
}

export function csdbScenerUrl(handle: string): string {
  return `https://csdb.dk/search/?seinsel=sceners&search=${encodeURIComponent(handle)}`;
}

export function countryFlag(country?: string | null): string {
  if (!country) return "";
  const map: Record<string, string> = {
    ARGENTINA: "🇦🇷",
    AUSTRALIA: "🇦🇺",
    AUSTRIA: "🇦🇹",
    BELGIUM: "🇧🇪",
    BRAZIL: "🇧🇷",
    BULGARIA: "🇧🇬",
    CANADA: "🇨🇦",
    CHILE: "🇨🇱",
    CROATIA: "🇭🇷",
    "CZECH REPUBLIC": "🇨🇿",
    DENMARK: "🇩🇰",
    ESTONIA: "🇪🇪",
    FINLAND: "🇫🇮",
    FRANCE: "🇫🇷",
    GERMANY: "🇩🇪",
    GREECE: "🇬🇷",
    HUNGARY: "🇭🇺",
    ICELAND: "🇮🇸",
    INDIA: "🇮🇳",
    IRAN: "🇮🇷",
    IRELAND: "🇮🇪",
    ISRAEL: "🇮🇱",
    ITALY: "🇮🇹",
    JAPAN: "🇯🇵",
    LATVIA: "🇱🇻",
    LITHUANIA: "🇱🇹",
    MACEDONIA: "🇲🇰",
    MEXICO: "🇲🇽",
    NETHERLANDS: "🇳🇱",
    "NEW ZEALAND": "🇳🇿",
    NORWAY: "🇳🇴",
    POLAND: "🇵🇱",
    PORTUGAL: "🇵🇹",
    ROMANIA: "🇷🇴",
    RUSSIA: "🇷🇺",
    SERBIA: "🇷🇸",
    SINGAPORE: "🇸🇬",
    SLOVAKIA: "🇸🇰",
    SLOVENIA: "🇸🇮",
    "SOUTH AFRICA": "🇿🇦",
    SPAIN: "🇪🇸",
    SWEDEN: "🇸🇪",
    SWITZERLAND: "🇨🇭",
    THAILAND: "🇹🇭",
    TURKEY: "🇹🇷",
    UKRAINE: "🇺🇦",
    USA: "🇺🇸",
    "UNITED KINGDOM": "🇬🇧",
    "UNITED KINGDOM (ENGLAND)": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "UNITED KINGDOM (SCOTLAND)": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    "UNITED KINGDOM (WALES)": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    "UNITED KINGDOM (NORTHERN IRELAND)": "🇬🇧",
    VIETNAM: "🇻🇳",
  };
  return map[country] ?? "🌍";
}

/** HVSC "released" strings are free-form; show a compact year when possible. */
export function yearOf(released?: string | null): string {
  if (!released) return "—";
  const match = released.match(/(19|20)\d{2}/);
  if (!match) return released.slice(0, 5);
  const year = match[0];
  return year.startsWith("19") ? `'${year.slice(2)}` : year;
}
