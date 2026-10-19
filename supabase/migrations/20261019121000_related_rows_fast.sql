-- crm_related_rows() timed out: under RLS, non-leakproof expressions (lower(), crm_norm_phone())
-- cannot use the expression indexes, so every key forced a full scan.
-- Fix: match ids in a private (not API-exposed) SECURITY DEFINER helper that can use the indexes,
-- then read the rows through the normal RLS-protected table, so users still only get rows they may see.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.related_owner_ids(owner_ids bigint[])
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select lower(trim(owner)) as o, crm_norm_phone(phone1) as p1, crm_norm_phone(phone2) as p2
    from public.owners
    where id = any(owner_ids)
  )
  select w.id from public.owners w where lower(trim(w.owner)) in (select o from src where o <> '')
  union select w.id from public.owners w where crm_norm_phone(w.phone1) in (select p1 from src where p1 <> '' union select p2 from src where p2 <> '')
  union select w.id from public.owners w where crm_norm_phone(w.phone2) in (select p1 from src where p1 <> '' union select p2 from src where p2 <> '')
$$;

revoke all on function private.related_owner_ids(bigint[]) from public, anon;
grant execute on function private.related_owner_ids(bigint[]) to authenticated;

create or replace function public.crm_related_rows(owner_ids bigint[])
returns setof public.owners
language sql
stable
security invoker
set search_path = public
as $$
  select w.* from public.owners w
  where w.id in (select private.related_owner_ids(owner_ids))
  limit 5000
$$;
