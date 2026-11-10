-- Company system, steps 2–5: deals + commission + KYC, accounts, HR, listings.
-- Additive only: new tables, functions and two storage buckets. No existing table, row or policy is changed,
-- apart from two triggers added to crm_approvals (KYC/permit check before approval, status sync after a decision).
-- Nothing financial can be deleted (FTA: 5 years of records); every change is written to crm_change_log.

-- ---------------------------------------------------------------- who is who
create or replace function private.is_finance() returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_perm('view_finance') $$;

create or replace function private.is_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (private.is_active() and (private.access_row()).role = 'hr')
$$;

create or replace function private.is_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_active() and coalesce((private.access_row()).role, 'agent') in ('agent', 'team_leader'))
$$;

create or replace function private.today_dubai() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Dubai')::date $$;

-- ---------------------------------------------------------------- company settings (name, TRN, bank details, WPS ids)
create table if not exists public.crm_company_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.crm_company_settings (id, data) values (1, '{"name": "Usama Real Estate"}') on conflict (id) do nothing;
alter table public.crm_company_settings enable row level security;
create policy crm_company_settings_select on public.crm_company_settings for select to authenticated
  using ((select private.is_finance()) or (select private.is_hr()));
create policy crm_company_settings_update on public.crm_company_settings for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

-- ---------------------------------------------------------------- HR: staff records
create table if not exists public.crm_staff (
  id uuid primary key default gen_random_uuid(),
  email text,                                        -- system login, when the person has one
  full_name text not null check (char_length(full_name) between 1 and 200),
  job_title text,
  nationality text,
  phone text,
  join_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'left')),
  salary_type text not null default 'commission_only' check (salary_type in ('commission_only', 'basic_commission', 'mixed')),
  basic_salary numeric(14, 2) not null default 0 check (basic_salary >= 0),
  allowances numeric(14, 2) not null default 0 check (allowances >= 0),
  commission_rate numeric(6, 3) not null default 50 check (commission_rate between 0 and 100),
  tl_override_pct numeric(6, 3) not null default 0 check (tl_override_pct between 0 and 100),
  pay_method text not null default 'bank' check (pay_method in ('wps', 'bank', 'cash')),
  iban text,
  bank_code text,                                    -- the employee bank's routing code (WPS agent id)
  labour_no text,                                    -- MOHRE personal number (14 digits) for WPS
  annual_leave_days int not null default 30 check (annual_leave_days between 0 and 60),
  notes text,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
create unique index if not exists crm_staff_email_idx on public.crm_staff (lower(email)) where email is not null;
alter table public.crm_staff enable row level security;

create or replace function private.staff_is_me(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crm_staff s where s.id = p_staff and lower(s.email) = private.current_email())
$$;

create policy crm_staff_select on public.crm_staff for select to authenticated
  using ((select private.is_hr()) or (select private.is_finance())
         or ((select private.is_active()) and lower(email) = (select private.current_email())));
create policy crm_staff_insert on public.crm_staff for insert to authenticated with check ((select private.is_hr()));
create policy crm_staff_update on public.crm_staff for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

create table if not exists public.crm_staff_documents (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.crm_staff (id),
  doc_type text not null check (doc_type in ('Visa', 'Work permit / labour card', 'Emirates ID', 'Passport', 'RERA broker card (BRN)',
                                             'Employment contract', 'Health insurance', 'Other')),
  doc_number text,
  issue_date date,
  expiry_date date,
  file_path text,
  notes text,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
create index if not exists crm_staff_documents_expiry_idx on public.crm_staff_documents (expiry_date);
create index if not exists crm_staff_documents_staff_idx on public.crm_staff_documents (staff_id);
alter table public.crm_staff_documents enable row level security;
create policy crm_staff_documents_select on public.crm_staff_documents for select to authenticated
  using ((select private.is_hr()) or private.staff_is_me(staff_id));
create policy crm_staff_documents_insert on public.crm_staff_documents for insert to authenticated with check ((select private.is_hr()));
create policy crm_staff_documents_update on public.crm_staff_documents for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy crm_staff_documents_delete on public.crm_staff_documents for delete to authenticated using ((select private.is_hr()));

create table if not exists public.crm_leave (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.crm_staff (id),
  leave_type text not null default 'Annual' check (leave_type in ('Annual', 'Sick', 'Unpaid', 'Maternity', 'Parental', 'Bereavement', 'Hajj', 'Other')),
  start_date date not null,
  end_date date not null,
  days numeric(5, 1) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists crm_leave_staff_idx on public.crm_leave (staff_id, start_date desc);
alter table public.crm_leave enable row level security;
create policy crm_leave_select on public.crm_leave for select to authenticated
  using ((select private.is_hr()) or private.staff_is_me(staff_id)
         or ((select private.has_perm('approve_leave')) and ((select (private.access_row()).role) <> 'team_leader' or private.in_my_team(created_by))));
create policy crm_leave_insert on public.crm_leave for insert to authenticated
  with check ((select private.is_hr()) or (private.staff_is_me(staff_id) and status = 'pending'));
create policy crm_leave_update on public.crm_leave for update to authenticated
  using ((select private.is_hr()) or (private.staff_is_me(staff_id) and status = 'pending'))
  with check ((select private.is_hr()) or (private.staff_is_me(staff_id) and status in ('pending', 'cancelled')));

create table if not exists public.crm_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft', 'final')),
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  finalised_at timestamptz
);
alter table public.crm_payroll_runs enable row level security;
create policy crm_payroll_runs_select on public.crm_payroll_runs for select to authenticated
  using ((select private.is_hr()) or (select private.is_finance()) or ((select private.is_active()) and status = 'final'));
create policy crm_payroll_runs_insert on public.crm_payroll_runs for insert to authenticated
  with check ((select private.is_hr()) or (select private.is_finance()));
create policy crm_payroll_runs_update on public.crm_payroll_runs for update to authenticated
  using ((select private.is_hr()) or (select private.is_finance()))
  with check ((select private.is_hr()) or (select private.is_finance()));

create table if not exists public.crm_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.crm_payroll_runs (id),
  staff_id uuid not null references public.crm_staff (id),
  basic numeric(14, 2) not null default 0,
  allowances numeric(14, 2) not null default 0,
  commission numeric(14, 2) not null default 0,
  advance_recovery numeric(14, 2) not null default 0,
  deductions numeric(14, 2) not null default 0,
  net numeric(14, 2) generated always as (basic + allowances + commission - advance_recovery - deductions) stored,
  pay_method text not null default 'bank' check (pay_method in ('wps', 'bank', 'cash')),
  paid boolean not null default false,
  note text,
  unique (run_id, staff_id)
);
alter table public.crm_payroll_lines enable row level security;
create policy crm_payroll_lines_select on public.crm_payroll_lines for select to authenticated
  using ((select private.is_hr()) or (select private.is_finance()) or private.staff_is_me(staff_id));
