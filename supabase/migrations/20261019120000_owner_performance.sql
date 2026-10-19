-- Performance: stop the browser from downloading every owner row.
-- Additive only: new extension, helper functions and indexes. No existing data or columns change.
-- All functions are SECURITY INVOKER, so the existing owners RLS policies still decide what each user sees.

create extension if not exists pg_trgm with schema extensions;

-- Same normalisation as formatPhone() in index.html.
create or replace function public.crm_norm_phone(p text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when length(d) = 9 and d like '5%' then '971' || d
    when length(d) = 10 and d like '05%' then '971' || substr(d, 2)
    else d
  end
  from (
    select case when d0 like '00%' then substr(d0, 3) else d0 end as d
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d0) s0
  ) s1
$$;

-- Indexes for "other units owned by the same person" lookups.
create index if not exists owners_owner_key_idx on public.owners (lower(trim(owner)));
create index if not exists owners_phone1_key_idx on public.owners (public.crm_norm_phone(phone1));
create index if not exists owners_phone2_key_idx on public.owners (public.crm_norm_phone(phone2));

-- Trigram indexes so "contains" search (ilike '%term%') does not scan the whole table.
create index if not exists owners_owner_trgm_idx on public.owners using gin (owner extensions.gin_trgm_ops);
create index if not exists owners_unit_trgm_idx on public.owners using gin (unit extensions.gin_trgm_ops);
create index if not exists owners_phone1_trgm_idx on public.owners using gin (phone1 extensions.gin_trgm_ops);
create index if not exists owners_phone2_trgm_idx on public.owners using gin (phone2 extensions.gin_trgm_ops);

-- Dropdown values (community / cluster / source) without shipping 33k rows to the browser.
create or replace function public.crm_filter_options()
returns table (community text, cluster text, data_source text, records bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select o.community, o.cluster, o.data_source, count(*)
  from public.owners o
  group by o.community, o.cluster, o.data_source
$$;

-- Every row that shares an owner name or phone with the given owner rows
-- (same rule as getRelatedRows() in index.html).
create or replace function public.crm_related_rows(owner_ids bigint[])
returns setof public.owners
language sql
stable
security invoker
set search_path = public
as $$
  with src as (
    select lower(trim(owner)) as o, crm_norm_phone(phone1) as p1, crm_norm_phone(phone2) as p2
    from public.owners
    where id = any(owner_ids)
  ),
  keys as (
    select o as k, 'o' as kind from src where o <> ''
    union select p1, 'p' from src where p1 <> ''
    union select p2, 'p' from src where p2 <> ''
  ),
  ids as (
    select w.id from public.owners w join keys on keys.kind = 'o' and lower(trim(w.owner)) = keys.k
    union select w.id from public.owners w join keys on keys.kind = 'p' and crm_norm_phone(w.phone1) = keys.k
    union select w.id from public.owners w join keys on keys.kind = 'p' and crm_norm_phone(w.phone2) = keys.k
  )
  select w.* from public.owners w where w.id in (select id from ids) limit 5000
$$;

grant execute on function public.crm_norm_phone(text) to authenticated;
grant execute on function public.crm_filter_options() to authenticated;
grant execute on function public.crm_related_rows(bigint[]) to authenticated;
revoke execute on function public.crm_filter_options() from anon, public;
revoke execute on function public.crm_related_rows(bigint[]) from anon, public;
