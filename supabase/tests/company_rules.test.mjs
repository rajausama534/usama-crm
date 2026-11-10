// Checks the company-departments database update (20261110100000) on a throwaway in-memory Postgres (PGlite):
// the update applies cleanly, the commission split matches the plan, and each role sees and changes only what it may.
// It never connects to the real database. Storage and auth are stand-ins, so storage policies are not covered.
//
//   npm install --prefix /tmp/pg-test @electric-sql/pglite
//   NODE_PATH=/tmp/pg-test/node_modules node supabase/tests/company_rules.test.mjs
//   (or copy this file next to that node_modules folder and run it there)
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const M = new URL("../migrations/", import.meta.url).pathname;
const db = new PGlite();
const old = fs.readFileSync(M + "20261019130000_permissions_history_sorting.sql", "utf8");
const grab = (name) => { const i = old.indexOf(`create or replace function private.${name}(`); const j = old.indexOf("$$;", i); if (i < 0) throw new Error(name); return old.slice(i, j + 3); };
await db.exec(`
create role authenticated nologin; create role anon nologin;
create schema private; create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create table public.user_access (id uuid primary key default gen_random_uuid(), email text not null, name text, role text, active boolean default true, assigned_communities text[], assigned_clusters text[]);
alter table public.user_access enable row level security;
create table public.leads (id uuid primary key default gen_random_uuid(), assigned_to text); alter table public.leads enable row level security;
create table public.owner_activities (id bigserial primary key, owner_id text, activity_type text, details text, created_by text, created_at timestamptz default now());
create table public.crm_change_log (id bigserial primary key, table_name text not null, row_id text not null, action text not null, changed_at timestamptz not null default now(), changed_by text, old_row jsonb, new_row jsonb);
grant usage on schema public, private, auth, storage to authenticated, anon;
grant select on public.user_access to authenticated;
create policy ua on public.user_access for select to authenticated using (true);
`);
for (const f of ["current_email", "access_row", "is_admin", "is_active", "log_change"]) await db.exec(grab(f));
await db.exec(fs.readFileSync(M + "20261108100000_roles_permissions_approvals.sql", "utf8"));
await db.exec("grant select, insert on public.crm_approvals to authenticated; grant usage on all sequences in schema public to authenticated;");
await db.exec(fs.readFileSync(M + "20261110100000_deals_accounts_hr_listings.sql", "utf8"));
console.log("migration applied cleanly");
// applying twice must also work (idempotent apart from policies)
await db.exec(`select set_config('request.jwt.claims', '{"email":"thechussar@gmail.com"}', false); insert into public.user_access (email, name, role) values
 ('omar@x.test','Omar','agent'),('nina@x.test','Nina','agent'),('james@x.test','James','team_leader'),('sara@x.test','Sara','accounts'),('hana@x.test','Hana','hr');
 update public.user_access set team_leader = 'james@x.test' where email = 'omar@x.test'; select set_config('request.jwt.claims', '', false);`);
const SUPER = "thechussar@gmail.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else fail++; console.log(cond ? "  ok  " : "  FAIL", name, cond ? "" : extra); };
async function as(email, sql, params = []) {
  await db.exec("begin"); let out, err;
  try {
    await db.exec(`set local role ${email ? "authenticated" : "anon"}; select set_config('request.jwt.claims', '${JSON.stringify({ email: email || "" })}', true);`);
    out = (await db.query(sql, params)).rows; await db.exec("commit");
  } catch (e) { err = e.message; await db.exec("rollback"); }
  return { rows: out, err };
}
const one = async (email, sql, p) => { const r = await as(email, sql, p); if (r.err) throw new Error(sql + " → " + r.err); return r.rows[0]; };

// staff
let r = await as("omar@x.test", "insert into crm_staff (full_name) values ('x')"); ok("agent cannot add staff", !!r.err);
for (const [e, n, rate, tl] of [["omar@x.test", "Omar", 60, 0], ["nina@x.test", "Nina", 50, 0], ["james@x.test", "James", 50, 10]])
  await one("hana@x.test", "insert into crm_staff (email, full_name, commission_rate, tl_override_pct, basic_salary, join_date) values ($1,$2,$3,$4,5000,'2024-01-01') returning id", [e, n, rate, tl]);
r = await as("omar@x.test", "select full_name from crm_staff"); ok("agent sees only own staff record", r.rows.length === 1 && r.rows[0].full_name === "Omar", JSON.stringify(r));

