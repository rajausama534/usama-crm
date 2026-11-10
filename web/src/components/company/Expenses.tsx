"use client";

import { useState } from "react";
import { Loader2, Plus, Receipt } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Empty, Field, Input, Segmented, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { DataTable, FileField, FormError, SIMPLE_TONE } from "./kit";
import { isFinance, requestApproval, uploadDoc, useRefresh, useRows } from "@/lib/company/data";
import { EXPENSE_CATEGORIES, num, r2, type Expense } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

const blank = () => ({ kind: "expense" as "expense" | "advance", expense_date: todayDubai(), category: "Other", vendor: "", description: "", amount: "", vat: "", receipt_path: null as string | null, staff_email: "", approveNow: true });

/** Expenses and advances. Staff submit with a receipt; Accounts or Usama approve. `mineOnly` = the person's own requests. */
export function Expenses({ mineOnly }: { mineOnly?: boolean }) {
  const { me } = useAuth();
  const staff = useStaff();
  const toast = useToast();
  const refresh = useRefresh();
  const finance = isFinance(me) && !mineOnly;
  const list = useRows<Expense>("crm_expenses", { key: [mineOnly ? "mine" : "all"], order: "expense_date", filter: mineOnly ? (q) => q.or(`submitted_by.ilike.${me!.email},staff_email.ilike.${me!.email}`) : undefined });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"all" | "pending" | "advances">("all");
  const [f, setF] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  async function save() {
    if (!me) return;
    if (!(num(f.amount) > 0)) return setErr("Enter the amount.");
    if (f.kind === "expense" && !f.description.trim() && !f.vendor.trim()) return setErr("Say what the expense was for.");
    setBusy(true); setErr("");
    const advanceFor = f.kind === "advance" ? (finance && f.staff_email ? f.staff_email : me.email) : null;
    const direct = finance && f.approveNow;
    const body = {
      kind: f.kind, expense_date: f.expense_date, category: f.kind === "advance" ? "Advance" : f.category, vendor: f.vendor.trim() || null, description: f.description.trim() || null,
      amount: num(f.amount), vat: f.kind === "advance" ? 0 : num(f.vat), receipt_path: f.receipt_path, staff_email: advanceFor, status: direct ? "approved" : "pending",
    };
    const r = await db.from("crm_expenses").insert(body).select("id").single();
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    try {
      if (!direct) await requestApproval({
        kind: f.kind, ref_table: "crm_expenses", ref_id: r.data.id, amount: r2(body.amount + body.vat),
        title: f.kind === "advance" ? `Advance for ${staffName(staff.data, advanceFor)}` : `${body.category}${body.vendor ? ` · ${body.vendor}` : ""}`,
        summary: [body.description, f.receipt_path ? "Receipt attached" : "No receipt"].filter(Boolean).join("\n"),
      });
    } catch (x) { setBusy(false); return setErr(`Saved, but it could not be sent for approval: ${(x as Error).message}`); }
    setBusy(false); setOpen(false); toast(direct ? "Saved" : "Sent for approval"); refresh();
  }

  const rows = (list.data || []).filter((e) => view === "all" || (view === "pending" ? e.status === "pending" : e.kind === "advance"));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <Segmented value={view} onChange={setView} options={[{ value: "all", label: "All" }, { value: "pending", label: "Waiting" }, { value: "advances", label: "Advances" }]} />
        <Button variant="primary" onClick={() => { setF(blank()); setErr(""); setOpen(true); }}><Plus size={15} /> {mineOnly ? "New expense or advance" : "Add expense"}</Button>
      </div>
      <DataTable rows={rows} empty={<Empty icon={<Receipt size={28} />} title="No expenses here" hint="Add an expense with a photo of the receipt. Approved expenses go into the books and the VAT return." />} cols={[
        { h: "Date", cell: (e) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(e.expense_date)}</span> },
        { h: "What", cell: (e) => <div className="min-w-40"><div className="font-medium">{e.kind === "advance" ? `Advance · ${staffName(staff.data, e.staff_email)}` : e.category}</div><div className="text-xs text-ink-3">{[e.vendor, e.description].filter(Boolean).join(" · ")}</div></div> },
        { h: "By", cell: (e) => <span className="text-ink-2 whitespace-nowrap">{staffName(staff.data, e.submitted_by)}</span> },
        { h: "Amount", right: true, cell: (e) => aed(e.amount) },
        { h: "VAT", right: true, cell: (e) => (num(e.vat) ? aed(e.vat) : "—") },
        { h: "Total", right: true, cell: (e) => <span className="font-medium">{aed(e.total ?? num(e.amount) + num(e.vat))}</span> },
        { h: "Receipt", cell: (e) => <FileField path={e.receipt_path} disabled onPick={async () => {}} /> },
        { h: "Status", cell: (e) => <span className="flex gap-1"><Badge tone={SIMPLE_TONE[e.status]}>{e.status}</Badge>{e.kind === "advance" && e.status === "approved" && <Badge tone={num(e.recovered) >= num(e.amount) ? "good" : "warn"}>{num(e.recovered) >= num(e.amount) ? "recovered" : `${aed(num(e.amount) - num(e.recovered))} to recover`}</Badge>}</span> },
      ]} />

      <Sheet open={open} onClose={() => setOpen(false)} title={f.kind === "advance" ? "Advance" : "Expense"} footer={<>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}{finance && f.approveNow ? "Save" : "Send for approval"}</Button>
      </>}>
        <div className="mb-4"><Segmented value={f.kind} onChange={(k) => setF((v) => ({ ...v, kind: k }))} options={[{ value: "expense", label: "Expense" }, { value: "advance", label: "Advance / loan" }]} /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.expense_date} onChange={set("expense_date")} /></Field>
          {f.kind === "expense" ? (
            <Field label="Category"><Select value={f.category} onChange={set("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          ) : finance ? (
            <Field label="Advance for"><Select value={f.staff_email} onChange={set("staff_email")}><option value="">Choose…</option>{(staff.data || []).map((u) => <option key={u.email} value={u.email}>{u.name || u.email}</option>)}</Select></Field>
          ) : <div />}
          {f.kind === "expense" && <Field label="Paid to (vendor)" className="sm:col-span-2"><Input value={f.vendor} onChange={set("vendor")} /></Field>}
          <Field label={f.kind === "expense" ? "Amount before VAT, AED" : "Amount AED"}><Input inputMode="decimal" value={f.amount} onChange={set("amount")} /></Field>
          {f.kind === "expense" && (
            <Field label="VAT on the receipt, AED">
              <div className="flex gap-2"><Input inputMode="decimal" value={f.vat} onChange={set("vat")} placeholder="0" />
                <Button type="button" onClick={() => setF((v) => ({ ...v, vat: String(r2(num(v.amount) * 0.05)) }))}>5%</Button></div>
            </Field>
          )}
          <Field label={f.kind === "expense" ? "What was it for?" : "Reason"} className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set("description")} /></Field>
          {f.kind === "expense" && <Field label="Receipt" className="sm:col-span-2"><FileField path={f.receipt_path} label="Attach receipt" onPick={async (file) => { const p = await uploadDoc("receipts", file); setF((v) => ({ ...v, receipt_path: p })); }} /></Field>}
        </div>
        {f.kind === "expense" && num(f.amount) > 0 && <div className="mt-3 text-sm text-ink-2">Total paid: <span className="num text-ink font-medium">{aed(r2(num(f.amount) + num(f.vat)))}</span></div>}
        {f.kind === "advance" && <div className="mt-3 text-xs text-ink-3">An approved advance is taken back from the person&apos;s next commission.</div>}
        {finance && <label className="mt-4 flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[var(--accent)]" checked={f.approveNow} onChange={(e) => setF((v) => ({ ...v, approveNow: e.target.checked }))} /> Already approved (goes straight into the books)</label>}
        <FormError>{err}</FormError>
      </Sheet>
    </>
  );
}
