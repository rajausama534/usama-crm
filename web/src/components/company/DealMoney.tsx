"use client";

// The money side of a deal (invoice, money received from the client, agent payouts, history). Lives in Accounts → Commissions.
import Link from "next/link";
import { useState } from "react";
import { FileText, Loader2, Plus } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useStaff, staffName } from "@/lib/hooks";
import { Button, Field, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { FormError, Line, Section } from "@/components/company/kit";
import { autoInvoiceDeal, isFinance, useRefresh, useRows } from "@/lib/company/data";
import { advancesOwed, dealMoney, num, payableNow, r2, type Deal, type DealPayment, type Expense, type Invoice, type Split } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

type Pay = { kind: "received" | "payout"; email?: string; amount: string; date: string; method: string; note: string; recover: string; max?: number };

export function DealMoney({ deal }: { deal: Deal }) {
  const { me } = useAuth();
  const staff = useStaff();
  const toast = useToast();
  const refresh = useRefresh();
  const finance = isFinance(me);
  const id = deal.id;
  const splits = useRows<Split>("crm_deal_splits", { key: [id], filter: (q) => q.eq("deal_id", id) });
  const payments = useRows<DealPayment>("crm_deal_payments", { key: [id], filter: (q) => q.eq("deal_id", id), order: "paid_on" });
  const invoices = useRows<Invoice>("crm_invoices", { key: ["deal", id], enabled: finance, filter: (q) => q.eq("deal_id", id) });
  const advances = useRows<Expense>("crm_expenses", { key: ["advances"], enabled: finance, filter: (q) => q.eq("kind", "advance").eq("status", "approved") });
  const [pay, setPay] = useState<Pay | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const dm = dealMoney(deal);
  const sp = splits.data || [];
  const active = !["pending", "rejected", "cancelled"].includes(deal.status);

  async function makeInvoice() {
    setBusy(true);
    const no = await autoInvoiceDeal(deal.id);
    setBusy(false);
    toast(no ? `Invoice ${no} created` : "Could not create the invoice"); refresh();
  }

  async function savePayment() {
    if (!pay) return;
    const amount = num(pay.amount), recover = num(pay.recover);
    if (!(amount > 0)) return setErr("Enter the amount.");
    if (recover > amount) return setErr("The advance recovered cannot be more than the commission being paid.");
    setBusy(true); setErr("");
    const note = [pay.note.trim(), recover ? `AED ${recover.toLocaleString("en-US")} kept back against advance` : ""].filter(Boolean).join(" · ") || null;
    const r = await db.from("crm_deal_payments").insert({ deal_id: deal.id, kind: pay.kind, email: pay.kind === "payout" ? pay.email : null, amount, paid_on: pay.date, method: pay.method || null, note });
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    if (pay.kind === "received") {
      // Keep the deal's tax invoice in step with the money received.
      const inv = (invoices.data || []).find((i) => i.status !== "cancelled");
      if (inv) { const paid = r2(num(inv.paid) + amount); await db.from("crm_invoices").update({ paid, status: paid >= num(inv.total) ? "paid" : "part_paid" }).eq("id", inv.id); }
    }
    if (recover && pay.email) {
      // Oldest advances first.
      let left = recover;
      for (const a of (advances.data || []).filter((x) => (x.staff_email || "").toLowerCase() === pay.email && num(x.amount) > num(x.recovered)).sort((x, y) => x.expense_date.localeCompare(y.expense_date))) {
        if (left <= 0) break;
        const take = Math.min(left, num(a.amount) - num(a.recovered));
        await db.from("crm_expenses").update({ recovered: r2(num(a.recovered) + take) }).eq("id", a.id);
        left = r2(left - take);
      }
    }
    setBusy(false); setPay(null);
    toast(pay.kind === "received" ? "Money received recorded" : "Payout recorded"); refresh();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-surface-2 p-4">
        <Line label="Due from the client (commission + VAT)" value={aed(dm.due)} />
        <Line label="Received so far" value={aed(deal.received)} tone={num(deal.received) >= dm.due ? "good" : undefined} />
        <Line label="Still to come" value={aed(Math.max(0, r2(dm.due - num(deal.received))))} strong />
      </div>
      {finance && active && (
        <div className="flex flex-wrap gap-2">
          {invoices.data && !invoices.data.some((i) => i.status !== "cancelled") && <Button onClick={makeInvoice} disabled={busy}><FileText size={15} /> Create tax invoice</Button>}
          <Button variant="primary" onClick={() => { setErr(""); setPay({ kind: "received", amount: String(Math.max(0, r2(dm.due - num(deal.received)))), date: todayDubai(), method: deal.payment_method || "bank", note: "", recover: "" }); }}><Plus size={15} /> Money received</Button>
        </div>
      )}
      {(invoices.data || []).map((i) => (
        <Link key={i.id} href={`/accounts?tab=invoices&open=${i.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm hover:border-line-strong">
          <span className="flex items-center gap-2 text-ink"><FileText size={15} className="text-ink-3" /> {i.invoice_no}</span><span className="num text-ink-2">{aed(i.total)} · {i.status.replace("_", " ")}</span>
        </Link>
      ))}

      <Section title="Commission to pay">
        {!sp.length ? <div className="text-sm text-ink-3">No agent share on this deal.</div> : (
          <div className="rounded-xl border border-line divide-y divide-line">
            {sp.map((l) => {
              const now = payableNow(deal, l), owed = advancesOwed(advances.data || [], l.email);
              return (
                <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="flex-1 min-w-40"><div className="text-ink">{staffName(staff.data, l.email)}</div>
                    <div className="text-xs text-ink-3 num">{aed(l.amount)} earned · {aed(l.paid)} paid{owed > 0 && finance ? ` · advance outstanding ${aed(owed)}` : ""}</div></div>
                  {finance && active && now > 0 ? (
                    <Button size="sm" variant="primary" onClick={() => { setErr(""); setPay({ kind: "payout", email: l.email, amount: String(now), max: now, date: todayDubai(), method: "bank", note: "", recover: owed > 0 ? String(Math.min(owed, now)) : "" }); }}>Pay {aed(now)}</Button>
                  ) : <span className="text-xs text-ink-3">{num(l.paid) >= num(l.amount) && num(l.amount) > 0 ? "Paid in full" : "Paid as the client's money arrives"}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {pay && (
        <div className="rounded-2xl border border-accent/40 p-4">
          <div className="font-medium text-ink mb-3">{pay.kind === "received" ? "Money received from the client" : `Pay ${staffName(staff.data, pay.email)}`}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Amount AED"><Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
            <Field label="Method"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option></Select></Field>
            {pay.kind === "payout" && <Field label="Of which kept against advance"><Input inputMode="decimal" value={pay.recover} onChange={(e) => setPay({ ...pay, recover: e.target.value })} placeholder="0" /></Field>}
            <Field label="Note" className="col-span-2"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
          </div>
          {pay.kind === "payout" && num(pay.recover) > 0 && <div className="mt-2 text-xs text-ink-3">Transfer to the agent: {aed(Math.max(0, r2(num(pay.amount) - num(pay.recover))))}</div>}
          <FormError>{err}</FormError>
          <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button><Button variant="primary" onClick={savePayment} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button></div>
        </div>
      )}

      <Section title="History">
        {!(payments.data || []).length ? <div className="text-sm text-ink-3">No payments recorded yet.</div> : (
          <div className="rounded-xl border border-line divide-y divide-line">
            {(payments.data || []).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div><div className="text-ink">{p.kind === "received" ? "Received from client" : p.kind === "payout" ? `Paid to ${staffName(staff.data, p.email)}` : "Paid to other agency"}</div>
                  <div className="text-xs text-ink-3">{fmtDate(p.paid_on)}{p.method ? ` · ${p.method}` : ""}{p.note ? ` · ${p.note}` : ""}</div></div>
                <div className={`num ${p.kind === "received" ? "text-good" : "text-ink"}`}>{p.kind === "received" ? "+" : "−"} {aed(p.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
