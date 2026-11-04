-- Cluster Guide v2: researched facts per cluster plus live figures worked out from the CRM and DLD.
-- Researched once (by Claude, on request): launch date, handover, payment plan, layouts (e.g. Earth / Horizon)
-- with their sizes, and published launch prices per bedroom type. Stored on cluster_guides.
-- Live (every time a guide is opened, and on "Update info"): units per bedroom type and layout from the CRM,
-- BUA / plot ranges, current market price (last 6 months, or 12 when fewer than 3 sales), trend, and the
-- earliest recorded sales around launch (used when no launch price was published).

alter table public.cluster_guides
  add column if not exists launch_on date,
  add column if not exists layouts jsonb not null default '[]'::jsonb,
  add column if not exists launch_prices jsonb not null default '[]'::jsonb,
  add column if not exists stats jsonb,
  add column if not exists stats_refreshed_at timestamptz,
  add column if not exists research_checked_on date;
alter table public.cluster_guides drop constraint if exists cluster_guides_layouts_array;
alter table public.cluster_guides add constraint cluster_guides_layouts_array check (jsonb_typeof(layouts) = 'array');
alter table public.cluster_guides drop constraint if exists cluster_guides_launch_prices_array;
alter table public.cluster_guides add constraint cluster_guides_launch_prices_array check (jsonb_typeof(launch_prices) = 'array');

-- Layout of each unit. layout_source 'estimated' = matched by BUA (re-done on every refresh);
-- anything else (e.g. 'manual') is never overwritten by the matcher.
alter table public.unit_details
  add column if not exists layout text check (layout is null or char_length(layout) <= 100),
  add column if not exists layout_source text check (layout_source is null or char_length(layout_source) <= 100);

-- Layout tags are derived: like last_contacted / is_primary, they are not worth a change-history entry.
create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and (o - 'last_contacted' - 'is_primary' - 'layout' - 'layout_source')
                        = (n - 'last_contacted' - 'is_primary' - 'layout' - 'layout_source') then
    return new;
  end if;
  insert into public.crm_change_log (table_name, row_id, action, changed_by, old_row, new_row)
  values (tg_table_name,
          coalesce(o ->> 'id', concat_ws('|', o ->> 'community', o ->> 'cluster', o ->> 'unit')),
          lower(tg_op), private.current_email(), o, n);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- "4", "4BR", "4 B/R", "4 Bedrooms" -> 4
create or replace function private.bedroom_count(t text) returns int
language sql immutable parallel safe set search_path = '' as $$
  select ((regexp_match(coalesce(t, ''), '(\d+)'))[1])::int
$$;

