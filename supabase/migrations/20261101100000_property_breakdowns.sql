-- Saved property breakdowns (the Breakdown page). New table only; nothing existing changes.
-- Admins see every breakdown; other active users see only the ones they created.
create table if not exists public.crm_breakdowns (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Property breakdown' check (char_length(title) between 1 and 200),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 100000),
  owner_id bigint references public.owners (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_breakdowns_creator_idx on public.crm_breakdowns (lower(created_by), updated_at desc);
create index if not exists crm_breakdowns_owner_idx on public.crm_breakdowns (owner_id) where owner_id is not null;
create index if not exists crm_breakdowns_lead_idx on public.crm_breakdowns (lead_id) where lead_id is not null;
alter table public.crm_breakdowns enable row level security;

create policy crm_breakdowns_select on public.crm_breakdowns for select to authenticated using (
  (select private.is_admin()) or ((select private.is_active()) and lower(created_by) = (select private.current_email()))
);
create policy crm_breakdowns_insert on public.crm_breakdowns for insert to authenticated with check (
  (select private.is_active()) and lower(created_by) = (select private.current_email())
);
create policy crm_breakdowns_update on public.crm_breakdowns for update to authenticated
  using ((select private.is_admin()) or ((select private.is_active()) and lower(created_by) = (select private.current_email())))
  with check ((select private.is_admin()) or ((select private.is_active()) and lower(created_by) = (select private.current_email())));
create policy crm_breakdowns_delete on public.crm_breakdowns for delete to authenticated using (
  (select private.is_admin()) or ((select private.is_active()) and lower(created_by) = (select private.current_email()))
);
grant select, insert, update, delete on public.crm_breakdowns to authenticated;

-- Floor plans, cluster plans and photos for breakdowns. Public read (the client page has no login);
-- only active CRM users can upload, JPEG/PNG/WebP up to 8 MB. Files are never overwritten.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('breakdown-media', 'breakdown-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists breakdown_media_insert on storage.objects;
create policy breakdown_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'breakdown-media' and (select private.is_active()));
