"use client";

import { useState } from "react";
import { CalendarClock, Check, Loader2, Plus } from "lucide-react";
import { db } from "@/lib/supabase";
import { Badge, Button, Empty, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { DataTable, FormError } from "@/components/company/kit";
import { useRefresh, useRows } from "@/lib/company/data";
import { EXPENSE_CATEGORIES, daysBetween, nextDue, num, r2, type Bill } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

const FREQ: Record<string, string> = { once: "One time", monthly: "Every month", quarterly: "Every 3 months", yearly: "Every year" };

/** Recurring bills (tenancy, utilities, visa renewals…) with due dates and reminders. */
export function Bills() {
  const toast = useToast();
  const refresh = useRefresh();
  const [ask, confirmNode] = useConfirm();
  const list = useRows<Bill>("crm_bills", { order: "next_due", asc: true });
  const [edit, setEdit] = useState<Bill | "new" | null>(null);
  const blank = { name: "", category: "Office rent", vendor: "", amount: "", vat: "", frequency: "monthly", next_due: todayDubai(), remind_days: "7", notes: "", active: true };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const today = todayDubai();

  function start(b: Bill | "new") {
    setErr(""); setEdit(b);
    setF(b === "new" ? blank : { name: b.name, category: b.category, vendor: b.vendor || "", amount: String(b.amount), vat: num(b.vat) ? String(b.vat) : "", frequency: b.frequency, next_due: b.next_due, remind_days: String(b.remind_days), notes: b.notes || "", active: b.active });
  }
  async function save() {
    if (!f.name.trim()) return setErr("Enter the bill's name.");
    setBusy(true); setErr("");
    const body = { name: f.name.trim(), category: f.category, vendor: f.vendor.trim() || null, amount: num(f.amount), vat: num(f.vat), frequency: f.frequency, next_due: f.next_due, remind_days: num(f.remind_days), notes: f.notes.trim() || null, active: f.active };
    const r = edit === "new" ? await db.from("crm_bills").insert(body) : await db.from("crm_bills").update(body).eq("id", (edit as Bill).id);
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    toast("Saved"); setEdit(null); refresh();
  }
  /** Paying a bill puts it in the books as an approved expense and moves the due date on. */
  async function markPaid(b: Bill) {
    if (!(await ask({ title: `Mark “${b.name}” as paid?`, hint: `${aed(r2(num(b.amount) + num(b.vat)))} goes into the books as an expense dated today.${b.frequency !== "once" ? ` Next due ${fmtDate(nextDue(b.next_due, b.frequency))}.` : ""}`, yes: "Mark paid" }))) return;
    const e = await db.from("crm_expenses").insert({ kind: "expense", expense_date: today, category: b.category, vendor: b.vendor, description: b.name, amount: num(b.amount), vat: num(b.vat), bill_id: b.id, status: "approved" });
    if (e.error) return toast(e.error.message);
    const r = await db.from("crm_bills").update(b.frequency === "once" ? { active: false } : { next_due: nextDue(b.next_due, b.frequency) }).eq("id", b.id);
    if (r.error) return toast(r.error.message);
    toast("Paid and recorded"); refresh();
  }

  return (
    <>
      <div className="flex justify-end mb-3"><Button variant="primary" onClick={() => start("new")}><Plus size={15} /> Add bill</Button></div>
      <DataTable rows={(list.data || []).filter((b) => b.active)} onRow={start} empty={<Empty icon={<CalendarClock size={28} />} title="No bills yet" hint="Add the office tenancy, utilities, visa renewals and other bills. You get a reminder before each one is due, and they show in the cash forecast." />} cols={[
        { h: "Bill", cell: (b) => <div><div className="font-medium">{b.name}</div><div className="text-xs text-ink-3">{[b.category, b.vendor].filter(Boolean).join(" · ")}</div></div> },
        { h: "How often", cell: (b) => <span className="text-ink-2 whitespace-nowrap">{FREQ[b.frequency]}</span> },
        { h: "Amount", right: true, cell: (b) => aed(r2(num(b.amount) + num(b.vat))) },
        { h: "Next due", cell: (b) => { const d = daysBetween(today, b.next_due); return <span className="flex items-center gap-2 whitespace-nowrap"><span className="num">{fmtDate(b.next_due)}</span>{d < 0 ? <Badge tone="bad">{-d} days late</Badge> : d <= b.remind_days ? <Badge tone="warn">{d === 0 ? "today" : `in ${d} days`}</Badge> : null}</span>; } },
        { h: "", right: true, cell: (b) => <Button size="sm" onClick={(e) => { e.stopPropagation(); markPaid(b); }}><Check size={14} /> Paid</Button> },
      ]} />

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add bill" : "Bill"} footer={<>
        <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button>
      </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Office tenancy, DEWA, Omar's visa renewal" /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Paid to"><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
          <Field label="Amount before VAT, AED"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="VAT, AED"><Input inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} placeholder="0" /></Field>
          <Field label="How often"><Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Next due"><Input type="date" value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} /></Field>
          <Field label="Remind me (days before)"><Input inputMode="numeric" value={f.remind_days} onChange={(e) => setF({ ...f, remind_days: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        {edit !== "new" && <label className="mt-4 flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[var(--accent)]" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (untick to stop this bill)</label>}
        <FormError>{err}</FormError>
      </Sheet>
      {confirmNode}
    </>
  );
}
