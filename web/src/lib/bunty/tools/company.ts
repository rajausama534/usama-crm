// Bunty's abilities for the company departments: commission (deals), compliance, accounts, VAT & tax, HR,
// documents and listings. Every figure comes from the same rules the pages use (lib/company/calc), read with the
// asking person's own access, so an agent asking Bunty sees only their own deals and commission.

import { ToolError, type BuntyCtx, type BuntyModule, type BuntyTool } from "../types";
import { must } from "../util";
import {
  CANDIDATE_STAGES, COUNTED, DEAL_STATUS, DEAL_TYPES, EXPENSE_CATEGORIES, LISTING_STATUS, addDays, advancesOwed, bankBalance, cashForecast, corporateTax, dealMoney, daysBetween,
  expiryState, gratuity, kycParties, leaveBalance, monthStart, num, payableNow, periodOf, profitAndLoss, r2, vatReturn,
  type BankAccount, type BankLine, type Bill, type Candidate, type CompanySettings, type Deal, type DealType, type Developer, type Expense, type Invoice, type Leave, type Listing,
  type PayrollLine, type PayrollRun, type Split, type Staff, type StaffDoc,
} from "@/lib/company/calc";

const missing = (m: string) => /relation|does not exist|schema cache|Could not find/i.test(m);
const NOT_READY = "This department is built but its database update has not been applied yet (waiting for Usama's OK).";
const money = (n: unknown) => `AED ${Math.round(num(n)).toLocaleString("en-US")}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
async function rows<T>(ctx: BuntyCtx, table: string, build?: (q: Q) => Q): Promise<T[]> {
  let q: Q = ctx.db.from(table).select("*");
  if (build) q = build(q);
  const r = await q.limit(5000);
  if (r.error) throw new ToolError(missing(r.error.message) ? NOT_READY : `${table}: ${r.error.message}`);
  return (r.data || []) as T[];
}
/** For badges: an empty list instead of an error while the tables are not there. */
async function soft<T>(ctx: BuntyCtx, table: string, build?: (q: Q) => Q): Promise<T[] | null> {
  try { return await rows<T>(ctx, table, build); } catch { return null; }
}
const off = (title: string) => ({ count: 0, title, items: [{ text: "Switches on with the database update.", tone: "info" as const }] });
const where = (d: { community?: string | null; cluster?: string | null; unit?: string | null }) => [d.community, d.cluster, d.unit].filter(Boolean).join(" ");
async function books(ctx: BuntyCtx) {
  const [deals, splits, invoices, expenses, bills, developers, staff, runs, lines] = await Promise.all([
    rows<Deal>(ctx, "crm_deals"), rows<Split>(ctx, "crm_deal_splits"), rows<Invoice>(ctx, "crm_invoices"), rows<Expense>(ctx, "crm_expenses"), rows<Bill>(ctx, "crm_bills"),
    rows<Developer>(ctx, "crm_developers"), rows<Staff>(ctx, "crm_staff"), rows<PayrollRun>(ctx, "crm_payroll_runs"), rows<PayrollLine>(ctx, "crm_payroll_lines"),
  ]);
  return { deals, splits, invoices, expenses, bills, developers, staff, runs, lines };
}
async function vatFirstMonth(ctx: BuntyCtx) {
  const r = await ctx.db.from("crm_company_settings").select("data").eq("id", 1).maybeSingle();
  return Number((r.data?.data as CompanySettings | undefined)?.vat_first_month) || 1;
}
const PERIOD = { type: "string", enum: ["month", "quarter", "year"], description: "Default month" } as const;
const DAY = { type: "string", format: "date", description: "Any day inside the period (YYYY-MM-DD). Default today." } as const;

/* ------------------------------------------------------------------ commission (deals) */
const listDeals: BuntyTool<{ status?: string; query?: string; from?: string; to?: string }> = {
  name: "list_deals",
  kind: "read",
  description: "Deals with their commission, status and money received. Filter by status, client/property text or deal date range. Use for 'how many deals did we close in October', 'which deals are waiting for payment'.",
  input_schema: { type: "object", properties: {
    status: { type: "string", enum: Object.keys(DEAL_STATUS) }, query: { type: "string", maxLength: 80 }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
  }, additionalProperties: false },
  async run(ctx, i) {
    let list = await rows<Deal>(ctx, "crm_deals", (q) => q.order("deal_date", { ascending: false }));
    if (i.status) list = list.filter((d) => d.status === i.status);
    if (i.from) list = list.filter((d) => d.deal_date >= i.from!);
    if (i.to) list = list.filter((d) => d.deal_date <= i.to!);
    if (i.query) { const t = i.query.toLowerCase(); list = list.filter((d) => `${d.client_name} ${where(d)} ${d.deal_no}`.toLowerCase().includes(t)); }
    const counted = list.filter((d) => COUNTED.has(d.status));
    return {
      total: list.length, counted_deals: counted.length, commission_before_vat: r2(counted.reduce((s, d) => s + dealMoney(d).gross, 0)),
      deals: list.slice(0, 40).map((d) => ({ id: d.id, no: d.deal_no, date: d.deal_date, type: DEAL_TYPES[d.deal_type]?.label, client: d.client_name, property: where(d), price: d.price,
        commission: dealMoney(d).gross, vat: d.vat, received: d.received, status: DEAL_STATUS[d.status], goaml: d.goaml_status, link: `/deals?open=${d.id}` })),
    };
  },
};

const getDeal: BuntyTool<{ id: string }> = {
  name: "get_deal",
  kind: "read",
  description: "One deal in full: the commission split (each agent, team leader, company share), payments received, payouts, and KYC status. Use for 'what does Ali get from the Alana deal'.",
  input_schema: { type: "object", properties: { id: { type: "string", description: "Deal id from list_deals" } }, required: ["id"], additionalProperties: false },
  async run(ctx, i) {
    const d = must(await ctx.db.from("crm_deals").select("*").eq("id", i.id).maybeSingle(), "Deal") as Deal | null;
    if (!d) throw new ToolError("Deal not found (or you cannot see it).");
    const [splits, pays, kyc] = await Promise.all([
      rows<Split>(ctx, "crm_deal_splits", (q) => q.eq("deal_id", i.id)), rows<{ kind: string; email: string | null; amount: number; paid_on: string }>(ctx, "crm_deal_payments", (q) => q.eq("deal_id", i.id)),
      rows<{ party: string; status: string }>(ctx, "crm_kyc", (q) => q.eq("deal_id", i.id)),
    ]);
    const m = dealMoney(d);
    return {
      deal: { no: d.deal_no, type: DEAL_TYPES[d.deal_type]?.label, status: DEAL_STATUS[d.status], client: d.client_name, property: where(d), date: d.deal_date, price: d.price, expected_on: d.expected_on, submitted_by: d.created_by },
      money: { commission_before_vat: m.gross, vat: m.vat, due_from_client: m.due, other_agency_share: m.otherAgency, office_commission: m.office, received: d.received, still_to_come: Math.max(0, r2(m.due - num(d.received))) },
      split: splits.map((s) => ({ who: s.email, role: s.kind, share_of_deal_pct: s.share_pct, rate_pct: s.rate_pct, amount: s.amount, paid: s.paid, payable_now: payableNow(d, s) })),
      company_share_if_all_lines_visible: r2(m.office - splits.reduce((s, l) => s + num(l.amount), 0)),
      payments: pays, kyc_needed: kycParties(d.deal_type), kyc, link: `/deals?open=${d.id}`,
    };
  },
};

const commissionSummary: BuntyTool<{ email?: string }> = {
  name: "get_commission_summary",
  kind: "read",
  description: "Commission per person across approved deals: earned, paid, still owed, payable now (in proportion to client money received) and outstanding advances. Optional email for one person.",
  input_schema: { type: "object", properties: { email: { type: "string", maxLength: 120 } }, additionalProperties: false },
  async run(ctx, i) {
    const [deals, splits, adv] = await Promise.all([rows<Deal>(ctx, "crm_deals"), rows<Split>(ctx, "crm_deal_splits"), rows<Expense>(ctx, "crm_expenses", (q) => q.eq("kind", "advance").eq("status", "approved"))]);
    const byId = new Map(deals.map((d) => [d.id, d]));
    const m = new Map<string, { earned: number; paid: number; payable_now: number; deals: number }>();
    for (const s of splits) {
      const d = byId.get(s.deal_id);
      if (!d || !COUNTED.has(d.status) || (i.email && s.email.toLowerCase() !== i.email.toLowerCase())) continue;
      const c = m.get(s.email) || { earned: 0, paid: 0, payable_now: 0, deals: 0 };
      c.earned = r2(c.earned + num(s.amount)); c.paid = r2(c.paid + num(s.paid)); c.payable_now = r2(c.payable_now + payableNow(d, s)); c.deals++;
      m.set(s.email, c);
    }
    return { people: [...m].map(([email, v]) => ({ email, ...v, still_owed: r2(v.earned - v.paid), advance_outstanding: advancesOwed(adv, email) })) };
  },
};

const recordDeal: BuntyTool<{ deal_type: string; client_name: string; client_phone?: string; community?: string; cluster?: string; unit?: string; price?: number; commission: number; agents?: string[]; cash_amount?: number; notes?: string }> = {
  name: "record_deal",
  kind: "write",
  description: "Record a new deal and send it for approval. `commission` is before VAT. `agents` is a list like 'ali@x.com:50' (email:share % of the deal; shares must total 100). Each agent's amount is worked out from their own rate.",
  input_schema: { type: "object", properties: {
    deal_type: { type: "string", enum: Object.keys(DEAL_TYPES) }, client_name: { type: "string", maxLength: 200 }, client_phone: { type: "string", maxLength: 40 }, community: { type: "string", maxLength: 120 },
    cluster: { type: "string", maxLength: 120 }, unit: { type: "string", maxLength: 60 }, price: { type: "number", minimum: 0 }, commission: { type: "number", minimum: 1 },
    agents: { type: "array", items: { type: "string" }, maxItems: 6 }, cash_amount: { type: "number", minimum: 0 }, notes: { type: "string", maxLength: 2000 },
  }, required: ["deal_type", "client_name", "commission"], additionalProperties: false },
  async preview(_ctx, i) {
    const m = dealMoney({ commission: i.commission });
    return { title: `Record deal: ${DEAL_TYPES[i.deal_type as DealType].label} · ${i.client_name}`, lines: [
      ...(where(i) ? [where(i)] : []), ...(i.price ? [`Price ${money(i.price)}`] : []), `Commission ${money(m.gross)} + VAT ${money(m.vat)}`,
      (i.agents || []).length ? `Agents: ${(i.agents || []).map((a) => a.replace(":", " ") + "%").join(", ")}` : "No agent share (company income)", "Goes to the approvals inbox. KYC must be complete before approval.",
    ] };
  },
  async run(ctx, i) {
    const agents = (i.agents || []).map((a) => { const [email, pct] = a.split(":"); return { email: email.trim().toLowerCase(), share_pct: Number(pct) }; });
    if (agents.some((a) => !a.email.includes("@") || !(a.share_pct > 0))) throw new ToolError("Each agent must be written as email:share, for example ali@example.com:50");
    if (agents.length && Math.abs(agents.reduce((s, a) => s + a.share_pct, 0) - 100) > 0.001) throw new ToolError("The agents' shares must total 100%.");
    const d = await ctx.db.from("crm_deals").insert({ deal_type: i.deal_type, client_name: i.client_name, client_phone: i.client_phone || null, community: i.community || null, cluster: i.cluster || null, unit: i.unit || null,
      price: i.price ?? null, commission: i.commission, commission_pct: i.price ? Math.round(i.commission / i.price * 100000) / 1000 : null, cash_amount: i.cash_amount || 0, notes: [i.notes, `Recorded by ${ctx.actor}`].filter(Boolean).join("\n") }).select("id,deal_no").single();
    if (d.error) throw new ToolError(missing(d.error.message) ? NOT_READY : d.error.message);
    const parties = kycParties(i.deal_type as DealType);
    if (parties.length) await ctx.db.from("crm_kyc").insert(parties.map((party) => ({ deal_id: d.data.id, party })));
    if (agents.length) { const s = await ctx.db.from("crm_deal_splits").insert(agents.map((a) => ({ deal_id: d.data.id, kind: "agent", ...a }))); if (s.error) throw new ToolError(`Deal saved, but agents were not added: ${s.error.message}`); }
    await ctx.db.from("crm_approvals").insert({ kind: "deal", ref_table: "crm_deals", ref_id: d.data.id, title: `${DEAL_TYPES[i.deal_type as DealType].label} · ${i.client_name}`, amount: i.commission, summary: where(i) || null });
    return { ok: true, deal_no: d.data.deal_no, link: `/deals?open=${d.data.id}`, next: parties.length ? `KYC needed for: ${parties.join(", ")}` : "No KYC needed" };
  },
};

export const commission: BuntyModule = {
  department: "commission",
  tools: [listDeals, getDeal, commissionSummary, recordDeal],
  guide: "Deals and commission: commission is before VAT; 5% VAT is on top and never split. Office commission = commission minus the other agency's share. Each agent gets their % of the deal × their own rate; what is left is the company share; a team leader's override is a % of the company share from their own agents. Agents are paid only as the client's money arrives, in proportion. Deals are never deleted, only cancelled.",
  async pending(ctx) {
    const deals = await soft<Deal>(ctx, "crm_deals");
    if (!deals) return off("Commission");
    const splits = (await soft<Split>(ctx, "crm_deal_splits")) || [];
    const waiting = deals.filter((d) => d.status === "pending");
    const open = deals.filter((d) => ["approved", "invoiced", "part_received"].includes(d.status));
    const payable = r2(deals.filter((d) => COUNTED.has(d.status)).reduce((s, d) => s + splits.filter((l) => l.deal_id === d.id).reduce((t, l) => t + payableNow(d, l), 0), 0));
    const late = open.filter((d) => d.expected_on && d.expected_on < ctx.today);
    const items = [
      ...(waiting.length ? [{ text: `${waiting.length} deal${waiting.length > 1 ? "s" : ""} waiting for approval`, tone: "warn" as const }] : []),
      ...(payable > 0 ? [{ text: `${money(payable)} of agent commission can be paid now`, tone: "warn" as const }] : []),
      ...late.slice(0, 2).map((d) => ({ text: `Deal #${d.deal_no} ${d.client_name}: payment was expected ${d.expected_on}`, tone: "bad" as const })),
      ...(open.length ? [{ text: `${money(open.reduce((s, d) => s + Math.max(0, dealMoney(d).due - num(d.received)), 0))} still to come in on ${open.length} open deal${open.length > 1 ? "s" : ""}`, tone: "info" as const }] : []),
    ];
    const count = waiting.length + late.length + (payable > 0 ? 1 : 0);
    return { count, title: count ? `Commission · ${count} to look at` : "Commission · all clear", items: items.length ? items : [{ text: "No deals waiting.", tone: "good" }], actions: ["Deals this month", "Who is owed commission?"] };
  },
};

