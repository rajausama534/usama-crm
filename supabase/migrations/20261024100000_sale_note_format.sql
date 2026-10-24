-- One format for every sale note:  4BR SOLD 7.5M Dec-2025, size 6,444 sq ft
-- Bedrooms and size are left out when they are not known.
--
-- private.crm_sale_note            builds the note
-- private.crm_reformat_sale_text   rewrites every old-style sale note inside a piece of text
-- private.crm_reformat_sale_notes  preview (dry run) or apply on owner_activities.details and
--                                  owners.admin_remarks / agent_remarks, with backup tables
-- public.crm_import_external_sales now writes new notes in this format.

create or replace function private.crm_sale_note(beds text, amount numeric, sold_on date, size_sqft numeric)
returns text language sql immutable set search_path = '' as $$
  select concat_ws(' ',
           (regexp_match(coalesce(beds, ''), '(\d+)'))[1] || 'BR',
           'SOLD',
           case when amount >= 1000000 then trim(trailing '.' from trim(trailing '0' from to_char(round(amount / 1000000, 2), 'FM9999990.00'))) || 'M'
                when amount >= 1000 then trim(trailing '.' from trim(trailing '0' from to_char(round(amount / 1000, 1), 'FM9999990.0'))) || 'K'
                else to_char(amount, 'FM999,999,990') end,
           to_char(sold_on, 'Mon-YYYY'))
         || case when size_sqft > 0 then ', size ' || to_char(round(size_sqft), 'FM999,999,990') || ' sq ft' else '' end
$$;

-- Old formats written by earlier importers (all contain "AED", the new format never does):
--   Type: 4BR\nPlot: 9,628 sqft\nLast Transaction: AED 8,001,888 - 22 Mar 2024
--   4BR\nSize: 8,267 sqft\nSold Price: AED 9,500,000 (2nd Transaction) - 10 Sep 2026
--   2nd Transaction: AED 9,500,000 - 10 Sep 2026\n4BR\nSize: 8,267 sqft
--   Last Sale Transaction: AED 7,050,000 - 17 Aug 2026   (also "Sale - Sold:", "Last Transaction - Sold:")
--   Sold AED 7.5M — 17 Aug 2026 — Plot 6,444 sq ft · BUA 3,900 sq ft   (also "— Area …", "(Alana sales report)")
-- Rental notes are not sales and are left as they are.
create or replace function private.crm_reformat_sale_text(txt text, fallback_beds text default null, fallback_size numeric default null)
returns text language plpgsql immutable set search_path = '' as $$
declare
  dt constant text := '(\d{1,2} [A-Za-z]{3} \d{4})';
  out text := txt; m text[]; guard int := 0;
  whole text; beds text; size_txt text; amt numeric; d date; p int;
begin
  if txt is null or txt !~* 'AED' then return txt; end if;
  loop
    guard := guard + 1;
    exit when guard > 100;
    -- each branch: whole match, beds, size, amount, millions flag, date
    m := regexp_match(out, '(Type:\s*(\d+)\s*BR\s*\n\s*Plot:\s*([\d,]+)\s*sq\s*ft\s*\n\s*Last Transaction:\s*AED\s*([\d,]+)()\s*-\s*' || dt || ')', 'i');
    if m is null then
      m := regexp_match(out, '((\d+)\s*BR\s*\n\s*Size:\s*([\d,]+)\s*sq\s*ft\s*\n\s*Sold Price:\s*AED\s*([\d,]+)()(?:\s*\([^)\n]*\))?\s*-\s*' || dt || ')', 'i');
    end if;
    if m is null then
      m := regexp_match(out, '(\d+(?:st|nd|rd|th) Transaction:\s*AED\s*([\d,]+)\s*-\s*' || dt || '(?:\s*\n\s*(\d+)\s*BR)?(?:\s*\n\s*Size:\s*([\d,]+)\s*sq\s*ft)?)', 'i');
      if m is not null then m := array[m[1], m[4], m[5], m[2], '', m[3]]; end if;
    end if;
    if m is null then
      m := regexp_match(out, '((?:Last Sale Transaction|Sale - Sold|Last Transaction - Sold):\s*AED\s*([\d,]+)\s*-\s*' || dt || ')', 'i');
      if m is not null then m := array[m[1], null, null, m[2], '', m[3]]; end if;
    end if;
    if m is null then
      m := regexp_match(out, '(Sold AED\s*([\d,]+(?:\.\d+)?)(M?)\s*—\s*' || dt || '(?:\s*—\s*(?:Plot|Area)\s*([\d,]+)\s*sq ft(?:\s*·\s*BUA\s*[\d,]+\s*sq ft)?)?(?:\s*\(Alana sales report\))?)', 'i');
      if m is not null then m := array[m[1], null, m[5], m[2], m[3], m[4]]; end if;
    end if;
    exit when m is null;

    whole := m[1]; beds := coalesce(m[2], fallback_beds); size_txt := m[3];
    amt := replace(m[4], ',', '')::numeric * case when upper(m[5]) = 'M' then 1000000 else 1 end;
    d := to_date(m[6], 'DD Mon YYYY');
    p := position(whole in out);
    out := left(out, p - 1)
           || private.crm_sale_note(beds, amt, d, coalesce(nullif(replace(size_txt, ',', ''), '')::numeric, fallback_size))
           || substr(out, p + length(whole));
  end loop;
  return out;
