-- Company system, step 1: roles, extra permission ticks, team leaders, approvals inbox, staff directory.
-- Additive only: new columns default to "no change"; no rows are deleted or rewritten; existing admin/agent
-- access stays exactly as it is. Old policies replaced here are recorded below for rollback.
--
-- Previous (20261019130000):
--   leads_select / leads_insert / leads_update: is_admin() or (assigned_to = me and is_active())
--   private.can_see_lead: is_admin() or (assigned_to = me and is_active())

-- ---------------------------------------------------------------- roles and ticks
alter table public.user_access
  add column if not exists permissions text[] not null default '{}',
  add column if not exists team_leader text;           -- email of this person's team leader (agents)

alter table public.user_access drop constraint if exists user_access_role_check;
alter table public.user_access add constraint user_access_role_check
  check (role is null or role in ('admin', 'agent', 'team_leader', 'accounts', 'hr'));

alter table public.user_access drop constraint if exists user_access_permissions_check;
alter table public.user_access add constraint user_access_permissions_check
  check (permissions <@ array['compliance', 'approve_deals', 'approve_expenses', 'approve_leave', 'approve_listings',
                              'view_finance', 'manage_users', 'export']::text[]);

create index if not exists user_access_team_leader_idx on public.user_access (lower(team_leader));

