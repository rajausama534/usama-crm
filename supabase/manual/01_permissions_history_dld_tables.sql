-- CRM upgrade: real database-enforced permissions, change history, natural unit sorting, dashboard stats.
-- Non-destructive: no rows are deleted or rewritten. Old policies are replaced (definitions recorded below).
--
-- Previous policies (for rollback):
--   owners  "owners_secure_select"/"owners_secure_update": admin email OR community/cluster in user_access
--   owners  "Agents can view/update only assigned owner data": assigned_to = jwt email
--   leads   ALL: jwt email = 'thechussar@gmail.com'
--   owner_activities, lead_activities, whatsapp_broadcast_log, crm_projects: any authenticated user (true)
--   user_access "user_access_self_read": lower(email) = lower(jwt email)

-- ---------------------------------------------------------------- user accounts
alter table public.user_access
  add column if not exists name text,
  add column if not exists active boolean not null default true,
  add column if not exists user_id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists user_access_email_lower_uidx on public.user_access (lower(email));

-- Leads are visible to an agent only when assigned to them.
alter table public.leads add column if not exists assigned_to text;
create index if not exists leads_assigned_to_idx on public.leads (lower(assigned_to));
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ---------------------------------------------------------------- identity helpers (private schema = not exposed by the API)
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.current_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function private.access_row() returns public.user_access
language sql stable security definer set search_path = '' as $$
  select ua.* from public.user_access ua
  where lower(ua.email) = private.current_email() and ua.active
  limit 1
$$;

-- The owner account is always admin so it can never be locked out.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_email() = 'thechussar@gmail.com'
      or coalesce((private.access_row()).role = 'admin', false)
$$;

create or replace function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (private.access_row()).id is not null
$$;

create or replace function private.my_communities() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((private.access_row()).assigned_communities, '{}'::text[])
$$;

-- Entries are "Community::Cluster" (new) or a bare cluster name (legacy rows).
create or replace function private.my_clusters() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((private.access_row()).assigned_clusters, '{}'::text[])
$$;

