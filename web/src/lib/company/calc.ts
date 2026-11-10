// The company's money rules in one place (deals, VAT, profit, payroll, gratuity). Pure functions: the pages and
// Bunty both use them, and the database repeats the commission split itself (private.recalc_deal) so the saved
// figures never depend on the screen.

export const VAT_RATE = 0.05;
export const GOAML_CASH_LIMIT = 55000;
export const CORPORATE_TAX_RATE = 0.09;
export const CORPORATE_TAX_FREE = 375000;

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

/* ------------------------------------------------------------------ deals */
export const DEAL_TYPES = {
  secondary: { label: "Secondary sale", pct: 2, hint: "2% from the buyer. Seller fee optional.", priceLabel: "Sale price" },
  offplan: { label: "Off-plan sale", pct: 0, hint: "From the developer's slab.", priceLabel: "Sale price" },
  rental: { label: "Rental", pct: 5, hint: "5% of the yearly rent, paid by the tenant.", priceLabel: "Yearly rent" },
  holiday_home: { label: "Holiday home", pct: 0, hint: "Company income only, no agent share.", priceLabel: "Rental income" },
  referral: { label: "Mortgage / agency referral", pct: 0, hint: "Type the amount. The agent gets their normal rate.", priceLabel: "Deal value (optional)" },
} as const;
export type DealType = keyof typeof DEAL_TYPES;

export const DEAL_STATUS: Record<string, string> = {
  pending: "Pending approval", approved: "Approved", invoiced: "Invoiced", part_received: "Part received",
  received: "Fully received", agents_paid: "Agents paid", cancelled: "Cancelled", rejected: "Rejected",
};
/** Deals that count in the books (approved and onwards). */
export const COUNTED = new Set(["approved", "invoiced", "part_received", "received", "agents_paid"]);

export type Deal = {
  id: string; deal_no: number; deal_type: DealType; status: string; lead_id: string | null; owner_id: number | null; developer_id: string | null;
  client_name: string; client_phone: string | null; community: string | null; cluster: string | null; unit: string | null; deal_date: string;
  price: number | null; commission_pct: number | null; commission: number; seller_fee: number; other_agency: string | null;
  other_agency_direction: "we_pay" | "they_pay" | null; other_agency_amount: number; vat: number; office_commission: number;
  payment_method: string | null; cash_amount: number; goaml_status: string; goaml_ref: string | null; expected_on: string | null;
  received: number; notes: string | null; created_by: string; created_at: string; approved_by: string | null; approved_at: string | null;
};
export type Split = { id: string; deal_id: string; kind: "agent" | "team_leader"; email: string; share_pct: number; rate_pct: number | null; amount: number; paid: number };
export type DealPayment = { id: string; deal_id: string; kind: "received" | "payout" | "other_agency"; email: string | null; amount: number; paid_on: string; method: string | null; note: string | null; created_by: string };

/** Commission before VAT → VAT on top → office commission after the other agency's share. */
export function dealMoney(d: { commission: number; seller_fee?: number; other_agency_direction?: string | null; other_agency_amount?: number }) {
  const gross = r2(num(d.commission) + num(d.seller_fee));
  const vat = r2(gross * VAT_RATE);
  const other = d.other_agency_direction === "we_pay" ? num(d.other_agency_amount) : 0;
  return { gross, vat, due: r2(gross + vat), office: r2(gross - other), otherAgency: r2(other) };
}

export type AgentShare = { email: string; share_pct: number; rate_pct: number | null };
export type StaffRate = { email: string; commission_rate: number; tl_override_pct: number; team_leader?: string | null };

