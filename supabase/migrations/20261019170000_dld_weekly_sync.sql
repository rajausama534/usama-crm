-- Weekly DLD sync: run log, server-only cluster list, and a pg_cron schedule calling the dld-sync edge function.

create table if not exists public.dld_sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer,
  mapped integer,
  error text
);
alter table public.dld_sync_runs enable row level security;
create policy dld_sync_runs_admin_read on public.dld_sync_runs for select to authenticated using ((select private.is_admin()));

-- Every community/cluster label in the CRM, for the sync job only (service role).
create or replace function public.crm_filter_options_all() returns table (community text, cluster text)
language sql stable set search_path = public as $$
  select distinct community, cluster from public.owners where community is not null and cluster is not null
$$;
revoke execute on function public.crm_filter_options_all() from public, anon, authenticated;
grant execute on function public.crm_filter_options_all() to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Mondays 03:00 UTC (07:00 Dubai). The function itself refuses to run more than once every 6 days.
select cron.unschedule(jobid) from cron.job where jobname = 'dld-weekly-sync';
select cron.schedule(
  'dld-weekly-sync',
  '0 3 * * 1',
  $$select net.http_post(
      url := 'https://vnydxkmhrcesdffpfjpc.supabase.co/functions/v1/dld-sync',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)$$
);