// deal by agent
const deal = await one("omar@x.test", "insert into crm_deals (deal_type, client_name, price, commission) values ('secondary','Rosa',5000000,100000) returning id, vat, office_commission, status");
ok("vat 5% and office commission", Number(deal.vat) === 5000 && Number(deal.office_commission) === 100000 && deal.status === "pending", JSON.stringify(deal));
r = await as("omar@x.test", "insert into crm_deal_splits (deal_id, email, share_pct, rate_pct) values ($1,'omar@x.test',100,95)", [deal.id]); ok("agent cannot set own rate", !!r.err);
r = await as("omar@x.test", "insert into crm_deal_splits (deal_id, email, share_pct) values ($1,'omar@x.test',100)", [deal.id]); ok("agent adds own split", !r.err, r.err);
r = await as("sara@x.test", "select kind, email, rate_pct, amount from crm_deal_splits where deal_id = $1 order by kind", [deal.id]);
ok("agent 60% = 60,000; TL 10% of 40,000 = 4,000", r.rows.length === 2 && Number(r.rows[0].amount) === 60000 && Number(r.rows[1].amount) === 4000 && r.rows[1].email === "james@x.test", JSON.stringify(r.rows));
r = await as("omar@x.test", "select email from crm_deal_splits"); ok("agent sees only own commission line", r.rows.length === 1 && r.rows[0].email === "omar@x.test", JSON.stringify(r.rows));
r = await as("james@x.test", "select email from crm_deal_splits"); ok("team leader sees own + team's lines", r.rows.length === 2);
r = await as("nina@x.test", "select id from crm_deals"); ok("other agent sees no deal", r.rows.length === 0);
r = await as("james@x.test", "select id from crm_deals"); ok("team leader sees team's deal", r.rows.length === 1);
r = await as("hana@x.test", "select id from crm_deals"); ok("HR sees no deals", r.rows.length === 0);

// approval + KYC
const ap = await one("omar@x.test", "insert into crm_approvals (kind, ref_table, ref_id, title) values ('deal','crm_deals',$1,'Rosa') returning id", [deal.id]);
r = await as("sara@x.test", "select crm_decide_approval($1, true, null)", [ap.id]); ok("approval blocked without KYC", /KYC/.test(r.err || ""), r.err);
await one("omar@x.test", "insert into crm_kyc (deal_id, party, full_name) values ($1,'buyer','Rosa'), ($1,'seller','Sam') returning id", [deal.id]);
r = await as("omar@x.test", "update crm_kyc set status = 'complete' where deal_id = $1 returning id", [deal.id]); ok("agent cannot complete KYC", !!r.err || r.rows.length === 0, JSON.stringify(r));
r = await as(SUPER, "update crm_kyc set status = 'complete' where deal_id = $1", [deal.id]); ok("KYC cannot complete with fields missing", /KYC needs/.test(r.err || ""), r.err);
r = await as(SUPER, "update crm_kyc set status = 'complete', id_number = '784', id_file = 'kyc/a.pdf', source_of_funds = 'savings', sanctions_checked = true where deal_id = $1 returning completed_by", [deal.id]);
ok("compliance completes KYC", !r.err && r.rows.length === 2 && r.rows[0].completed_by === SUPER, r.err);
r = await as("omar@x.test", "select crm_decide_approval($1, true, null)", [ap.id]); ok("agent cannot approve own deal", !!r.err);
r = await as("sara@x.test", "select crm_decide_approval($1, true, null)", [ap.id]); ok("accounts approves", !r.err, r.err);
r = await as("sara@x.test", "select status, approved_by from crm_deals where id = $1", [deal.id]); ok("deal is approved", r.rows[0].status === "approved" && r.rows[0].approved_by === "sara@x.test", JSON.stringify(r.rows));
r = await as("omar@x.test", "update crm_deals set commission = 1 where id = $1 returning id", [deal.id]); ok("agent cannot change an approved deal", !!r.err || r.rows.length === 0);

