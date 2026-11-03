-- Change history for tables without an "id" (unit_details): label the row "community|cluster|unit"
-- instead of failing. Before this, editing an existing unit's Property details was rejected.
create or replace function private.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) end;
begin
  -- "Last contacted" changes on every call/WhatsApp click; they are not worth a history entry.
  if tg_op = 'UPDATE' and (o - 'last_contacted') = (n - 'last_contacted') then
    return new;
  end if;
  insert into public.crm_change_log (table_name, row_id, action, changed_by, old_row, new_row)
  values (tg_table_name,
          coalesce(o ->> 'id', concat_ws('|', o ->> 'community', o ->> 'cluster', o ->> 'unit')),
          lower(tg_op), private.current_email(), o, n);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Rivana: sizes for the units an older import saved with bedrooms only, from the DXB Interact
-- capture of 27 Oct 2026. Only empty size fields are filled; bedrooms and anything typed stay.
update public.unit_details d set
  plot_sqft = coalesce(d.plot_sqft, round(s.size_max)),
  bua_sqft  = coalesce(d.bua_sqft, case when s.has_plot_and_bua then round(s.bua_sqft) end),
  property_type = coalesce(d.property_type, case when s.townhouse then 'Townhouse' else 'Villa' end),
  updated_at = now()
from private.dxb_unit_summary_20261027 s
where d.cluster = 'Rivana' and s.cluster = 'Rivana' and s.unit_no = private.unit_number(d.unit)
  and d.plot_sqft is null and d.bua_sqft is null
  and (s.note_blocker is null or s.note_blocker like 'partial-share%');
