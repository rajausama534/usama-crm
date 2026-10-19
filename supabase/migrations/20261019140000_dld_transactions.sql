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
