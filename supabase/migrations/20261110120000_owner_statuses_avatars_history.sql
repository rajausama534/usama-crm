-- Keep-or-drop answers, 10 Nov 2026:
--   * custom owner statuses: KEEP  -> shared list, everyone active can read, only admin adds/removes
--   * profile photo: KEEP           -> public "avatars" bucket, each person writes only <their user id>/...
--   * owner history edit/delete: ADMIN ONLY (agents could edit/delete entries they could see)

-- 1. Custom owner statuses (the standard ones stay in the app code).
create table if not exists public.crm_owner_statuses (
  name text primary key check (length(trim(name)) between 1 and 40),
  sort_order int not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.crm_owner_statuses enable row level security;
grant select, insert, update, delete on public.crm_owner_statuses to authenticated;

drop policy if exists crm_owner_statuses_select on public.crm_owner_statuses;
create policy crm_owner_statuses_select on public.crm_owner_statuses for select to authenticated
  using ((select private.is_active()) or (select private.is_admin()));
drop policy if exists crm_owner_statuses_write on public.crm_owner_statuses;
create policy crm_owner_statuses_write on public.crm_owner_statuses for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Bunty's read-only login: same rules as every other table (see ~/Bunty/company_readonly.sql).
drop policy if exists bunty_reader_select on public.crm_owner_statuses;
create policy bunty_reader_select on public.crm_owner_statuses for select to authenticated using (private.is_bunty_reader());
drop policy if exists bunty_reader_insert on public.crm_owner_statuses;
create policy bunty_reader_insert on public.crm_owner_statuses as restrictive for insert to authenticated with check (not private.is_bunty_reader());
drop policy if exists bunty_reader_update on public.crm_owner_statuses;
create policy bunty_reader_update on public.crm_owner_statuses as restrictive for update to authenticated using (not private.is_bunty_reader()) with check (not private.is_bunty_reader());
drop policy if exists bunty_reader_delete on public.crm_owner_statuses;
create policy bunty_reader_delete on public.crm_owner_statuses as restrictive for delete to authenticated using (not private.is_bunty_reader());

-- 2. Profile photos: public bucket, small images only, path must start with the uploader's own user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 524288, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (select private.is_active()) and not (select private.is_bunty_reader()) and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and not (select private.is_bunty_reader()) and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and not (select private.is_bunty_reader()) and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3. Owner history: only admin may change or remove an entry. Adding stays as before.
drop policy if exists owner_activities_update on public.owner_activities;
create policy owner_activities_update on public.owner_activities for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists owner_activities_delete on public.owner_activities;
create policy owner_activities_delete on public.owner_activities for delete to authenticated
  using ((select private.is_admin()));
