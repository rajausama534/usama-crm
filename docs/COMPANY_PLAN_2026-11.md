# Usama Real Estate — company system design (November 2026)

Status: **design for Usama's approval. Nothing is built.** Agreed in discussion on 7 Nov 2026.
Company name for now: **Usama Real Estate** (changeable in Settings). VAT registered, returns every 3 months.

Request (7 Nov 2026): run the entire company in the system — sales, accounts, HR, VAT, everything; record
each deal's commission with multiple agents, splits, company share and VAT. It must be a proper company system,
super fast, with a high-end, simple, pleasing design.

---

## 1. The new app
- **New app, same data.** A new modern app (React / Next.js on Vercel) on the existing Supabase database.
  Owners, leads, notes, calendar and all history stay exactly as they are. The old CRM keeps working until the
  new one is approved, then usamabinnusrat.com switches over.
- **Layout:** left sidebar by department — Sales (Leads, Owners, Listings, Deals), Accounts, HR, Compliance,
  Approvals. Each person sees only the departments they have access to. Cmd+K search finds anything (owner,
  lead, deal, invoice, staff). Bottom tabs on phone.
- **Look:** clean premium, light and dark mode, calm and spacious, one accent colour, sharp numbers; smooth
  animations, not complicated.
- **Speed targets** (measured on the preview before go-live): any page usable in under 1 second, search results
  under 0.3 seconds, no full-page reloads.
- **Super Admin (Usama):** whole-company dashboard — revenue, company share, pipeline, cash forecast, VAT due,
  agent/team performance, approvals waiting, expiring documents.

## 2. People and access
- Roles: **Super Admin**, **Agent**, **Team Leader**, **Accounts**, **Admin / HR / Operations**.
- A role sets the usual access; extra ticks per person (e.g. *Compliance officer*, *Approve expenses*).
  Compliance is you for now, can be given to an accountant/admin later.
- Enforced by the database (Row Level Security), not only the screen.
- Agents: own leads, owners in their areas, own deals and **only their own commission**.
  Team Leaders: their team's leads, deals and performance. Accounts and Super Admin: everything financial.

## 3. Deals and commission
**Deal types:** secondary sale, off-plan sale, rental, holiday-home management, other income
(mortgage referrals, referral fees from agencies).

**Starting a deal:** moving a lead to **Won** opens "Record deal" pre-filled (client, unit, owner); deals can
also be added from the Deals page. The **agent submits; you or Accounts approve.** Only approved deals count.
A deal can't be approved until KYC is complete (section 6).

**Default commission (editable on every deal):**
| Type | Default |
|---|---|
| Secondary sale | 2% from buyer. Seller fee optional (sometimes paid) |
| Off-plan | From the developer's slab (below) |
| Rental | 5% of yearly rent, paid by tenant |
| Holiday home | % of the unit's rental income (company income only, no agent share) |
| Mortgage / agency referral | Amount typed; agent gets their normal rate |

**Off-plan developers:** a Developers list with each developer's slabs — by AED sold or by units sold, over a
period you set. The system suggests the % for each deal. When a higher slab is reached it applies to **all
units in that period (backdated)**; the system shows the top-up to claim. **Slab top-ups are company income
only.** Developers usually release commission after the buyer pays 20%, then pay in 45–60 days — the deal shows
"expected on" for the cash forecast.

**Other agencies (co-broking):** the buyer's agency always collects from the buyer.
- We are the buyer's agency → we collect and pay the listing agency their agreed share.
- We hold the property, another agency brings the buyer → we invoice them for our agreed share.

**Splits — order of calculation:**
1. Commission before VAT (VAT 5% added on top, kept separate for the FTA, never split)
2. Minus the other agency's share (if any) → **office commission**
3. Each of our agents gets their % of the deal (must total 100%) × their own rate (set on their profile,
   editable per deal)
4. What's left is the **company share**
5. Team Leader override = their % (usually 5–10%, set per TL, editable per deal) **of the company share**