create policy crm_payroll_lines_insert on public.crm_payroll_lines for insert to authenticated
  with check ((select private.is_hr()) or (select private.is_finance()));
create policy crm_payroll_lines_update on public.crm_payroll_lines for update to authenticated
  using ((select private.is_hr()) or (select private.is_finance()))
  with check ((select private.is_hr()) or (select private.is_finance()));
-- Lines of a draft run can be removed and rebuilt; a final run is fixed.
create policy crm_payroll_lines_delete on public.crm_payroll_lines for delete to authenticated
  using (((select private.is_hr()) or (select private.is_finance()))
         and exists (select 1 from public.crm_payroll_runs r where r.id = run_id and r.status = 'draft'));

create table if not exists public.crm_candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 200),
  phone text,
  email text,
  role text,
  source text,
  stage text not null default 'Applied' check (stage in ('Applied', 'Interview', 'Offer', 'Joined', 'Rejected')),
  cv_path text,
  notes text,
  checklist jsonb not null default '{}'::jsonb,
  staff_id uuid references public.crm_staff (id),
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
alter table public.crm_candidates enable row level security;
create policy crm_candidates_all on public.crm_candidates for all to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

-- ---------------------------------------------------------------- deals and commission
create table if not exists public.crm_developers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 200),
  basis text not null default 'aed' check (basis in ('aed', 'units')),
  period_start date,
  period_end date,
  slabs jsonb not null default '[]'::jsonb,           -- [{ "from": 0, "pct": 4 }, { "from": 20000000, "pct": 5 }]
  pay_days int not null default 60 check (pay_days between 0 and 365),
  notes text,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
alter table public.crm_developers enable row level security;
create policy crm_developers_select on public.crm_developers for select to authenticated using ((select private.is_active()));
create policy crm_developers_insert on public.crm_developers for insert to authenticated with check ((select private.is_finance()));
create policy crm_developers_update on public.crm_developers for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  deal_no bigint generated always as identity,
  deal_type text not null check (deal_type in ('secondary', 'offplan', 'rental', 'holiday_home', 'referral')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'invoiced', 'part_received', 'received', 'agents_paid', 'cancelled', 'rejected')),
  lead_id uuid,
  owner_id bigint,
  developer_id uuid references public.crm_developers (id),
  client_name text not null check (char_length(client_name) between 1 and 200),
  client_phone text,
  community text,
  cluster text,
  unit text,
  deal_date date not null default private.today_dubai(),
  price numeric(14, 2) check (price is null or price >= 0),               -- sale price, or yearly rent
  commission_pct numeric(6, 3),
  commission numeric(14, 2) not null default 0 check (commission >= 0),    -- before VAT
  seller_fee numeric(14, 2) not null default 0 check (seller_fee >= 0),    -- before VAT
  other_agency text,
  other_agency_direction text check (other_agency_direction is null or other_agency_direction in ('we_pay', 'they_pay')),
  other_agency_amount numeric(14, 2) not null default 0 check (other_agency_amount >= 0),
  -- 5% VAT on top, kept separate for the FTA and never split.
  vat numeric(14, 2) generated always as (round((commission + seller_fee) * 0.05, 2)) stored,
  office_commission numeric(14, 2) generated always as
    (commission + seller_fee - case when other_agency_direction = 'we_pay' then other_agency_amount else 0 end) stored,
  payment_method text check (payment_method is null or payment_method in ('bank', 'cheque', 'cash', 'mortgage', 'mixed')),
  cash_amount numeric(14, 2) not null default 0 check (cash_amount >= 0),
  goaml_status text not null default 'not_needed' check (goaml_status in ('not_needed', 'needed', 'reported')),
  goaml_ref text,
  expected_on date,
  received numeric(14, 2) not null default 0,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  check (other_agency_direction is distinct from 'we_pay' or other_agency_amount <= commission + seller_fee)
);
create index if not exists crm_deals_status_idx on public.crm_deals (status, deal_date desc);
create index if not exists crm_deals_created_by_idx on public.crm_deals (lower(created_by));
alter table public.crm_deals enable row level security;