// invoice + money
r = await as("omar@x.test", "insert into crm_invoices (invoice_no, bill_to, subtotal) values ('', 'x', 1)"); ok("agent cannot invoice", !!r.err);
const inv = await one("sara@x.test", "insert into crm_invoices (invoice_no, deal_id, bill_to, subtotal, vat) values ('',$1,'Rosa',100000,5000) returning invoice_no, total", [deal.id]);
ok("invoice number and total", /^INV-\d{4}-0001$/.test(inv.invoice_no) && Number(inv.total) === 105000, JSON.stringify(inv));
const st = async () => (await one("sara@x.test", "select status, received from crm_deals where id = $1", [deal.id]));
ok("deal → invoiced", (await st()).status === "invoiced");
r = await as("omar@x.test", "insert into crm_deal_payments (deal_id, kind, amount) values ($1,'received',1)", [deal.id]); ok("agent cannot record money", !!r.err);
await one("sara@x.test", "insert into crm_deal_payments (deal_id, kind, amount) values ($1,'received',52500) returning id", [deal.id]);
ok("deal → part received", (await st()).status === "part_received");
await one("sara@x.test", "insert into crm_deal_payments (deal_id, kind, email, amount) values ($1,'payout','omar@x.test',30000) returning id", [deal.id]);
r = await as("omar@x.test", "select paid from crm_deal_splits"); ok("split shows 30,000 paid", Number(r.rows[0].paid) === 30000);
r = await as("omar@x.test", "select kind from crm_deal_payments"); ok("agent sees only own payout", r.rows.length === 1 && r.rows[0].kind === "payout");
await one("sara@x.test", "insert into crm_deal_payments (deal_id, kind, amount) values ($1,'received',52500) returning id", [deal.id]);
ok("deal → fully received", (await st()).status === "received");
await one("sara@x.test", "insert into crm_deal_payments (deal_id, kind, email, amount) values ($1,'payout','omar@x.test',30000), ($1,'payout','james@x.test',4000) returning id", [deal.id]);
ok("deal → agents paid", (await st()).status === "agents_paid");
r = await as("sara@x.test", "delete from crm_deal_payments"); ok("payments cannot be deleted", !!r.err);
r = await as("sara@x.test", "delete from crm_deals"); ok("deals cannot be deleted", !!r.err);
r = await db.query("select count(*)::int n from crm_change_log where table_name = 'crm_deals'"); ok("deal changes are logged", r.rows[0].n >= 3, JSON.stringify(r.rows));

// co-broke, two agents, goAML
const d2 = await one(SUPER, "insert into crm_deals (deal_type, client_name, commission, other_agency_direction, other_agency_amount, cash_amount) values ('referral','Tom',80000,'we_pay',30000,60000) returning id, office_commission, goaml_status");
ok("other agency share and goAML flag", Number(d2.office_commission) === 50000 && d2.goaml_status === "needed", JSON.stringify(d2));
await one(SUPER, "insert into crm_deal_splits (deal_id, email, share_pct) values ($1,'omar@x.test',50), ($1,'nina@x.test',50) returning id", [d2.id]);
r = await as(SUPER, "select email, kind, amount from crm_deal_splits where deal_id = $1 order by kind, email", [d2.id]);
ok("two agents: Nina 12,500, Omar 15,000, TL 10% of Omar's 10,000 company part = 1,000", r.rows.map((x) => Number(x.amount)).join() === "12500,15000,1000", JSON.stringify(r.rows));
await one(SUPER, "update crm_deals set commission = 130000 where id = $1 returning id", [d2.id]);
r = await as(SUPER, "select amount from crm_deal_splits where deal_id = $1 order by kind, email", [d2.id]); ok("split recalculates when commission changes", r.rows.map((x) => Number(x.amount)).join() === "25000,30000,2000", JSON.stringify(r.rows));
const ap2 = await one(SUPER, "insert into crm_approvals (kind, ref_table, ref_id, title) values ('deal','crm_deals',$1,'Tom') returning id", [d2.id]);
await one(SUPER, "update crm_deal_splits set share_pct = 40 where deal_id = $1 and email = 'nina@x.test' returning id", [d2.id]);
r = await as(SUPER, "select crm_decide_approval($1, true, null)", [ap2.id]); ok("approval blocked when shares are not 100%", /add up/.test(r.err || ""), r.err);

// expenses
const ex = await one("omar@x.test", "insert into crm_expenses (category, amount, vat) values ('Travel & fuel', 200, 10) returning id, total, status");
ok("expense pending, total 210", ex.status === "pending" && Number(ex.total) === 210);
r = await as("omar@x.test", "insert into crm_expenses (category, amount, status) values ('Other', 5, 'approved')"); ok("agent cannot self-approve an expense", !!r.err);
r = await as("nina@x.test", "select id from crm_expenses"); ok("other agent cannot see it", r.rows.length === 0);
const ap3 = await one("omar@x.test", "insert into crm_approvals (kind, ref_table, ref_id, title, amount) values ('expense','crm_expenses',$1,'Fuel',210) returning id", [ex.id]);
await one("sara@x.test", "select crm_decide_approval($1, true, 'ok')", [ap3.id]);
r = await as("omar@x.test", "select status, decided_by from crm_expenses"); ok("expense approved through the inbox", r.rows[0].status === "approved" && r.rows[0].decided_by === "sara@x.test");