create or replace function private.can_see_location(p_community text, p_cluster text, p_assigned_to text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or p_community = any (private.my_communities())
      or p_cluster = any (private.my_clusters())
      or (p_community || '::' || p_cluster) = any (private.my_clusters())
      or (p_assigned_to is not null and lower(p_assigned_to) = private.current_email() and private.is_active())
$$;

create or replace function private.can_see_owner(p_owner_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.owners o
    where p_owner_id ~ '^\d+$' and o.id = p_owner_id::bigint
      and private.can_see_location(o.community, o.cluster, o.assigned_to)
  )
$$;

create or replace function private.can_see_lead(p_lead_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where p_lead_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and l.id = p_lead_id::uuid
      and (private.is_admin() or (lower(l.assigned_to) = private.current_email() and private.is_active()))
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------- policies
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public'
    and tablename in ('owners','leads','owner_activities','lead_activities','whatsapp_broadcast_log','crm_projects','user_access')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- owners: the (select ...) wrappers are evaluated once per query, not once per row.
create policy owners_select on public.owners for select to authenticated using (
  (select private.is_admin())
  or community = any ((select private.my_communities()))
  or cluster = any ((select private.my_clusters()))
  or (community || '::' || cluster) = any ((select private.my_clusters()))
  or (assigned_to is not null and lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
);
create policy owners_insert on public.owners for insert to authenticated with check (
  private.can_see_location(community, cluster, assigned_to)
);
create policy owners_update on public.owners for update to authenticated
  using (
    (select private.is_admin())
    or community = any ((select private.my_communities()))
    or cluster = any ((select private.my_clusters()))
    or (community || '::' || cluster) = any ((select private.my_clusters()))
    or (assigned_to is not null and lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
  )
  with check (private.can_see_location(community, cluster, assigned_to));
create policy owners_delete on public.owners for delete to authenticated using ((select private.is_admin()));

-- leads
create policy leads_select on public.leads for select to authenticated using (
  (select private.is_admin()) or (lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
);
create policy leads_insert on public.leads for insert to authenticated with check (
  (select private.is_admin()) or (lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
);
create policy leads_update on public.leads for update to authenticated
  using ((select private.is_admin()) or (lower(assigned_to) = (select private.current_email()) and (select private.is_active())))
  with check ((select private.is_admin()) or (lower(assigned_to) = (select private.current_email()) and (select private.is_active())));
create policy leads_delete on public.leads for delete to authenticated using ((select private.is_admin()));

-- notes / activities follow the record they belong to
create policy owner_activities_select on public.owner_activities for select to authenticated using ((select private.is_admin()) or private.can_see_owner(owner_id));
create policy owner_activities_insert on public.owner_activities for insert to authenticated with check ((select private.is_admin()) or private.can_see_owner(owner_id));
create policy owner_activities_update on public.owner_activities for update to authenticated
  using ((select private.is_admin()) or private.can_see_owner(owner_id)) with check ((select private.is_admin()) or private.can_see_owner(owner_id));
create policy owner_activities_delete on public.owner_activities for delete to authenticated using ((select private.is_admin()) or private.can_see_owner(owner_id));

create policy lead_activities_select on public.lead_activities for select to authenticated using ((select private.is_admin()) or private.can_see_lead(lead_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated with check ((select private.is_admin()) or private.can_see_lead(lead_id));
create policy lead_activities_update on public.lead_activities for update to authenticated
  using ((select private.is_admin()) or private.can_see_lead(lead_id)) with check ((select private.is_admin()) or private.can_see_lead(lead_id));
create policy lead_activities_delete on public.lead_activities for delete to authenticated using ((select private.is_admin()) or private.can_see_lead(lead_id));

create policy whatsapp_log_select on public.whatsapp_broadcast_log for select to authenticated using (
  (select private.is_admin()) or lower(sent_by) = (select private.current_email())
);
create policy whatsapp_log_insert on public.whatsapp_broadcast_log for insert to authenticated with check (
  (select private.is_active()) and ((select private.is_admin()) or lower(sent_by) = (select private.current_email()))
);

create policy crm_projects_select on public.crm_projects for select to authenticated using ((select private.is_active()));
create policy crm_projects_write on public.crm_projects for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy user_access_select on public.user_access for select to authenticated using (
  lower(email) = (select private.current_email()) or (select private.is_admin())
);
create policy user_access_write on public.user_access for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------- change history (append-only)
create table if not exists public.crm_change_log (
  id bigserial primary key,
  table_name text not null,
  row_id text not null,
  action text not null,
  changed_at timestamptz not null default now(),
  changed_by text,
  old_row jsonb,
  new_row jsonb
);
create index if not exists crm_change_log_row_idx on public.crm_change_log (table_name, row_id, changed_at desc);
alter table public.crm_change_log enable row level security;
create policy crm_change_log_select on public.crm_change_log for select to authenticated using (
  (select private.is_admin())
  or (table_name = 'owners' and private.can_see_location(old_row ->> 'community', old_row ->> 'cluster', old_row ->> 'assigned_to'))
);

create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) end;
begin
  -- "Last contacted" changes on every call/WhatsApp click; they are not worth a history entry.
  if tg_op = 'UPDATE' and (o - 'last_contacted') = (n - 'last_contacted') then
    return new;
  end if;
  insert into public.crm_change_log (table_name, row_id, action, changed_by, old_row, new_row)
  values (tg_table_name, o ->> 'id', lower(tg_op), private.current_email(), o, n);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists crm_log_change on public.owners;
create trigger crm_log_change after update or delete on public.owners for each row execute function private.log_change();
drop trigger if exists crm_log_change on public.owner_activities;
create trigger crm_log_change after update or delete on public.owner_activities for each row execute function private.log_change();
drop trigger if exists crm_log_change on public.leads;
create trigger crm_log_change after update or delete on public.leads for each row execute function private.log_change();
drop trigger if exists crm_log_change on public.lead_activities;
create trigger crm_log_change after update or delete on public.lead_activities for each row execute function private.log_change();

-- ---------------------------------------------------------------- natural unit sorting
-- "R2 Casa-V-25" -> "r000000000002 casa-v-000000000025", so 2 < 10 < 100 and prefixes group together.
create or replace function private.natural_key(s text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare r text := ''; m text[];
begin
  if s is null then return null; end if;
  for m in select regexp_matches(lower(trim(s)), '(\d+|\D+)', 'g') loop
    if m[1] ~ '^\d+$' then r := r || lpad(coalesce(nullif(ltrim(m[1], '0'), ''), '0'), 12, '0');
    else r := r || m[1];
    end if;
  end loop;
  return r;
end $$;

create index if not exists owners_cluster_natural_idx on public.owners (community, cluster, private.natural_key(unit));
create index if not exists owners_natural_idx on public.owners (private.natural_key(unit));
create index if not exists owners_status_idx on public.owners (status);

-- Read-only view used for listing; RLS of owners applies (security_invoker).
create or replace view public.owners_list with (security_invoker = true) as
  select o.*, private.natural_key(o.unit) as unit_natural from public.owners o;
grant select on public.owners_list to authenticated;
revoke all on public.owners_list from anon;

-- ---------------------------------------------------------------- dashboard numbers in one request (RLS applies)
create or replace function public.crm_dashboard_stats() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'owners', (select jsonb_build_object(
        'records', count(*),
        'communities', count(distinct community),
        'clusters', count(distinct (community, cluster)),
        'units', count(distinct (community, cluster, unit)),
        'contacted_7d', count(*) filter (where last_contacted >= current_date - 7),
        'contacted_30d', count(*) filter (where last_contacted >= current_date - 30)
      ) from owners),
    'owner_status', (select coalesce(jsonb_object_agg(coalesce(nullif(status, ''), '-'), n), '{}') from (select status, count(*) n from owners group by status) s),
    'owners_by_community', (select coalesce(jsonb_object_agg(community, n), '{}') from (select coalesce(community, '-') community, count(*) n from owners group by 1) s),
    'leads', (select jsonb_build_object(
        'total', count(*),
        'new_7d', count(*) filter (where created_at >= now() - interval '7 days'),
        'followups_today', count(*) filter (where follow_up_date = current_date),
        'followups_overdue', count(*) filter (where follow_up_date < current_date)
      ) from leads),
    'lead_status', (select coalesce(jsonb_object_agg(coalesce(nullif(status, ''), '-'), n), '{}') from (select status, count(*) n from leads group by status) s),
    'lead_source', (select coalesce(jsonb_object_agg(coalesce(nullif(source, ''), '-'), n), '{}') from (select source, count(*) n from leads group by source) s),
    'leads_by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', w, 'n', n) order by w), '[]') from (
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') w, count(*) n from leads
        where created_at >= now() - interval '12 weeks' group by 1) s)
  )
$$;
grant execute on function public.crm_dashboard_stats() to authenticated;
revoke execute on function public.crm_dashboard_stats() from anon, public;
-- DLD transaction enrichment: structured, re-runnable, never guessed.
-- dld_transactions: DLD open-data sales whose project maps to exactly one CRM community/cluster
--                   (cluster-level comparables; DLD publishes no unit numbers).
-- property_transactions: sales tied to a specific CRM unit, only when a unit-numbered sales report
--                   and DLD agree exactly (same cluster, date and price, one candidate each side).
-- Both are keyed by the DLD transaction number, so re-running an import never duplicates rows.

create table if not exists public.dld_transactions (
  transaction_number text primary key,
  transaction_date date not null,
  procedure text,
  is_offplan boolean,
  property_type text,
  property_sub_type text,
  rooms text,
  amount numeric not null,
  area_sqm numeric,
  area_sqft numeric,
  dld_area text,
  dld_project text,
  crm_community text not null,
  crm_cluster text not null,
  fetched_at timestamptz not null default now()
);
create index if not exists dld_transactions_cluster_idx on public.dld_transactions (crm_community, crm_cluster, transaction_date desc);
alter table public.dld_transactions enable row level security;
create policy dld_transactions_select on public.dld_transactions for select to authenticated using (
  private.can_see_location(crm_community, crm_cluster, null)
);

create table if not exists public.property_transactions (
  id bigserial primary key,
  community text not null,
  cluster text not null,
  unit text not null,
  transaction_date date not null,
  kind text not null default 'Sold',
  amount numeric not null,
  area_sqft numeric,
  area_type text check (area_type in ('plot', 'property')),
  dld_transaction_number text unique references public.dld_transactions (transaction_number),
  source text not null,
  match_method text not null,
  created_at timestamptz not null default now()
);
create index if not exists property_transactions_unit_idx on public.property_transactions (community, cluster, unit, transaction_date desc);
alter table public.property_transactions enable row level security;
create policy property_transactions_select on public.property_transactions for select to authenticated using (
  private.can_see_location(community, cluster, null)
);
-- Writes happen only through reviewed import scripts run by the admin in the SQL editor.

-- Unit number used for matching report lines to CRM units ("Villa 053" -> 53).
create or replace function private.unit_number(u text) returns int
language sql immutable parallel safe set search_path = '' as $$
  select ((regexp_match(coalesce(u, ''), '(\d+)\D*$'))[1])::int
$$;