end $$;

create table if not exists private.sale_notes_backup_20261024 (
  source text not null,         -- 'activity' | 'admin_remarks' | 'agent_remarks'
  id text not null,
  original text,
  backed_up_at timestamptz not null default now(),
  primary key (source, id)
);

-- select * from private.crm_reformat_sale_notes(true);   -- preview: before / after, nothing changes
-- select * from private.crm_reformat_sale_notes(false);  -- apply (originals kept in private.sale_notes_backup_20261024)
create or replace function private.crm_reformat_sale_notes(dry_run boolean default true)
returns table (source text, id text, owner text, before text, after text)
language plpgsql set search_path = '' as $$
begin
  drop table if exists sale_note_changes;
  create temporary table sale_note_changes on commit drop as
  with unit_facts as (
    select o.id::text as owner_id,
           coalesce(ud.bedrooms, pt.bedrooms, dt.rooms) as beds,
           coalesce(ud.plot_sqft, ud.bua_sqft, pt.area_sqft) as size_sqft
    from public.owners o
    left join public.unit_details ud on ud.community = o.community and ud.cluster = o.cluster and ud.unit = o.unit
    left join lateral (
      select p.bedrooms, p.area_sqft, p.dld_transaction_number from public.property_transactions p
      where p.community = o.community and p.cluster = o.cluster and p.unit = o.unit
      order by (p.bedrooms is not null) desc, p.transaction_date desc limit 1
    ) pt on true
    left join public.dld_transactions dt on dt.transaction_number = pt.dld_transaction_number
  ),
  candidates as (
    select 'activity'::text as source, a.id::text as id, a.owner_id, a.details as before from public.owner_activities a where a.details ~* 'AED'
    union all
    select 'admin_remarks', o.id::text, o.id::text, o.admin_remarks from public.owners o where o.admin_remarks ~* 'AED'
    union all
    select 'agent_remarks', o.id::text, o.id::text, o.agent_remarks from public.owners o where o.agent_remarks ~* 'AED'
  )
  select c.source, c.id, c.owner_id, c.before,
         private.crm_reformat_sale_text(c.before, f.beds, f.size_sqft) as after
  from candidates c left join unit_facts f on f.owner_id = c.owner_id;
  delete from sale_note_changes s where s.after is not distinct from s.before;

  if not dry_run then
    insert into private.sale_notes_backup_20261024 (source, id, original)
    select s.source, s.id, s.before from sale_note_changes s
    on conflict do nothing;
    update public.owner_activities a set details = s.after
      from sale_note_changes s where s.source = 'activity' and a.id::text = s.id;
    update public.owners o set admin_remarks = s.after
      from sale_note_changes s where s.source = 'admin_remarks' and o.id::text = s.id;
    update public.owners o set agent_remarks = s.after
      from sale_note_changes s where s.source = 'agent_remarks' and o.id::text = s.id;
  end if;

  return query
    select s.source, s.id, concat_ws(' · ', o.owner, o.cluster, o.unit), s.before, s.after
    from sale_note_changes s left join public.owners o on o.id::text = s.owner_id
    order by o.cluster, o.unit, s.source;
