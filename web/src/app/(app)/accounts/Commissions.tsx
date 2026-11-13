"use client";

// Accounts → Commissions: every approved deal's billing in one place — invoice, money received from the client, agent payouts.
import { useMemo, useState } from "react";
import { Handshake } from "lucide-react";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Empty, SearchBox, Segmented, Sheet, Stat } from "@/components/ui";
import { DataTable, DEAL_TONE } from "@/components/company/kit";
import { DealMoney } from "@/components/company/DealMoney";
import { useRows } from "@/lib/company/data";
import { COUNTED, DEAL_STATUS, DEAL_TYPES, advancesOwed, dealMoney, num, payableNow, r2, type Deal, type Expense, type Invoice, type Split } from "@/lib/company/calc";
import { aed, fmtDate } from "@/lib/format";

export function Commissions({ openId, onOpen }: { openId?: string | null; onOpen: (id: string | null) => void }) {
  const staff = useStaff();
  const deals = useRows<Deal>("crm_deals", { order: "deal_date" });
  const splits = useRows<Split>("crm_deal_splits");
  const invoices = useRows<Invoice>("crm_invoices", { order: "issue_date" });
  const advances = useRows<Expense>("crm_expenses", { key: ["advances"], filter: (q) => q.eq("kind", "advance").eq("status", "approved") });
  const [view, setView] = useState<"deals" | "agents">("deals");
  const [show, setShow] = useState<"open" | "all">("open");
  const [q, setQ] = useState("");

  const counted = useMemo(() => (deals.data || []).filter((d) => COUNTED.has(d.status)), [deals.data]);
  const byDeal = useMemo(() => { const m = new Map<string, Split[]>(); for (const s of splits.data || []) m.set(s.deal_id, [...(m.get(s.deal_id) || []), s]); return m; }, [splits.data]);
  const invOf = useMemo(() => { const m = new Map<string, Invoice>(); for (const i of invoices.data || []) if (i.deal_id && i.status !== "cancelled") m.set(i.deal_id, i); return m; }, [invoices.data]);
  const toCome = (d: Deal) => Math.max(0, r2(dealMoney(d).due - num(d.received)));
  const owedTo = (d: Deal) => r2((byDeal.get(d.id) || []).reduce((s, l) => s + num(l.amount) - num(l.paid), 0));

  const stats = useMemo(() => ({
    toCome: r2(counted.reduce((s, d) => s + toCome(d), 0)),
    owed: r2(counted.reduce((s, d) => s + owedTo(d), 0)),
    payable: r2(counted.reduce((s, d) => s + (byDeal.get(d.id) || []).reduce((t, l) => t + payableNow(d, l), 0), 0)),
    noInvoice: counted.filter((d) => !invOf.has(d.id)).length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [counted, byDeal, invOf]);

  const shown = counted.filter((d) => (show === "all" || toCome(d) > 0 || owedTo(d) > 0)
    && (!q || `${d.client_name} ${d.community || ""} ${d.cluster || ""} ${d.unit || ""} ${d.deal_no}`.toLowerCase().includes(q.toLowerCase())));
  const deal = (deals.data || []).find((d) => d.id === openId);

  const agents = useMemo(() => {
    const byId = new Map(counted.map((d) => [d.id, d]));
    const m = new Map<string, { id: string; earned: number; paid: number; now: number; deals: number }>();
    for (const s of splits.data || []) {
      const d = byId.get(s.deal_id);
      if (!d) continue;
      const k = s.email.toLowerCase(); const cur = m.get(k) || { id: k, earned: 0, paid: 0, now: 0, deals: 0 };
      cur.earned = r2(cur.earned + num(s.amount)); cur.paid = r2(cur.paid + num(s.paid)); cur.now = r2(cur.now + payableNow(d, s)); cur.deals++;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.now - a.now || b.earned - a.earned);
  }, [counted, splits.data]);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Still to be received" value={aed(stats.toCome)} hint="Commission + VAT on approved deals" />
        <Stat label="Owed to agents" value={aed(stats.owed)} hint={`${aed(stats.payable)} can be paid now`} tone={stats.payable > 0 ? "warn" : undefined} />
        <Stat label="Approved deals" value={String(counted.length)} />
        <Stat label="Without an invoice" value={String(stats.noInvoice)} tone={stats.noInvoice ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Segmented value={view} onChange={setView} options={[{ value: "deals", label: "By deal" }, { value: "agents", label: "Agent payouts" }]} />
        {view === "deals" && <>
          <Segmented value={show} onChange={setShow} options={[{ value: "open", label: "Money pending" }, { value: "all", label: "All" }]} />
          <SearchBox value={q} onChange={setQ} placeholder="Search client, unit or deal number" />
        </>}
      </div>

      {view === "deals" ? (
        <DataTable rows={shown} onRow={(d) => onOpen(d.id)}
          empty={<Empty icon={<Handshake size={28} />} title={counted.length ? "Nothing pending" : "No approved deals yet"} hint={counted.length ? "Every approved deal is fully received and paid out. Switch to All to see them." : "Deals appear here once they are approved."} />}
          cols={[
            { h: "#", cell: (d) => <span className="num text-ink-3">{d.deal_no}</span> },
            { h: "Date", cell: (d) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(d.deal_date)}</span> },
            { h: "Client", cell: (d) => <div className="min-w-32"><div className="font-medium">{d.client_name}</div><div className="text-xs text-ink-3">{[DEAL_TYPES[d.deal_type]?.label, d.community, d.cluster, d.unit].filter(Boolean).join(" · ")}</div></div> },
            { h: "Agents", cell: (d) => <span className="text-ink-2">{(byDeal.get(d.id) || []).filter((s) => s.kind === "agent").map((s) => staffName(staff.data, s.email)).join(", ") || "Company"}</span> },
            { h: "Due incl. VAT", right: true, cell: (d) => aed(dealMoney(d).due) },
            { h: "Received", right: true, cell: (d) => aed(d.received) },
            { h: "Still to come", right: true, cell: (d) => <span className={toCome(d) > 0 ? "text-warn font-medium" : "text-ink-3"}>{aed(toCome(d))}</span> },
            { h: "Owed to agents", right: true, cell: (d) => <span className={owedTo(d) > 0 ? "text-ink" : "text-ink-3"}>{aed(owedTo(d))}</span> },
            { h: "Invoice", cell: (d) => { const i = invOf.get(d.id); return i ? <span className="num whitespace-nowrap">{i.invoice_no}</span> : <Badge tone="warn">None</Badge>; } },
            { h: "Status", cell: (d) => <Badge tone={DEAL_TONE[d.status]}>{DEAL_STATUS[d.status]}</Badge> },
          ]} />
      ) : (
        <>
          <DataTable rows={agents} empty={<Empty title="No commission to pay yet" hint="Agents appear here once a deal with their share is approved." />} cols={[
            { h: "Person", cell: (r) => <span className="font-medium">{staffName(staff.data, r.id)}</span> },
            { h: "Deals", right: true, cell: (r) => r.deals },
            { h: "Earned", right: true, cell: (r) => aed(r.earned) },
            { h: "Paid", right: true, cell: (r) => aed(r.paid) },
            { h: "Still owed", right: true, cell: (r) => aed(r2(r.earned - r.paid)) },
            { h: "Can be paid now", right: true, cell: (r) => <span className={r.now > 0 ? "text-warn font-medium" : "text-ink-3"}>{aed(r.now)}</span> },
            { h: "Advance outstanding", right: true, cell: (r) => { const a = advancesOwed(advances.data || [], r.id); return a > 0 ? <span className="text-bad">{aed(a)}</span> : <span className="text-ink-3">—</span>; } },
          ]} />
          <div className="mt-2 text-xs text-ink-3">Agents are paid in proportion to the client&apos;s money received. To pay someone, open the deal in By deal.</div>
        </>
      )}

      <Sheet open={!!deal} onClose={() => onOpen(null)} large
        title={deal ? <span className="flex items-center gap-2 flex-wrap">Deal #{deal.deal_no} · {deal.client_name} <Badge tone={DEAL_TONE[deal.status]}>{DEAL_STATUS[deal.status]}</Badge></span> : ""}>
        {deal && <DealMoney deal={deal} />}
      </Sheet>
    </>
  );
}
