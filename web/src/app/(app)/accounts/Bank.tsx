"use client";

import { useMemo, useRef, useState } from "react";
import { Landmark, Loader2, Plus, Upload } from "lucide-react";
import { db } from "@/lib/supabase";
import { loadScript } from "@/lib/tools";
import { Badge, Button, Card, Empty, Field, FilterSelect, Input, Select, Sheet } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { DataTable, FormError } from "@/components/company/kit";
import { useRefresh, useRows } from "@/lib/company/data";
import { bankBalance, num, r2, type BankAccount, type BankLayout, type BankLine, type Expense, type Invoice } from "@/lib/company/calc";
import { aed, fmtDate } from "@/lib/format";

const XLSX_SRC = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const KINDS: Record<string, string> = { deal: "Deal commission", invoice: "Invoice", expense: "Expense", payout: "Agent commission", payroll: "Salaries", transfer: "Transfer between accounts", other: "Other" };

/** Statement dates in the usual bank formats: 05/11/2026, 5-Nov-26, 2026-11-05. UAE banks write the day first. */
export function parseBankDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{2,4})/);
  if (m) { const mo = MONTHS.indexOf(m[2].toLowerCase()); if (mo >= 0) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m && Number(m[2]) <= 12) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
export function parseBankAmount(v: unknown): number {
  let s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^0-9.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
const guess = (headers: string[], re: RegExp) => headers.find((h) => re.test(h)) || "";

export function Bank() {
  const toast = useToast();
  const refresh = useRefresh();
  const accounts = useRows<BankAccount>("crm_bank_accounts", { order: "created_at", asc: true });
  const lines = useRows<BankLine>("crm_bank_lines", { order: "line_date", limit: 5000 });
  const invoices = useRows<Invoice>("crm_invoices");
  const expenses = useRows<Expense>("crm_expenses");
  const [acc, setAcc] = useState("");
  const [only, setOnly] = useState<"" | "unmatched">("");
  const [addOpen, setAddOpen] = useState(false);
  const [af, setAf] = useState({ name: "", bank: "", iban: "", opening_balance: "", opening_date: "" });
  const [imp, setImp] = useState<null | { headers: string[]; rows: Record<string, string>[]; map: BankLayout; file: string }>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const account = (accounts.data || []).find((a) => a.id === acc) || accounts.data?.[0];

  async function addAccount() {
    if (!af.name.trim()) return setErr("Enter a name for the account.");
    setBusy(true); setErr("");
    const r = await db.from("crm_bank_accounts").insert({ name: af.name.trim(), bank: af.bank.trim() || null, iban: af.iban.trim() || null, opening_balance: num(af.opening_balance), opening_date: af.opening_date || null }).select("id").single();
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    setAddOpen(false); setAcc(r.data.id); toast("Account added"); refresh();
  }

  async function pick(file: File) {
    try {
      await loadScript(XLSX_SRC);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX = (window as any).XLSX;
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false }) as string[][];
      // The column titles are the first row with a date-like and an amount-like heading, or the first row with 3+ cells.
      let h = grid.findIndex((r) => r.filter((c) => String(c).trim()).length >= 3 && r.some((c) => /date/i.test(String(c))));
      if (h < 0) h = grid.findIndex((r) => r.filter((c) => String(c).trim()).length >= 3);
      if (h < 0) throw new Error("No table found in this file.");
      const headers = grid[h].map((c, i) => String(c).trim() || `Column ${i + 1}`);
      const rows = grid.slice(h + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(headers.map((k, i) => [k, String(r[i] ?? "").trim()])));
      const saved = account?.layout && [account.layout.date, account.layout.description].every((k) => headers.includes(k)) ? account.layout : null;
      setImp({ headers, rows, file: file.name, map: saved || {
        date: guess(headers, /date/i), description: guess(headers, /desc|narrat|detail|particular|remark/i), amount: guess(headers, /^amount|amount \(|transaction amount/i),
        debit: guess(headers, /debit|withdraw|paid out|money out/i), credit: guess(headers, /credit|deposit|paid in|money in/i), balance: guess(headers, /balance/i) } });
      setErr("");
    } catch (x) { toast((x as Error).message); }
  }

  const parsed = useMemo(() => {
    if (!imp) return [];
    const m = imp.map;
    return imp.rows.map((r) => {
      const date = parseBankDate(r[m.date]);
      const amount = m.amount ? parseBankAmount(r[m.amount]) : r2(Math.abs(parseBankAmount(r[m.credit || ""])) - Math.abs(parseBankAmount(r[m.debit || ""])));
      return { date, description: r[m.description] || "", amount, balance: m.balance && r[m.balance] ? parseBankAmount(r[m.balance]) : null };
    }).filter((r) => r.date && r.amount);
  }, [imp]);

  async function doImport() {
    if (!imp || !account) return;
    if (!imp.map.date || !imp.map.description || !(imp.map.amount || imp.map.debit || imp.map.credit)) return setErr("Choose the date, description and amount columns.");
    if (!parsed.length) return setErr("No lines could be read with these columns.");
    setBusy(true); setErr("");
    // Same day + description + amount twice in one statement is real (two equal payments), so a counter is part of the key.
    const seen = new Map<string, number>();
    const rows = parsed.map((r) => {
      const base = `${r.date}|${r.description}|${r.amount}`; const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      return { account_id: account.id, line_date: r.date, description: r.description.slice(0, 500), amount: r.amount, balance: r.balance, hash: `${base}|${n}` };
    });
    const before = (lines.data || []).filter((l) => l.account_id === account.id).length;
    const r = await db.from("crm_bank_lines").upsert(rows, { onConflict: "account_id,hash", ignoreDuplicates: true });
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    await db.from("crm_bank_accounts").update({ layout: imp.map }).eq("id", account.id);
    const after = await db.from("crm_bank_lines").select("id", { count: "exact", head: true }).eq("account_id", account.id);
    setBusy(false); setImp(null);
    const added = Math.max(0, (after.count ?? before + rows.length) - before);
    toast(`${added} new line${added === 1 ? "" : "s"} imported${rows.length - added > 0 ? `, ${rows.length - added} already there` : ""}`); refresh();
  }

  /** A likely match for a line: an unpaid invoice for the same amount (money in), or an approved expense (money out). */
  function suggest(l: BankLine) {
    if (l.amount > 0) { const i = (invoices.data || []).find((x) => x.status !== "cancelled" && Math.abs(num(x.total) - l.amount) < 0.01); if (i) return { kind: "invoice", id: i.id, label: `${i.invoice_no} · ${i.bill_to}` }; }
    else { const e = (expenses.data || []).find((x) => x.status === "approved" && Math.abs(num(x.total) + l.amount) < 0.01 && Math.abs(new Date(x.expense_date).getTime() - new Date(l.line_date).getTime()) < 10 * 86400000); if (e) return { kind: "expense", id: e.id, label: `${e.category}${e.vendor ? ` · ${e.vendor}` : ""}` }; }
    return null;
  }
  async function match(l: BankLine, kind: string, id: string | null = null) {
    const r = await db.from("crm_bank_lines").update({ match_kind: kind || null, match_id: id }).eq("id", l.id);
    if (r.error) toast(r.error.message); else refresh();
  }

  const shown = (lines.data || []).filter((l) => l.account_id === account?.id && (!only || !l.match_kind));
  const unmatched = (lines.data || []).filter((l) => l.account_id === account?.id && !l.match_kind).length;

  if (accounts.data && !accounts.data.length && !addOpen) return (
    <Card><Empty icon={<Landmark size={28} />} title="Add the company bank account" hint="Then upload its statement (CSV or Excel) from any bank. The first time, you show which columns are the date, description and amount; after that it remembers."
      action={<Button variant="primary" onClick={() => { setErr(""); setAddOpen(true); }}><Plus size={15} /> Add bank account</Button>} /></Card>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterSelect value={account?.id || ""} active={false} onChange={(e) => setAcc(e.target.value)}>{(accounts.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</FilterSelect>
        <FilterSelect value={only} onChange={(e) => setOnly(e.target.value as "")}><option value="">All lines</option><option value="unmatched">Not matched ({unmatched})</option></FilterSelect>
        {account && <span className="text-sm text-ink-2">Balance as per the books <span className="num font-semibold text-ink">{aed(bankBalance(account, lines.data || []))}</span></span>}
        <span className="flex-1" />
        <Button onClick={() => { setErr(""); setAf({ name: "", bank: "", iban: "", opening_balance: "", opening_date: "" }); setAddOpen(true); }}><Plus size={15} /> Account</Button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
        <Button variant="primary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Upload statement</Button>
      </div>
      <DataTable rows={shown} empty={<Empty icon={<Landmark size={28} />} title="No statement lines yet" hint="Upload a CSV or Excel statement downloaded from your online banking." />} cols={[
        { h: "Date", cell: (l) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(l.line_date)}</span> },
        { h: "Description", cell: (l) => <span className="block min-w-48 max-w-md break-words">{l.description}</span> },
        { h: "Amount", right: true, cell: (l) => <span className={l.amount > 0 ? "text-good" : ""}>{l.amount > 0 ? "+" : "−"} {aed(Math.abs(l.amount))}</span> },
        { h: "Matched to", cell: (l) => {
          if (l.match_kind) return <span className="flex items-center gap-2"><Badge tone="good">{KINDS[l.match_kind] || l.match_kind}</Badge><button className="text-xs text-ink-3 hover:text-ink" onClick={() => match(l, "")}>undo</button></span>;
          const s = suggest(l);
          return (
            <span className="flex items-center gap-2">
              {s && <Button size="sm" onClick={() => match(l, s.kind, s.id)}>{s.label}?</Button>}
              <select value="" onChange={(e) => match(l, e.target.value)} className="h-8 rounded-full border border-line bg-surface px-2.5 text-xs text-ink-2 outline-none focus:border-accent">
                <option value="">What is this?</option>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </span>
          );
        } },
      ]} />

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Bank account" footer={<>
        <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={addAccount} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Add account</Button>
      </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" className="sm:col-span-2"><Input value={af.name} onChange={(e) => setAf({ ...af, name: e.target.value })} placeholder="e.g. Main business account" /></Field>
          <Field label="Bank"><Input value={af.bank} onChange={(e) => setAf({ ...af, bank: e.target.value })} /></Field>
          <Field label="IBAN"><Input value={af.iban} onChange={(e) => setAf({ ...af, iban: e.target.value })} /></Field>
          <Field label="Opening balance, AED"><Input inputMode="decimal" value={af.opening_balance} onChange={(e) => setAf({ ...af, opening_balance: e.target.value })} /></Field>
          <Field label="On date"><Input type="date" value={af.opening_date} onChange={(e) => setAf({ ...af, opening_date: e.target.value })} /></Field>
        </div>
        <div className="mt-3 text-xs text-ink-3">Opening balance = the balance just before the first statement line you will upload.</div>
        <FormError>{err}</FormError>
      </Sheet>

      <Sheet open={!!imp} onClose={() => setImp(null)} wide title={`Statement · ${imp?.file || ""}`} footer={<>
        <Button variant="ghost" onClick={() => setImp(null)}>Cancel</Button>
        <Button variant="primary" onClick={doImport} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Import {parsed.length} line{parsed.length === 1 ? "" : "s"}</Button>
      </>}>
        {imp && (
          <>
            <div className="text-sm text-ink-2 mb-3">Which column is which? This is remembered for {account?.name}.</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {([["date", "Date"], ["description", "Description"], ["amount", "Amount (one column, + in / − out)"], ["credit", "Money in (credit)"], ["debit", "Money out (debit)"], ["balance", "Balance (optional)"]] as const).map(([k, label]) => (
                <Field key={k} label={label}>
                  <Select value={imp.map[k] || ""} onChange={(e) => setImp({ ...imp, map: { ...imp.map, [k]: e.target.value } })}><option value="">—</option>{imp.headers.map((h) => <option key={h}>{h}</option>)}</Select>
                </Field>
              ))}
            </div>
            <div className="mt-4 text-xs font-medium text-ink-2 mb-1.5">First lines as they will be imported</div>
            <div className="rounded-xl border border-line divide-y divide-line text-[13px]">
              {parsed.slice(0, 6).map((r, i) => <div key={i} className="flex gap-3 px-3 py-2"><span className="num text-ink-2 whitespace-nowrap">{fmtDate(r.date)}</span><span className="flex-1 min-w-0 truncate">{r.description}</span><span className={`num whitespace-nowrap ${r.amount > 0 ? "text-good" : ""}`}>{aed(r.amount)}</span></div>)}
              {!parsed.length && <div className="px-3 py-3 text-ink-3">Nothing readable yet: pick the columns above.</div>}
            </div>
            <FormError>{err}</FormError>
          </>
        )}
      </Sheet>
    </>
  );
}
