"use client";

import { Card, cx } from "@/components/ui";
import type { Metrics } from "@/lib/team";

/** Calls, WhatsApp and other work per day, as stacked bars. */
export function ActivityChart({ days, perDay, title = "Activity per day" }: { days: string[]; perDay: Metrics["perDay"]; title?: string }) {
  const shown = days.length > 62 ? weeks(days, perDay) : days.map((d) => ({ label: d, ...(perDay[d] || { call: 0, whatsapp: 0, other: 0 }) }));
  const max = Math.max(1, ...shown.map((d) => d.call + d.whatsapp + d.other));
  const total = shown.reduce((s, d) => s + d.call + d.whatsapp + d.other, 0);
  const tick = Math.max(1, Math.ceil(shown.length / 8));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="flex items-center gap-3 text-xs text-ink-2">
          <Key className="bg-accent" label="Calls" /><Key className="bg-good" label="WhatsApp" /><Key className="bg-ink-3/40" label="Notes, status, other" />
        </div>
      </div>
      {!total ? <div className="h-40 grid place-items-center text-sm text-ink-3">No activity recorded in this period.</div> : (
        <>
          <div className="h-40 flex items-end gap-[3px]">
            {shown.map((d) => {
              const n = d.call + d.whatsapp + d.other;
              return (
                <div key={d.label} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative" title={`${label(d.label)}: ${d.call} calls, ${d.whatsapp} WhatsApp, ${d.other} other`}>
                  <div className="w-full flex flex-col-reverse rounded-t-[3px] overflow-hidden" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0 }}>
                    <div className="bg-accent" style={{ flex: d.call }} />
                    <div className="bg-good" style={{ flex: d.whatsapp }} />
                    <div className="bg-ink-3/40" style={{ flex: d.other }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px] mt-1.5">
            {shown.map((d, i) => <div key={d.label} className="flex-1 min-w-0 text-[10px] text-ink-3 text-center truncate">{i % tick === 0 ? label(d.label) : ""}</div>)}
          </div>
        </>
      )}
    </Card>
  );
}
function Key({ className, label }: { className: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cx("size-2 rounded-full", className)} />{label}</span>;
}
function label(day: string) {
  if (day.length === 7) return new Date(`${day}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" });
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
/** Long periods are shown per month. */
function weeks(days: string[], perDay: Metrics["perDay"]) {
  const m = new Map<string, { label: string; call: number; whatsapp: number; other: number }>();
  for (const d of days) {
    const k = d.slice(0, 7);
    const e = m.get(k) || { label: k, call: 0, whatsapp: 0, other: 0 };
    const v = perDay[d]; if (v) { e.call += v.call; e.whatsapp += v.whatsapp; e.other += v.other; }
    m.set(k, e);
  }
  return [...m.values()];
}

/** Small figure with a label, for dense rows of numbers. */
export function Mini({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn"; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-3 truncate">{label}</div>
      <div className={cx("text-[22px] leading-tight num mt-0.5", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {hint && <div className="text-[11px] text-ink-3 truncate">{hint}</div>}
    </div>
  );
}

export const fmtShare = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
