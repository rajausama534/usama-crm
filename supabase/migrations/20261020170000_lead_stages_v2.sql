-- Lead stages v2 (requested 20 Oct 2026): New, No Response, Interested, Viewing Scheduled, Visit Done, Negotiation, Won, Lost.
-- Call Back -> No Response. Viewing Done -> Visit Done, except leads that were 'Viewing' before the 20 Oct mapping
-- (read from crm_change_log) -> Viewing Scheduled. Every change is logged by the crm_change_log trigger.
update public.leads l set status = 'Viewing Scheduled'
where l.status = 'Viewing Done'
  and (select c.old_row ->> 'status' from public.crm_change_log c
       where c.table_name = 'leads' and c.row_id = l.id::text and c.new_row ->> 'status' = 'Viewing Done'
         and c.old_row ->> 'status' is distinct from 'Viewing Done'
       order by c.changed_at desc limit 1) = 'Viewing';
update public.leads set status = 'Visit Done' where status in ('Viewing Done', 'Visit Done');
update public.leads set status = 'No Response' where status in ('Call Back', 'Contacted');
update public.leads set status = 'Viewing Scheduled' where status = 'Viewing';
update public.leads set status = 'Won' where status = 'WON';
update public.leads set status = 'Lost' where status = 'LOST';
