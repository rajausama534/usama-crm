import { ToolError } from "./types";

/** Text safe to put inside a PostgREST or() filter. */
export function orSafe(s: string) {
  return s.replace(/[,()*%\\:]/g, " ").replace(/\s+/g, " ").trim();
}

export function cut(s: string | null | undefined, n = 300) {
  if (!s) return s ?? null;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function todayDubai(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
}

export function nowDubaiText(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

/** "2026-11-09" + "16:00" → ISO with Dubai offset (Dubai has no daylight saving). */
export function dubaiIso(date: string, time = "09:00") {
  return `${date}T${time}:00+04:00`;
}

export function fmtDubai(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new ToolError(`${what}: ${res.error.message}`);
  return res.data as T;
}

export function changeLines(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) {
  return Object.keys(after)
    .filter((k) => (before[k] ?? null) !== (after[k] ?? null))
    .map((k) => `${labels[k] || k}: ${before[k] ?? "-"} → ${after[k] ?? "-"}`);
}