/** The split in the agreed order. `rates` supplies each person's own rate and who their team leader is. */
export function splitDeal(office: number, agents: AgentShare[], rates: StaffRate[], tlRates?: Record<string, number>) {
  const find = (e: string | null | undefined) => rates.find((r) => r.email.toLowerCase() === String(e || "").toLowerCase());
  const lines = agents.map((a) => {
    const rate = a.rate_pct ?? find(a.email)?.commission_rate ?? 50;
    return { kind: "agent" as const, email: a.email.toLowerCase(), share_pct: num(a.share_pct), rate_pct: rate, amount: r2(office * num(a.share_pct) / 100 * rate / 100) };
  });
  const tl = new Map<string, { share: number; part: number }>();
  for (const l of lines) {
    const leader = find(l.email)?.team_leader?.toLowerCase();
    if (!leader || leader === l.email) continue;
    const pct = tlRates?.[leader] ?? find(leader)?.tl_override_pct ?? 0;
    if (!(pct > 0)) continue;
    const cur = tl.get(leader) || { share: 0, part: 0 };
    cur.share += l.share_pct; cur.part += office * l.share_pct / 100 - l.amount;
    tl.set(leader, cur);
  }
  const leaders = [...tl].map(([email, v]) => {
    const rate = tlRates?.[email] ?? find(email)?.tl_override_pct ?? 0;
    return { kind: "team_leader" as const, email, share_pct: v.share, rate_pct: rate, amount: r2(v.part * rate / 100) };
  });
  const agentsTotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const tlTotal = r2(leaders.reduce((s, l) => s + l.amount, 0));
  return { lines: [...lines, ...leaders], agentsTotal, tlTotal, company: r2(office - agentsTotal - tlTotal), shareTotal: r2(lines.reduce((s, l) => s + l.share_pct, 0)) };
}

/** Part of the client's money that has arrived (agents are paid in the same proportion). */
export function receivedRatio(d: Pick<Deal, "commission" | "seller_fee" | "vat" | "received">) {
  const due = num(d.commission) + num(d.seller_fee) + num(d.vat);
  return due > 0 ? Math.min(1, Math.max(0, num(d.received) / due)) : 0;
}
/** What can be paid to this person now: their amount × money received so far, minus what they already got. */
export function payableNow(d: Pick<Deal, "commission" | "seller_fee" | "vat" | "received">, s: Pick<Split, "amount" | "paid">) {
  return Math.max(0, r2(num(s.amount) * receivedRatio(d) - num(s.paid)));
}

export type Developer = { id: string; name: string; basis: "aed" | "units"; period_start: string | null; period_end: string | null; slabs: { from: number; pct: number }[]; pay_days: number; notes: string | null };
/** The developer's slab for the period, counting this deal. `sold` = AED or units already sold in the period. */
export function slabFor(dev: Pick<Developer, "slabs">, sold: number) {
  const slabs = [...(dev.slabs || [])].sort((a, b) => a.from - b.from);
  let cur = slabs[0] || null;
  for (const s of slabs) if (sold >= s.from) cur = s;
  const next = slabs.find((s) => s.from > sold) || null;
  return { pct: cur?.pct ?? 0, next };
}
/** Backdated top-up to claim when a higher slab is reached: every unit in the period moves to the new %. */
export function slabTopUp(dev: Developer, deals: Pick<Deal, "price" | "commission" | "deal_date" | "developer_id" | "status">[]) {
  const mine = deals.filter((d) => d.developer_id === dev.id && COUNTED.has(d.status)
    && (!dev.period_start || d.deal_date >= dev.period_start) && (!dev.period_end || d.deal_date <= dev.period_end));
  const sold = dev.basis === "units" ? mine.length : mine.reduce((s, d) => s + num(d.price), 0);
  const { pct, next } = slabFor(dev, sold);
  const atSlab = mine.reduce((s, d) => s + num(d.price) * pct / 100, 0);
  const booked = mine.reduce((s, d) => s + num(d.commission), 0);
  return { units: mine.length, value: mine.reduce((s, d) => s + num(d.price), 0), sold, pct, next, topUp: Math.max(0, r2(atSlab - booked)) };
}

export function kycParties(type: DealType): string[] {
  return type === "secondary" ? ["buyer", "seller"] : type === "offplan" ? ["buyer"] : type === "rental" ? ["tenant", "landlord"] : [];
}

/* ------------------------------------------------------------------ dates */
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const utc = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
export function addDays(s: string, n: number) { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
export function addMonths(s: string, n: number) {
  const d = utc(s); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return ymd(d);
}
export function daysBetween(a: string, b: string) { return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000); }
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s: string) => addDays(addMonths(monthStart(s), 1), -1);
export function monthLabel(s: string) { return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(utc(monthStart(s))); }

