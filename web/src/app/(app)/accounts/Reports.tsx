"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useStaff, staffName } from "@/lib/hooks";
import { Button, Card, Segmented } from "@/components/ui";
import { Line, Section, signedAed } from "@/components/company/kit";
import { downloadText, useCompany, useRows } from "@/lib/company/data";
import {
  COUNTED, addDays, cashForecast, corporateTax, dealMoney, monthLabel, num, periodOf, profitAndLoss, r2, shiftPeriod, toCsv, vatReturn,
  type Bill, type Deal, type Developer, type Expense, type Invoice, type PayrollLine, type PayrollRun, type Split, type Staff,
} from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

/** Everything the reports read. Shared with the Accounts overview. */
export function useBooks() {
  const deals = useRows<Deal>("crm_deals", { order: "deal_date" });
  const splits = useRows<Split>("crm_deal_splits");
  const invoices = useRows<Invoice>("crm_invoices", { order: "issue_date" });
  const expenses = useRows<Expense>("crm_expenses", { key: ["all"], order: "expense_date" });
  const bills = useRows<Bill>("crm_bills", { order: "next_due", asc: true });
  const developers = useRows<Developer>("crm_developers", { order: "name", asc: true });
  const staff = useRows<Staff>("crm_staff", { key: ["all"] });
  const runs = useRows<PayrollRun>("crm_payroll_runs", { order: "month" });
  const lines = useRows<PayrollLine>("crm_payroll_lines");
  return {
    loading: deals.isLoading || invoices.isLoading || expenses.isLoading, missing: deals.data === null || invoices.data === null,
    deals: deals.data || [], splits: splits.data || [], invoices: invoices.data || [], expenses: expenses.data || [], bills: bills.data || [],
    developers: developers.data || [], staff: staff.data || [], runs: runs.data || [], lines: lines.data || [],
  };
}

