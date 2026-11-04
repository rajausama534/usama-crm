-- "Update from DXB Interact" (Cluster Data page): after the sales read from DXB Interact are saved with
-- public.crm_import_external_sales, this fills in each unit of ONE cluster from its saved sales.
--
--   a) a co-owner share transfer (plot below 75% of that unit's biggest plot) is marked kind 'Share transfer'
--   b) unit_details: bedrooms, BUA, plot and type are filled ONLY where empty (typed values are never replaced);
--      a unit whose DXB sales disagree on bedrooms or plot size is skipped
--   c) owners.admin_remarks: the sale summary line is replaced, or added on top when there is none;
--      everything else in the note stays. Resale: "4BR 4.5M Dec-2026 4500 sq ft", developer only: "4BR - 4500sq ft"
--      status New / Contacted -> Sold only for a resale in the last 12 months. Names, phones and other statuses untouched.
-- Every change goes through the normal change history (private.log_change) so it can be looked up and undone.
-- Admin only. Safe to run again: a second run changes nothing.

create or replace function public.crm_refresh_cluster_from_sales(p_community text, p_cluster text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- an earlier sale summary written by the CRM (any of its formats); hand-typed text never matches
  summary_re constant text :=
    '((\d+BR )?[\d.]+[MK] [A-Z][a-z]{2}-\d{4}( \d+ sq ft)?|\d+BR - \d+ ?sq ft|(\d+BR )?SOLD [\d.]+[MK] [A-Z][a-z]{2}-\d{4}(, size [\d,]+ sq ft)?)';
  v_share int := 0; v_filled int := 0; v_notes int := 0; v_sold int := 0; v_units int := 0; rc int;
  v_conflicts text[] := '{}';
  u record; v_note text; v_beds text; v_size numeric; v_dev boolean;
begin
  if not private.is_admin() then raise exception 'Only an administrator can update cluster data.'; end if;
  if coalesce(p_community, '') = '' or coalesce(p_cluster, '') = '' then raise exception 'Pick a community and a cluster.'; end if;

  -- a) partial co-owner share transfers
  with mx as (
    select t.unit, max(t.area_sqft) as m from public.property_transactions t
    where t.community = p_community and t.cluster = p_cluster and t.area_type = 'plot' and t.area_sqft > 0
      and t.kind in ('Sold', 'Share transfer')
    group by t.unit)
  update public.property_transactions t set kind = 'Share transfer'
  from mx
  where t.community = p_community and t.cluster = p_cluster and t.unit = mx.unit
    and t.kind = 'Sold' and t.area_type = 'plot' and t.area_sqft < 0.75 * mx.m;
  get diagnostics v_share = row_count;

  -- b) unit details from the DXB Interact sales
  for u in
    select t.unit,
           count(distinct t.bedrooms) filter (where t.bedrooms is not null) as nbeds,
           max(t.bedrooms) as beds,
           min(t.area_sqft) filter (where t.area_type = 'plot') as pmin,
           max(t.area_sqft) filter (where t.area_type = 'plot') as pmax,
           max(t.area_sqft) filter (where t.area_type is distinct from 'plot') as area,
           (array_agg(t.bua_sqft order by t.transaction_date desc) filter (where t.bua_sqft > 0))[1] as bua
    from public.property_transactions t
    where t.community = p_community and t.cluster = p_cluster and t.kind = 'Sold'
      and t.source ilike '%dxb%' and coalesce(t.unit, '') <> ''
    group by t.unit
  loop
    v_units := v_units + 1;
    if u.nbeds > 1 or u.pmax > u.pmin * 1.02 then v_conflicts := v_conflicts || u.unit; continue; end if;
    insert into public.unit_details as d (community, cluster, unit, property_type, bedrooms, bua_sqft, plot_sqft, details_source)
    values (p_community, p_cluster, u.unit,
            case when u.pmax is not null and u.bua is not null then 'Villa' when u.pmax is not null then 'Townhouse' end,
            u.beds,
            coalesce(u.bua, case when u.pmax is null then u.area end),
            round(u.pmax),
            'DXB Interact (' || to_char(current_date, 'FMDD Mon YYYY') || ')')
    on conflict (community, cluster, unit) do update set
      property_type  = coalesce(d.property_type, excluded.property_type),
      bedrooms       = coalesce(d.bedrooms, excluded.bedrooms),
      bua_sqft       = coalesce(d.bua_sqft, excluded.bua_sqft),
      plot_sqft      = coalesce(d.plot_sqft, excluded.plot_sqft),
      details_source = coalesce(d.details_source, excluded.details_source),
      updated_at     = now()
    where (d.property_type is null and excluded.property_type is not null)
       or (d.bedrooms is null and excluded.bedrooms is not null)
       or (d.bua_sqft is null and excluded.bua_sqft is not null)
       or (d.plot_sqft is null and excluded.plot_sqft is not null);
    get diagnostics rc = row_count;
    v_filled := v_filled + rc;
  end loop;

  -- c) owner notes and status from each unit's newest sale (any source, same rule as Last Price)
  for u in
    select distinct on (t.unit) t.unit, t.amount, t.transaction_date, t.sold_by, t.bedrooms as tbeds, t.area_sqft as tarea,
           d.bedrooms as dbeds, d.plot_sqft as dplot, d.bua_sqft as dbua
    from public.property_transactions t
    left join public.unit_details d on d.community = t.community and d.cluster = t.cluster and d.unit = t.unit
    where t.community = p_community and t.cluster = p_cluster and t.kind = 'Sold' and t.amount > 0
      and coalesce(t.unit, '') <> ''
    order by t.unit, t.transaction_date desc, (t.source ilike '%dxb%') desc, t.amount desc
  loop
    if u.unit = any(v_conflicts) and u.dbeds is null then continue; end if;
    v_beds := coalesce(u.dbeds, u.tbeds);
    v_size := coalesce(u.dplot, u.dbua, u.tarea);
    v_dev := coalesce(u.sold_by, '') ilike 'developer%';
    if v_dev then
      if (regexp_match(coalesce(v_beds, ''), '(\d+)')) is null or v_size is null then continue; end if;
      v_note := (regexp_match(v_beds, '(\d+)'))[1] || 'BR - ' || round(v_size)::text || 'sq ft';
    else
      v_note := private.crm_sale_note(v_beds, u.amount, u.transaction_date, v_size);
    end if;

    update public.owners o set admin_remarks =
      case when coalesce(o.admin_remarks, '') ~ summary_re then regexp_replace(o.admin_remarks, summary_re, v_note)
           else concat_ws(E'\n', v_note, nullif(o.admin_remarks, '')) end
    where o.community = p_community and o.cluster = p_cluster and o.unit = u.unit
      and position(v_note in coalesce(o.admin_remarks, '')) = 0;
    get diagnostics rc = row_count;
    v_notes := v_notes + rc;

    if not v_dev and u.transaction_date >= current_date - 365 then
      update public.owners o set status = 'Sold'
      where o.community = p_community and o.cluster = p_cluster and o.unit = u.unit and o.status in ('New', 'Contacted');
      get diagnostics rc = row_count;
      v_sold := v_sold + rc;
    end if;
  end loop;

  return jsonb_build_object('units_with_sales', v_units, 'share_transfers', v_share, 'units_filled', v_filled,
                            'notes_updated', v_notes, 'marked_sold', v_sold, 'skipped_units', to_jsonb(v_conflicts));
end $$;
revoke execute on function public.crm_refresh_cluster_from_sales(text, text) from public, anon;
grant execute on function public.crm_refresh_cluster_from_sales(text, text) to authenticated;