export type Period = { from: string; to: string; label: string };
/** VAT quarter containing `day`. `firstMonth` (1–12) is the month one of the company's tax periods starts in. */
export function vatQuarter(day: string, firstMonth = 1): Period {
  const m = Number(day.slice(5, 7)); const y = Number(day.slice(0, 4));
  const offset = (((m - firstMonth) % 3) + 3) % 3;
  const from = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, -offset);
  const to = monthEnd(addMonths(from, 2));
  return { from, to, label: `${monthLabel(from)} – ${monthLabel(to)}` };
}
/** The FTA return and payment are due on the 28th of the month after the quarter ends. */
export const vatDueDate = (p: Period) => `${addMonths(monthStart(p.to), 1).slice(0, 7)}-28`;
export function periodOf(kind: "month" | "quarter" | "year", day: string, firstMonth = 1): Period {
  if (kind === "month") return { from: monthStart(day), to: monthEnd(day), label: monthLabel(day) };
  if (kind === "quarter") return vatQuarter(day, firstMonth);
  return { from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31`, label: day.slice(0, 4) };
}
export function shiftPeriod(kind: "month" | "quarter" | "year", p: Period, dir: number, firstMonth = 1) {
  return periodOf(kind, addMonths(p.from, dir * (kind === "month" ? 1 : kind === "quarter" ? 3 : 12)), firstMonth);
}
const inPeriod = (d: string | null | undefined, p: Period) => !!d && d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;

/* ------------------------------------------------------------------ accounts */
export type Invoice = {
  id: string; invoice_no: string; deal_id: string | null; bill_to: string; bill_to_address: string | null; bill_to_trn: string | null;
  issue_date: string; due_date: string | null; lines: { description: string; amount: number }[]; subtotal: number; vat: number; total: number;
  paid: number; status: string; notes: string | null; created_by: string;
};
export type Expense = {
  id: string; kind: "expense" | "advance"; expense_date: string; category: string; vendor: string | null; description: string | null;
  amount: number; vat: number; total: number; receipt_path: string | null; staff_email: string | null; recovered: number; bill_id: string | null;
  status: string; submitted_by: string; created_at: string;
};
export type Bill = { id: string; name: string; category: string; vendor: string | null; amount: number; vat: number; frequency: "once" | "monthly" | "quarterly" | "yearly"; next_due: string; remind_days: number; active: boolean; notes: string | null };
export type BankAccount = { id: string; name: string; bank: string | null; iban: string | null; opening_balance: number; opening_date: string | null; layout: BankLayout | null };
export type BankLayout = { date: string; description: string; amount?: string; debit?: string; credit?: string; balance?: string };
export type BankLine = { id: string; account_id: string; line_date: string; description: string | null; amount: number; balance: number | null; hash: string; match_kind: string | null; match_id: string | null; note: string | null };

export const EXPENSE_CATEGORIES = ["Office rent", "Utilities & internet", "Marketing & portals", "Visas & government fees", "Salaries", "Travel & fuel",
  "Software", "Professional fees", "Bank charges", "Office supplies", "Entertainment", "Other"];

export function nextDue(date: string, f: Bill["frequency"]) {
  return f === "monthly" ? addMonths(date, 1) : f === "quarterly" ? addMonths(date, 3) : f === "yearly" ? addMonths(date, 12) : date;
}
/** Every date a bill falls due up to `until` (recurring bills repeat). */
export function billDates(b: Bill, until: string) {
  const out: string[] = [];
  for (let d = b.next_due, i = 0; d <= until && i < 60; d = nextDue(d, b.frequency), i++) { out.push(d); if (b.frequency === "once") break; }
  return out;
}

/** FTA VAT 201 figures for one tax period. Sales are standard-rated and made in Dubai; nothing is zero-rated or exempt. */
export function vatReturn(invoices: Invoice[], expenses: Expense[], p: Period) {
  const inv = invoices.filter((i) => i.status !== "cancelled" && inPeriod(i.issue_date, p));
  const exp = expenses.filter((e) => e.kind === "expense" && e.status === "approved" && num(e.vat) > 0 && inPeriod(e.expense_date, p));
  const salesNet = r2(inv.reduce((s, i) => s + num(i.subtotal), 0)), salesVat = r2(inv.reduce((s, i) => s + num(i.vat), 0));
  const buyNet = r2(exp.reduce((s, e) => s + num(e.amount), 0)), buyVat = r2(exp.reduce((s, e) => s + num(e.vat), 0));
  return {
    boxes: [
      { box: "1b", label: "Standard-rated supplies in Dubai", amount: salesNet, vat: salesVat },
      { box: "8", label: "Total sales and output VAT", amount: salesNet, vat: salesVat },
      { box: "9", label: "Standard-rated expenses", amount: buyNet, vat: buyVat },
      { box: "11", label: "Total expenses and recoverable VAT", amount: buyNet, vat: buyVat },
      { box: "12", label: "Total VAT due for the period", amount: null, vat: salesVat },
      { box: "13", label: "Total recoverable VAT for the period", amount: null, vat: buyVat },
      { box: "14", label: "VAT payable (or refundable if negative)", amount: null, vat: r2(salesVat - buyVat) },
    ],
    payable: r2(salesVat - buyVat), invoices: inv.length, expenses: exp.length, due: vatDueDate(p),
  };
}

export type PayrollLine = { id: string; run_id: string; staff_id: string; basic: number; allowances: number; commission: number; advance_recovery: number; deductions: number; net: number; pay_method: string; paid: boolean; note: string | null };
export type PayrollRun = { id: string; month: string; status: "draft" | "final" };

/** Profit and loss for a period. Income is counted when a deal is approved (deal date), costs when they are dated. */
export function profitAndLoss(x: { deals: Deal[]; splits: Split[]; expenses: Expense[]; runs: PayrollRun[]; lines: PayrollLine[] }, p: Period) {
  const deals = x.deals.filter((d) => COUNTED.has(d.status) && inPeriod(d.deal_date, p));
  const ids = new Set(deals.map((d) => d.id));
  const income = r2(deals.reduce((s, d) => s + num(d.commission) + num(d.seller_fee), 0));
  const otherAgency = r2(deals.reduce((s, d) => s + (d.other_agency_direction === "we_pay" ? num(d.other_agency_amount) : 0), 0));
  const commissions = r2(x.splits.filter((s) => ids.has(s.deal_id)).reduce((s, l) => s + num(l.amount), 0));
  const byCategory: Record<string, number> = {};
  for (const e of x.expenses) {
    if (e.kind !== "expense" || e.status !== "approved" || !inPeriod(e.expense_date, p)) continue;
    byCategory[e.category] = r2((byCategory[e.category] || 0) + num(e.amount));
  }
  const finalRuns = new Set(x.runs.filter((r) => r.status === "final" && inPeriod(r.month, p)).map((r) => r.id));
  const salaries = r2(x.lines.filter((l) => finalRuns.has(l.run_id)).reduce((s, l) => s + num(l.basic) + num(l.allowances), 0));
  if (salaries) byCategory["Salaries (payroll)"] = salaries;
  const overheads = r2(Object.values(byCategory).reduce((s, v) => s + v, 0));
  const gross = r2(income - otherAgency - commissions);
  return { deals: deals.length, income, otherAgency, commissions, gross, byCategory, overheads, profit: r2(gross - overheads) };
}

/** UAE corporate tax estimate: 9% of the year's profit above AED 375,000. */
export const corporateTax = (yearProfit: number) => r2(Math.max(0, yearProfit - CORPORATE_TAX_FREE) * CORPORATE_TAX_RATE);

export type CashEvent = { date: string; label: string; amount: number; kind: "in" | "out" };
/** Money expected in (unpaid commission) and out (bills, agent commission, salaries) from today to `until`. */
export function cashForecast(x: { deals: Deal[]; splits: Split[]; bills: Bill[]; developers: Developer[]; staff: Staff[] }, today: string, until: string) {
  const ev: CashEvent[] = [];
  for (const d of x.deals) {
    if (!["approved", "invoiced", "part_received"].includes(d.status)) continue;
    const left = r2(num(d.commission) + num(d.seller_fee) + num(d.vat) - num(d.received));
    if (left <= 0) continue;
    const dev = x.developers.find((v) => v.id === d.developer_id);
    let on = d.expected_on || addDays(d.deal_date, d.deal_type === "offplan" ? dev?.pay_days ?? 60 : 14);
    if (on < today) on = today;
    if (on <= until) ev.push({ date: on, label: `Deal #${d.deal_no} · ${d.client_name}`, amount: left, kind: "in" });
    const owed = r2(x.splits.filter((s) => s.deal_id === d.id).reduce((s, l) => s + num(l.amount) - num(l.paid), 0));
    if (owed > 0 && on <= until) ev.push({ date: on, label: `Agent commission · deal #${d.deal_no}`, amount: -owed, kind: "out" });
  }
  for (const b of x.bills) if (b.active) for (const date of billDates(b, until)) ev.push({ date: date < today ? today : date, label: b.name, amount: -r2(num(b.amount) + num(b.vat)), kind: "out" });
  const salaries = r2(x.staff.filter((s) => s.status === "active").reduce((s, p) => s + num(p.basic_salary) + num(p.allowances), 0));
  if (salaries) for (let m = monthEnd(today); m <= until; m = monthEnd(addMonths(monthStart(m), 1))) ev.push({ date: m, label: "Salaries", amount: -salaries, kind: "out" });
  ev.sort((a, b) => a.date.localeCompare(b.date));
  const months: Record<string, { in: number; out: number }> = {};
  for (const e of ev) { const k = e.date.slice(0, 7); months[k] ||= { in: 0, out: 0 }; if (e.amount > 0) months[k].in = r2(months[k].in + e.amount); else months[k].out = r2(months[k].out - e.amount); }
  return { events: ev, months, totalIn: r2(ev.reduce((s, e) => s + Math.max(0, e.amount), 0)), totalOut: r2(ev.reduce((s, e) => s + Math.max(0, -e.amount), 0)) };
}