/* ------------------------------------------------------------------ compliance */
type KycRow = { deal_id: string; party: string; status: string };
async function kycGaps(ctx: BuntyCtx) {
  const [deals, kyc] = await Promise.all([rows<Deal>(ctx, "crm_deals"), rows<KycRow>(ctx, "crm_kyc")]);
  return {
    kyc: deals.filter((d) => ["pending", "rejected"].includes(d.status)).map((d) => ({ d, missing: kycParties(d.deal_type).filter((p) => kyc.find((k) => k.deal_id === d.id && k.party === p)?.status !== "complete") })).filter((x) => x.missing.length),
    goaml: deals.filter((d) => d.goaml_status === "needed" && d.status !== "cancelled"),
  };
}
const complianceStatus: BuntyTool<Record<string, never>> = {
  name: "get_compliance_status",
  kind: "read",
  description: "Deals whose KYC is not complete (and which party is missing) and cash deals of AED 55,000 or more that still need a goAML report.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const g = await kycGaps(ctx);
    return { kyc_incomplete: g.kyc.map((x) => ({ deal_no: x.d.deal_no, client: x.d.client_name, missing: x.missing, submitted_by: x.d.created_by, link: `/deals?open=${x.d.id}` })),
      goaml_needed: g.goaml.map((d) => ({ deal_no: d.deal_no, client: d.client_name, cash: d.cash_amount, link: `/deals?open=${d.id}` })) };
  },
};
export const compliance: BuntyModule = {
  department: "compliance",
  tools: [complianceStatus],
  guide: "Compliance: a sale needs KYC for buyer and seller, off-plan for the buyer, a rental for tenant and landlord, before the deal can be approved. Only the compliance officer marks KYC complete. Cash of AED 55,000 or more needs a goAML report.",
  async pending(ctx) {
    let g; try { g = await kycGaps(ctx); } catch { return off("Compliance"); }
    const items = [...g.goaml.map((d) => ({ text: `goAML report needed: deal #${d.deal_no} ${d.client_name} (${money(d.cash_amount)} cash)`, tone: "bad" as const })),
      ...g.kyc.slice(0, 4).map((x) => ({ text: `KYC missing for ${x.missing.join(" and ")}: deal #${x.d.deal_no} ${x.d.client_name}`, tone: "warn" as const }))];
    const count = g.kyc.length + g.goaml.length;
    return { count, title: count ? `Compliance · ${count} open` : "Compliance · all clear", items: items.length ? items : [{ text: "KYC is complete on every waiting deal.", tone: "good" }], actions: ["What KYC is missing?"] };
  },
};

