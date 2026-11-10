"use client";

import { useRef, useState } from "react";
import { DatabaseZap, FileText, Loader2, Paperclip } from "lucide-react";
import { Badge, Card, Empty, cx, type Tone } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { openDoc } from "@/lib/company/data";
import { aed } from "@/lib/format";

/** Money with the minus sign in front: "− AED 25,225". */
export const signedAed = (n: number) => (n < 0 ? `− ${aed(-n)}` : aed(n));

/** Shown until the database update for the company departments is applied. */
export function SetupNeeded({ what }: { what: string }) {
  return (
    <Card>
      <Empty icon={<DatabaseZap size={28} />} title={`${what} switches on with the database update`}
        hint="The pages are built and tested. They start working as soon as the update is applied to the live database, which waits for Usama's OK." />
    </Card>
  );
}

export type Col<T> = { h: string; cell: (r: T) => React.ReactNode; right?: boolean; className?: string };
/** Plain list table: scrolls sideways on a phone, rows open on click. */
export function DataTable<T extends { id: string | number }>({ cols, rows, onRow, empty, foot }: {
  cols: Col<T>[]; rows: T[]; onRow?: (r: T) => void; empty?: React.ReactNode; foot?: React.ReactNode;
}) {
  if (!rows.length) return <Card>{empty || <Empty title="Nothing here yet" />}</Card>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              {cols.map((c) => <th key={c.h} className={cx("font-medium px-4 py-3 whitespace-nowrap", c.right && "text-right")}>{c.h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={onRow ? () => onRow(r) : undefined}
                className={cx("border-t border-line", onRow && "cursor-pointer hover:bg-surface-2 transition-colors")}>
                {cols.map((c) => <td key={c.h} className={cx("px-4 py-2.5 align-middle text-ink", c.right && "text-right num whitespace-nowrap", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {foot && <tfoot className="border-t border-line-strong text-ink font-medium">{foot}</tfoot>}
        </table>
      </div>
    </Card>
  );
}

/** Label on the left, figure on the right. */
export function Line({ label, value, strong, tone, hint }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: Tone; hint?: React.ReactNode }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-1.5 text-sm", strong && "font-semibold border-t border-line mt-1 pt-2.5")}>
      <span className={strong ? "text-ink" : "text-ink-2"}>{label}{hint && <span className="block text-xs font-normal text-ink-3">{hint}</span>}</span>
      <span className={cx("num whitespace-nowrap", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</span>
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Attach a private file; shows "View" once there is one. */
export function FileField({ path, onPick, label = "Attach file", accept = "image/jpeg,image/png,image/webp,application/pdf", disabled }: {
  path: string | null | undefined; onPick: (f: File) => Promise<void>; label?: string; accept?: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input ref={ref} type="file" accept={accept} hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { await onPick(f); } catch (x) { toast((x as Error).message); }
        setBusy(false);
      }} />
      {!disabled && (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line bg-surface text-[13px] font-medium text-ink hover:border-line-strong disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}{path ? "Replace" : label}
        </button>
      )}
      {path ? (
        <button type="button" onClick={() => openDoc(path).catch((x) => toast((x as Error).message))}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text hover:underline"><FileText size={14} /> View file</button>
      ) : disabled ? <span className="text-[13px] text-ink-3">No file</span> : null}
    </div>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

export const DEAL_TONE: Record<string, Tone> = {
  pending: "warn", approved: "accent", invoiced: "accent", part_received: "warn", received: "good", agents_paid: "good", cancelled: "neutral", rejected: "bad",
};
export const SIMPLE_TONE: Record<string, Tone> = {
  pending: "warn", approved: "good", rejected: "bad", cancelled: "neutral", unpaid: "warn", part_paid: "warn", paid: "good",
  draft: "neutral", live: "good", unpublished: "neutral", sold: "accent", rented: "accent", complete: "good", final: "good",
  Applied: "neutral", Interview: "warn", Offer: "accent", Joined: "good", Rejected: "bad", active: "good", left: "neutral",
};

/** Error line under a form. */
export function FormError({ children }: { children?: string }) {
  return children ? <div className="mt-3 rounded-xl bg-bad-soft text-bad text-sm px-3 py-2">{children}</div> : null;
}
