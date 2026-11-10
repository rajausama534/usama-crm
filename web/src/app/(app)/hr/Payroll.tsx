"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Lock, Wallet } from "lucide-react";
import { db } from "@/lib/supabase";
import { Badge, Button, Card, Empty, Input } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { PAY_METHODS, addMonths, monthEnd, monthLabel, monthStart, num, r2, sifFile, toCsv, type DealPayment, type PayrollLine, type PayrollRun, type Staff } from "@/lib/company/calc";
import { downloadText, useCompany, useRefresh, useRows } from "@/lib/company/data";
import { aed, fmtDate, todayDubai } from "@/lib/format";

/** Monthly payroll: one line per person, the WPS salary file for the bank, and a receipt for cash salaries. */
export function Payroll() {
  const toast = useToast();
  const refresh = useRefresh();
  const { settings } = useCompany();
  const [ask, confirmNode] = useConfirm();
  const [month, setMonth] = useState(monthStart(todayDubai()));
  const staff = useRows<Staff>("crm_staff", { key: ["all"] });
  const runs = useRows<PayrollRun>("crm_payroll_runs", { order: "month" });
  const lines = useRows<PayrollLine>("crm_payroll_lines");
  const payouts = useRows<DealPayment>("crm_deal_payments", { key: ["payouts"], filter: (q) => q.eq("kind", "payout") });
  const [busy, setBusy] = useState(false);
  const run = (runs.data || []).find((r) => r.month === month);
  const rows = useMemo(() => (lines.data || []).filter((l) => l.run_id === run?.id).map((l) => ({ line: l, staff: (staff.data || []).find((s) => s.id === l.staff_id)! })).filter((r) => r.staff)
    .sort((a, b) => a.staff.full_name.localeCompare(b.staff.full_name)), [lines.data, run?.id, staff.data]);
  const total = r2(rows.reduce((s, r) => s + num(r.line.net ?? num(r.line.basic) + num(r.line.allowances) + num(r.line.commission) - num(r.line.advance_recovery) - num(r.line.deductions)), 0));
  const draft = run?.status === "draft";

  async function prepare() {
    setBusy(true);
    const r = await db.from("crm_payroll_runs").insert({ month, status: "draft" }).select("id").single();
    if (r.error) { setBusy(false); return toast(r.error.message); }
    const end = monthEnd(month);
    const people = (staff.data || []).filter((s) => s.status === "active" && (!s.join_date || s.join_date <= end));
    const body = people.map((s) => ({
      run_id: r.data.id, staff_id: s.id, basic: num(s.basic_salary), allowances: num(s.allowances), pay_method: s.pay_method,
      // Commission paid out on deals this month, shown here so the payslip is complete.
      commission: r2((payouts.data || []).filter((p) => s.email && (p.email || "").toLowerCase() === s.email.toLowerCase() && p.paid_on >= month && p.paid_on <= end).reduce((t, p) => t + num(p.amount), 0)),
    }));
    if (body.length) { const l = await db.from("crm_payroll_lines").insert(body); if (l.error) toast(l.error.message); }
    setBusy(false); refresh();
  }
  async function patch(l: PayrollLine, k: "basic" | "allowances" | "commission" | "advance_recovery" | "deductions", v: string) {
    if (num(v) === num(l[k])) return;
    const r = await db.from("crm_payroll_lines").update({ [k]: num(v) }).eq("id", l.id);
    if (r.error) toast(r.error.message); else refresh();
  }
  async function finalise() {
    if (!run || !(await ask({ title: `Finalise payroll for ${monthLabel(month)}?`, hint: "The figures are fixed after this and count in the profit and loss.", yes: "Finalise" }))) return;
    const r = await db.from("crm_payroll_runs").update({ status: "final", finalised_at: new Date().toISOString() }).eq("id", run.id);
    if (r.error) toast(r.error.message); else { toast("Payroll finalised"); refresh(); }
  }
  async function setPaid(l: PayrollLine, paid: boolean) {
    const r = await db.from("crm_payroll_lines").update({ paid }).eq("id", l.id);
    if (r.error) toast(r.error.message); else refresh();
  }
  function sif() {
    const wps = rows.filter((r) => r.line.pay_method === "wps");
    if (!wps.length) return toast("Nobody in this payroll is paid by WPS");
    const missing = wps.filter((r) => !r.staff.iban || !r.staff.labour_no || !r.staff.bank_code).map((r) => r.staff.full_name);
    if (missing.length) return toast(`Add IBAN, routing code and MOHRE number for: ${missing.join(", ")}`);
    if (!settings.mohre_establishment_id || !settings.wps_bank_code) return toast("Add the MOHRE establishment ID and bank routing code in Accounts → Settings");
    const f = sifFile(settings, month, wps);
    downloadText(f.name, f.text, "text/plain");
  }
  function receipt(s: Staff, l: PayrollLine) {
    const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to print the receipt");
    const net = num(l.net ?? num(l.basic) + num(l.allowances) + num(l.commission) - num(l.advance_recovery) - num(l.deductions));
    const row = (a: string, b: number) => (b ? `<tr><td>${a}</td><td style="text-align:right">${b.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>` : "");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Salary receipt</title><style>body{font:14px/1.6 -apple-system,Helvetica,Arial,sans-serif;padding:48px;max-width:640px;margin:auto;color:#12122e}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:6px 0;border-bottom:1px solid #e6e6f0}.t td{font-weight:600;border-top:2px solid #12122e;border-bottom:0}</style></head><body>
      <h2 style="margin:0">Salary receipt</h2><div>${settings.name || "Usama Real Estate"}</div>
      <p>Received by <strong>${s.full_name}</strong> in cash, salary for <strong>${monthLabel(month)}</strong>.</p>
      <table>${row("Basic salary", num(l.basic))}${row("Allowances", num(l.allowances))}${row("Commission", num(l.commission))}${row("Advance recovered", -num(l.advance_recovery))}${row("Deductions", -num(l.deductions))}
      <tr class="t"><td>Net paid (AED)</td><td style="text-align:right">${net.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr></table>
      <p style="margin-top:56px">Date: ____________________ &nbsp;&nbsp; Signature: ______________________________</p></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  }
  const cell = (l: PayrollLine, k: "basic" | "allowances" | "commission" | "advance_recovery" | "deductions") => draft
    ? <Input key={`${l.id}${k}${l[k]}`} defaultValue={num(l[k]) ? String(l[k]) : ""} placeholder="0" inputMode="decimal" onBlur={(e) => patch(l, k, e.target.value)} className="w-24 min-w-[5.5rem] h-8 text-right num" />
    : <span className="num">{num(l[k]) ? aed(l[k]) : "—"}</span>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Input type="month" className="w-44" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)} />
        <Button size="sm" variant="ghost" onClick={() => setMonth(addMonths(month, -1))}>Earlier</Button>
        {run && <Badge tone={draft ? "warn" : "good"}>{draft ? "Draft" : "Final"}</Badge>}
        <span className="flex-1" />
        {run && <Button onClick={() => downloadText(`payroll-${month.slice(0, 7)}.csv`, toCsv(rows.map((r) => ({ name: r.staff.full_name, basic: r.line.basic, allowances: r.line.allowances, commission: r.line.commission, advance_recovery: r.line.advance_recovery, deductions: r.line.deductions, net: r.line.net, paid_by: PAY_METHODS[r.line.pay_method], paid: r.line.paid ? "yes" : "no" }))))}><Download size={15} /> Excel</Button>}
        {run && <Button onClick={sif}><Download size={15} /> WPS file (SIF)</Button>}
        {draft && <Button variant="primary" onClick={finalise}><Lock size={15} /> Finalise</Button>}
      </div>
      {!run ? (
        <Card><Empty icon={<Wallet size={28} />} title={`No payroll for ${monthLabel(month)} yet`} hint="Preparing it adds a line for every active staff member from their salary on file. You can adjust each line before finalising."
          action={<Button variant="primary" onClick={prepare} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Prepare payroll</Button>} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-xs text-ink-3 text-right"><th className="font-medium px-4 py-3 text-left">Person</th><th className="font-medium px-2">Basic</th><th className="font-medium px-2">Allowances</th><th className="font-medium px-2">Commission</th><th className="font-medium px-2">Advance recovered</th><th className="font-medium px-2">Deductions</th><th className="font-medium px-2">Net pay</th><th className="font-medium px-4 text-left">Paid</th></tr></thead>
              <tbody>
                {rows.map(({ line: l, staff: s }) => (
                  <tr key={l.id} className="border-t border-line text-right">
                    <td className="px-4 py-2 text-left"><div className="font-medium text-ink">{s.full_name}</div><div className="text-xs text-ink-3">{PAY_METHODS[l.pay_method]}</div></td>
                    <td className="px-2">{cell(l, "basic")}</td><td className="px-2">{cell(l, "allowances")}</td><td className="px-2">{cell(l, "commission")}</td><td className="px-2">{cell(l, "advance_recovery")}</td><td className="px-2">{cell(l, "deductions")}</td>
                    <td className="px-2 num font-semibold text-ink whitespace-nowrap">{aed(l.net ?? num(l.basic) + num(l.allowances) + num(l.commission) - num(l.advance_recovery) - num(l.deductions))}</td>
                    <td className="px-4 text-left whitespace-nowrap">
                      <label className="inline-flex items-center gap-1.5 text-ink-2"><input type="checkbox" className="accent-[var(--accent)]" checked={l.paid} onChange={(e) => setPaid(l, e.target.checked)} /> Paid</label>
                      {l.pay_method === "cash" && <button className="ml-3 text-xs font-medium text-accent-text hover:underline" onClick={() => receipt(s, l)}>Receipt</button>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-3">No active staff with a record yet.</td></tr>}
              </tbody>
              <tfoot><tr className="border-t border-line-strong font-semibold text-ink"><td className="px-4 py-3" colSpan={6}>Total net pay · {monthLabel(month)}</td><td className="px-2 text-right num whitespace-nowrap">{aed(total)}</td><td /></tr></tfoot>
            </table>
          </div>
        </Card>
      )}
      <div className="mt-2 text-xs text-ink-3">Commission shows what was paid out on deals this month ({fmtDate(month)} – {fmtDate(monthEnd(month))}). The WPS file follows the Central Bank SIF layout: check the first file with your bank before sending.</div>
      {confirmNode}
    </>
  );
}