create table if not exists public.crm_deal_splits (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_deals (id),
  kind text not null default 'agent' check (kind in ('agent', 'team_leader')),
  email text not null,
  share_pct numeric(6, 3) not null default 100 check (share_pct between 0 and 100),   -- the agent's part of the deal
  rate_pct numeric(6, 3) check (rate_pct is null or rate_pct between 0 and 100),      -- their own commission rate / TL override
  amount numeric(14, 2) not null default 0,
  paid numeric(14, 2) not null default 0
);
create unique index if not exists crm_deal_splits_one on public.crm_deal_splits (deal_id, kind, lower(email));
create index if not exists crm_deal_splits_email_idx on public.crm_deal_splits (lower(email));
alter table public.crm_deal_splits enable row level security;

create table if not exists public.crm_deal_payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_deals (id),
  kind text not null check (kind in ('received', 'payout', 'other_agency')),
  email text,                                         -- payout: who was paid
  amount numeric(14, 2) not null check (amount <> 0),
  paid_on date not null default private.today_dubai(),
  method text,
  note text,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  check (kind <> 'payout' or email is not null)
);
create index if not exists crm_deal_payments_deal_idx on public.crm_deal_payments (deal_id);
alter table public.crm_deal_payments enable row level security;

-- Policy helpers run as the owner, so the deal and split policies can look at each other without recursion.
create or replace function private.deal_is_mine(p_deal uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and (
    exists (select 1 from public.crm_deals d where d.id = p_deal
              and (lower(d.created_by) = private.current_email() or private.in_my_team(d.created_by)))
    or exists (select 1 from public.crm_deal_splits s where s.deal_id = p_deal
                 and (lower(s.email) = private.current_email() or private.in_my_team(s.email))))
$$;

create or replace function private.deal_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_finance() or private.has_perm('approve_deals') or private.has_perm('compliance')
$$;

-- The person who submitted a deal can still correct it until it is approved.
create or replace function private.deal_editable(p_deal uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crm_deals d where d.id = p_deal and d.status in ('pending', 'rejected')
                   and lower(d.created_by) = private.current_email()) and private.is_active()
$$;

-- The submitter's own check reads the row itself (not a lookup), so "insert … returning" works for a new deal.
create policy crm_deals_select on public.crm_deals for select to authenticated
  using ((select private.deal_staff())
         or ((select private.is_active()) and (lower(created_by) = (select private.current_email()) or private.in_my_team(created_by)))
         or private.deal_is_mine(id));
create policy crm_deals_insert on public.crm_deals for insert to authenticated
  with check ((select private.is_active()) and lower(created_by) = (select private.current_email())
              and status = 'pending' and received = 0 and approved_by is null);
create policy crm_deals_update on public.crm_deals for update to authenticated
  using ((select private.is_finance()) or (select private.has_perm('approve_deals')) or (select private.has_perm('compliance'))
         or ((select private.is_active()) and lower(created_by) = (select private.current_email()) and status in ('pending', 'rejected')))
  with check ((select private.is_finance()) or (select private.has_perm('approve_deals')) or (select private.has_perm('compliance'))
              or (lower(created_by) = (select private.current_email()) and status in ('pending', 'cancelled')));

-- Agents see only their own commission line (team leaders: their team's). Finance and approvers see every line.
create policy crm_deal_splits_select on public.crm_deal_splits for select to authenticated
  using ((select private.is_finance()) or (select private.has_perm('approve_deals'))
         or ((select private.is_active()) and (lower(email) = (select private.current_email()) or private.in_my_team(email))));
create policy crm_deal_splits_insert on public.crm_deal_splits for insert to authenticated
  with check ((select private.is_finance())
              or (private.deal_editable(deal_id) and kind = 'agent' and rate_pct is null and paid = 0));
create policy crm_deal_splits_update on public.crm_deal_splits for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));
create policy crm_deal_splits_delete on public.crm_deal_splits for delete to authenticated
  using (paid = 0 and ((select private.is_finance()) or private.deal_editable(deal_id)));

create policy crm_deal_payments_select on public.crm_deal_payments for select to authenticated
  using ((select private.is_finance())
         or ((select private.is_active()) and kind = 'payout' and lower(email) = (select private.current_email())));
create policy crm_deal_payments_insert on public.crm_deal_payments for insert to authenticated
  with check ((select private.is_finance()));
-- Payments are never edited or deleted: a mistake is corrected with a second entry (negative amount).