export function Reports() {
  const b = useBooks();
  const people = useStaff();
  const { settings } = useCompany();
  const today = todayDubai();
  const first = settings.vat_first_month || 1;
  const [kind, setKind] = useState<"month" | "quarter" | "year">("month");
  const [p, setP] = useState(() => periodOf("month", today, first));
  const change = (k: typeof kind) => { setKind(k); setP(periodOf(k, today, first)); };

  const pl = useMemo(() => profitAndLoss(b, p), [b, p]);
  const quarter = useMemo(() => periodOf("quarter", p.from, first), [p.from, first]);
  const vat = useMemo(() => vatReturn(b.invoices, b.expenses, quarter), [b.invoices, b.expenses, quarter]);
  const year = useMemo(() => profitAndLoss(b, periodOf("year", p.from)), [b, p.from]);
  const cash = useMemo(() => cashForecast(b, today, addDays(today, 90)), [b, today]);
  const team = useMemo(() => {
    const ids = new Map(b.deals.filter((d) => COUNTED.has(d.status) && d.deal_date >= p.from && d.deal_date <= p.to).map((d) => [d.id, d]));
    const m = new Map<string, { deals: number; office: number; earned: number }>();
    for (const s of b.splits) {
      const d = ids.get(s.deal_id); if (!d || s.kind !== "agent") continue;
      const cur = m.get(s.email) || { deals: 0, office: 0, earned: 0 };
      cur.deals++; cur.office = r2(cur.office + num(d.office_commission) * num(s.share_pct) / 100); cur.earned = r2(cur.earned + num(s.amount));
      m.set(s.email, cur);
    }
    return [...m].sort((a, c) => c[1].office - a[1].office);
  }, [b.deals, b.splits, p]);

  function exportBooks() {
    const inP = (d: string) => d >= p.from && d <= p.to;
    const rows = [
      ...b.deals.filter((d) => COUNTED.has(d.status) && inP(d.deal_date)).map((d) => ({ date: d.deal_date, type: "Deal", ref: `#${d.deal_no}`, party: d.client_name, description: [d.community, d.cluster, d.unit].filter(Boolean).join(" "), net: dealMoney(d).gross, vat: d.vat, total: dealMoney(d).due, status: d.status })),
      ...b.invoices.filter((i) => inP(i.issue_date)).map((i) => ({ date: i.issue_date, type: "Invoice", ref: i.invoice_no, party: i.bill_to, description: (i.lines || []).map((l) => l.description).join("; "), net: i.subtotal, vat: i.vat, total: i.total, status: i.status })),
      ...b.expenses.filter((e) => inP(e.expense_date)).map((e) => ({ date: e.expense_date, type: e.kind === "advance" ? "Advance" : "Expense", ref: e.category, party: e.vendor || e.staff_email || "", description: e.description || "", net: -num(e.amount), vat: -num(e.vat), total: -r2(num(e.amount) + num(e.vat)), status: e.status })),
    ].sort((x, y) => x.date.localeCompare(y.date));
    if (!rows.length) return;
    downloadText(`books-${p.from}-to-${p.to}.csv`, toCsv(rows));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={kind} onChange={change} options={[{ value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }]} />
        <div className="flex items-center gap-1">
          <button aria-label="Earlier" onClick={() => setP(shiftPeriod(kind, p, -1, first))} className="p-1.5 rounded-full text-ink-2 hover:bg-surface-2"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-ink min-w-36 text-center">{p.label}</span>
          <button aria-label="Later" onClick={() => setP(shiftPeriod(kind, p, 1, first))} className="p-1.5 rounded-full text-ink-2 hover:bg-surface-2"><ChevronRight size={18} /></button>
        </div>
        <span className="flex-1" />
        <Button onClick={exportBooks}><Download size={15} /> Excel export</Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <Section title={`Profit and loss · ${p.label}`}>
            <Line label={`Commission income (${pl.deals} deal${pl.deals === 1 ? "" : "s"})`} value={aed(pl.income)} />
            {pl.otherAgency > 0 && <Line label="Other agencies' share" value={`− ${aed(pl.otherAgency)}`} />}
            <Line label="Agent and team-leader commission" value={`− ${aed(pl.commissions)}`} />
            <Line label="Company share" value={signedAed(pl.gross)} strong />
            {Object.entries(pl.byCategory).sort((a, c) => c[1] - a[1]).map(([k, v]) => <Line key={k} label={k} value={`− ${aed(v)}`} />)}
            {!pl.overheads && <div className="py-1.5 text-sm text-ink-3">No approved expenses in this period.</div>}
            <Line label="Profit" value={signedAed(pl.profit)} strong tone={pl.profit < 0 ? "bad" : "good"} />
          </Section>
        </Card>

        <Card className="p-5">
          <Section title={`VAT return · ${quarter.label}`}>
            <div className="text-xs text-ink-3 mb-2">From {vat.invoices} tax invoice{vat.invoices === 1 ? "" : "s"} and {vat.expenses} expense{vat.expenses === 1 ? "" : "s"} with VAT. File and pay by {fmtDate(vat.due)}.</div>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink-3 text-left"><th className="font-medium py-1.5 w-10">Box</th><th className="font-medium"></th><th className="font-medium text-right">Amount</th><th className="font-medium text-right pl-3">VAT</th></tr></thead>
              <tbody>{vat.boxes.map((x) => (
                <tr key={x.box} className={`border-t border-line ${x.box === "14" ? "font-semibold" : ""}`}><td className="py-1.5 num text-ink-3">{x.box}</td><td className="text-ink-2 pr-2">{x.label}</td>
                  <td className="text-right num whitespace-nowrap">{x.amount == null ? "" : aed(x.amount)}</td><td className="text-right num whitespace-nowrap pl-3 text-ink">{aed(x.vat)}</td></tr>
              ))}</tbody>
            </table>
            <div className="mt-2 text-xs text-ink-3">Figures for your accountant, who reviews and files the return.</div>
          </Section>
        </Card>

        <Card className="p-5">
          <Section title="Cash forecast · next 90 days">
            <Line label="Commission expected in" value={aed(cash.totalIn)} tone="good" />
            <Line label="Bills, salaries and agent commission going out" value={`− ${aed(cash.totalOut)}`} />
            <Line label="Net" value={signedAed(r2(cash.totalIn - cash.totalOut))} strong tone={cash.totalIn - cash.totalOut < 0 ? "bad" : undefined} />
            <div className="mt-3 space-y-1">
              {Object.entries(cash.months).map(([m, v]) => <div key={m} className="flex justify-between text-xs text-ink-2"><span>{monthLabel(`${m}-01`)}</span><span className="num">+ {aed(v.in)} · − {aed(v.out)}</span></div>)}
            </div>
            <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line divide-y divide-line">
              {cash.events.map((e, i) => <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-[13px]"><span className="num text-ink-3 whitespace-nowrap w-20">{fmtDate(e.date).replace(/ \d{4}$/, "")}</span><span className="flex-1 min-w-0 truncate text-ink-2">{e.label}</span><span className={`num whitespace-nowrap ${e.amount > 0 ? "text-good" : "text-ink"}`}>{e.amount > 0 ? "+" : "−"} {aed(Math.abs(e.amount))}</span></div>)}
              {!cash.events.length && <div className="px-3 py-3 text-sm text-ink-3">Nothing expected in or out yet.</div>}
            </div>
          </Section>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <Section title={`Corporate tax estimate · ${p.from.slice(0, 4)}`}>
              <Line label="Profit for the year so far" value={signedAed(year.profit)} />
              <Line label="Tax-free amount" value={aed(375000)} />
              <Line label="Estimated tax (9% above AED 375,000)" value={aed(corporateTax(year.profit))} strong />
              <div className="mt-2 text-xs text-ink-3">An estimate from the books. Your accountant works out the final figure.</div>
            </Section>
          </Card>
          <Card className="p-5">
            <Section title={`Agents · ${p.label}`}>
              {!team.length ? <div className="text-sm text-ink-3">No approved deals with agents in this period.</div> : team.map(([email, v]) => (
                <Line key={email} label={staffName(people.data, email)} hint={`${v.deals} deal${v.deals === 1 ? "" : "s"} · earned ${aed(v.earned)}`} value={aed(v.office)} />
              ))}
              {team.length > 0 && <div className="mt-1 text-xs text-ink-3">Figure on the right: office commission each agent brought in.</div>}
            </Section>
          </Card>
        </div>
      </div>
    </div>
  );
}
