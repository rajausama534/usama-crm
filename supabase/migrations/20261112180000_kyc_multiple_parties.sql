-- More than one KYC per party on a deal: joint buyers (husband and wife), two sellers, co-tenants, two landlords.
-- Each person is a row numbered party_no 1..4 within its party. A party is ready only when it has at least one row
-- and every one of its rows is complete.

alter table public.crm_kyc add column if not exists party_no smallint not null default 1;
alter table public.crm_kyc drop constraint if exists crm_kyc_party_no_check;
alter table public.crm_kyc add constraint crm_kyc_party_no_check check (party_no between 1 and 4);
alter table public.crm_kyc drop constraint if exists crm_kyc_deal_id_party_key;
alter table public.crm_kyc drop constraint if exists crm_kyc_deal_id_party_party_no_key;
alter table public.crm_kyc add constraint crm_kyc_deal_id_party_party_no_key unique (deal_id, party, party_no);

-- Which KYC a deal still needs (empty = ready for approval).
create or replace function private.kyc_missing(p_deal uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(need.party order by need.party), '{}')
    from public.crm_deals d
    cross join lateral unnest(case d.deal_type when 'secondary' then array['buyer', 'seller']
                                               when 'offplan' then array['buyer']
                                               when 'rental' then array['tenant', 'landlord']
                                               else '{}'::text[] end) as need(party)
   where d.id = p_deal
     and (not exists (select 1 from public.crm_kyc k where k.deal_id = d.id and k.party = need.party)
          or exists (select 1 from public.crm_kyc k where k.deal_id = d.id and k.party = need.party and k.status <> 'complete'))
$$;

-- An extra person added by mistake (party_no 2..4, still pending) can be removed by whoever may edit the KYC.
-- The first row of each party stays: it is opened with the deal.
drop policy if exists crm_kyc_delete on public.crm_kyc;
create policy crm_kyc_delete on public.crm_kyc for delete to authenticated
  using (party_no > 1 and status = 'pending' and ((select private.has_perm('compliance')) or private.deal_editable(deal_id)));
grant delete on public.crm_kyc to authenticated;