-- Commission split, in the agreed order:
--   office commission = commission before VAT, minus the other agency's share
--   each agent        = their % of the deal × their own rate
--   company share     = what is left
--   team leader       = their override % of the company share that came from their own agents
create or replace function private.recalc_deal(p_deal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_office numeric;
begin
  select office_commission into v_office from public.crm_deals where id = p_deal;
  if v_office is null then return; end if;

  update public.crm_deal_splits s
     set rate_pct = coalesce((select st.commission_rate from public.crm_staff st
                               where lower(st.email) = lower(s.email) and st.status = 'active' limit 1), 50)
   where s.deal_id = p_deal and s.kind = 'agent' and s.rate_pct is null;

  update public.crm_deal_splits s
     set amount = round(v_office * s.share_pct / 100 * s.rate_pct / 100, 2)
   where s.deal_id = p_deal and s.kind = 'agent';

  insert into public.crm_deal_splits (deal_id, kind, email, share_pct, rate_pct, amount)
  select distinct p_deal, 'team_leader', lower(u.team_leader), 0, st.tl_override_pct, 0
    from public.crm_deal_splits s
    join public.user_access u on lower(u.email) = lower(s.email)
    join public.crm_staff st on lower(st.email) = lower(u.team_leader) and st.status = 'active'
   where s.deal_id = p_deal and s.kind = 'agent' and u.team_leader is not null and st.tl_override_pct > 0
     and lower(u.team_leader) <> lower(s.email)
     and not exists (select 1 from public.crm_deal_splits x
                      where x.deal_id = p_deal and x.kind = 'team_leader' and lower(x.email) = lower(u.team_leader));

  update public.crm_deal_splits t
     set share_pct = coalesce(a.share, 0),
         amount = round(coalesce(a.company_part, 0) * coalesce(t.rate_pct, 0) / 100, 2)
    from (select t2.id, sum(s.share_pct) as share, sum(v_office * s.share_pct / 100 - s.amount) as company_part
            from public.crm_deal_splits t2
            left join public.user_access u on lower(u.team_leader) = lower(t2.email)
            left join public.crm_deal_splits s
                   on s.deal_id = p_deal and s.kind = 'agent' and lower(s.email) = lower(u.email)
           where t2.deal_id = p_deal and t2.kind = 'team_leader'
           group by t2.id) a
   where t.id = a.id;
end $$;

create or replace function private.deal_splits_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform private.recalc_deal(coalesce(new.deal_id, old.deal_id));
  return null;
end $$;
drop trigger if exists crm_deal_splits_recalc on public.crm_deal_splits;
create trigger crm_deal_splits_recalc after insert or update or delete on public.crm_deal_splits
  for each row execute function private.deal_splits_changed();

-- Cash of AED 55,000 or more must be reported on goAML.
create or replace function private.deal_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cash_amount >= 55000 and new.goaml_status = 'not_needed' then new.goaml_status := 'needed'; end if;
  if new.cash_amount < 55000 and new.goaml_status = 'needed' then new.goaml_status := 'not_needed'; end if;
  if tg_op = 'UPDATE' and not (private.is_finance() or private.has_perm('approve_deals')) then
    -- The submitter may correct a pending deal, but money already received and approval marks are not theirs to set.
    new.received := old.received; new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    if not private.has_perm('compliance') then new.goaml_ref := old.goaml_ref; end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_deal_before_write on public.crm_deals;
create trigger crm_deal_before_write before insert or update on public.crm_deals
  for each row execute function private.deal_before_write();

create or replace function private.deal_money_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform private.recalc_deal(new.id);
  return null;
end $$;
drop trigger if exists crm_deal_recalc on public.crm_deals;
create trigger crm_deal_recalc after update of commission, seller_fee, other_agency_amount, other_agency_direction on public.crm_deals
  for each row execute function private.deal_money_changed();

-- Money in and agent payouts move the deal along: Part received → Fully received → Agents paid.
create or replace function private.deal_payment_added() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.crm_deals; v_received numeric; v_due numeric; v_owed numeric; v_paid numeric;
begin
  select * into d from public.crm_deals where id = new.deal_id for update;
  if d.status in ('pending', 'rejected', 'cancelled') then
    raise exception 'Payments can only be recorded on an approved deal';
  end if;
  select coalesce(sum(amount), 0) into v_received from public.crm_deal_payments where deal_id = new.deal_id and kind = 'received';
  update public.crm_deal_splits s
     set paid = coalesce((select sum(p.amount) from public.crm_deal_payments p
                           where p.deal_id = s.deal_id and p.kind = 'payout' and lower(p.email) = lower(s.email)), 0)
   where s.deal_id = new.deal_id;
  select coalesce(sum(amount), 0), coalesce(sum(paid), 0) into v_owed, v_paid from public.crm_deal_splits where deal_id = new.deal_id;
  -- What the client or developer owes us: our own invoice (commission + VAT). When the other agency collects,
  -- "commission" is already our agreed share.
  v_due := d.commission + d.seller_fee + d.vat;
  update public.crm_deals
     set received = v_received,
         status = case when v_received >= v_due and v_due > 0 and v_paid >= v_owed then 'agents_paid'
                       when v_received >= v_due and v_due > 0 then 'received'
                       when v_received > 0 then 'part_received'
                       when exists (select 1 from public.crm_invoices i where i.deal_id = d.id and i.status <> 'cancelled') then 'invoiced'
                       else 'approved' end
   where id = new.deal_id;
  return null;
end $$;

-- ---------------------------------------------------------------- compliance: KYC before a deal is approved
create table if not exists public.crm_kyc (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_deals (id),
  party text not null check (party in ('buyer', 'seller', 'tenant', 'landlord')),
  full_name text,
  nationality text,
  id_type text check (id_type is null or id_type in ('Emirates ID', 'Passport', 'Trade licence')),
  id_number text,
  id_expiry date,
  id_file text,
  source_of_funds text,
  sanctions_checked boolean not null default false,
  sanctions_note text,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  completed_by text,
  completed_at timestamptz,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  unique (deal_id, party)
);
alter table public.crm_kyc enable row level security;
create policy crm_kyc_select on public.crm_kyc for select to authenticated
  using ((select private.deal_staff()) or private.deal_is_mine(deal_id));
-- The agent fills in the details and uploads the ID; only the compliance officer marks it complete.
create policy crm_kyc_insert on public.crm_kyc for insert to authenticated
  with check ((select private.has_perm('compliance')) or (private.deal_editable(deal_id) and status = 'pending'));
create policy crm_kyc_update on public.crm_kyc for update to authenticated
  using ((select private.has_perm('compliance')) or (private.deal_editable(deal_id) and status = 'pending'))
  with check ((select private.has_perm('compliance')) or (private.deal_editable(deal_id) and status = 'pending'));

create or replace function private.kyc_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then
    if coalesce(trim(new.full_name), '') = '' or coalesce(trim(new.id_number), '') = '' or new.id_file is null
       or coalesce(trim(new.source_of_funds), '') = '' or not new.sanctions_checked then
      raise exception 'KYC needs the name, ID number, ID copy, source of funds and the sanctions check before it can be completed';
    end if;
    new.completed_by := private.current_email(); new.completed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists crm_kyc_before_write on public.crm_kyc;
create trigger crm_kyc_before_write before insert or update on public.crm_kyc
  for each row execute function private.kyc_before_write();

-- Which KYC a deal needs, and what is still missing (empty = ready for approval).
create or replace function private.kyc_missing(p_deal uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(need.party order by need.party), '{}')
    from public.crm_deals d
    cross join lateral unnest(case d.deal_type when 'secondary' then array['buyer', 'seller']
                                               when 'offplan' then array['buyer']
                                               when 'rental' then array['tenant', 'landlord']
                                               else '{}'::text[] end) as need(party)
   where d.id = p_deal
     and not exists (select 1 from public.crm_kyc k where k.deal_id = d.id and k.party = need.party and k.status = 'complete')
$$;

-- ---------------------------------------------------------------- accounts
-- Tax invoice numbers must run in order with no gaps, so they come from a counter row (rolled back with a failed
-- insert), not a sequence, and are given out by the database only.
create table if not exists private.crm_counters (name text primary key, value bigint not null default 0);
revoke all on private.crm_counters from public, anon, authenticated;

create table if not exists public.crm_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  deal_id uuid references public.crm_deals (id),
  bill_to text not null check (char_length(bill_to) between 1 and 300),
  bill_to_address text,
  bill_to_trn text,
  issue_date date not null default private.today_dubai(),
  due_date date,
  lines jsonb not null default '[]'::jsonb,           -- [{ "description": "...", "amount": 1000 }] before VAT
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) generated always as (subtotal + vat) stored,
  paid numeric(14, 2) not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'part_paid', 'paid', 'cancelled')),
  notes text,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