/* ------------------------------------------------------------------ accounts */
const accountsSummary: BuntyTool<{ period?: string; day?: string }> = {
  name: "get_accounts_summary",
  kind: "read",
  description: "The books for a month, quarter or year: profit and loss (income, agent commission, expenses by category, profit), bank balance as per the books, unpaid and overdue invoices, bills due, and the cash forecast for the next 60 days. Call twice with different days to compare periods.",
  input_schema: { type: "object", properties: { period: PERIOD, day: DAY }, additionalProperties: false },
  async run(ctx, i) {
    const b = await books(ctx);
    const p = periodOf((i.period as "month") || "month", i.day || ctx.today, await vatFirstMonth(ctx));
    const [accounts, lines] = await Promise.all([rows<BankAccount>(ctx, "crm_bank_accounts"), rows<BankLine>(ctx, "crm_bank_lines")]);
    const unpaid = b.invoices.filter((x) => ["unpaid", "part_paid"].includes(x.status));
    const cash = cashForecast(b, ctx.today, addDays(ctx.today, 60));
    return {
      period: p, profit_and_loss: profitAndLoss(b, p),
      bank_balance_per_books: r2(accounts.reduce((s, a) => s + bankBalance(a, lines), 0)), bank_lines_not_matched: lines.filter((l) => !l.match_kind).length,
      invoices_unpaid: { count: unpaid.length, total: r2(unpaid.reduce((s, x) => s + num(x.total) - num(x.paid), 0)), overdue: unpaid.filter((x) => x.due_date && x.due_date < ctx.today).map((x) => ({ no: x.invoice_no, bill_to: x.bill_to, total: x.total, due: x.due_date })) },
      bills_next_14_days: b.bills.filter((x) => x.active && daysBetween(ctx.today, x.next_due) <= 14).map((x) => ({ name: x.name, due: x.next_due, amount: r2(num(x.amount) + num(x.vat)) })),
      cash_next_60_days: { money_in: cash.totalIn, money_out: cash.totalOut, by_month: cash.months, events: cash.events.slice(0, 25) },
      expenses_waiting_approval: b.expenses.filter((e) => e.status === "pending").length,
    };
  },
};
const listExpenses: BuntyTool<{ status?: string; from?: string; to?: string }> = {
  name: "list_expenses",
  kind: "read",
  description: "Expenses and advances, newest first, with category, vendor, amount, VAT and status.",
  input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "approved", "rejected"] }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" } }, additionalProperties: false },
  async run(ctx, i) {
    let list = await rows<Expense>(ctx, "crm_expenses", (q) => q.order("expense_date", { ascending: false }));
    if (i.status) list = list.filter((e) => e.status === i.status);
    if (i.from) list = list.filter((e) => e.expense_date >= i.from!);
    if (i.to) list = list.filter((e) => e.expense_date <= i.to!);
    return { total: list.length, sum_before_vat: r2(list.reduce((s, e) => s + num(e.amount), 0)), expenses: list.slice(0, 40).map((e) => ({ date: e.expense_date, kind: e.kind, category: e.category, vendor: e.vendor, description: e.description, amount: e.amount, vat: e.vat, status: e.status, by: e.submitted_by, has_receipt: !!e.receipt_path })) };
  },
};
const logExpense: BuntyTool<{ category: string; amount: number; vat?: number; vendor?: string; description?: string; date?: string }> = {
  name: "log_expense",
  kind: "write",
  description: "Log a company expense (amount before VAT, VAT separately). It goes to the approvals inbox unless the person is Accounts or Super Admin, in which case it goes straight into the books.",
  input_schema: { type: "object", properties: {
    category: { type: "string", enum: EXPENSE_CATEGORIES }, amount: { type: "number", minimum: 0.01 }, vat: { type: "number", minimum: 0 }, vendor: { type: "string", maxLength: 200 },
    description: { type: "string", maxLength: 1000 }, date: { type: "string", format: "date" },
  }, required: ["category", "amount"], additionalProperties: false },
  async preview(ctx, i) {
    return { title: `Log expense: ${i.category} ${money(i.amount + (i.vat || 0))}`, lines: [...(i.vendor ? [`Paid to ${i.vendor}`] : []), ...(i.description ? [i.description] : []), `Before VAT ${money(i.amount)}, VAT ${money(i.vat || 0)}`, `Date ${i.date || ctx.today}`] };
  },
  async run(ctx, i) {
    const direct = ctx.me.isAdmin || ctx.me.role === "accounts";
    const r = await ctx.db.from("crm_expenses").insert({ kind: "expense", expense_date: i.date || ctx.today, category: i.category, vendor: i.vendor || null, description: [i.description, `(${ctx.actor})`].filter(Boolean).join(" "), amount: i.amount, vat: i.vat || 0, status: direct ? "approved" : "pending" }).select("id").single();
    if (r.error) throw new ToolError(missing(r.error.message) ? NOT_READY : r.error.message);
    if (!direct) await ctx.db.from("crm_approvals").insert({ kind: "expense", ref_table: "crm_expenses", ref_id: r.data.id, title: `${i.category}${i.vendor ? ` · ${i.vendor}` : ""}`, amount: r2(i.amount + (i.vat || 0)), summary: i.description || null });
    return { ok: true, status: direct ? "in the books" : "sent for approval", link: "/accounts?tab=expenses" };
  },
};
const addBill: BuntyTool<{ name: string; amount: number; vat?: number; frequency: string; next_due: string; category?: string }> = {
  name: "add_bill",
  kind: "write",
  description: "Add a bill with a due date and reminder (one time, monthly, quarterly or yearly), e.g. office tenancy, utilities, a visa renewal.",
  input_schema: { type: "object", properties: {
    name: { type: "string", maxLength: 200 }, amount: { type: "number", minimum: 0 }, vat: { type: "number", minimum: 0 }, frequency: { type: "string", enum: ["once", "monthly", "quarterly", "yearly"] },
    next_due: { type: "string", format: "date" }, category: { type: "string", enum: EXPENSE_CATEGORIES },
  }, required: ["name", "amount", "frequency", "next_due"], additionalProperties: false },
  async preview(_ctx, i) { return { title: `Add bill: ${i.name}`, lines: [`${money(i.amount + (i.vat || 0))} · ${i.frequency}`, `Next due ${i.next_due}`] }; },
  async run(ctx, i) {
    const r = await ctx.db.from("crm_bills").insert({ name: i.name, amount: i.amount, vat: i.vat || 0, frequency: i.frequency, next_due: i.next_due, category: i.category || "Other" });
    if (r.error) throw new ToolError(missing(r.error.message) ? NOT_READY : r.error.message);
    return { ok: true, link: "/accounts?tab=bills" };
  },
};
export const accounts: BuntyModule = {
  department: "accounts",
  tools: [accountsSummary, listExpenses, logExpense, addBill],
  guide: "Accounts: income counts when a deal is approved (deal date); expenses count once approved. Nothing financial is deleted. Bank balance 'as per the books' = opening balance plus uploaded statement lines. Reports are for the accountant, who still reviews and files.",
  async pending(ctx) {
    const [inv, exp, bills] = await Promise.all([soft<Invoice>(ctx, "crm_invoices"), soft<Expense>(ctx, "crm_expenses"), soft<Bill>(ctx, "crm_bills")]);
    if (!inv || !exp || !bills) return off("Accounts");
    const overdue = inv.filter((x) => ["unpaid", "part_paid"].includes(x.status) && x.due_date && x.due_date < ctx.today);
    const waiting = exp.filter((e) => e.status === "pending");
    const due = bills.filter((b) => b.active && daysBetween(ctx.today, b.next_due) <= 7);
    const items = [
      ...overdue.slice(0, 2).map((x) => ({ text: `Invoice ${x.invoice_no} overdue: ${x.bill_to}, ${money(num(x.total) - num(x.paid))}`, tone: "bad" as const })),
      ...due.slice(0, 3).map((b) => ({ text: `${b.name} ${b.next_due < ctx.today ? "is late" : `due ${b.next_due}`}: ${money(num(b.amount) + num(b.vat))}`, tone: (b.next_due < ctx.today ? "bad" : "warn") as "bad" | "warn" })),
      ...(waiting.length ? [{ text: `${waiting.length} expense${waiting.length > 1 ? "s" : ""} waiting for approval`, tone: "warn" as const }] : []),
    ];
    const count = overdue.length + due.length + waiting.length;
    return { count, title: count ? `Accounts · ${count} to look at` : "Accounts · all clear", items: items.length ? items : [{ text: "No overdue invoices or bills due this week.", tone: "good" }], actions: ["Profit this month", "Money coming in the next 60 days"] };
  },
};