-- What each role can do without extra ticks (kept in step with web/src/lib/access.ts).
create or replace function private.role_permissions(p_role text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_role
    when 'team_leader' then array['approve_listings', 'approve_leave']
    when 'accounts'    then array['approve_deals', 'approve_expenses', 'view_finance', 'export']
    when 'hr'          then array['approve_leave', 'manage_users']
    else '{}'::text[] end
$$;

create or replace function private.has_perm(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_active()
          and (p = any (coalesce((private.access_row()).permissions, '{}'))
               or p = any (private.role_permissions((private.access_row()).role))))
$$;

-- True when p_email is an active member of the signed-in team leader's team.
create or replace function private.in_my_team(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_email is not null
     and (private.access_row()).role = 'team_leader'
     and exists (select 1 from public.user_access u
                 where lower(u.email) = lower(p_email) and u.active
                   and lower(u.team_leader) = private.current_email())
$$;

-- ---------------------------------------------------------------- leads: team leaders see their team's leads
create or replace function private.can_see_lead(p_lead_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where p_lead_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and l.id = p_lead_id::uuid
      and (private.is_admin()
           or (lower(l.assigned_to) = private.current_email() and private.is_active())
           or private.in_my_team(l.assigned_to))
  )
$$;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (
  (select private.is_admin())
  or (lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
  or private.in_my_team(assigned_to)
);
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated with check (
  (select private.is_admin())
  or (lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
  or private.in_my_team(assigned_to)
);
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using ((select private.is_admin())
         or (lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
         or private.in_my_team(assigned_to))
  with check ((select private.is_admin())
              or (lower(assigned_to) = (select private.current_email()) and (select private.is_active()))
              or private.in_my_team(assigned_to));

-- People with "Manage users" can manage everyone except admins.
drop policy if exists user_access_manage on public.user_access;
create policy user_access_manage on public.user_access for all to authenticated
  using ((select private.has_perm('manage_users')) and coalesce(role, '') <> 'admin')
  with check ((select private.has_perm('manage_users')) and coalesce(role, '') <> 'admin');
-- (user_access_select / user_access_write from 20261019130000 remain: self + admin.)

-- Only admins can give roles above agent/team leader or extra ticks, and nobody but an admin edits their own access.
create or replace function private.guard_user_access() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_admin() then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and lower(old.email) = private.current_email() then
    raise exception 'Ask an admin to change your own access';
  end if;
  if tg_op = 'DELETE' then raise exception 'Deactivate users instead of deleting them'; end if;
  if coalesce(new.role, 'agent') not in ('agent', 'team_leader') then
    raise exception 'Only an admin can give the % role', new.role;
  end if;
  if tg_op = 'INSERT' and cardinality(new.permissions) > 0 then
    raise exception 'Only an admin can give extra permissions';
  end if;
  if tg_op = 'UPDATE' and (new.permissions is distinct from old.permissions
                           or (old.role is distinct from new.role and coalesce(old.role, 'agent') not in ('agent', 'team_leader'))) then
    raise exception 'Only an admin can change extra permissions or senior roles';
  end if;
  return new;
end $$;
drop trigger if exists guard_user_access on public.user_access;
create trigger guard_user_access before insert or update or delete on public.user_access
  for each row execute function private.guard_user_access();

-- Names of active staff, for "assigned to" labels and pickers. No phone numbers, areas or permissions.
create or replace function public.crm_staff_directory()
returns table (email text, name text, role text, team_leader text)
language sql stable security definer set search_path = '' as $$
  select lower(u.email), u.name, u.role, lower(u.team_leader)
  from public.user_access u
  where u.active and private.is_active()
  order by u.name
$$;
revoke all on function public.crm_staff_directory() from public, anon;
grant execute on function public.crm_staff_directory() to authenticated;

drop trigger if exists crm_log_change on public.user_access;
create trigger crm_log_change after update or delete on public.user_access for each row execute function private.log_change();

-- ---------------------------------------------------------------- approvals inbox
create table if not exists public.crm_approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('deal', 'expense', 'advance', 'leave', 'listing')),
  ref_table text not null,
  ref_id text not null,
  title text not null check (char_length(title) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 2000),
  amount numeric(14, 2),
  requested_by text not null default private.current_email(),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000)
);
create index if not exists crm_approvals_status_idx on public.crm_approvals (status, kind, requested_at desc);
create index if not exists crm_approvals_requester_idx on public.crm_approvals (lower(requested_by), requested_at desc);
create unique index if not exists crm_approvals_one_pending on public.crm_approvals (ref_table, ref_id) where status = 'pending';
alter table public.crm_approvals enable row level security;

create or replace function private.approval_perm(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'deal' then 'approve_deals' when 'expense' then 'approve_expenses'
                     when 'advance' then 'approve_expenses' when 'leave' then 'approve_leave'
                     when 'listing' then 'approve_listings' end
$$;

-- Requesters see their own requests; approvers see the kinds they may approve. Team leaders approving
-- leave/listings only see their own team's requests.
create or replace function private.can_see_approval(p_kind text, p_requested_by text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_active() and lower(p_requested_by) = private.current_email())
      or (private.has_perm(private.approval_perm(p_kind))
          and ((private.access_row()).role <> 'team_leader' or private.in_my_team(p_requested_by)))
$$;

create policy crm_approvals_select on public.crm_approvals for select to authenticated
  using (private.can_see_approval(kind, requested_by));
-- Requests are created by the feature that needs them (deals, expenses…) as the signed-in user.
create policy crm_approvals_insert on public.crm_approvals for insert to authenticated
  with check ((select private.is_active()) and lower(requested_by) = (select private.current_email()) and status = 'pending'
              and decided_by is null and decided_at is null);
-- No direct updates or deletes: decisions go through crm_decide_approval(), withdrawals through crm_withdraw_approval().

create or replace function public.crm_decide_approval(p_id uuid, p_approve boolean, p_note text default null)
returns public.crm_approvals
language plpgsql security definer set search_path = '' as $$
declare a public.crm_approvals;
begin
  select * into a from public.crm_approvals where id = p_id for update;
  if a.id is null then raise exception 'Approval not found'; end if;
  if a.status <> 'pending' then raise exception 'Already %', a.status; end if;
  if not private.can_see_approval(a.kind, a.requested_by) or not private.has_perm(private.approval_perm(a.kind)) then
    raise exception 'You cannot approve this';
  end if;
  if lower(a.requested_by) = private.current_email() and not private.is_admin() then
    raise exception 'You cannot approve your own request';
  end if;
  update public.crm_approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = private.current_email(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id returning * into a;
  return a;
end $$;

create or replace function public.crm_withdraw_approval(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.crm_approvals set status = 'withdrawn', decided_by = private.current_email(), decided_at = now()
  where id = p_id and status = 'pending' and lower(requested_by) = private.current_email()
$$;

revoke all on function public.crm_decide_approval(uuid, boolean, text) from public, anon;
revoke all on function public.crm_withdraw_approval(uuid) from public, anon;
grant execute on function public.crm_decide_approval(uuid, boolean, text) to authenticated;
grant execute on function public.crm_withdraw_approval(uuid) to authenticated;

drop trigger if exists crm_log_change on public.crm_approvals;
create trigger crm_log_change after update or delete on public.crm_approvals for each row execute function private.log_change();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
