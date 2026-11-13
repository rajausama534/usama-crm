"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, Loader2, Mail, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { Badge, Button, Empty, Field, Input, Sheet, Textarea, buttonClass } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { DataTable, FormError, Line, SIMPLE_TONE } from "@/components/company/kit";
import { useCompany, useRefresh, useRows } from "@/lib/company/data";
import { COUNTED, DEAL_TYPES, addDays, invoiceFromDeal, num, r2, type CompanySettings, type Deal, type Developer, type Invoice } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n: unknown) => new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(n));

/** The tax invoice as a printable page (Print → Save as PDF). Shows everything the FTA asks for on a tax invoice. */
export function invoiceHtml(i: Invoice, co: CompanySettings) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(i.invoice_no)}</title><style>
  body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#12122e;margin:0;padding:48px;max-width:820px;margin:auto}
  h1{font-size:26px;font-weight:600;margin:0;letter-spacing:.02em}.muted{color:#5d5f7c}.row{display:flex;justify-content:space-between;gap:32px}
  table{width:100%;border-collapse:collapse;margin-top:28px}th{text-align:left;font-size:12px;color:#5d5f7c;border-bottom:1px solid #d6d6e6;padding:8px 0}
  td{padding:10px 0;border-bottom:1px solid #ececf4;vertical-align:top}.r{text-align:right;white-space:nowrap}.tot td{border:0;padding:4px 0}.grand td{font-weight:600;font-size:16px;border-top:2px solid #12122e;padding-top:10px}
  .box{margin-top:36px;padding:16px;background:#f5f5fb;border-radius:10px;font-size:13px}@media print{body{padding:24px}}</style></head><body>
  <div class="row"><div><h1>TAX INVOICE</h1><div class="muted">${esc(i.invoice_no)}</div></div>
  <div style="text-align:right"><strong>${esc(co.name || "Usama Real Estate")}</strong><br>${esc(co.address || "").replace(/\n/g, "<br>")}<br>${co.trn ? `TRN ${esc(co.trn)}` : ""}${co.orn ? `<br>ORN ${esc(co.orn)}` : ""}<br>${esc([co.phone, co.email].filter(Boolean).join(" · "))}</div></div>
  <div class="row" style="margin-top:36px"><div><div class="muted">Bill to</div><strong>${esc(i.bill_to)}</strong><br>${esc(i.bill_to_address || "").replace(/\n/g, "<br>")}${i.bill_to_trn ? `<br>TRN ${esc(i.bill_to_trn)}` : ""}</div>
  <div style="text-align:right"><div class="muted">Invoice date</div>${esc(fmtDate(i.issue_date))}<div class="muted" style="margin-top:8px">Due date</div>${esc(fmtDate(i.due_date))}</div></div>
  <table><thead><tr><th>Description</th><th class="r">Amount (AED)</th><th class="r">VAT 5%</th><th class="r">Total (AED)</th></tr></thead><tbody>
  ${(i.lines || []).map((l) => { const v = num(i.vat) > 0 ? r2(num(l.amount) * 0.05) : 0; return `<tr><td>${esc(l.description)}</td><td class="r">${money(l.amount)}</td><td class="r">${money(v)}</td><td class="r">${money(num(l.amount) + v)}</td></tr>`; }).join("")}
  </tbody></table>
  <table style="width:320px;margin-left:auto;margin-top:12px"><tbody>
  <tr class="tot"><td>Total before VAT</td><td class="r">${money(i.subtotal)}</td></tr><tr class="tot"><td>VAT 5%</td><td class="r">${money(i.vat)}</td></tr>
  <tr class="grand"><td>Total due (AED)</td><td class="r">${money(num(i.subtotal) + num(i.vat))}</td></tr></tbody></table>
  ${co.iban ? `<div class="box"><strong>Bank details</strong><br>${esc(co.bank_account_name || co.name || "")}<br>${esc(co.bank_name || "")}<br>IBAN ${esc(co.iban)}${co.swift ? ` · SWIFT ${esc(co.swift)}` : ""}</div>` : ""}
  ${i.notes ? `<p class="muted" style="margin-top:24px">${esc(i.notes)}</p>` : ""}</body></html>`;
}
export function printInvoice(i: Invoice, co: CompanySettings) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(invoiceHtml(i, co)); w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}

export function Invoices({ openId }: { openId?: string | null }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { settings } = useCompany();
  const [ask, confirmNode] = useConfirm();
  const list = useRows<Invoice>("crm_invoices", { order: "issue_date" });
  const [open, setOpen] = useState<string | null>(openId || null);
  const blank = { bill_to: "", bill_to_address: "", bill_to_trn: "", issue_date: todayDubai(), due_date: addDays(todayDubai(), 7), notes: "", vatOn: true };
  const [f, setF] = useState(blank);
  const [lines, setLines] = useState([{ description: "", amount: "" }]);
  const deals = useRows<Deal>("crm_deals", { order: "deal_date" });
  const developers = useRows<Developer>("crm_developers", { order: "name", asc: true });
  const [dealId, setDealId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [payAmt, setPayAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (openId) setOpen(openId); }, [openId]);
  const inv = (list.data || []).find((i) => i.id === open);
  const sub = r2(lines.reduce((s, l) => s + num(l.amount), 0));
  const invoiced = new Set((list.data || []).filter((i) => i.deal_id && i.status !== "cancelled").map((i) => i.deal_id));
  const devName = (d: Deal) => (developers.data || []).find((x) => x.id === d.developer_id)?.name || "";
  const term = f.bill_to.trim().toLowerCase();
  const matches = (deals.data || []).filter((d) => COUNTED.has(d.status)
    && (!term || `${d.client_name} ${d.other_agency || ""} ${devName(d)} ${d.community || ""} ${d.cluster || ""} ${d.unit || ""} ${d.deal_no}`.toLowerCase().includes(term))).slice(0, 8);
  const linked = (deals.data || []).find((d) => d.id === dealId);
  function pickDeal(d: Deal) {
    const x = invoiceFromDeal(d, developers.data || [], todayDubai());
    setF((v) => ({ ...v, bill_to: x.bill_to, due_date: x.due_date, vatOn: true }));
    setLines(x.lines.map((l) => ({ description: l.description, amount: String(l.amount) })));
    setDealId(d.id); setPickOpen(false); setErr("");
  }

  async function create() {
    if (!f.bill_to.trim()) return setErr("Enter who the invoice is for.");
    const ls = lines.filter((l) => l.description.trim() && num(l.amount) > 0).map((l) => ({ description: l.description.trim(), amount: num(l.amount) }));
    if (!ls.length) return setErr("Add at least one line with a description and an amount.");
    setBusy(true); setErr("");
    if (dealId && invoiced.has(dealId)) return setErr("This deal already has an invoice. Cancel that one first, or remove the deal link.");
    const r = await db.from("crm_invoices").insert({ deal_id: dealId, bill_to: f.bill_to.trim(), bill_to_address: f.bill_to_address.trim() || null, bill_to_trn: f.bill_to_trn.trim() || null, issue_date: f.issue_date,
      due_date: f.due_date || null, lines: ls, subtotal: sub, vat: f.vatOn ? r2(sub * 0.05) : 0, notes: f.notes.trim() || null }).select("id,invoice_no").single();
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    toast(`Invoice ${r.data.invoice_no} created`); refresh(); setOpen(r.data.id);
  }
  async function recordPayment() {
    if (!inv || !(num(payAmt) > 0)) return;
    const paid = r2(num(inv.paid) + num(payAmt));
    const r = await db.from("crm_invoices").update({ paid, status: paid >= num(inv.total) ? "paid" : "part_paid" }).eq("id", inv.id);
    if (r.error) return toast(r.error.message);
    setPayAmt(""); toast("Payment recorded"); refresh();
  }
  async function cancel() {
    if (!inv || !(await ask({ title: `Cancel invoice ${inv.invoice_no}?`, hint: "It stays in the records marked Cancelled and leaves the VAT return. Issue a new invoice if needed.", yes: "Cancel invoice", danger: true }))) return;
    const r = await db.from("crm_invoices").update({ status: "cancelled" }).eq("id", inv.id);
    if (r.error) toast(r.error.message); else { toast("Invoice cancelled"); refresh(); }
  }
  const mailto = inv ? `mailto:?subject=${encodeURIComponent(`Tax invoice ${inv.invoice_no} from ${settings.name || "Usama Real Estate"}`)}&body=${encodeURIComponent(`Dear ${inv.bill_to},\n\nPlease find attached tax invoice ${inv.invoice_no} for AED ${money(inv.total)}, due ${fmtDate(inv.due_date)}.\n\n${settings.iban ? `Bank: ${settings.bank_name || ""}\nIBAN: ${settings.iban}\n\n` : ""}Thank you,\n${settings.name || "Usama Real Estate"}`)}` : "";

  return (
    <>
      <div className="flex justify-end mb-3"><Button variant="primary" onClick={() => { setF(blank); setLines([{ description: "", amount: "" }]); setDealId(null); setErr(""); setOpen("new"); }}><Plus size={15} /> New invoice</Button></div>
      {!settings.trn && <div className="mb-3 rounded-xl bg-warn-soft text-warn text-sm px-3 py-2">Add the company TRN, address and bank details in Settings so they print on every invoice.</div>}
      <DataTable rows={list.data || []} onRow={(i) => setOpen(i.id)} empty={<Empty icon={<FileText size={28} />} title="No invoices yet" hint="Approved deals get their invoice automatically. You can also create one here: search the client under Bill to." />} cols={[
        { h: "Invoice", cell: (i) => <span className="font-medium num">{i.invoice_no}</span> },
        { h: "Date", cell: (i) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(i.issue_date)}</span> },
        { h: "Bill to", cell: (i) => i.bill_to },
        { h: "Before VAT", right: true, cell: (i) => aed(i.subtotal) },
        { h: "VAT", right: true, cell: (i) => aed(i.vat) },
        { h: "Total", right: true, cell: (i) => <span className="font-medium">{aed(i.total)}</span> },
        { h: "Due", cell: (i) => <span className={`num whitespace-nowrap ${i.status !== "paid" && i.status !== "cancelled" && i.due_date && i.due_date < todayDubai() ? "text-bad" : "text-ink-2"}`}>{fmtDate(i.due_date)}</span> },
        { h: "Status", cell: (i) => <Badge tone={SIMPLE_TONE[i.status]}>{i.status.replace("_", " ")}</Badge> },
      ]} />

      <Sheet open={open === "new"} onClose={() => setOpen(null)} wide title="New tax invoice" footer={<>
        <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
        <Button variant="primary" onClick={create} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Create invoice</Button>
      </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Bill to (search a client or deal)">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <Input className="pl-9" value={f.bill_to} placeholder="Client name, unit or deal number" autoComplete="off"
                onFocus={() => setPickOpen(true)} onBlur={() => setTimeout(() => setPickOpen(false), 150)}
                onChange={(e) => { setF({ ...f, bill_to: e.target.value }); setPickOpen(true); }} />
              {pickOpen && matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-line bg-surface shadow-pop">
                  {matches.map((d) => {
                    const x = invoiceFromDeal(d, developers.data || []);
                    return (
                      <button key={d.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickDeal(d)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-line last:border-0">
                        <div className="flex items-center justify-between gap-2 text-sm"><span className="font-medium text-ink truncate">{x.bill_to}</span><span className="num text-ink-2 whitespace-nowrap">{aed(r2(x.subtotal * 1.05))}</span></div>
                        <div className="text-xs text-ink-3 truncate">Deal #{d.deal_no} · {[DEAL_TYPES[d.deal_type]?.label, d.community, d.cluster, d.unit].filter(Boolean).join(" · ")}{invoiced.has(d.id) ? " · already invoiced" : ""}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {linked && <span className="mt-1 flex items-center gap-1 text-xs text-ink-3">Linked to deal #{linked.deal_no}: amounts filled from the deal<button type="button" aria-label="Remove deal link" onClick={() => setDealId(null)} className="hover:text-bad"><X size={13} /></button></span>}
          </Field>
          <Field label="Their TRN (if registered)"><Input value={f.bill_to_trn} onChange={(e) => setF({ ...f, bill_to_trn: e.target.value })} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.bill_to_address} onChange={(e) => setF({ ...f, bill_to_address: e.target.value })} /></Field>
          <Field label="Invoice date"><Input type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <div className="mt-4 text-xs font-medium text-ink-2 mb-1.5">Lines (before VAT)</div>
        <div className="space-y-2">
          {lines.map((l, n) => (
            <div key={n} className="flex gap-2">
              <Input value={l.description} placeholder="Description" onChange={(e) => setLines((x) => x.map((y, m) => (m === n ? { ...y, description: e.target.value } : y)))} />
              <Input className="w-36" inputMode="decimal" value={l.amount} placeholder="AED" onChange={(e) => setLines((x) => x.map((y, m) => (m === n ? { ...y, amount: e.target.value } : y)))} />
              <button type="button" aria-label="Remove line" onClick={() => setLines((x) => x.filter((_, m) => m !== n))} className="px-1 text-ink-3 hover:text-bad"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((x) => [...x, { description: "", amount: "" }])} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent-text"><Plus size={14} /> Add line</button>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="accent-[var(--accent)]" checked={f.vatOn} onChange={(e) => setF({ ...f, vatOn: e.target.checked })} /> Add 5% VAT</label>
        <div className="mt-3 rounded-2xl bg-surface-2 p-4"><Line label="Before VAT" value={aed(sub)} /><Line label="VAT 5%" value={aed(f.vatOn ? r2(sub * 0.05) : 0)} /><Line label="Total" value={aed(r2(sub * (f.vatOn ? 1.05 : 1)))} strong /></div>
        <Field label="Note on the invoice" className="mt-4"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <FormError>{err}</FormError>
      </Sheet>

      <Sheet open={!!inv} onClose={() => setOpen(null)} wide title={inv ? <span className="flex items-center gap-2">{inv.invoice_no} <Badge tone={SIMPLE_TONE[inv.status]}>{inv.status.replace("_", " ")}</Badge></span> : ""}
        footer={inv && <>
          {inv.status !== "cancelled" && inv.status !== "paid" && <Button variant="ghost" onClick={cancel}>Cancel invoice</Button>}
          <a href={mailto} className={buttonClass("secondary")}><Mail size={15} /> Email</a>
          <Button variant="primary" onClick={() => { if (!printInvoice(inv, settings)) toast("Allow pop-ups to print the invoice"); }}><Printer size={15} /> Print / PDF</Button>
        </>}>
        {inv && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-ink-3">Bill to</div><div className="text-ink">{inv.bill_to}</div>{inv.bill_to_trn && <div className="text-ink-3 num">TRN {inv.bill_to_trn}</div>}</div>
              <div><div className="text-xs text-ink-3">Dates</div><div className="text-ink num">{fmtDate(inv.issue_date)} · due {fmtDate(inv.due_date)}</div></div>
            </div>
            <div className="rounded-2xl bg-surface-2 p-4">
              {(inv.lines || []).map((l, n) => <Line key={n} label={l.description} value={aed(l.amount)} />)}
              <Line label="VAT 5%" value={aed(inv.vat)} /><Line label="Total" value={aed(inv.total)} strong />
              <Line label="Paid" value={aed(inv.paid)} tone={num(inv.paid) >= num(inv.total) ? "good" : undefined} />
            </div>
            {inv.status !== "cancelled" && inv.status !== "paid" && (inv.deal_id ? (
              <Link href={`/deals?open=${inv.deal_id}`} className={buttonClass("secondary")}>Record the money on the deal</Link>
            ) : (
              <div className="flex items-end gap-2"><Field label="Payment received, AED"><Input inputMode="decimal" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} placeholder={String(r2(num(inv.total) - num(inv.paid)))} /></Field><Button onClick={recordPayment}>Record</Button></div>
            ))}
            <div className="text-xs text-ink-3">Email opens your mail app with the message ready: print the invoice to PDF first and attach it.</div>
          </div>
        )}
      </Sheet>
      {confirmNode}
    </>
  );
}