create index if not exists crm_invoices_date_idx on public.crm_invoices (issue_date desc);
alter table public.crm_invoices enable row level security;
create policy crm_invoices_select on public.crm_invoices for select to authenticated using ((select private.is_finance()));
create policy crm_invoices_insert on public.crm_invoices for insert to authenticated with check ((select private.is_finance()));
create policy crm_invoices_update on public.crm_invoices for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

create or replace function private.invoice_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n bigint; y text := to_char(coalesce(new.issue_date, private.today_dubai()), 'YYYY');
begin
  if not private.is_finance() then raise exception 'Only Accounts can issue invoices'; end if;
  insert into private.crm_counters as c (name, value) values ('invoice-' || y, 1)
    on conflict (name) do update set value = c.value + 1 returning value into n;
  new.invoice_no := 'INV-' || y || '-' || lpad(n::text, 4, '0');
  return new;
end $$;
drop trigger if exists crm_invoice_before_insert on public.crm_invoices;
create trigger crm_invoice_before_insert before insert on public.crm_invoices for each row execute function private.invoice_before_insert();

create or replace function private.invoice_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deal_id is not null and new.status <> 'cancelled' then
    update public.crm_deals set status = 'invoiced' where id = new.deal_id and status = 'approved';
  end if;
  return null;
end $$;
drop trigger if exists crm_invoice_added on public.crm_invoices;
create trigger crm_invoice_added after insert on public.crm_invoices for each row execute function private.invoice_added();

