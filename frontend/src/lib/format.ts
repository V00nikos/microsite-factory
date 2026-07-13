// Small formatting helpers for the telemetry read-outs.

export function usd(n: number | undefined | null): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return "$" + v.toFixed(2);
}

export function pct(fraction: number | undefined | null): string {
  const v = typeof fraction === "number" && isFinite(fraction) ? fraction : 0;
  return Math.round(v * 100) + "%";
}

export function compact(n: number | undefined | null): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
  return (v / 1_000_000).toFixed(1) + "M";
}

/** Relative "3s ago" / "2m ago" clock for the live-update feel. */
export function ago(epochMs: number | undefined | null, now: number = Date.now()): string {
  if (!epochMs) return "—";
  const s = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (s < 3) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

/** Strip protocol for a tidy on-board URL label. */
export function hostLabel(url: string | undefined | null): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