/* ------------------------------------------------------------------ VAT & tax */
const vatFigures: BuntyTool<{ day?: string }> = {
  name: "get_vat_and_tax",
  kind: "read",
  description: "VAT return figures box by box for the quarter containing `day` (default: this quarter), when it is due, and the corporate tax estimate for that year (9% of profit above AED 375,000).",
  input_schema: { type: "object", properties: { day: DAY }, additionalProperties: false },
  async run(ctx, i) {
    const b = await books(ctx);
    const day = i.day || ctx.today;
    const q = periodOf("quarter", day, await vatFirstMonth(ctx));
    const year = profitAndLoss(b, periodOf("year", day));
    return { quarter: q, vat_return: vatReturn(b.invoices, b.expenses, q), year: day.slice(0, 4), profit_for_year: year.profit, corporate_tax_estimate: corporateTax(year.profit), note: "Figures for the accountant, who reviews and files." };
  },
};
export const vat: BuntyModule = {
  department: "vat",
  tools: [vatFigures],
  guide: "VAT: 5%, from tax invoices issued (output) and approved expenses with VAT (input), per quarter; the return is due on the 28th of the month after the quarter. Corporate tax estimate: 9% of the year's profit above AED 375,000.",
  async pending(ctx) {
    const [inv, exp] = await Promise.all([soft<Invoice>(ctx, "crm_invoices"), soft<Expense>(ctx, "crm_expenses")]);
    if (!inv || !exp) return off("VAT & tax");
    const first = await vatFirstMonth(ctx);
    const prev = periodOf("quarter", addDays(periodOf("quarter", ctx.today, first).from, -1), first);
    const pv = vatReturn(inv, exp, prev), cur = vatReturn(inv, exp, periodOf("quarter", ctx.today, first));
    const days = daysBetween(ctx.today, pv.due);
    const dueSoon = days >= 0 && days <= 28 && (pv.invoices > 0 || pv.expenses > 0);
    return { count: dueSoon ? 1 : 0, title: dueSoon ? "VAT & tax · return due" : "VAT & tax", items: [
      ...(dueSoon ? [{ text: `VAT return for ${prev.label}: ${money(pv.payable)} to pay by ${pv.due} (${days} days)`, tone: (days <= 7 ? "bad" : "warn") as "bad" | "warn" }] : []),
      { text: `This quarter so far: ${money(cur.payable)} VAT payable, due ${cur.due}`, tone: "info" },
    ], actions: ["VAT this quarter", "Corporate tax estimate"] };
  },
};

