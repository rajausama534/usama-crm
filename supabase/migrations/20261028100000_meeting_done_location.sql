-- Calendar: "Done" records what happened and where the person was when they pressed it.
-- Additive only: new nullable columns on crm_events, no existing rows changed.
alter table public.crm_events
  add column if not exists outcome text check (outcome is null or char_length(outcome) <= 4000),
  add column if not exists done_location_status text check (done_location_status in ('captured', 'denied', 'unavailable', 'timeout', 'unsupported')),
  add column if not exists done_lat double precision check (done_lat between -90 and 90),
  add column if not exists done_lng double precision check (done_lng between -180 and 180),
  add column if not exists done_accuracy_m real check (done_accuracy_m >= 0),
  add column if not exists done_location_at timestamptz;

-- The location is stamped by the database clock and cannot be changed afterwards (except by an admin),
-- so an agent cannot back-date it or edit the coordinates later.
create or replace function private.guard_event_done_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.done_location_status is not null and not private.is_admin() then
    new.done_location_status := old.done_location_status;
    new.done_lat := old.done_lat;
    new.done_lng := old.done_lng;
    new.done_accuracy_m := old.done_accuracy_m;
    new.done_location_at := old.done_location_at;
  elsif new.done_location_status is not null and new.done_location_status is distinct from old.done_location_status then
    new.done_location_at := now();
    if new.done_location_status <> 'captured' then
      new.done_lat := null; new.done_lng := null; new.done_accuracy_m := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists crm_event_done_location on public.crm_events;
create trigger crm_event_done_location before update on public.crm_events for each row execute function private.guard_event_done_location();

-- Lead history line on completion now carries the outcome and whether a location was shared.
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
      values (new.lead_id::text, 'Completed: ' || new.event_type,
              new.title || coalesce(' · ' || coalesce(new.outcome, new.notes), '')
              || case when new.done_location_status = 'captured' then ' · Location shared (±' || round(coalesce(new.done_accuracy_m, 0))::text || ' m)'
                      when new.done_location_status is not null then ' · Location not shared'
                      else '' end, who);
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