/** Balance as per the books: opening balance plus every imported bank line. */
export function bankBalance(a: BankAccount, lines: BankLine[]) {
  return r2(num(a.opening_balance) + lines.filter((l) => l.account_id === a.id).reduce((s, l) => s + num(l.amount), 0));
}

/** Outstanding advances for a person (approved, not yet recovered from commission or salary). */
export function advancesOwed(expenses: Expense[], email: string) {
  return r2(expenses.filter((e) => e.kind === "advance" && e.status === "approved" && (e.staff_email || "").toLowerCase() === email.toLowerCase())
    .reduce((s, e) => s + num(e.amount) - num(e.recovered), 0));
}

/* ------------------------------------------------------------------ HR */
export type Staff = {
  id: string; email: string | null; full_name: string; job_title: string | null; nationality: string | null; phone: string | null;
  join_date: string | null; end_date: string | null; status: "active" | "left"; salary_type: string; basic_salary: number; allowances: number;
  commission_rate: number; tl_override_pct: number; pay_method: "wps" | "bank" | "cash"; iban: string | null; bank_code: string | null;
  labour_no: string | null; annual_leave_days: number; notes: string | null;
};
export type StaffDoc = { id: string; staff_id: string; doc_type: string; doc_number: string | null; issue_date: string | null; expiry_date: string | null; file_path: string | null; notes: string | null };
export type Leave = { id: string; staff_id: string; leave_type: string; start_date: string; end_date: string; days: number; reason: string | null; status: string; created_by: string; created_at: string };
export type Candidate = { id: string; full_name: string; phone: string | null; email: string | null; role: string | null; source: string | null; stage: string; cv_path: string | null; notes: string | null; checklist: Record<string, boolean>; staff_id: string | null; created_at: string };