-- Tag units with their layout by BUA. A unit gets a layout when its bedroom type has only one layout,
-- or when its BUA is within 4% of one layout's BUA and clearly closer to it than to any other (2-point margin).
-- Layouts with the same BUA (façade styles only) cannot be told apart, so those units stay untagged.
create or replace function public.cluster_guide_tag_layouts(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare g record; n int := 0;
begin
  select community, name, layouts into g from public.cluster_guides where id = p_id;
  if not found then return 0; end if;
  -- Clear earlier estimates first, so a layout removed from the guide does not linger.
  update public.unit_details d set layout = null, layout_source = null
   where d.community = g.community and d.cluster = g.name and d.layout_source = 'estimated';
  with l as (
    select private.bedroom_count(x ->> 'bedrooms') b, btrim(x ->> 'name') nm,
           coalesce(nullif(x ->> 'bua_sqft', '')::numeric,
                    (nullif(x ->> 'bua_min_sqft', '')::numeric + nullif(x ->> 'bua_max_sqft', '')::numeric) / 2) bua
    from jsonb_array_elements(g.layouts) x
    where coalesce(btrim(x ->> 'name'), '') <> ''
  ), u as (
    select d.unit, private.bedroom_count(d.bedrooms) b, d.bua_sqft
    from public.unit_details d
    where d.community = g.community and d.cluster = g.name and d.layout_source is null
  ), f as (
    -- Some CRM sizes come from DLD and run smaller than Emaar plan areas, others are the plan areas.
    -- Per bedroom type, take the median ratio of each unit's BUA to its nearest layout: ~1 when the CRM
    -- already holds plan areas, lower when it holds DLD areas. Only used when plausible (within 30%).
    select x.b, percentile_cont(0.5) within group (order by x.ratio) k
    from (select u.b, (select u.bua_sqft / l.bua from l where l.b = u.b and l.bua > 0
                       order by abs(ln(u.bua_sqft / l.bua)) limit 1) ratio
          from u where u.bua_sqft > 0) x
    where x.ratio is not null group by x.b
  ), c as (
    select u.unit, l.nm, count(*) over (partition by u.unit) cands,
           abs(l.bua * coalesce(case when f.k between 0.7 and 1.3 then f.k end, 1) - u.bua_sqft) / nullif(u.bua_sqft, 0) diff
    from u join l on l.b = u.b left join f on f.b = u.b
  ), r as (
    select unit, nm, cands, diff,
           row_number() over (partition by unit order by diff nulls last) rn,
           lead(diff) over (partition by unit order by diff nulls last) next_diff
    from c
  )
  update public.unit_details d set layout = r.nm, layout_source = 'estimated'
  from r
  where r.rn = 1 and d.community = g.community and d.cluster = g.name and d.unit = r.unit
    and (r.cands = 1 or (r.diff <= 0.04 and (r.next_diff is null or r.next_diff - r.diff >= 0.02)));
  get diagnostics n = row_count;
  return n;
end $$;

-- Live figures for one guide, as JSON. Sales come from DLD open data (cluster level) plus unit-level sales
-- (DXB Interact / reports) that DLD does not already have (same cluster, date and price = same sale).
create or replace function public.cluster_guide_stats(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g record; res jsonb;
begin
  select id, community, name, launch_on into g from public.cluster_guides where id = p_id;
  if not found then return null; end if;

  with units as (
    select k from (
      select lower(btrim(o.unit)) k from public.owners o
       where o.community = g.community and o.cluster = g.name and coalesce(btrim(o.unit), '') <> ''
      union
      select lower(btrim(d.unit)) from public.unit_details d where d.community = g.community and d.cluster = g.name
    ) s
  ), ud as (
    select u.k, private.bedroom_count(d.bedrooms) b, d.bua_sqft bua, d.plot_sqft plot, nullif(btrim(d.layout), '') layout
    from units u
    left join public.unit_details d on d.community = g.community and d.cluster = g.name and lower(btrim(d.unit)) = u.k
  ), sales_all as (
    select t.transaction_date d, t.amount a, t.area_sqft s, private.bedroom_count(t.rooms) b, t.is_offplan off
    from public.dld_transactions t
    where t.crm_community = g.community and t.crm_cluster = g.name and t.property_type = 'Building' and t.amount > 0
    union all
    select p.transaction_date, p.amount,
           coalesce(p.bua_sqft, case when p.area_type = 'property' then p.area_sqft end, d.bua_sqft),
           private.bedroom_count(coalesce(p.bedrooms, d.bedrooms)), null
    from public.property_transactions p
    left join public.unit_details d on d.community = p.community and d.cluster = p.cluster and d.unit = p.unit
    where p.community = g.community and p.cluster = g.name and p.kind = 'Sold' and p.amount > 0
      and p.dld_transaction_number is null
      and not exists (select 1 from public.dld_transactions t
                       where t.crm_community = p.community and t.crm_cluster = p.cluster
                         and t.transaction_date = p.transaction_date and t.amount = p.amount)
  ), lsales as (  -- unit-level sales, which know the unit's layout
    select p.transaction_date d, p.amount a, private.bedroom_count(coalesce(p.bedrooms, d.bedrooms)) b, d.layout
    from public.property_transactions p
    join public.unit_details d on d.community = p.community and d.cluster = p.cluster and d.unit = p.unit
    where p.community = g.community and p.cluster = g.name and p.kind = 'Sold' and p.amount > 0 and d.layout is not null
  ), med as (  -- typical price per bedroom type over the last 2 years, to drop part-share / non-market sales
    select b, percentile_cont(0.5) within group (order by a) m
    from sales_all where b is not null and d >= current_date - interval '24 months' group by b
  ), sales as (
    select s.* from sales_all s left join med on med.b = s.b
    where med.m is null or s.a >= med.m * 0.6
  ), win as (
    select b, case when count(*) filter (where d >= current_date - interval '6 months') >= 3 then 6 else 12 end w
    from sales where b is not null and d >= current_date - interval '12 months' group by b
  ), market as (
    select s.b, jsonb_build_object(
             'months', w.w, 'sales', count(*), 'offplan', count(*) filter (where s.off),
             'avg', round(avg(s.a)), 'min', min(s.a), 'max', max(s.a),
             'psf', round(avg(s.a / s.s) filter (where s.s > 0)), 'last_date', max(s.d)) m
    from sales s join win w on w.b = s.b
    where s.d >= current_date - make_interval(months => w.w)
    group by s.b, w.w
  ), trend as (
    select b,
           avg(a / s) filter (where d >= current_date - interval '6 months') cur,
           avg(a / s) filter (where d < current_date - interval '6 months' and d >= current_date - interval '12 months') prev,
           count(*) filter (where d >= current_date - interval '6 months') n_cur,
           count(*) filter (where d < current_date - interval '6 months' and d >= current_date - interval '12 months') n_prev
    from sales where b is not null and s > 0 and d >= current_date - interval '12 months' group by b
  ), first_sales as (  -- sales from 30 days before to 90 days after the researched launch date
    select b, jsonb_build_object('min', min(a), 'avg', round(avg(a)), 'sales', count(*), 'first_date', min(d), 'last_date', max(d)) f
    from sales
    where b is not null and g.launch_on is not null
      and d between g.launch_on - 30 and g.launch_on + 90
    group by b
  ), beds as (
    select b from ud where b is not null union select b from market union select b from first_sales
  ), by_bed as (
    select bs.b, jsonb_build_object(
             'bedrooms', bs.b,
             'units', (select count(*) from ud where ud.b = bs.b),
             'bua_min', (select min(bua) from ud where ud.b = bs.b), 'bua_max', (select max(bua) from ud where ud.b = bs.b),
             'plot_min', (select min(plot) from ud where ud.b = bs.b), 'plot_max', (select max(plot) from ud where ud.b = bs.b),
             'market', (select m from market where market.b = bs.b),
             'trend_pct', (select case when n_cur >= 5 and n_prev >= 5 and prev > 0 then round((cur / prev - 1) * 100, 1) end
                            from trend where trend.b = bs.b),
             'first_sales', (select f from first_sales where first_sales.b = bs.b)) j
    from beds bs
  ), by_layout as (
    select x.b, x.layout, jsonb_build_object(
             'bedrooms', x.b, 'layout', x.layout, 'units', x.units,
             'bua_min', x.bua_min, 'bua_max', x.bua_max, 'plot_min', x.plot_min, 'plot_max', x.plot_max,
             'market_avg', (select round(avg(a)) from lsales l where l.b = x.b and l.layout = x.layout and l.d >= current_date - interval '12 months'),
             'market_sales', (select count(*) from lsales l where l.b = x.b and l.layout = x.layout and l.d >= current_date - interval '12 months'),
             'first_min', (select min(a) from lsales l where l.b = x.b and l.layout = x.layout and g.launch_on is not null
                            and l.d between g.launch_on - 30 and g.launch_on + 90)) j
    from (select b, layout, count(*) units, min(bua) bua_min, max(bua) bua_max, min(plot) plot_min, max(plot) plot_max
          from ud where layout is not null and b is not null group by b, layout) x
  )
  select jsonb_build_object(
           'units_total', (select count(*) from ud),
           'units_without_bedrooms', (select count(*) from ud where b is null),
           'units_without_layout', (select count(*) from ud where layout is null and b is not null),
           'bedrooms', coalesce((select jsonb_agg(j order by b) from by_bed), '[]'::jsonb),
           'layouts', coalesce((select jsonb_agg(j order by b, layout) from by_layout), '[]'::jsonb),
           'sales_recorded', (select count(*) from sales_all),
           'first_sale_date', (select min(d) from sales),
           'dld_last_fetch', (select max(coalesce(finished_at, started_at)) from public.dld_sync_runs where error is null),
           'computed_at', now())
    into res;
  return res;
end $$;

revoke all on function public.cluster_guide_stats(uuid) from public, anon, authenticated;
revoke all on function public.cluster_guide_tag_layouts(uuid) from public, anon, authenticated;
grant execute on function public.cluster_guide_stats(uuid) to service_role;
grant execute on function public.cluster_guide_tag_layouts(uuid) to service_role;