drop trigger if exists crm_deal_payment_added on public.crm_deal_payments;
create trigger crm_deal_payment_added after insert on public.crm_deal_payments
  for each row execute function private.deal_payment_added();

create table if not exists public.crm_bills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  category text not null default 'Other',
  vendor text,
  amount numeric(14, 2) not null default 0 check (amount >= 0),   -- before VAT
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  frequency text not null default 'monthly' check (frequency in ('once', 'monthly', 'quarterly', 'yearly')),
  next_due date not null,
  remind_days int not null default 7 check (remind_days between 0 and 90),
  active boolean not null default true,
  notes text,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
alter table public.crm_bills enable row level security;
create policy crm_bills_select on public.crm_bills for select to authenticated using ((select private.is_finance()));
create policy crm_bills_insert on public.crm_bills for insert to authenticated with check ((select private.is_finance()));
create policy crm_bills_update on public.crm_bills for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

create table if not exists public.crm_expenses (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'expense' check (kind in ('expense', 'advance')),
  expense_date date not null default private.today_dubai(),
  category text not null default 'Other',
  vendor text,
  description text check (description is null or char_length(description) <= 2000),
  amount numeric(14, 2) not null check (amount > 0),              -- before VAT
  vat numeric(14, 2) not null default 0 check (vat >= 0),
  total numeric(14, 2) generated always as (amount + vat) stored,
  receipt_path text,
  staff_email text,                                               -- advance: who receives it
  recovered numeric(14, 2) not null default 0 check (recovered >= 0),
  bill_id uuid references public.crm_bills (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index if not exists crm_expenses_date_idx on public.crm_expenses (expense_date desc);
create index if not exists crm_expenses_submitter_idx on public.crm_expenses (lower(submitted_by));
alter table public.crm_expenses enable row level security;
create policy crm_expenses_select on public.crm_expenses for select to authenticated
  using ((select private.is_finance()) or (select private.has_perm('approve_expenses'))
         or ((select private.is_active()) and ((select private.current_email()) in (lower(submitted_by), lower(staff_email)))));
create policy crm_expenses_insert on public.crm_expenses for insert to authenticated
  with check ((select private.is_active()) and lower(submitted_by) = (select private.current_email())
              and (status = 'pending' or (select private.is_finance())) and recovered = 0);
create policy crm_expenses_update on public.crm_expenses for update to authenticated
  using ((select private.is_finance()) or (lower(submitted_by) = (select private.current_email()) and status = 'pending'))
  with check ((select private.is_finance()) or (lower(submitted_by) = (select private.current_email()) and status = 'pending' and recovered = 0));

create table if not exists public.crm_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  bank text,
  iban text,
  opening_balance numeric(14, 2) not null default 0,
  opening_date date,
  layout jsonb,                                      -- remembered statement columns: { date, description, amount | debit + credit, balance }
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now()
);
alter table public.crm_bank_accounts enable row level security;
create policy crm_bank_accounts_select on public.crm_bank_accounts for select to authenticated using ((select private.is_finance()));
create policy crm_bank_accounts_insert on public.crm_bank_accounts for insert to authenticated with check ((select private.is_finance()));
create policy crm_bank_accounts_update on public.crm_bank_accounts for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

create table if not exists public.crm_bank_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_bank_accounts (id),
  line_date date not null,
  description text,
  amount numeric(14, 2) not null,                    -- money in is positive, money out negative
  balance numeric(14, 2),
  hash text not null,                                -- stops the same statement line being imported twice
  match_kind text check (match_kind is null or match_kind in ('deal', 'invoice', 'expense', 'payout', 'payroll', 'transfer', 'other')),
  match_id text,
  note text,
  imported_by text not null default private.current_email(),
  imported_at timestamptz not null default now(),
  unique (account_id, hash)
);
create index if not exists crm_bank_lines_date_idx on public.crm_bank_lines (account_id, line_date desc);
alter table public.crm_bank_lines enable row level security;
create policy crm_bank_lines_select on public.crm_bank_lines for select to authenticated using ((select private.is_finance()));
create policy crm_bank_lines_insert on public.crm_bank_lines for insert to authenticated with check ((select private.is_finance()));
create policy crm_bank_lines_update on public.crm_bank_lines for update to authenticated
  using ((select private.is_finance())) with check ((select private.is_finance()));

-- ---------------------------------------------------------------- listings
create sequence if not exists public.crm_listing_seq start 1001;
create or replace function private.next_listing_ref() returns text
language sql volatile security definer set search_path = '' as $$
  select 'URE-' || nextval('public.crm_listing_seq')::text
$$;

create table if not exists public.crm_listings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default private.next_listing_ref(),
  owner_id bigint,
  community text,
  cluster text,
  unit text,
  purpose text not null default 'sale' check (purpose in ('sale', 'rent')),
  property_type text,
  bedrooms text,
  bathrooms numeric(4, 1),
  bua_sqft numeric(12, 2),
  plot_sqft numeric(12, 2),
  price numeric(14, 2) check (price is null or price >= 0),
  title text check (title is null or char_length(title) <= 200),
  description text check (description is null or char_length(description) <= 6000),
  agent_email text not null default private.current_email(),
  permit_no text,                                    -- Trakheesi
  permit_expiry date,
  form_a_path text,
  photos jsonb not null default '[]'::jsonb,
  portals jsonb not null default '{"property_finder": true, "bayut": true, "website": true}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'pending', 'live', 'unpublished', 'sold', 'rented')),
  published_at timestamptz,
  closed_at timestamptz,
  created_by text not null default private.current_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_listings_status_idx on public.crm_listings (status, permit_expiry);
