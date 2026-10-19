-- Property details and occupancy/field observations per unit (community + cluster + unit).
-- Additive only. Same visibility rules as owners (private.can_see_location).

create table if not exists public.unit_details (
  community text not null,
  cluster text not null,
  unit text not null,
  property_type text,
  bedrooms text,
  bua_sqft numeric check (bua_sqft is null or bua_sqft > 0),
  plot_sqft numeric check (plot_sqft is null or plot_sqft > 0),
  suite_sqft numeric check (suite_sqft is null or suite_sqft > 0),
  details_source text,
  updated_at timestamptz not null default now(),
  updated_by text default private.current_email(),
  primary key (community, cluster, unit)
);
alter table public.unit_details enable row level security;
create policy unit_details_select on public.unit_details for select to authenticated using (private.can_see_location(community, cluster, null));
create policy unit_details_insert on public.unit_details for insert to authenticated with check (private.can_see_location(community, cluster, null));
create policy unit_details_update on public.unit_details for update to authenticated
  using (private.can_see_location(community, cluster, null)) with check (private.can_see_location(community, cluster, null));
create policy unit_details_delete on public.unit_details for delete to authenticated using ((select private.is_admin()));
drop trigger if exists crm_log_change on public.unit_details;
create trigger crm_log_change after update or delete on public.unit_details for each row execute function private.log_change();

-- Append-only: a new observation never replaces an earlier one.
create table if not exists public.unit_observations (
  id bigserial primary key,
  community text not null,
  cluster text not null,
  unit text not null,
  status text not null check (status in ('Occupied', 'Vacant', 'Available for rent', 'Available for sale', 'Under renovation', 'Landscaping', 'Under construction', 'Other')),
  note text check (note is null or char_length(note) <= 2000),
  observed_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by text default private.current_email()
);
create index if not exists unit_observations_unit_idx on public.unit_observations (community, cluster, unit, observed_on desc, id desc);
alter table public.unit_observations enable row level security;
create policy unit_observations_select on public.unit_observations for select to authenticated using (private.can_see_location(community, cluster, null));
create policy unit_observations_insert on public.unit_observations for insert to authenticated with check (private.can_see_location(community, cluster, null));
create policy unit_observations_delete on public.unit_observations for delete to authenticated using ((select private.is_admin()));
drop trigger if exists crm_log_change on public.unit_observations;
create trigger crm_log_change after update or delete on public.unit_observations for each row execute function private.log_change();

-- Latest observation per unit (RLS of the base table applies).
create or replace view public.unit_current_status with (security_invoker = true) as
  select distinct on (community, cluster, unit) community, cluster, unit, status, note, observed_on, created_by
  from public.unit_observations
  order by community, cluster, unit, observed_on desc, id desc;
grant select on public.unit_current_status to authenticated;
revoke all on public.unit_current_status from anon;

-- Dashboard: add occupancy from the latest observation of each unit.
create or replace function public.crm_occupancy_stats() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'observed_units', coalesce(sum(n), 0),
    'by_status', coalesce(jsonb_object_agg(status, n) filter (where status is not null), '{}')
  )
  from (select status, count(*) n from unit_current_status group by status) s
$$;
grant execute on function public.crm_occupancy_stats() to authenticated;
revoke execute on function public.crm_occupancy_stats() from anon, public;