Example: office commission AED 100,000, one agent at 50% → agent 50,000, company 50,000;
TL override 10% → TL 5,000, company keeps 45,000.

**Paying agents:** agents are paid only after the client/developer money arrives, in proportion to what has been
received. Advances/loans to an agent are recovered from their next commission. Agents who leave are still paid
when money arrives later.

**Deal statuses:** Pending approval → Approved → Invoiced → Part received → Fully received → Agents paid
(or Cancelled; never deleted). Every change kept in history.

## 4. Accounts — the company's books live in the system
- **One business bank account** (more can be added). Bank statement upload (CSV/Excel) from any bank: the first
  upload from a bank you show which columns are date / description / amount, it remembers the layout. Each line
  is matched to deals, invoices and expenses; unknown lines are asked about.
- **Tax invoices:** numbered, with TRN, logo and bank details; PDF download and sent by email; payment status.
- **Expenses:** staff submit with a receipt photo; you/Accounts approve; approved ones go into the books and VAT.
- **Recurring bills:** visa renewals, office tenancy, utilities and other bills with due dates and reminders.
- **Reports:** profit & loss by month/quarter/year; VAT return figures per quarter (box by box for the FTA);
  corporate tax estimate (9% on yearly profit above AED 375,000); agent and team performance;
  **cash forecast** — commission coming in (incl. developers' 45–60 days) and bills going out.
- Nothing financial is deleted (FTA requires 5 years of records). Excel export for your accountant/auditor,
  who still reviews and files.

## 5. HR
- **Staff records** with salary type per person: commission only, basic + commission, or mixed.
- **Payroll** per person: WPS (the system produces the salary file, SIF), bank transfer, or cash
  (for people not yet on the company visa) with a signed receipt. Commission and advance recoveries shown.
- **Leave:** request in the system → manager/HR approves; balances by UAE labour law.
- **Documents with expiry reminders:** visa, work permit/labour card, Emirates ID, passport, RERA broker card
  (BRN), employment contract, health insurance.
- **End of service:** running gratuity per person (UAE law) and final settlement (unpaid salary, leave balance,
  commission still due).
- No attendance tracking.
- **Recruitment:** candidates (CV, source, applied → interview → offer → joined) and an onboarding checklist
  (visa, Emirates ID, RERA course/BRN, system login, portal accounts) that creates the staff record.

## 6. Compliance / AML
- KYC before deal approval: buyer and seller ID copies, nationality, source of funds, sanctions check note.
- Cash deals of AED 55,000 or more are flagged for a goAML report.
- Handled by whoever has the *Compliance officer* tick (you for now).

## 7. Listings and marketing
- Listings created from an existing owner's unit; the owner's history shows "listed with us" then
  "sold/rented by us".
- Before going live: valid Trakheesi permit (auto-unpublished when it expires), signed Form A uploaded, manager
  approval, agent's BRN in date.
- Published through feeds to Property Finder, Bayut/Dubizzle and **your own website**. Needs feed access from
  each portal for your account.

## 8. Approvals and alerts
- **Approvals inbox:** deals and commission splits, expenses and advances, leave requests, listings going live.
- Tasks between staff.
- Alerts in the app (bell) and by email: approvals, follow-ups, document expiries, bills due, Trakheesi expiry.

---

## Build order (each step tested on a preview and live only with your OK)
1. **Foundation:** new app shell and design, roles + extra ticks, approvals inbox, your company dashboard,
   today's Leads / Owners / Calendar moved into the new app.
2. **Deals + commission + KYC.**
3. **Accounts:** invoices, bank statement upload, expenses, recurring bills, VAT, cash forecast, P&L, tax estimate.
4. **HR:** staff, payroll / WPS, leave, documents, gratuity, recruitment.
5. **Listings:** listings, permits, portal and website feeds.

## Safety rules (unchanged)
- No owner records deleted or merged, no owner history lost, without your OK.
- Database changes on the live project, merging and going live need your OK each time.
- Every change to deals, money and staff records is kept in the change history.
