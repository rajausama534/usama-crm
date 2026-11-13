"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Check, X, Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Card, Empty, ListSkeleton, PageHeader, Segmented, Textarea, type Tone } from "@/components/ui";
import { aed, fmtDateTime } from "@/lib/format";
import { autoInvoiceDeal } from "@/lib/company/data";

type Approval = {
  id: string; kind: string; ref_table: string; ref_id: string; title: string; summary: string | null; amount: number | null;
  requested_by: string; requested_at: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null;
};
const REF_LINK: Record<string, (id: string) => string> = {
  crm_deals: (id) => `/deals?open=${id}`, crm_listings: (id) => `/listings?open=${id}`, crm_expenses: () => "/accounts?tab=expenses", crm_leave: () => "/hr?tab=leave",
};
const KIND_LABEL: Record<string, string> = { deal: "Deal", expense: "Expense", advance: "Advance", leave: "Leave", listing: "Listing" };
const STATUS_TONE: Record<string, Tone> = { pending: "warn", approved: "good", rejected: "bad", withdrawn: "neutral" };

export default function ApprovalsPage() {
  const { me } = useAuth();
  const staff = useStaff();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "done" | "mine">("pending");
  const [deciding, setDeciding] = useState<{ a: Approval; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const q = useQuery({
    queryKey: ["approvals", tab],
    queryFn: async () => {
      let query = db.from("crm_approvals").select("*").order("requested_at", { ascending: false }).limit(200);
      if (tab === "pending") query = query.eq("status", "pending");
      if (tab === "done") query = query.neq("status", "pending");
      if (tab === "mine") query = query.ilike("requested_by", me!.email);
      const { data, error } = await query;
      if (error) {
        // Table arrives with the step-1 database update.
        if (/relation|does not exist|schema cache/i.test(error.message)) return null;
        throw error;
      }
      return (data || []) as Approval[];
    },
  });

  async function decide() {
    if (!deciding) return;
    setBusy(true); setErr("");
    const { error } = await db.rpc("crm_decide_approval", { p_id: deciding.a.id, p_approve: deciding.approve, p_note: note || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    // An approved deal gets its tax invoice straight away (Accounts only; does nothing for others).
    if (deciding.approve && deciding.a.ref_table === "crm_deals") await autoInvoiceDeal(deciding.a.ref_id);
    setDeciding(null); setNote("");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }

  return (
    <div className="animate-in">
      <PageHeader title="Approvals" subtitle="Deals, expenses, advances, leave and listings waiting for a decision"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: "pending", label: "Waiting" }, { value: "done", label: "Decided" }, { value: "mine", label: "My requests" }]} />} />

      {q.isLoading ? <ListSkeleton rows={4} /> : q.data === null ? (
        <Card><Empty icon={<Inbox size={28} />} title="Approvals switch on with the database update" hint="Once it’s applied, deals, expenses, leave and listings that need a decision will collect here." /></Card>
      ) : !q.data?.length ? (
        <Card><Empty icon={<Inbox size={28} />} title={tab === "pending" ? "Nothing waiting for you" : "Nothing here yet"} hint={tab === "pending" ? "New requests will appear here as soon as they’re submitted." : undefined} /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {q.data.map((a) => (
            <div key={a.id} className="p-4 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="accent">{KIND_LABEL[a.kind] || a.kind}</Badge>
                  <span className="font-medium text-ink">{a.title}</span>
                  {a.status !== "pending" && <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>}
                </div>
                {a.summary && <div className="text-sm text-ink-2 mt-1 whitespace-pre-wrap">{a.summary}</div>}
                {REF_LINK[a.ref_table] && <Link href={REF_LINK[a.ref_table](a.ref_id)} className="inline-block mt-1 text-[13px] font-medium text-accent-text hover:underline">Open the {KIND_LABEL[a.kind]?.toLowerCase() || "item"}</Link>}
                <div className="text-xs text-ink-3 mt-1.5">
                  {staffName(staff.data, a.requested_by)} · {fmtDateTime(a.requested_at)}
                  {a.decided_by && ` · ${a.status} by ${staffName(staff.data, a.decided_by)} ${fmtDateTime(a.decided_at)}`}
                  {a.decision_note && ` — “${a.decision_note}”`}
                </div>
              </div>
              {a.amount != null && <div className="text-right font-semibold num text-ink">{aed(a.amount)}</div>}
              {a.status === "pending" && tab !== "mine" && a.requested_by.toLowerCase() !== me?.email && (
                <div className="flex gap-2 w-full sm:w-auto justify-end">
                  <Button size="sm" onClick={() => setDeciding({ a, approve: false })}><X size={14} /> Reject</Button>
                  <Button size="sm" variant="primary" onClick={() => setDeciding({ a, approve: true })}><Check size={14} /> Approve</Button>
                </div>
              )}
              {a.status === "pending" && a.requested_by.toLowerCase() === me?.email && (
                <Button size="sm" variant="ghost" onClick={async () => { await db.rpc("crm_withdraw_approval", { p_id: a.id }); qc.invalidateQueries({ queryKey: ["approvals"] }); }}>Withdraw</Button>
              )}
            </div>
          ))}
        </Card>
      )}

      {deciding && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDeciding(null)} />
          <Card className="relative w-full max-w-md p-5 shadow-pop animate-in">
            <div className="font-semibold text-ink">{deciding.approve ? "Approve" : "Reject"}: {deciding.a.title}</div>
            <Textarea className="mt-3" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding.approve ? "Note (optional)" : "Reason (helps the person fix it)"} />
            {err && <div className="text-sm text-bad mt-2">{err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setDeciding(null)}>Cancel</Button>
              <Button variant={deciding.approve ? "primary" : "danger"} onClick={decide} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}{deciding.approve ? "Approve" : "Reject"}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
