-- Calendar events tied to leads, notifications, lead stage mapping, admin display name, cluster guide sources.
-- Only change to existing data: the approved stage mapping (logged in crm_change_log) and the admin's display name.

-- ---------------------------------------------------------------- lead stages (approved 20 Oct 2026)
update public.leads set status = 'Viewing Done' where status in ('Visit Done', 'Viewing');
update public.leads set status = 'Call Back' where status = 'Contacted';

-- ---------------------------------------------------------------- greeting uses the stored display name
update public.user_access set name = 'Usama', updated_at = now()
where lower(email) = 'thechussar@gmail.com' and (name is null or name = '');
insert into public.user_access (email, name, role, active, assigned_communities, assigned_clusters, can_export)
select 'thechussar@gmail.com', 'Usama', 'admin', true, '{}', '{}', true
where not exists (select 1 from public.user_access where lower(email) = 'thechussar@gmail.com');

-- ---------------------------------------------------------------- events
create table if not exists public.crm_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  event_type text not null check (event_type in ('Call Back', 'Follow-Up', 'Phone Call', 'Meeting', 'Property Viewing', 'Reminder', 'Task', 'Other')),
  title text not null check (char_length(title) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 4000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Completed', 'Cancelled')),
  completed_at timestamptz,
  remind_minutes integer not null default 30 check (remind_minutes between 0 and 10080),
  assigned_to text not null default private.current_email(),
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_events_starts_idx on public.crm_events (starts_at);
create index if not exists crm_events_lead_idx on public.crm_events (lead_id, starts_at);
create index if not exists crm_events_assignee_idx on public.crm_events (lower(assigned_to), status, starts_at);
alter table public.crm_events enable row level security;

-- A user sees an event when they are admin, or it is theirs AND (no lead, or a lead they can see).
create or replace function private.can_see_event(p_lead uuid, p_assigned text, p_created text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_active()
          and (lower(p_assigned) = private.current_email() or lower(p_created) = private.current_email())
          and (p_lead is null or private.can_see_lead(p_lead::text)))
$$;
grant execute on function private.can_see_event(uuid, text, text) to authenticated;

create policy crm_events_select on public.crm_events for select to authenticated using (private.can_see_event(lead_id, assigned_to, created_by));
create policy crm_events_insert on public.crm_events for insert to authenticated with check (
  private.can_see_event(lead_id, assigned_to, created_by)
  and ((select private.is_admin()) or lower(assigned_to) = (select private.current_email()))
);
create policy crm_events_update on public.crm_events for update to authenticated
  using (private.can_see_event(lead_id, assigned_to, created_by))
  with check (private.can_see_event(lead_id, assigned_to, created_by)
              and ((select private.is_admin()) or lower(assigned_to) = (select private.current_email())));
create policy crm_events_delete on public.crm_events for delete to authenticated using (private.can_see_event(lead_id, assigned_to, created_by));

drop trigger if exists crm_log_change on public.crm_events;
create trigger crm_log_change after update or delete on public.crm_events for each row execute function private.log_change();

-- Keep the lead in sync: its follow-up fields always show the next scheduled event,
-- and scheduling / completing / rescheduling writes a line into the lead's activity history.
create or replace function private.sync_event_to_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l uuid := coalesce(new.lead_id, old.lead_id);
  who text := private.current_email();
begin
  if tg_op = 'UPDATE' and old.lead_id is distinct from new.lead_id and old.lead_id is not null then
    perform private.refresh_lead_followup(old.lead_id);
  end if;
  if l is null then return coalesce(new, old); end if;
  perform private.refresh_lead_followup(l);
  -- The one-time carry-over of old scheduled activities must not write them into history twice.
  if coalesce(current_setting('crm.skip_activity_log', true), '') = 'on' then return coalesce(new, old); end if;

  if tg_op = 'INSERT' and new.lead_id is not null then
    insert into public.lead_activities (lead_id, activity_type, details, created_by)
    values (new.lead_id::text, 'Scheduled: ' || new.event_type,
            new.title || ' — ' || to_char(new.starts_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI') || coalesce(' · ' || new.notes, ''), who);
  elsif tg_op = 'UPDATE' and new.lead_id is not null then
    if new.status = 'Completed' and old.status <> 'Completed' then
      insert into public.lead_activities (lead_id, activity_type, details, created_by)
      values (new.lead_id::text, 'Completed: ' || new.event_type, new.title || coalesce(' · ' || new.notes, ''), who);
    elsif new.status = 'Cancelled' and old.status <> 'Cancelled' then
      insert into public.lead_activities (lead_id, activity_type, details, created_by)
      values (new.lead_id::text, 'Cancelled: ' || new.event_type, new.title, who);
    elsif new.starts_at <> old.starts_at and new.status = 'Scheduled' then
      insert into public.lead_activities (lead_id, activity_type, details, created_by)
      values (new.lead_id::text, 'Rescheduled: ' || new.event_type,
              new.title || ' — now ' || to_char(new.starts_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI'), who);
    end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function private.refresh_lead_followup(p_lead uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare nxt record;
begin
  select e.starts_at, e.event_type, e.title into nxt
  from public.crm_events e
  where e.lead_id = p_lead and e.status = 'Scheduled'
  order by e.starts_at limit 1;
  update public.leads set
    follow_up_date = (nxt.starts_at at time zone 'Asia/Dubai')::date,
    follow_up_time = (nxt.starts_at at time zone 'Asia/Dubai')::time,
    reminder_type = nxt.event_type,
    reminder_note = nxt.title
  where id = p_lead
    and (follow_up_date, follow_up_time, reminder_type, reminder_note)
        is distinct from ((nxt.starts_at at time zone 'Asia/Dubai')::date, (nxt.starts_at at time zone 'Asia/Dubai')::time, nxt.event_type, nxt.title);
end $$;

drop trigger if exists crm_event_sync on public.crm_events;
create trigger crm_event_sync after insert or update or delete on public.crm_events for each row execute function private.sync_event_to_lead();

-- Carry over the 8 existing "Scheduled:" lead activities (originals stay untouched).
set local crm.skip_activity_log = 'on';
insert into public.crm_events (lead_id, event_type, title, notes, starts_at, status, assigned_to, created_by)
select l.id,
       case split_part(a.activity_type, ': ', 2) when 'Call' then 'Phone Call' when 'Follow-up' then 'Follow-Up'
            when 'Meeting' then 'Meeting' when 'Viewing' then 'Property Viewing' else 'Other' end,
       coalesce(nullif(split_part(a.activity_type, ': ', 2), ''), 'Event') || ' — ' || coalesce(l.name, 'Lead'),
       nullif(a.details, ''), a.created_at,
       case when a.created_at < now() then 'Completed' else 'Scheduled' end,
       coalesce(nullif(l.assigned_to, ''), 'thechussar@gmail.com'), coalesce(nullif(a.created_by, ''), 'thechussar@gmail.com')
from public.lead_activities a join public.leads l on l.id::text = a.lead_id
where a.activity_type like 'Scheduled:%'
  and not exists (select 1 from public.crm_events e where e.lead_id = l.id and e.starts_at = a.created_at);
set local crm.skip_activity_log = 'off';

-- ---------------------------------------------------------------- notifications
create table if not exists public.crm_notification_reads (
  user_email text not null,
  event_id uuid not null references public.crm_events (id) on delete cascade,
  kind text not null,
  read_at timestamptz not null default now(),
  primary key (user_email, event_id, kind)
);
alter table public.crm_notification_reads enable row level security;
create policy crm_notification_reads_own on public.crm_notification_reads for all to authenticated
  using (user_email = (select private.current_email())) with check (user_email = (select private.current_email()));

-- The signed-in user's notifications: their own scheduled events that are due soon (inside the reminder window),
-- due today, or overdue within the last 14 days. Nothing else, to avoid noise.
create or replace function public.crm_my_notifications() returns table (
  event_id uuid, kind text, event_type text, title text, starts_at timestamptz, lead_id uuid, lead_name text, is_read boolean)
language sql stable security invoker set search_path = public as $$
  with mine as (
    select e.*, case
      when e.starts_at < now() then 'overdue'
      when e.starts_at <= now() + make_interval(mins => greatest(e.remind_minutes, 15)) then 'due_soon'
      else 'today' end as kind
    from crm_events e
    where e.status = 'Scheduled'
      and lower(e.assigned_to) = private.current_email()
      and e.starts_at >= now() - interval '14 days'
      and (e.starts_at < now()
           or e.starts_at <= now() + make_interval(mins => greatest(e.remind_minutes, 15))
           or (e.starts_at at time zone 'Asia/Dubai')::date = (now() at time zone 'Asia/Dubai')::date)
  )
  select m.id, m.kind, m.event_type, m.title, m.starts_at, m.lead_id, l.name,
         exists (select 1 from crm_notification_reads r where r.event_id = m.id and r.kind = m.kind and r.user_email = private.current_email())
  from mine m left join leads l on l.id = m.lead_id
  order by m.starts_at
$$;
grant execute on function public.crm_my_notifications() to authenticated;
revoke execute on function public.crm_my_notifications() from anon, public;

-- ---------------------------------------------------------------- cluster guide: developer + verification metadata
alter table public.cluster_guides
  add column if not exists developer text,
  add column if not exists development_type text,
  add column if not exists original_price_note text,
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists verified_on date,
  add column if not exists open_questions text;