/* ------------------------------------------------------------------ HR */
const listStaff: BuntyTool<{ query?: string }> = {
  name: "list_staff",
  kind: "read",
  description: "Staff records: job title, join date, salary type, basic salary, commission rate, pay method, annual leave balance and running gratuity. Optional name search. Salaries are only returned if the person asking may see them.",
  input_schema: { type: "object", properties: { query: { type: "string", maxLength: 80 } }, additionalProperties: false },
  async run(ctx, i) {
    const [staff, leave] = await Promise.all([rows<Staff>(ctx, "crm_staff"), rows<Leave>(ctx, "crm_leave")]);
    const t = (i.query || "").toLowerCase();
    return { staff: staff.filter((s) => !t || s.full_name.toLowerCase().includes(t)).map((s) => ({ name: s.full_name, email: s.email, job_title: s.job_title, status: s.status, joined: s.join_date, salary_type: s.salary_type, basic_salary: s.basic_salary,
      allowances: s.allowances, commission_rate_pct: s.commission_rate, team_leader_override_pct: s.tl_override_pct, paid_by: s.pay_method, leave: leaveBalance(s, leave.filter((l) => l.staff_id === s.id), ctx.today), gratuity_to_date: gratuity(num(s.basic_salary), s.join_date, ctx.today) })) };
  },
};
const listLeave: BuntyTool<{ status?: string }> = {
  name: "list_leave",
  kind: "read",
  description: "Leave requests (default: pending and approved from today on), with who, type, dates and days.",
  input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] } }, additionalProperties: false },
  async run(ctx, i) {
    const [staff, leave] = await Promise.all([rows<Staff>(ctx, "crm_staff"), rows<Leave>(ctx, "crm_leave", (q) => q.order("start_date", { ascending: false }))]);
    const list = leave.filter((l) => (i.status ? l.status === i.status : ["pending", "approved"].includes(l.status) && l.end_date >= ctx.today));
    return { leave: list.slice(0, 40).map((l) => ({ who: staff.find((s) => s.id === l.staff_id)?.full_name, type: l.leave_type, from: l.start_date, to: l.end_date, days: l.days, status: l.status, reason: l.reason })) };
  },
};
const getPayroll: BuntyTool<{ month?: string }> = {
  name: "get_payroll",
  kind: "read",
  description: "Payroll for a month (YYYY-MM-01, default this month): each person's basic, allowances, commission, deductions, net pay, pay method and whether paid.",
  input_schema: { type: "object", properties: { month: { type: "string", format: "date" } }, additionalProperties: false },
  async run(ctx, i) {
    const month = monthStart(i.month || ctx.today);
    const [runs, lines, staff] = await Promise.all([rows<PayrollRun>(ctx, "crm_payroll_runs"), rows<PayrollLine>(ctx, "crm_payroll_lines"), rows<Staff>(ctx, "crm_staff")]);
    const run = runs.find((r) => r.month === month);
    if (!run) return { month, note: "No payroll prepared for this month yet. It is prepared in HR → Payroll." };
    const mine = lines.filter((l) => l.run_id === run.id);
    return { month, status: run.status, total_net: r2(mine.reduce((s, l) => s + num(l.net), 0)), lines: mine.map((l) => ({ who: staff.find((s) => s.id === l.staff_id)?.full_name, basic: l.basic, allowances: l.allowances, commission: l.commission, advance_recovery: l.advance_recovery, deductions: l.deductions, net: l.net, paid_by: l.pay_method, paid: l.paid })), link: "/hr?tab=payroll" };
  },
};
const listCandidates: BuntyTool<{ stage?: string }> = {
  name: "list_candidates",
  kind: "read",
  description: "Recruitment pipeline: candidates with role, source and stage.",
  input_schema: { type: "object", properties: { stage: { type: "string", enum: CANDIDATE_STAGES } }, additionalProperties: false },
  async run(ctx, i) {
    const list = await rows<Candidate>(ctx, "crm_candidates", (q) => q.order("created_at", { ascending: false }));
    return { candidates: list.filter((c) => !i.stage || c.stage === i.stage).slice(0, 40).map((c) => ({ name: c.full_name, role: c.role, source: c.source, stage: c.stage, phone: c.phone, added: c.created_at.slice(0, 10) })) };
  },
};
const addCandidate: BuntyTool<{ full_name: string; role?: string; phone?: string; email?: string; source?: string; notes?: string }> = {
  name: "add_candidate",
  kind: "write",
  description: "Add a job candidate to the recruitment pipeline (stage: Applied).",
  input_schema: { type: "object", properties: { full_name: { type: "string", maxLength: 200 }, role: { type: "string", maxLength: 120 }, phone: { type: "string", maxLength: 40 }, email: { type: "string", maxLength: 160 }, source: { type: "string", maxLength: 60 }, notes: { type: "string", maxLength: 2000 } }, required: ["full_name"], additionalProperties: false },
  async preview(_ctx, i) { return { title: `Add candidate: ${i.full_name}`, lines: [[i.role, i.source].filter(Boolean).join(" · ") || "Stage: Applied", ...(i.phone ? [i.phone] : [])] }; },
  async run(ctx, i) {
    const r = await ctx.db.from("crm_candidates").insert({ full_name: i.full_name, role: i.role || null, phone: i.phone || null, email: i.email || null, source: i.source || "Other", notes: i.notes || null });
    if (r.error) throw new ToolError(missing(r.error.message) ? NOT_READY : r.error.message);
    return { ok: true, link: "/hr?tab=recruitment" };
  },
};
export const hr: BuntyModule = {
  department: "hr",
  tools: [listStaff, listLeave, getPayroll, listCandidates, addCandidate],
  guide: "HR: annual leave is 2 days a month after 6 months and 30 days a year after the first year (UAE Labour Law). Gratuity: 21 days' basic pay per year for the first 5 years, 30 after, nothing under 1 year, capped at 2 years' pay. Payroll is prepared per month in HR → Payroll, which also makes the WPS salary file.",
  async pending(ctx) {
    const [leave, staff, runs] = await Promise.all([soft<Leave>(ctx, "crm_leave"), soft<Staff>(ctx, "crm_staff"), soft<PayrollRun>(ctx, "crm_payroll_runs")]);
    if (!leave || !staff || !runs) return off("HR");
    const waiting = leave.filter((l) => l.status === "pending");
    const lastMonth = monthStart(addDays(monthStart(ctx.today), -1));
    const payrollDue = staff.some((s) => s.status === "active" && num(s.basic_salary) > 0) && runs.find((r) => r.month === lastMonth)?.status !== "final";
    const items = [
      ...waiting.slice(0, 3).map((l) => ({ text: `Leave request: ${staff.find((s) => s.id === l.staff_id)?.full_name || "staff"}, ${l.start_date} to ${l.end_date} (${l.days} days)`, tone: "warn" as const })),
      ...(payrollDue ? [{ text: `Payroll for ${lastMonth.slice(0, 7)} is not finalised`, tone: "warn" as const }] : []),
    ];
    const count = waiting.length + (payrollDue ? 1 : 0);
    return { count, title: count ? `HR · ${count} to look at` : "HR · all clear", items: items.length ? items : [{ text: "No leave requests waiting.", tone: "good" }], actions: ["Who is on leave?", "Leave balances"] };
  },
};