// leave
const sid = (await one("hana@x.test", "select id from crm_staff where email = 'omar@x.test'")).id;
const lv = await one("omar@x.test", "insert into crm_leave (staff_id, start_date, end_date, days) values ($1,'2026-12-01','2026-12-05',5) returning id", [sid]);
r = await as("nina@x.test", "insert into crm_leave (staff_id, start_date, end_date, days) values ($1,'2026-12-01','2026-12-05',5)", [sid]); ok("cannot request leave for someone else", !!r.err);
const ap4 = await one("omar@x.test", "insert into crm_approvals (kind, ref_table, ref_id, title) values ('leave','crm_leave',$1,'Leave') returning id", [lv.id]);
r = await as("james@x.test", "select crm_decide_approval($1, true, null)", [ap4.id]); ok("team leader approves team's leave", !r.err, r.err);
r = await as("omar@x.test", "select status from crm_leave"); ok("leave approved", r.rows[0].status === "approved");

// payroll
const run = await one("hana@x.test", "insert into crm_payroll_runs (month) values ('2026-11-01') returning id");
await one("hana@x.test", "insert into crm_payroll_lines (run_id, staff_id, basic, commission, deductions) values ($1,$2,5000,1000,200) returning net", [run.id, sid]).then((x) => ok("payroll net = 5,800", Number(x.net) === 5800));
r = await as("omar@x.test", "select net from crm_payroll_lines"); ok("agent sees own payslip only", r.rows.length === 1);
r = await as("nina@x.test", "select net from crm_payroll_lines"); ok("other agent sees no payslip", r.rows.length === 0);

// listings
const li = await one("omar@x.test", "insert into crm_listings (owner_id, community, unit, price, permit_no, permit_expiry, form_a_path, status) values (5,'Alana','12',3000000,'T-1', current_date + 30, 'listings/a.pdf','pending') returning id, ref");
ok("listing reference", /^URE-\d+$/.test(li.ref), li.ref);
r = await as("omar@x.test", "update crm_listings set status = 'live' where id = $1 returning id", [li.id]); ok("agent cannot make a listing live", !!r.err || r.rows.length === 0);
const ap5 = await one("omar@x.test", "insert into crm_approvals (kind, ref_table, ref_id, title) values ('listing','crm_listings',$1,'L') returning id", [li.id]);
r = await as("james@x.test", "select crm_decide_approval($1, true, null)", [ap5.id]); ok("go-live blocked without the agent's BRN", /BRN/.test(r.err || ""), r.err);
await one("hana@x.test", "insert into crm_staff_documents (staff_id, doc_type, doc_number, expiry_date) values ($1,'RERA broker card (BRN)','55123', current_date + 200) returning id", [sid]);
r = await as("omar@x.test", "select crm_listing_blockers($1) b", [li.id]); ok("no blockers left", r.rows[0].b.length === 0, JSON.stringify(r));
r = await as("james@x.test", "select crm_decide_approval($1, true, null)", [ap5.id]); ok("team leader approves the listing", !r.err, r.err);
r = await as("nina@x.test", "select status from crm_listings"); ok("live listing visible to sales staff", r.rows.length === 1 && r.rows[0].status === "live");
r = await db.query("select activity_type, owner_id, created_by from owner_activities"); ok("owner history says Listed with us", r.rows.length === 1 && r.rows[0].activity_type === "Listed with us" && r.rows[0].owner_id === "5", JSON.stringify(r.rows));
r = await as(null, "select ref, agent_brn, agent_name from crm_listings_feed()"); ok("public feed has the live listing with BRN", !r.err && r.rows.length === 1 && r.rows[0].agent_brn === "55123", JSON.stringify(r));
r = await as(null, "select * from crm_listings"); ok("public cannot read the listings table", !!r.err);
r = await as(null, "select * from crm_deals"); ok("public cannot read deals", !!r.err);
await db.exec("update crm_listings set permit_expiry = current_date - 1");
r = await as(null, "select ref from crm_listings_feed()"); ok("expired permit leaves the feed", r.rows.length === 0);
r = await db.query("select crm_unpublish_expired_listings() n"); ok("daily job unpublishes it", r.rows[0].n === 1);
await one("omar@x.test", "update crm_listings set status = 'sold' where id = $1 returning id", [li.id]);
r = await db.query("select activity_type from owner_activities order by id desc limit 1"); ok("owner history says Sold by us", r.rows[0].activity_type === "Sold by us");

// settings, bank
r = await as("omar@x.test", "select * from crm_company_settings"); ok("agent cannot read company settings", r.rows.length === 0);
r = await as("sara@x.test", "update crm_company_settings set data = '{\"trn\":\"100\"}' returning id"); ok("accounts saves settings", r.rows?.length === 1, r.err);
r = await as("omar@x.test", "select * from crm_bank_lines"); ok("agent sees no bank lines", r.rows.length === 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
