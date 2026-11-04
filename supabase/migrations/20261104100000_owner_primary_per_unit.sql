-- One owner row per unit in the Owners list (requested 4 Nov 2026). Nothing is deleted: every record
-- stays, and is_primary marks the single record shown for its unit; the others appear as co-owners.
-- Pick order per community|cluster|unit: a person (not Emaar / a company), a usable phone, a record
-- already worked on, the newest owner list, then the oldest id.
alter table public.owners add column if not exists is_primary boolean not null default true;
create index if not exists owners_primary_idx on public.owners (community, cluster, is_primary);

create or replace function private.owner_primary_rank(o public.owners) returns int[]
language sql immutable set search_path = '' as $$
  select array[
    case when o.owner ~* 'emaar' then 2
         when o.owner ~* '\m(developments?|p\.?\s*j\.?\s*s\.?\s*c|l\.?\s*l\.?\s*c|properties|investments?|holdings?|limited|ltd|bank|group|trading|company)\M' then 1
         else 0 end,
    case when coalesce(o.status, '') <> 'Invalid Number'
              and length(regexp_replace(coalesce(nullif(o.phone1, ''), o.phone2, ''), '\D', '', 'g')) >= 7 then 0 else 1 end,
    case when coalesce(o.status, 'New') in ('New', '-', 'Invalid Number') then 1 else 0 end,
    case when o.data_source ~* '2026' then 0 when o.data_source ~* '2025|-25$' then 1 else 2 end
  ]
$$;

create or replace function private.refresh_owner_primary(p_community text default null, p_cluster text default null, p_unit text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with ranked as (
    select o.id, row_number() over (partition by o.community, o.cluster, trim(coalesce(o.unit, ''))
                                    order by private.owner_primary_rank(o), o.id) = 1 as want
    from public.owners o
    where (p_community is null or o.community = p_community)
      and (p_cluster is null or o.cluster = p_cluster)
      and (p_unit is null or trim(coalesce(o.unit, '')) = trim(p_unit))
  )
  update public.owners o set is_primary = r.want from ranked r
  where o.id = r.id and o.is_primary is distinct from r.want;
  get diagnostics n = row_count;
  return n;
end $$;

-- Keep it right as records are added or edited (only the unit that changed is recalculated).
create or replace function private.owner_primary_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.refresh_owner_primary(old.community, old.cluster, old.unit); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform private.refresh_owner_primary(new.community, new.cluster, new.unit); end if;
  return null;
end $$;
drop trigger if exists owners_primary_refresh on public.owners;
create trigger owners_primary_refresh after insert or delete or update of owner, phone1, phone2, status, unit, community, cluster, data_source
  on public.owners for each row execute function private.owner_primary_trigger();

-- The change history does not need an entry when only the shown-record flag moves.
create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) end;
begin
  -- "Last contacted" changes on every call/WhatsApp click and is_primary is derived; neither is worth a history entry.
  if tg_op = 'UPDATE' and (o - 'last_contacted' - 'is_primary') = (n - 'last_contacted' - 'is_primary') then
    return new;
  end if;
  insert into public.crm_change_log (table_name, row_id, action, changed_by, old_row, new_row)
  values (tg_table_name,
          coalesce(o ->> 'id', concat_ws('|', o ->> 'community', o ->> 'cluster', o ->> 'unit')),
          lower(tg_op), private.current_email(), o, n);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

select private.refresh_owner_primary();