export const DOC_TYPES = ["Visa", "Work permit / labour card", "Emirates ID", "Passport", "RERA broker card (BRN)", "Employment contract", "Health insurance", "Other"];
export const LEAVE_TYPES = ["Annual", "Sick", "Unpaid", "Maternity", "Parental", "Bereavement", "Hajj", "Other"];
export const CANDIDATE_STAGES = ["Applied", "Interview", "Offer", "Joined", "Rejected"];
export const ONBOARDING = ["Offer letter signed", "Visa applied", "Emirates ID", "Health insurance", "RERA course / BRN", "System login", "Portal accounts (Property Finder, Bayut)", "Business cards & email"];
export const SALARY_TYPES: Record<string, string> = { commission_only: "Commission only", basic_commission: "Basic + commission", mixed: "Mixed" };
export const PAY_METHODS: Record<string, string> = { wps: "WPS", bank: "Bank transfer", cash: "Cash (signed receipt)" };

/** How a document's expiry reads today. */
export function expiryState(expiry: string | null | undefined, today: string, warnDays = 30) {
  if (!expiry) return { tone: "neutral" as const, text: "No expiry date", days: null };
  const days = daysBetween(today, expiry);
  if (days < 0) return { tone: "bad" as const, text: `Expired ${-days} day${days === -1 ? "" : "s"} ago`, days };
  if (days <= warnDays) return { tone: "warn" as const, text: days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`, days };
  return { tone: "good" as const, text: "In date", days };
}

/** Whole days of a leave request (both ends included). */
export const leaveDays = (from: string, to: string) => (from && to && to >= from ? daysBetween(from, to) + 1 : 0);

/**
 * Annual leave under the UAE Labour Law (Federal Decree-Law 33 of 2021, art. 29): 2 days a month after 6 months of
 * service, the full yearly entitlement (30 days) after a year. Balance = earned to date − approved annual leave taken.
 */
export function leaveBalance(s: Pick<Staff, "join_date" | "end_date" | "annual_leave_days">, leave: Pick<Leave, "leave_type" | "status" | "days">[], today: string) {
  if (!s.join_date) return { earned: 0, taken: 0, balance: 0 };
  const end = s.end_date && s.end_date < today ? s.end_date : today;
  const days = Math.max(0, daysBetween(s.join_date, end));
  const months = days / 30.4375;
  const perYear = num(s.annual_leave_days) || 30;
  const earned = months < 6 ? 0 : months < 12 ? Math.floor(months) * 2 : r2(days / 365 * perYear);
  const taken = leave.filter((l) => l.leave_type === "Annual" && l.status === "approved").reduce((t, l) => t + num(l.days), 0);
  return { earned: Math.round(earned * 10) / 10, taken, balance: Math.round((earned - taken) * 10) / 10 };
}

/**
 * End-of-service gratuity (art. 51): nothing under 1 year; 21 days' basic pay for each of the first 5 years and
 * 30 days' for each year after; part-years count in proportion; capped at two years' pay. Daily pay = basic × 12 ÷ 365.
 */
export function gratuity(basic: number, join: string | null, end: string) {
  if (!join || !(basic > 0)) return { years: 0, amount: 0 };
  const years = Math.max(0, daysBetween(join, end)) / 365;
  if (years < 1) return { years: r2(years), amount: 0 };
  const daily = basic * 12 / 365;
  const amount = Math.min(daily * (Math.min(years, 5) * 21 + Math.max(0, years - 5) * 30), basic * 24);
  return { years: r2(years), amount: r2(amount) };
}

/** Final settlement: gratuity + unused leave paid out + anything still owed, minus outstanding advances. */
export function finalSettlement(s: Staff, x: { leave: Leave[]; unpaidSalary: number; commissionDue: number; advances: number }, end: string) {
  const g = gratuity(num(s.basic_salary), s.join_date, end);
  const lb = leaveBalance({ ...s, end_date: end }, x.leave.filter((l) => l.staff_id === s.id), end);
  const leavePay = r2(Math.max(0, lb.balance) * num(s.basic_salary) / 30);
  return { gratuity: g.amount, years: g.years, leaveDays: Math.max(0, lb.balance), leavePay, unpaidSalary: r2(x.unpaidSalary), commissionDue: r2(x.commissionDue), advances: r2(x.advances),
    total: r2(g.amount + leavePay + x.unpaidSalary + x.commissionDue - x.advances) };
}

export type CompanySettings = {
  name?: string; trn?: string; address?: string; phone?: string; email?: string; bank_name?: string; bank_account_name?: string; iban?: string; swift?: string;
  vat_first_month?: number; mohre_establishment_id?: string; wps_bank_code?: string; orn?: string;
};

/**
 * WPS salary file (SIF) for the bank: one EDR line per employee and one SCR line for the company, comma separated,
 * as set out in the Central Bank's WPS file specification. Check the first file with your bank before sending.
 */
export function sifFile(co: CompanySettings, month: string, rows: { staff: Staff; line: PayrollLine }[], now = new Date()) {
  const from = monthStart(month), to = monthEnd(month);
  const days = daysBetween(from, to) + 1;
  const pad = (v: string | null | undefined, n: number) => String(v || "").replace(/\D/g, "").padStart(n, "0").slice(-n);
  const edr = rows.map(({ staff: s, line: l }) => {
    const fixed = r2(num(l.basic) + num(l.allowances));
    const variable = r2(Math.max(0, num(l.commission) - num(l.advance_recovery) - num(l.deductions)));
    return ["EDR", pad(s.labour_no, 14), pad(s.bank_code, 9), String(s.iban || "").replace(/\s/g, "").toUpperCase(), from, to, days, fixed.toFixed(2), variable.toFixed(2), 0].join(",");
  });
  const total = r2(rows.reduce((t, { line: l }) => t + num(l.net), 0));
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).replace(":", "");
  const scr = ["SCR", pad(co.mohre_establishment_id, 13), pad(co.wps_bank_code, 9), stamp, time, `${month.slice(5, 7)}${month.slice(0, 4)}`, rows.length, total.toFixed(2), "AED", (co.name || "").slice(0, 35)].join(",");
  const name = `${pad(co.mohre_establishment_id, 13)}${stamp.slice(2).replace(/-/g, "")}${time}00.SIF`;
  return { name, text: [...edr, scr].join("\r\n") + "\r\n", total, count: rows.length };
}

/* ------------------------------------------------------------------ listings */
export type Listing = {
  id: string; ref: string; owner_id: number | null; community: string | null; cluster: string | null; unit: string | null; purpose: "sale" | "rent";
  property_type: string | null; bedrooms: string | null; bathrooms: number | null; bua_sqft: number | null; plot_sqft: number | null; price: number | null;
  title: string | null; description: string | null; agent_email: string; permit_no: string | null; permit_expiry: string | null; form_a_path: string | null;
  photos: string[]; portals: Record<string, boolean>; status: string; published_at: string | null; closed_at: string | null; created_by: string; created_at: string;
};
export const LISTING_STATUS: Record<string, string> = { draft: "Draft", pending: "Waiting for approval", live: "Live", unpublished: "Unpublished", sold: "Sold by us", rented: "Rented by us" };
export const PORTALS: Record<string, string> = { property_finder: "Property Finder", bayut: "Bayut / Dubizzle", website: "Our website" };

/** Same checks as the database (private.listing_blockers), for showing on the form. `brnExpiry` = the agent's RERA card expiry. */
export function listingBlockers(l: Pick<Listing, "permit_no" | "permit_expiry" | "form_a_path" | "price">, brnExpiry: string | null | undefined, today: string) {
  const out: string[] = [];
  if (!String(l.permit_no || "").trim()) out.push("Trakheesi permit number is missing");
  if (!l.permit_expiry || l.permit_expiry < today) out.push("Trakheesi permit has expired or has no expiry date");
  if (!l.form_a_path) out.push("Signed Form A is not uploaded");
  if (!(num(l.price) > 0)) out.push("Price is missing");
  if (!brnExpiry || brnExpiry < today) out.push("The agent has no RERA broker card (BRN) in date on their staff record");
  return out;
}

/* ------------------------------------------------------------------ files */
export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}
