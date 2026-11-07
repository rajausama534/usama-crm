// Prices are cut, not rounded (same rule as the old CRM): 5,097,888 -> 5.097M.
export function shortAED(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!n || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `${Math.trunc(n / 1e3) / 1e3}M`;
  if (Math.abs(n) >= 1e3) return `${Math.trunc(n / 1e3)}K`;
  return String(n);
}

const fullFmt = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 });
export function aed(v: number | string | null | undefined): string {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return "—";
  return `AED ${fullFmt.format(n)}`;
}

export function count(n: number | null | undefined): string {
  return n == null ? "—" : new Intl.NumberFormat("en-AE").format(n);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T12:00:00+04:00` : v);
  return Number.isNaN(d.getTime()) ? v : dateFmt.format(d);
}
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : dateTimeFmt.format(d);
}
export function fmtTime(v: string | Date): string {
  return timeFmt.format(typeof v === "string" ? new Date(v) : v);
}

/** Today's date in Dubai as YYYY-MM-DD. */
export function todayDubai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

export function relative(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T12:00:00+04:00` : v);
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0 && days < 30) return `in ${days} days`;
  if (days < 0 && days > -30) return `${-days} days ago`;
  return fmtDate(v);
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** UAE-style WhatsApp number: digits only, 05x -> 9715x. */
export function waNumber(phone: string | null | undefined): string {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = "971" + p.slice(1);
  if (p.length === 9 && p.startsWith("5")) p = "971" + p;
  return p;
}