create index if not exists crm_listings_owner_idx on public.crm_listings (owner_id);
alter table public.crm_listings enable row level security;
create policy crm_listings_select on public.crm_listings for select to authenticated
  using ((select private.is_admin()) or (select private.has_perm('approve_listings'))
         or ((select private.is_sales()) and (status = 'live' or (select private.current_email()) in (lower(agent_email), lower(created_by))
                                               or private.in_my_team(agent_email))));
create policy crm_listings_insert on public.crm_listings for insert to authenticated
  with check ((select private.is_sales()) and lower(created_by) = (select private.current_email()) and status in ('draft', 'pending'));
-- Agents edit their own listing but only an approver can make it live.
create policy crm_listings_update on public.crm_listings for update to authenticated
  using ((select private.has_perm('approve_listings'))
         or ((select private.is_sales()) and (select private.current_email()) in (lower(agent_email), lower(created_by))))
  with check ((select private.has_perm('approve_listings'))
              or ((select private.current_email()) in (lower(agent_email), lower(created_by)) and status <> 'live'));

-- What must be true before a listing goes live. Empty = ready.
create or replace function private.listing_blockers(p_listing uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when coalesce(trim(l.permit_no), '') = '' then 'Trakheesi permit number is missing' end,
    case when l.permit_expiry is null or l.permit_expiry < private.today_dubai() then 'Trakheesi permit has expired or has no expiry date' end,
    case when l.form_a_path is null then 'Signed Form A is not uploaded' end,
    case when l.price is null or l.price <= 0 then 'Price is missing' end,
    case when not exists (select 1 from public.crm_staff s join public.crm_staff_documents d on d.staff_id = s.id
                           where lower(s.email) = lower(l.agent_email) and d.doc_type = 'RERA broker card (BRN)'
                             and d.expiry_date >= private.today_dubai())
         then 'The agent has no RERA broker card (BRN) in date on their staff record' end
  ], null)
  from public.crm_listings l where l.id = p_listing
$$;

create or replace function public.crm_listing_blockers(p_listing uuid) returns text[]
language sql stable security invoker set search_path = '' as $$
  select case when exists (select 1 from public.crm_listings l where l.id = p_listing)   -- the caller's own access applies here
              then private.listing_blockers(p_listing) end
$$;

create or replace function private.listing_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live') then new.published_at := now(); end if;
  if new.status in ('sold', 'rented') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.closed_at := now(); end if;
  -- The owner's history shows "listed with us", then "sold/rented by us".
  if new.owner_id is not null and new.status in ('live', 'sold', 'rented') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.owner_activities (owner_id, activity_type, details, created_by)
    values (new.owner_id::text,
            case new.status when 'live' then 'Listed with us' when 'sold' then 'Sold by us' else 'Rented by us' end,
            new.ref || case when new.price is not null then ' · AED ' || trim(to_char(new.price, 'FM999,999,999,990')) else '' end
              || case new.purpose when 'rent' then ' (for rent)' else ' (for sale)' end,
            private.current_email());
  end if;
  return new;
end $$;
drop trigger if exists crm_listing_before_write on public.crm_listings;
create trigger crm_listing_before_write before insert or update on public.crm_listings
  for each row execute function private.listing_before_write();

