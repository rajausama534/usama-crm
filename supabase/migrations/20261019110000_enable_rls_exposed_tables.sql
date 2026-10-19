-- Applied 2026-10-19 (approved by owner). These tables had RLS disabled and were readable
-- with the public anon key. leads and user_access already had the intended policies
-- (leads: admin only; user_access: read own row); enabling RLS makes them take effect.
-- Backup tables get no policies, so only the dashboard / service role can read them.
alter table public.leads enable row level security;
alter table public.user_access enable row level security;
alter table public.owners_pre_shortname_dedupe_20261009 enable row level security;
alter table public.owner_activities_pre_shortname_dedupe_20261009 enable row level security;
alter table public.owners_pre_unit_dedupe_20261014 enable row level security;
alter table public.owners_villa33_backup_20261014 enable row level security;
alter table public.owner_activities_villa33_backup_20261014 enable row level security;