/* ------------------------------------------------------------------ documents */
async function docStates(ctx: BuntyCtx, days: number) {
  const [docs, staff] = await Promise.all([rows<StaffDoc>(ctx, "crm_staff_documents"), rows<Staff>(ctx, "crm_staff")]);
  return docs.map((d) => ({ d, who: staff.find((s) => s.id === d.staff_id), st: expiryState(d.expiry_date, ctx.today, days) })).filter((x) => x.who?.status === "active" && x.d.expiry_date && x.st.tone !== "good")
    .sort((a, b) => (a.d.expiry_date || "").localeCompare(b.d.expiry_date || ""));
}
const expiringDocuments: BuntyTool<{ days?: number }> = {
  name: "list_expiring_documents",
  kind: "read",
  description: "Staff documents (visa, work permit, Emirates ID, passport, RERA broker card, contract, health insurance) that have expired or expire within `days` (default 30).",
  input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365 } }, additionalProperties: false },
  async run(ctx, i) {
    return { documents: (await docStates(ctx, i.days || 30)).map((x) => ({ who: x.who?.full_name, document: x.d.doc_type, number: x.d.doc_number, expires: x.d.expiry_date, state: x.st.text })) };
  },
};
export const documents: BuntyModule = {
  department: "documents",
  tools: [expiringDocuments],
  async pending(ctx) {
    let list; try { list = await docStates(ctx, 30); } catch { return off("Documents"); }
    return { count: list.length, title: list.length ? `Documents · ${list.length} expiring` : "Documents · all in date",
      items: list.length ? list.slice(0, 5).map((x) => ({ text: `${x.who?.full_name}: ${x.d.doc_type} ${x.st.text.toLowerCase()}`, tone: x.st.tone === "bad" ? "bad" as const : "warn" as const })) : [{ text: "Nothing expires in the next 30 days.", tone: "good" }],
      actions: ["Whose visa expires this month?"] };
  },
};