-- The portals and the website read this without a login. Only adverts that are live with a permit in date, and
-- only what is published anyway: no owner, no unit number, no documents.
create or replace function public.crm_listings_feed()
returns table (ref text, purpose text, property_type text, community text, cluster text, bedrooms text, bathrooms numeric,
               bua_sqft numeric, plot_sqft numeric, price numeric, title text, description text, permit_no text,
               photos jsonb, portals jsonb, agent_name text, agent_email text, agent_phone text, agent_brn text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.ref, l.purpose, l.property_type, l.community, l.cluster, l.bedrooms, l.bathrooms, l.bua_sqft, l.plot_sqft, l.price,
         l.title, l.description, l.permit_no, l.photos, l.portals, s.full_name, lower(l.agent_email), s.phone,
         (select d.doc_number from public.crm_staff_documents d
           where d.staff_id = s.id and d.doc_type = 'RERA broker card (BRN)' order by d.expiry_date desc nulls last limit 1),
         l.updated_at
    from public.crm_listings l
    left join public.crm_staff s on lower(s.email) = lower(l.agent_email)
   where l.status = 'live' and l.permit_expiry >= private.today_dubai()
   order by l.published_at desc nulls last
$$;
revoke all on function public.crm_listings_feed() from public;
grant execute on function public.crm_listings_feed() to anon, authenticated;

-- Run daily: adverts whose Trakheesi permit ran out come off the portals (the feed already leaves them out).
create or replace function public.crm_unpublish_expired_listings() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.crm_listings set status = 'unpublished' where status = 'live' and permit_expiry < private.today_dubai();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.crm_unpublish_expired_listings() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'crm-unpublish-expired-listings';
    perform cron.schedule('crm-unpublish-expired-listings', '5 20 * * *', 'select public.crm_unpublish_expired_listings()');  -- 00:05 Dubai
  end if;
end $$;

-- ---------------------------------------------------------------- approvals: checks before, status sync after
create or replace function private.approval_before_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare miss text[]; tot numeric;
begin
  if new.status <> 'approved' or old.status = 'approved' then return new; end if;
  if new.kind = 'deal' and new.ref_table = 'crm_deals' then
    miss := private.kyc_missing(new.ref_id::uuid);
    if cardinality(miss) > 0 then
      raise exception 'KYC is not complete for this deal (%). Complete it in Compliance first.', array_to_string(miss, ', ');
    end if;
    select sum(share_pct) into tot from public.crm_deal_splits where deal_id = new.ref_id::uuid and kind = 'agent';
    if tot is not null and tot <> 100 then
      raise exception 'The agents'' shares of this deal add up to %, not 100', trim(to_char(tot, '990.99'));
    end if;
  elsif new.kind = 'listing' and new.ref_table = 'crm_listings' then
    miss := private.listing_blockers(new.ref_id::uuid);
    if cardinality(miss) > 0 then raise exception 'This listing cannot go live yet: %', array_to_string(miss, '; '); end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_approval_before_decision on public.crm_approvals;
create trigger crm_approval_before_decision before update on public.crm_approvals
  for each row execute function private.approval_before_decision();

create or replace function private.approval_after_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = old.status or new.status not in ('approved', 'rejected', 'withdrawn') then return null; end if;
  if new.ref_table = 'crm_deals' then
    update public.crm_deals
       set status = case new.status when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end,
           approved_by = case when new.status = 'approved' then new.decided_by end,
           approved_at = case when new.status = 'approved' then new.decided_at end
     where id = new.ref_id::uuid and status = 'pending';
  elsif new.ref_table = 'crm_expenses' then
    update public.crm_expenses
       set status = case when new.status = 'approved' then 'approved' else 'rejected' end,
           decided_by = new.decided_by, decided_at = new.decided_at
     where id = new.ref_id::uuid and status = 'pending';
  elsif new.ref_table = 'crm_leave' then
    update public.crm_leave
       set status = case new.status when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end
     where id = new.ref_id::uuid and status = 'pending';
  elsif new.ref_table = 'crm_listings' then
    update public.crm_listings set status = case when new.status = 'approved' then 'live' else 'draft' end
     where id = new.ref_id::uuid and status = 'pending';
  end if;
  return null;
end $$;
drop trigger if exists crm_approval_after_decision on public.crm_approvals;
create trigger crm_approval_after_decision after update on public.crm_approvals
  for each row execute function private.approval_after_decision();

-- ---------------------------------------------------------------- files
-- company-docs: private (ID copies, receipts, Form A, staff documents, CVs). The first folder says what it is.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-docs', 'company-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists company_docs_insert on storage.objects;
create policy company_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-docs' and (select private.is_active())
              and (storage.foldername(name))[1] in ('kyc', 'receipts', 'hr', 'cv', 'listings'));
drop policy if exists company_docs_select on storage.objects;
create policy company_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'company-docs' and (select private.is_active()) and (
    owner = (select auth.uid()) or (select private.is_admin())
    or ((storage.foldername(name))[1] = 'kyc' and (select private.deal_staff()))
    or ((storage.foldername(name))[1] = 'receipts' and ((select private.is_finance()) or (select private.has_perm('approve_expenses'))))
    or ((storage.foldername(name))[1] in ('hr', 'cv') and (select private.is_hr()))
    or ((storage.foldername(name))[1] = 'listings' and (select private.has_perm('approve_listings')))));

-- listing-media: public photos for the portals and the website. Only active sales staff can upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-media', 'listing-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists listing_media_insert on storage.objects;
create policy listing_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-media' and (select private.is_sales()));

-- ---------------------------------------------------------------- change history and grants
do $$
declare t text;
begin
  foreach t in array array['crm_company_settings', 'crm_staff', 'crm_staff_documents', 'crm_leave', 'crm_payroll_runs', 'crm_payroll_lines',
                           'crm_candidates', 'crm_developers', 'crm_deals', 'crm_deal_splits', 'crm_kyc', 'crm_invoices', 'crm_bills',
                           'crm_expenses', 'crm_bank_accounts', 'crm_bank_lines', 'crm_listings'] loop
    execute format('drop trigger if exists crm_log_change on public.%I', t);
    execute format('create trigger crm_log_change after update or delete on public.%I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on public.crm_deal_payments from anon;
grant select, insert on public.crm_deal_payments to authenticated;
grant delete on public.crm_deal_splits, public.crm_staff_documents, public.crm_payroll_lines, public.crm_candidates to authenticated;
revoke all on sequence public.crm_listing_seq from anon, authenticated;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
grant execute on function public.crm_listing_blockers(uuid) to authenticated;