end $$;
revoke execute on function private.crm_reformat_sale_notes(boolean) from public, anon, authenticated;

-- New imports from DXBinteract use the same format.
create or replace function public.crm_import_external_sales(rows jsonb, source text, dry_run boolean default true)
returns table (idx int, result text, community text, cluster text, unit text, note text)
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i int := 0; units text[]; u text; k text; n text; amt numeric; d date;
  plot numeric; bua numeric; area numeric;
begin
  if not private.is_admin() then raise exception 'Only an administrator can import sales.'; end if;
  if source is null or source !~ '^[a-z0-9_-]{2,40}$' then raise exception 'Invalid source'; end if;
  for r in select * from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) loop
    i := i + 1;
    community := r ->> 'community'; cluster := r ->> 'cluster'; unit := null; note := null;
    begin
      amt := (r ->> 'amount')::numeric; d := (r ->> 'date')::date;
    exception when others then idx := i; result := 'skipped: unreadable price or date'; return next; continue; end;
    if community is null or cluster is null or (r ->> 'unit_no') !~ '^\d+$' or amt is null or d is null then
      idx := i; result := 'skipped: no unit number or cluster'; return next; continue;
    end if;
    select array_agg(distinct o.unit) into units from public.owners o
      where o.community = r ->> 'community' and o.cluster = r ->> 'cluster' and private.unit_number(o.unit) = (r ->> 'unit_no')::int;
    if units is null then idx := i; result := 'skipped: unit not in CRM'; return next; continue; end if;
    if array_length(units, 1) > 1 then idx := i; result := 'skipped: unit number ambiguous in this cluster'; return next; continue; end if;
    u := units[1]; unit := u;
    plot := nullif(r ->> 'plot_sqft', '')::numeric; bua := nullif(r ->> 'bua_sqft', '')::numeric; area := nullif(r ->> 'area_sqft', '')::numeric;
    k := source || '|' || (r ->> 'community') || '|' || (r ->> 'cluster') || '|' || u || '|' || d || '|' || amt;
    if exists (select 1 from public.property_transactions p
               where p.external_key = k
                  or (p.community = r ->> 'community' and p.cluster = r ->> 'cluster' and p.unit = u and p.transaction_date = d and p.amount = amt)) then
      idx := i; result := 'already stored'; return next; continue;
    end if;
    n := private.crm_sale_note(nullif(r ->> 'beds', ''), amt, d, coalesce(plot, area, bua));
    note := n;
    if dry_run then idx := i; result := 'will import'; return next; continue; end if;
    insert into public.property_transactions (community, cluster, unit, transaction_date, kind, amount, area_sqft, area_type, bua_sqft, bedrooms, sold_by,
                                              source, match_method, external_key)
    values (r ->> 'community', r ->> 'cluster', u, d, 'Sold', amt, coalesce(plot, area, bua),
            case when plot is not null then 'plot' else 'property' end, bua, nullif(r ->> 'beds', ''), nullif(r ->> 'sold_by', ''),
            source, 'unit number + cluster from ' || source || ' (sent by admin)', k)
    on conflict do nothing;
    insert into public.owner_activities (owner_id, activity_type, details, created_by)
    select o.id::text, 'Property Transaction', n, source || '-import'
    from public.owners o
    where o.community = r ->> 'community' and o.cluster = r ->> 'cluster' and o.unit = u
      and not exists (select 1 from public.owner_activities a where a.owner_id = o.id::text and a.details = n);
    idx := i; result := 'imported'; return next;
  end loop;
end $$;
revoke execute on function public.crm_import_external_sales(jsonb, text, boolean) from public, anon;
grant execute on function public.crm_import_external_sales(jsonb, text, boolean) to authenticated;
