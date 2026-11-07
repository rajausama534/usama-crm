# Running the whole company in the CRM — plan (November 2026)

Status: **draft, waiting for Usama's approval.** Nothing is built yet. Branch `deals-commission`.

Request (7 Nov 2026): "make it run an entire company including the accounts department, HR, VAT, everything …
If someone closes a deal, record how much commission that agent will get; if there are multiple agents,
multiple splits, then company share, then VAT, everything."

## Phase order (agreed 7 Nov 2026)
1. **Deals + Commission** (this phase, detailed below)
2. **Accounts** — invoices, income, expenses, VAT return summary every 3 months
3. **HR** — staff files, salaries, leave, visa / Emirates ID / RERA card expiry reminders

Each phase gets its own plan, approval, branch and preview test before going live.

---

## Phase 1 — Deals + Commission

### What you agreed
| Question | Answer |
|---|---|
| Deal types | Secondary sale (resale), off-plan sale, rental, holiday home / management, plus "other company income" |
| Commission amount | CRM fills a default rate per deal type; you can change it on any deal |
| Several agents | Enter % per agent on each deal (must total 100%), plus an option for a deal shared with another agency |
| Agent vs company | Each agent has their own rate on their profile; can be changed on a single deal |
| VAT | 5% added on top of the commission; splits are worked out on the amount before VAT |
| Who sees what | An agent sees the deals they are on and only their own commission. You and a new **Accounts** role see everything |
| Money tracking | Invoiced → received from client (part payments allowed) → agent paid |
| Starting a deal | Moving a lead to **Won** opens "Record deal", pre-filled; a deal can also be added from a new **Deals** page |

### What a deal records
- Type, date closed, status (Closed → Invoiced → Part received → Fully received → Agents paid; or Cancelled)
- Property: community, cluster, unit (linked to the owner record when there is one), property type, beds
- Price: sale price, or yearly rent for rentals
- Sides: buyer / tenant (linked to the lead), seller / landlord (linked to the owner), developer for off-plan
- Commission lines: who pays (buyer, seller, developer, tenant, landlord, other), % or fixed AED → amount
- Other agency (optional): agency name, RERA/ORN number, their share as % or fixed AED
- Our agents: each agent's % of the deal and their own rate (copied from their profile, editable here)
- Notes and attachments (Form F / tenancy contract / booking form) — attachments can come later if you prefer

### Proposed default rates (change them before I build, or later on a Settings screen)
| Deal type | Default commission |
|---|---|
| Secondary sale | 2% from buyer + 2% from seller |
| Off-plan | Developer pays; % typed per project (no fixed default) |
| Rental | 5% of yearly rent from tenant |
| Holiday home / management | Management fee % typed per property |
| Other company income | Amount typed |

### How the money is worked out (example)
Villa resale, AED 3,000,000. 2% buyer + 2% seller. Another agency brought the buyer and gets AED 30,000.
Agent A (rate 50%) did 60% of the work, Agent B (rate 70%) did 40%.

| | AED |
|---|---|
| Commission before VAT (4% of 3,000,000) | 120,000 |
| VAT 5% on top (owed to the FTA, not shared) | 6,000 |
| Invoiced to clients | 126,000 |
| Other agency's share | − 30,000 |
| **Left for our office** | **90,000** |
| Agent A: 60% of 90,000 = 54,000 × 50% | 27,000 |
| Agent B: 40% of 90,000 = 36,000 × 70% | 25,200 |
| **Company share** (54,000 − 27,000) + (36,000 − 25,200) | **37,800** |

Check: 30,000 + 27,000 + 25,200 + 37,800 = 120,000.

Agents become payable as the client's money comes in: if half the commission has been received, half of each
agent's commission shows as "due now". Off-plan stage payments work the same way.

### Screens
- **Deals page** (new menu item): list with filters (type, status, agent, month), totals at the top
  (commission this month / year, company share, VAT collected, owed by clients, owed to agents).
- **Record / edit deal** form with the live calculation above, shown as you type.
- **Deal page**: the breakdown, payments received, agent payouts, history of changes.
- **Leads**: choosing **Won** asks "Record the deal now?" and opens the form pre-filled.
- **Users page**: new "Commission rate %" for each agent, and a new **Accounts** role.
- **Agent's view**: "My deals" with only their own commission: earned, received, paid, still owed.

### Safety
- Database permissions (Row Level Security) enforce who sees what, not just the screen.
- Every change to a deal, payment or payout is kept in the change history (`crm_change_log`), like owners and leads.
- Deals are cancelled, never deleted, so the history stays.
- Nothing existing (owners, leads, notes) is changed. Leads only gain a link to their deal.
- I test on the Vercel preview first; database changes on the live project and going live need your OK each time.

### Not in Phase 1 (comes in Accounts)
Printed tax invoices with invoice numbers, expenses, bank accounts, the quarterly VAT return, the other agency's
VAT on their invoice to us.

---

## Phase 2 — Accounts (outline, to be agreed later)
Tax invoices (numbered, with TRN) created from deals, other income, expenses with receipts, money owed to/from
the company, VAT return summary per quarter (output VAT from deals, input VAT from expenses), profit per month.

## Phase 3 — HR (outline, to be agreed later)
Staff records, salaries and commission statements, leave requests and balances, document storage, expiry
reminders for visa, Emirates ID, passport and RERA broker card.
