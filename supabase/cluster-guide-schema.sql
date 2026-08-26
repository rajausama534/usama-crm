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

create unique index if not exists cluster_guides_name_community_uidx
  on public.cluster_guides (lower(name), lower(community));

alter table public.cluster_guides enable row level security;
revoke all on table public.cluster_guides from anon, authenticated;
grant select, insert, update, delete on table public.cluster_guides to service_role;
