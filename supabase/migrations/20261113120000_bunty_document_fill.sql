-- Bunty document fill (13 Nov 2026): lets Bunty's login (thechussar+bunty@gmail.com) save the details he reads from the
-- documents Usama sends (Emirates ID, passport, title deed, pre-approval...) straight into the portal, instead of
-- typing them into web pages. Bunty stays read-only on every table; these functions are the narrow exceptions:
--   1. bunty_save_kyc: fill one party's KYC on a deal (name, nationality, ID type, ID number, expiry, source of funds).
--      It can never tick the sanctions check or mark a KYC complete, and refuses a KYC already marked complete.
--   2. bunty_save_staff_document: HR, save a staff member's document (visa, Emirates ID, passport...) number and dates.
--   3. bunty_add_staff: HR onboarding, add a new staff member's basic details (no salary, IBAN or bank details).
-- Empty values never overwrite what is already there. Anyone who isn't Bunty's login is refused.
begin;

create or replace function public.bunty_save_kyc(p_deal_no bigint, p_party text, p_party_no int, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_deal uuid;
  v_row public.crm_kyc;
  v_type text := nullif(trim(p_fields ->> 'id_type'), '');
  v_exp date := nullif(trim(p_fields ->> 'id_expiry'), '')::date;
begin
  if not private.is_bunty_reader() then raise exception 'only Bunty may call this'; end if;
  if p_party not in ('buyer', 'seller', 'tenant', 'landlord') then raise exception 'party must be buyer, seller, tenant or landlord'; end if;
  if coalesce(p_party_no, 1) not between 1 and 4 then raise exception 'party_no must be 1 to 4'; end if;
  if v_type is not null and v_type not in ('Emirates ID', 'Passport', 'Trade licence') then raise exception 'bad id_type'; end if;
  select id into v_deal from public.crm_deals where deal_no = p_deal_no;
  if v_deal is null then raise exception 'no deal %', p_deal_no; end if;

  select * into v_row from public.crm_kyc where deal_id = v_deal and party = p_party and party_no = coalesce(p_party_no, 1);
  if found and v_row.status = 'complete' then raise exception 'this KYC is already complete; only compliance can change it'; end if;

  if not found then
    insert into public.crm_kyc (deal_id, party, party_no, full_name, nationality, id_type, id_number, id_expiry, source_of_funds, created_by)
    values (v_deal, p_party, coalesce(p_party_no, 1),
            left(nullif(trim(p_fields ->> 'full_name'), ''), 200), left(nullif(trim(p_fields ->> 'nationality'), ''), 100),
            v_type, left(nullif(trim(p_fields ->> 'id_number'), ''), 60), v_exp,
            left(nullif(trim(p_fields ->> 'source_of_funds'), ''), 1000), 'Bunty')
    returning * into v_row;
  else
    update public.crm_kyc set
      full_name = coalesce(left(nullif(trim(p_fields ->> 'full_name'), ''), 200), full_name),
      nationality = coalesce(left(nullif(trim(p_fields ->> 'nationality'), ''), 100), nationality),
      id_type = coalesce(v_type, id_type),
      id_number = coalesce(left(nullif(trim(p_fields ->> 'id_number'), ''), 60), id_number),
      id_expiry = coalesce(v_exp, id_expiry),
      source_of_funds = coalesce(left(nullif(trim(p_fields ->> 'source_of_funds'), ''), 1000), source_of_funds)
    where id = v_row.id
    returning * into v_row;
  end if;
  return jsonb_build_object('deal_no', p_deal_no, 'party', v_row.party, 'party_no', v_row.party_no, 'full_name', v_row.full_name,
    'nationality', v_row.nationality, 'id_type', v_row.id_type, 'id_number', v_row.id_number, 'id_expiry', v_row.id_expiry,
    'source_of_funds', v_row.source_of_funds, 'has_id_copy', v_row.id_file is not null, 'status', v_row.status);
end $$;

-- p_staff: the staff member's email or full name (must match exactly one active staff member).
create or replace function public.bunty_save_staff_document(p_staff text, p_doc_type text, p_doc_number text,
                                                            p_issue_date date, p_expiry_date date, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_staff uuid; v_n int; v_doc public.crm_staff_documents;
begin
  if not private.is_bunty_reader() then raise exception 'only Bunty may call this'; end if;
  select count(*), min(id::text)::uuid into v_n, v_staff from public.crm_staff
   where lower(email) = lower(trim(p_staff)) or lower(full_name) = lower(trim(p_staff));
  if v_n = 0 then raise exception 'no staff member called %', p_staff; end if;
  if v_n > 1 then raise exception 'more than one staff member matches %; use their email', p_staff; end if;
  select * into v_doc from public.crm_staff_documents where staff_id = v_staff and doc_type = p_doc_type
   order by created_at desc limit 1;
  if not found then
    insert into public.crm_staff_documents (staff_id, doc_type, doc_number, issue_date, expiry_date, notes, created_by)
    values (v_staff, p_doc_type, left(nullif(trim(p_doc_number), ''), 60), p_issue_date, p_expiry_date, left(p_notes, 1000), 'Bunty')
    returning * into v_doc;
  else
    update public.crm_staff_documents set
      doc_number = coalesce(left(nullif(trim(p_doc_number), ''), 60), doc_number),
      issue_date = coalesce(p_issue_date, issue_date), expiry_date = coalesce(p_expiry_date, expiry_date),
      notes = coalesce(left(nullif(trim(p_notes), ''), 1000), notes)
    where id = v_doc.id returning * into v_doc;
  end if;
  return jsonb_build_object('staff_id', v_staff, 'doc_type', v_doc.doc_type, 'doc_number', v_doc.doc_number,
                            'issue_date', v_doc.issue_date, 'expiry_date', v_doc.expiry_date);
end $$;

create or replace function public.bunty_add_staff(p_full_name text, p_nationality text, p_phone text, p_job_title text,
                                                  p_join_date date, p_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_bunty_reader() then raise exception 'only Bunty may call this'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'full name needed'; end if;
  if exists (select 1 from public.crm_staff where lower(full_name) = lower(trim(p_full_name))) then
    raise exception '% is already on the staff list', p_full_name; end if;
  insert into public.crm_staff (full_name, nationality, phone, job_title, join_date, email, created_by)
  values (left(trim(p_full_name), 200), left(nullif(trim(p_nationality), ''), 100), left(nullif(trim(p_phone), ''), 30),
          left(nullif(trim(p_job_title), ''), 100), p_join_date, nullif(lower(trim(p_email)), ''), 'Bunty')
  returning id into v_id;
  return jsonb_build_object('staff_id', v_id, 'full_name', p_full_name);
end $$;

revoke all on function public.bunty_save_kyc(bigint, text, int, jsonb) from public, anon;
revoke all on function public.bunty_save_staff_document(text, text, text, date, date, text) from public, anon;
revoke all on function public.bunty_add_staff(text, text, text, text, date, text) from public, anon;
grant execute on function public.bunty_save_kyc(bigint, text, int, jsonb) to authenticated;
grant execute on function public.bunty_save_staff_document(text, text, text, date, date, text) to authenticated;
grant execute on function public.bunty_add_staff(text, text, text, text, date, text) to authenticated;

commit;
