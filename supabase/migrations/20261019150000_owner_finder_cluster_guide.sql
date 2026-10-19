-- Owner Finder + Cluster Guide storage in the CRM's own project.
-- Both pages previously called an edge function in a Supabase project outside this account
-- (fkhboleibqrrqljmwbit), so they never worked. Additive only.
-- Tables have RLS on and no policies: only the owner-finder-api edge function (service role) reads/writes them.

create table if not exists public.owner_finder_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_size bigint not null default 0,
  file_hash text not null unique,
  rows_count integer not null default 0,
  status text not null default 'uploading' check (status in ('uploading', 'complete', 'failed')),
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.owner_finder_files enable row level security;

create table if not exists public.owner_finder_records (
  id bigserial primary key,
  file_id uuid not null references public.owner_finder_files (id) on delete cascade,
  owner_name text,
  phones text,
  email text,
  property text,
  searchable text,
  source_sheet text,
  source_row integer,
  row_data jsonb not null default '{}'::jsonb
);
create index if not exists owner_finder_records_file_idx on public.owner_finder_records (file_id);
create index if not exists owner_finder_records_search_trgm on public.owner_finder_records using gin (searchable extensions.gin_trgm_ops);
alter table public.owner_finder_records enable row level security;

create or replace function public.owner_finder_search(search_term text, result_limit int default 250)
returns table (owner_name text, phones text, email text, property text, source_sheet text, source_row int, file_name text)
language sql stable set search_path = public as $$
  select r.owner_name, r.phones, r.email, r.property, r.source_sheet, r.source_row, f.file_name
  from public.owner_finder_records r
  join public.owner_finder_files f on f.id = r.file_id and f.status = 'complete'
  where r.searchable ilike '%' || search_term || '%'
  limit least(greatest(coalesce(result_limit, 250), 1), 500)
$$;
revoke execute on function public.owner_finder_search(text, int) from public, anon, authenticated;

create table if not exists public.cluster_guides (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  community text not null default '' check (char_length(community) <= 200),
  total_units integer not null default 0 check (total_units >= 0),
  launch_date text not null default '' check (char_length(launch_date) <= 100),
  handover_date text not null default '' check (char_length(handover_date) <= 100),
  payment_plan text not null default '' check (char_length(payment_plan) <= 4000),
  usp text not null default '' check (char_length(usp) <= 6000),
  unit_mix jsonb not null default '[]'::jsonb check (jsonb_typeof(unit_mix) = 'array'),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cluster_guides_name_community_uidx on public.cluster_guides (lower(name), lower(community));
alter table public.cluster_guides enable row level security;
revoke all on table public.cluster_guides, public.owner_finder_files, public.owner_finder_records from anon, authenticated;
