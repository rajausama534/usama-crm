"""Build supabase/manual/03_alana_repair.sql.

Removes the one wrong note the broken Alana importer stamped on every Alana villa
("Last Sale Transaction: AED 4,276,888 - 10 Sep 2026" + stray "54"), after copying each removed row
to a backup table, then adds the correct sale for each unit from data/alana-sales-transactions.txt.
Sales already linked to DLD by the DLD import are skipped here so no sale gets two notes.
"""
import datetime as dt, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from dld_import_sql import money_text, q  # noqa: E402

matches_path, out_path = sys.argv[1], ROOT / "supabase" / "manual" / "03_alana_repair.sql"
dld_linked = {(m["unit"], m["transaction_date"]) for m in json.load(open(matches_path))["matched"] if m["cluster"] == "Alana"}

values = []
for line in (ROOT / "data" / "alana-sales-transactions.txt").read_text().splitlines():
    if not line.strip():
        continue
    unit, amount, date = line.split("|")
    d = dt.datetime.strptime(date.strip(), "%d %b %Y").date()
    if (str(int(unit)), d.isoformat()) in dld_linked:
        continue
    note = f"Sold {money_text(int(amount.replace(',', '')))} — {d.strftime('%-d %b %Y')} (Alana sales report)"
    values.append(f"({int(unit)}, {q(note)})")

bad = "o.community = 'The Valley' and o.cluster = 'Alana' and a.details like 'Last Sale Transaction: AED 4,276,888 - 10 Sep 2026%'"
sql = f"""-- Alana repair (approved 19 Oct 2026). Re-runnable.
begin;
create table if not exists public.owner_activities_alana_wrong_notes_20261019 (like public.owner_activities including all);
alter table public.owner_activities_alana_wrong_notes_20261019 enable row level security;

insert into public.owner_activities_alana_wrong_notes_20261019
select a.* from public.owner_activities a join public.owners o on o.id::text = a.owner_id
where {bad}
on conflict do nothing;

delete from public.owner_activities a using public.owners o
where o.id::text = a.owner_id and {bad}
  and exists (select 1 from public.owner_activities_alana_wrong_notes_20261019 b where b.id = a.id);

insert into public.owner_activities (owner_id, activity_type, details, created_by)
select o.id::text, 'Property Transaction', v.note, 'alana-repair'
from public.owners o
join (values
  {(','+chr(10)+'  ').join(values)}
) as v(unit_no, note) on private.unit_number(o.unit) = v.unit_no
where o.community = 'The Valley' and o.cluster = 'Alana'
  and not exists (select 1 from public.owner_activities x where x.owner_id = o.id::text and x.details = v.note);

select json_build_object(
  'wrong_notes_left', (select count(*) from public.owner_activities a join public.owners o on o.id::text = a.owner_id where {bad}),
  'backed_up', (select count(*) from public.owner_activities_alana_wrong_notes_20261019),
  'report_notes', (select count(*) from public.owner_activities where created_by = 'alana-repair'))::text as result;
commit;
"""
out_path.write_text(sql)
print(len(values), "report sales written;", len(dld_linked), "left to the DLD import")
