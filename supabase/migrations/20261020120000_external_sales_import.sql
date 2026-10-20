-- Import sales that the admin sends from DXBinteract (via the CRM Chrome extension) into property_transactions.
-- Admin-only, previewable (dry run), exact-unit matching only, idempotent. Existing rows/notes are never changed.

alter table public.property_transactions
  add column if not exists bua_sqft numeric,
  add column if not exists bedrooms text,
  add column if not exists sold_by text,
  add column if not exists external_key text;
create unique index if not exists property_transactions_external_key_uidx on public.property_transactions (external_key) where external_key is not null;

-- rows: [{community, cluster, unit_no, date (YYYY-MM-DD), amount, plot_sqft, bua_sqft, area_sqft, beds, sold_by, label}]
-- community/cluster are the CRM labels the page matched by name; the unit is matched here.
create or replace function public.crm_import_external_sales(rows jsonb, source text, dry_run boolean default true)
returns table (idx int, result text, community text, cluster text, unit text, note text)
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i int := 0; units text[]; u text; k text; n text; amt numeric; d date;
  plot numeric; bua numeric; area numeric; area_txt text;
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
    area_txt := case
      when plot is not null and bua is not null then ' — Plot ' || to_char(plot, 'FM999,999,990') || ' sq ft · BUA ' || to_char(bua, 'FM999,999,990') || ' sq ft'
      when plot is not null then ' — Plot ' || to_char(plot, 'FM999,999,990') || ' sq ft'
      when coalesce(area, bua) is not null then ' — Area ' || to_char(coalesce(area, bua), 'FM999,999,990') || ' sq ft'
      else '' end;
    n := 'Sold ' || case when amt >= 1000000 then 'AED ' || trim(trailing '.' from trim(trailing '0' from to_char(round(amt / 1000000, 2), 'FM9999990.00'))) || 'M'
                        else 'AED ' || to_char(amt, 'FM999,999,990') end
         || ' — ' || to_char(d, 'FMDD Mon YYYY') || area_txt;
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
