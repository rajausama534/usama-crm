"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Button, Card, Field, Input, ListSkeleton, PageHeader, Select, Stat, Tabs, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { FormError, Line, Section, SetupNeeded, signedAed } from "@/components/company/kit";
import { Expenses } from "@/components/company/Expenses";
import { useCompany, useRefresh, useRows } from "@/lib/company/data";
import { addDays, bankBalance, cashForecast, daysBetween, num, periodOf, profitAndLoss, r2, vatReturn, type BankAccount, type BankLine, type CompanySettings } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";
import { Invoices } from "./Invoices";
import { Bills } from "./Bills";
import { Bank } from "./Bank";
import { Reports, useBooks } from "./Reports";

type Tab = "overview" | "invoices" | "expenses" | "bills" | "bank" | "reports" | "settings";

export default function AccountsPage() {
  return <Suspense><Accounts /></Suspense>;
}

function Accounts() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const setTab = (t: Tab) => router.replace(t === "overview" ? "/accounts" : `/accounts?tab=${t}`, { scroll: false });
  const b = useBooks();

  if (b.loading) return <><PageHeader title="Accounts" /><ListSkeleton /></>;
  if (b.missing) return <><PageHeader title="Accounts" /><SetupNeeded what="Accounts" /></>;
  return (
    <div className="animate-in">
      <PageHeader title="Accounts" subtitle="Invoices, expenses, bills, the bank and the reports for your accountant" />
      <Tabs className="mb-5" value={tab} onChange={setTab} options={[
        { value: "overview", label: "Overview" }, { value: "invoices", label: "Invoices" }, { value: "expenses", label: "Expenses", n: b.expenses.filter((e) => e.status === "pending").length || undefined },
        { value: "bills", label: "Bills" }, { value: "bank", label: "Bank" }, { value: "reports", label: "Reports" }, { value: "settings", label: "Settings" },
      ]} />
      {tab === "overview" && <Overview />}
      {tab === "invoices" && <Invoices openId={params.get("open")} />}
      {tab === "expenses" && <Expenses />}
      {tab === "bills" && <Bills />}
      {tab === "bank" && <Bank />}
      {tab === "reports" && <Reports />}
      {tab === "settings" && <Settings />}
    </div>
  );
}

function Overview() {
  const b = useBooks();
  const { settings } = useCompany();
  const accounts = useRows<BankAccount>("crm_bank_accounts");
  const lines = useRows<BankLine>("crm_bank_lines", { order: "line_date", limit: 5000 });
  const today = todayDubai();
  const x = useMemo(() => {
    const q = periodOf("quarter", today, settings.vat_first_month || 1);
    const unpaid = b.invoices.filter((i) => ["unpaid", "part_paid"].includes(i.status));
    const dueBills = b.bills.filter((bill) => bill.active && daysBetween(today, bill.next_due) <= 7);
    return {
      q, vat: vatReturn(b.invoices, b.expenses, q), month: profitAndLoss(b, periodOf("month", today)), cash: cashForecast(b, today, addDays(today, 60)),
      unpaid, unpaidTotal: r2(unpaid.reduce((s, i) => s + num(i.total) - num(i.paid), 0)), overdue: unpaid.filter((i) => i.due_date && i.due_date < today).length,
      dueBills, bank: r2((accounts.data || []).reduce((s, a) => s + bankBalance(a, lines.data || []), 0)),
    };
  }, [b, settings.vat_first_month, today, accounts.data, lines.data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Bank balance as per the books" value={aed(x.bank)} hint={(accounts.data || []).length ? `${(lines.data || []).filter((l) => !l.match_kind).length} lines not matched` : "Add the bank account in Bank"} />
        <Stat label="Profit this month" value={signedAed(x.month.profit)} tone={x.month.profit < 0 ? "bad" : "good"} hint={`Income ${aed(x.month.income)}`} />
        <Stat label="Invoices unpaid" value={aed(x.unpaidTotal)} tone={x.overdue ? "bad" : undefined} hint={`${x.unpaid.length} open${x.overdue ? `, ${x.overdue} overdue` : ""}`} />
        <Stat label="VAT this quarter" value={aed(x.vat.payable)} hint={`Due ${fmtDate(x.vat.due)}`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <Section title="Next 60 days">
            <Line label="Commission expected in" value={aed(x.cash.totalIn)} tone="good" />
            <Line label="Going out (bills, salaries, agent commission)" value={`− ${aed(x.cash.totalOut)}`} />
            <Line label="Net" value={signedAed(r2(x.cash.totalIn - x.cash.totalOut))} strong tone={x.cash.totalIn < x.cash.totalOut ? "bad" : undefined} />
          </Section>
        </Card>
        <Card className="p-5">
          <Section title="Bills due this week">
            {!x.dueBills.length ? <div className="text-sm text-ink-3">Nothing due in the next 7 days.</div>
              : x.dueBills.map((bill) => <Line key={bill.id} label={bill.name} hint={bill.next_due < today ? `${daysBetween(bill.next_due, today)} days late` : `due ${fmtDate(bill.next_due)}`} value={aed(r2(num(bill.amount) + num(bill.vat)))} tone={bill.next_due < today ? "bad" : undefined} />)}
          </Section>
        </Card>
      </div>
    </div>
  );
}

const FIELDS: [keyof CompanySettings, string, string?][] = [
  ["name", "Company name"], ["trn", "TRN (tax registration number)"], ["orn", "RERA office number (ORN)"], ["phone", "Phone"], ["email", "Email"],
  ["bank_account_name", "Bank account name"], ["bank_name", "Bank"], ["iban", "IBAN"], ["swift", "SWIFT"],
  ["mohre_establishment_id", "MOHRE establishment ID (13 digits, for WPS)"], ["wps_bank_code", "Company bank routing code (9 digits, for WPS)"],
];

function Settings() {
  const { me } = useAuth();
  const toast = useToast();
  const refresh = useRefresh();
  const { settings, data } = useCompany();
  const [f, setF] = useState<CompanySettings>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setF(settings); }, [data]);

  async function save() {
    setBusy(true); setErr("");
    const r = await db.from("crm_company_settings").update({ data: f, updated_by: me?.email, updated_at: new Date().toISOString() }).eq("id", 1);
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    toast("Saved"); refresh();
  }
  return (
    <Card className="p-5 max-w-3xl">
      <div className="text-sm text-ink-2 mb-4">These print on tax invoices and go into the WPS salary file.</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {FIELDS.map(([k, label]) => <Field key={k} label={label}><Input value={String(f[k] ?? "")} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
        <Field label="A VAT quarter starts in">
          <Select value={String(f.vat_first_month || 1)} onChange={(e) => setF({ ...f, vat_first_month: Number(e.target.value) })}>
            <option value="1">January, April, July, October</option><option value="2">February, May, August, November</option><option value="3">March, June, September, December</option>
          </Select>
        </Field>
        <Field label="Address (as on the trade licence)" className="sm:col-span-2"><Textarea rows={2} value={f.address || ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      <FormError>{err}</FormError>
      <div className="mt-4 flex justify-end"><Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button></div>
    </Card>
  );
}
