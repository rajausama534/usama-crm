# CRM upgrade — October 2026

Branch `crm-upgrade`. Nothing here deletes or merges CRM records.

## Security findings (fixed 19 Oct 2026)
- `leads`, `user_access` and five backup tables (incl. `owners_pre_shortname_dedupe_20261009`, 20,228 owner rows)
  had Row Level Security switched off and were readable by anyone with the public key in the website code.
  RLS enabled (migration `20261019110000`); verified anonymous reads now return 0 rows.
- Public sign-up is enabled in Supabase Auth. Turn off "Allow new users to sign up" (admin creates users instead).
- Permissions were enforced only in the browser (`applyAccessFilter`, admin = hard-coded email). Migration
  `20261019130000` moves them into the database: owners by community / "Community::Cluster", notes follow
  their owner/lead, leads only when `assigned_to` = the user, deactivated users see nothing.
- The existing agent is assigned "Arabian Ranches-3" but owners are stored as "Arabian Ranches 3", so that
  agent currently sees 0 owners. Re-select the community on the Users page.

## Performance (measured on 33,815 owner rows, admin account)
| Opening Owners | Before | After |
|---|---|---|
| Dropdowns | 21.9 s (34 requests downloading every owner row) | 0.9 s (`crm_filter_options()`) |
| First page | 9.3 s (each "More Unit" button scanned all 33k rows in the browser) | 1.5 s (`crm_related_rows()` for the 50 rows on screen) |
| Total | 33.0 s | 4.2 s |

Other causes found: KPI tiles ran 6 sequential count requests (replaced by one `crm_dashboard_stats()` call);
selecting a cluster downloaded the whole cluster to sort it in the browser (now sorted in the database);
`unit_sort` is empty for 30,080 rows, so unit order was wrong (now `private.natural_key(unit)`:
community A–Z, cluster A–Z, unit 1, 2 … 10 … 100); "contains" search had no index (pg_trgm indexes added);
search fired on every keystroke (now waits 300 ms).

## Duplicate units
8,449 units have more than one row (19,857 rows). None are exact duplicates (same person and phones);
every group lists different people, i.e. joint owners or ownership history. Nothing should be deleted.
Going forward every owner/note/lead update or delete is copied to `crm_change_log`.

## Alana notes
`alana-transactions.js` used double-escaped regexes, so it read the whole file as one line and gave every
Alana villa the note "Last Sale Transaction: AED 4,276,888 - 10 Sep 2026\n54" (431 rows, also present in
the 9 Oct backup, so no correct earlier notes exist to restore). The script is no longer loaded.
Repair (needs approval): remove those 431 notes and add the correct per-unit sales from the Alana report.

## DLD enrichment
- Source: DLD open-data transactions feed (the one behind dubailand.gov.ae open data). It returned sales from
  1 Jan 2026 onwards only (129,498 sales to 19 Oct 2026); nothing for Oct–Dec 2025.
- DLD publishes no unit numbers or owners. 1,264 sales map to exactly one CRM cluster because the DLD project
  names the community and cluster (e.g. "The Valley - Alana") → `dld_transactions` (cluster comparables).
- Unit level: 93 sales where a unit-numbered sales report in `data/` and DLD agree on cluster, date and exact
  price with one candidate on each side → `property_transactions` + note "Sold AED 4.28M — 10 Sep 2026 — Area 3,715 sq ft".
  Skipped: 25 Palmiera (CRM splits Palmiera 1/2/3, report has no phase), 44 where two units share date+price.
- Re-run: `scripts/dld_fetch.py` → `scripts/dld_match.py` → `scripts/dld_import_sql.py` (idempotent).

## Later on 19 Oct 2026
- Owner Finder and Cluster Guide called an edge function in a Supabase project outside this account
  (fkhboleibqrrqljmwbit), so both pages never worked. Their tables and `owner-finder-api` now live in the CRM
  project; Owner Finder (uploaded third-party owner data) is admin-only. Earlier Cluster Guide entries stored
  in that external project are not reachable.
- Property details (`unit_details`: type, bedrooms, BUA, plot, suite kept separate) and an append-only
  occupancy log (`unit_observations`) on every owner profile; dashboard shows vacant/occupied from the latest
  observation per unit. Seeded 497 units from the FG2 (bedrooms + plot) and Rivana (bedrooms) reports.
- Weekly DLD sync: `dld-sync` edge function + pg_cron job `dld-weekly-sync` (Mondays 03:00 UTC). Fetches the
  last 21 days, maps to clusters with the same rules as the import scripts, inserts idempotently, refuses to
  run twice within 6 days. First run: 8,870 fetched, 123 in CRM clusters, 0 new (all already imported).
- Phone checks done: dashboard, Owners (card list), owner profile, Leads (card list), Add Lead form, Users.