/* ------------------------------------------------------------------ listings */
const listListings: BuntyTool<{ status?: string; query?: string }> = {
  name: "list_listings",
  kind: "read",
  description: "Property listings with price, agent, Trakheesi permit and its expiry, and status (draft, waiting for approval, live, unpublished, sold, rented).",
  input_schema: { type: "object", properties: { status: { type: "string", enum: Object.keys(LISTING_STATUS) }, query: { type: "string", maxLength: 80 } }, additionalProperties: false },
  async run(ctx, i) {
    let list = await rows<Listing>(ctx, "crm_listings", (q) => q.order("created_at", { ascending: false }));
    if (i.status) list = list.filter((l) => l.status === i.status);
    if (i.query) { const t = i.query.toLowerCase(); list = list.filter((l) => `${l.ref} ${where(l)} ${l.title || ""}`.toLowerCase().includes(t)); }
    return { total: list.length, listings: list.slice(0, 40).map((l) => ({ ref: l.ref, property: where(l), purpose: l.purpose, type: l.property_type, bedrooms: l.bedrooms, price: l.price, agent: l.agent_email, permit: l.permit_no, permit_expiry: l.permit_expiry,
      permit_state: expiryState(l.permit_expiry, ctx.today).text, form_a: !!l.form_a_path, status: LISTING_STATUS[l.status], link: `/listings?open=${l.id}` })) };
  },
};
export const listings: BuntyModule = {
  department: "listings",
  tools: [listListings],
  guide: "Listings: created from an owner's unit; before going live a listing needs a Trakheesi permit in date, a signed Form A, the agent's RERA card (BRN) in date and an approver's yes. A live listing leaves the portal feeds by itself the day its permit expires.",
  async pending(ctx) {
    const list = await soft<Listing>(ctx, "crm_listings");
    if (!list) return off("Listings");
    const waiting = list.filter((l) => l.status === "pending");
    const permits = list.filter((l) => l.status === "live" && expiryState(l.permit_expiry, ctx.today).tone !== "good");
    const items = [...permits.slice(0, 3).map((l) => ({ text: `${l.ref} ${where(l)}: permit ${expiryState(l.permit_expiry, ctx.today).text.toLowerCase()}`, tone: (l.permit_expiry && l.permit_expiry < ctx.today ? "bad" : "warn") as "bad" | "warn" })),
      ...(waiting.length ? [{ text: `${waiting.length} listing${waiting.length > 1 ? "s" : ""} waiting for approval`, tone: "warn" as const }] : [])];
    const count = waiting.length + permits.length;
    return { count, title: count ? `Listings · ${count} to look at` : `Listings · ${list.filter((l) => l.status === "live").length} live`, items: items.length ? items : [{ text: "No permits expiring and nothing waiting.", tone: "good" }], actions: ["Live listings", "Permits expiring"] };
  },
};
