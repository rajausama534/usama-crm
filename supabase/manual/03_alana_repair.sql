-- Alana repair (approved 19 Oct 2026). Re-runnable.
begin;
create table if not exists public.owner_activities_alana_wrong_notes_20261019 (like public.owner_activities including all);
alter table public.owner_activities_alana_wrong_notes_20261019 enable row level security;

insert into public.owner_activities_alana_wrong_notes_20261019
select a.* from public.owner_activities a join public.owners o on o.id::text = a.owner_id
where o.community = 'The Valley' and o.cluster = 'Alana' and a.details like 'Last Sale Transaction: AED 4,276,888 - 10 Sep 2026%'
on conflict do nothing;

delete from public.owner_activities a using public.owners o
where o.id::text = a.owner_id and o.community = 'The Valley' and o.cluster = 'Alana' and a.details like 'Last Sale Transaction: AED 4,276,888 - 10 Sep 2026%'
  and exists (select 1 from public.owner_activities_alana_wrong_notes_20261019 b where b.id = a.id);

insert into public.owner_activities (owner_id, activity_type, details, created_by)
select o.id::text, 'Property Transaction', v.note, 'alana-repair'
from public.owners o
join (values
  (105, 'Sold AED 6.8M — 22 Dec 2025 (Alana sales report)'),
  (126, 'Sold AED 4.72M — 11 Dec 2025 (Alana sales report)'),
  (103, 'Sold AED 6.1M — 10 Dec 2025 (Alana sales report)'),
  (213, 'Sold AED 4.67M — 10 Dec 2025 (Alana sales report)'),
  (154, 'Sold AED 4.88M — 10 Dec 2025 (Alana sales report)'),
  (104, 'Sold AED 6.3M — 25 Nov 2025 (Alana sales report)'),
  (150, 'Sold AED 4.6M — 27 Oct 2025 (Alana sales report)'),
  (218, 'Sold AED 4.25M — 24 Oct 2025 (Alana sales report)'),
  (153, 'Sold AED 4.9M — 24 Oct 2025 (Alana sales report)'),
  (175, 'Sold AED 6.24M — 22 Oct 2025 (Alana sales report)'),
  (177, 'Sold AED 6M — 30 Sep 2025 (Alana sales report)'),
  (28, 'Sold AED 4.5M — 22 Sep 2025 (Alana sales report)'),
  (194, 'Sold AED 5.75M — 11 Sep 2025 (Alana sales report)'),
  (246, 'Sold AED 4.2M — 18 Aug 2025 (Alana sales report)'),
  (19, 'Sold AED 4.25M — 4 Aug 2025 (Alana sales report)'),
  (111, 'Sold AED 4.72M — 21 Jul 2025 (Alana sales report)'),
  (157, 'Sold AED 4.9M — 21 Jul 2025 (Alana sales report)'),
  (99, 'Sold AED 4.8M — 15 Jul 2025 (Alana sales report)'),
  (224, 'Sold AED 4.33M — 9 Jul 2025 (Alana sales report)'),
  (31, 'Sold AED 4.5M — 20 May 2025 (Alana sales report)'),
  (131, 'Sold AED 4.78M — 15 May 2025 (Alana sales report)'),
  (118, 'Sold AED 5.06M — 8 May 2025 (Alana sales report)'),
  (105, 'Sold AED 7M — 7 May 2025 (Alana sales report)'),
  (301, 'Sold AED 3.89M — 5 May 2025 (Alana sales report)'),
  (321, 'Sold AED 3.88M — 24 Apr 2025 (Alana sales report)'),
  (117, 'Sold AED 5.05M — 23 Apr 2025 (Alana sales report)'),
  (193, 'Sold AED 5.17M — 21 Apr 2025 (Alana sales report)'),
  (151, 'Sold AED 4.65M — 10 Apr 2025 (Alana sales report)'),
  (11, 'Sold AED 5.4M — 18 Mar 2025 (Alana sales report)'),
  (207, 'Sold AED 5.4M — 4 Mar 2025 (Alana sales report)'),
  (293, 'Sold AED 3.6M — 12 Feb 2025 (Alana sales report)')
) as v(unit_no, note) on private.unit_number(o.unit) = v.unit_no
where o.community = 'The Valley' and o.cluster = 'Alana'
  and not exists (select 1 from public.owner_activities x where x.owner_id = o.id::text and x.details = v.note);

select json_build_object(
  'wrong_notes_left', (select count(*) from public.owner_activities a join public.owners o on o.id::text = a.owner_id where o.community = 'The Valley' and o.cluster = 'Alana' and a.details like 'Last Sale Transaction: AED 4,276,888 - 10 Sep 2026%'),
  'backed_up', (select count(*) from public.owner_activities_alana_wrong_notes_20261019),
  'report_notes', (select count(*) from public.owner_activities where created_by = 'alana-repair'))::text as result;
commit;
