-- Listings: the Trakheesi permit number is enough (Usama, 13 Nov 2026).
-- A Trakheesi permit is only issued on a signed Form A, so "Signed Form A" and "Permit valid until" are no longer
-- asked for. The permit_expiry and form_a_path columns stay (old data kept); they are just not required any more.
-- Also: an agent can delete their own draft or unpublished listing (there was no way to delete a listing before).

-- 1. What must be true before a listing goes live: permit number, price, agent's BRN in date.
create or replace function private.listing_blockers(p_listing uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when coalesce(trim(l.permit_no), '') = '' then 'Trakheesi permit number is missing' end,
    case when l.price is null or l.price <= 0 then 'Price is missing' end,
    case when not exists (select 1 from public.crm_staff s join public.crm_staff_documents d on d.staff_id = s.id
                           where lower(s.email) = lower(l.agent_email) and d.doc_type = 'RERA broker card (BRN)'
                             and d.expiry_date >= private.today_dubai())
         then 'The agent has no RERA broker card (BRN) in date on their staff record' end
  ], null)
  from public.crm_listings l where l.id = p_listing
$$;

-- 2. Feed: a listing sent to Property Finder or Bayut needs a permit number (and, where an old expiry date was
-- entered, it must not have passed). Website-only listings may still show without a permit (decision of 13 Nov).
create or replace function public.crm_listings_feed()
returns table(ref text, purpose text, property_type text, community text, cluster text, bedrooms text, bathrooms numeric, bua_sqft numeric,
              plot_sqft numeric, price numeric, title text, description text, permit_no text, photos jsonb, portals jsonb, agent_name text,
              agent_email text, agent_phone text, agent_brn text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.ref, l.purpose, l.property_type, l.community, l.cluster, l.bedrooms, l.bathrooms, l.bua_sqft, l.plot_sqft, l.price,
         l.title, l.description, l.permit_no, l.photos, l.portals, s.full_name, lower(l.agent_email), s.phone,
         (select d.doc_number from public.crm_staff_documents d
           where d.staff_id = s.id and d.doc_type = 'RERA broker card (BRN)' order by d.expiry_date desc nulls last limit 1),
         l.updated_at
    from public.crm_listings l
    left join public.crm_staff s on lower(s.email) = lower(l.agent_email)
   where l.status = 'live'
     and ((coalesce(trim(l.permit_no), '') <> '' and (l.permit_expiry is null or l.permit_expiry >= private.today_dubai()))
          or (coalesce(l.portals ->> 'property_finder', 'true') = 'false' and coalesce(l.portals ->> 'bayut', 'true') = 'false'))
   order by l.published_at desc nulls last
$$;
revoke all on function public.crm_listings_feed() from public;
grant execute on function public.crm_listings_feed() to anon, authenticated;

-- 3. Delete: only drafts and unpublished listings, by their agent / creator or by someone who approves listings.
grant delete on public.crm_listings to authenticated;
drop policy if exists crm_listings_delete on public.crm_listings;
create policy crm_listings_delete on public.crm_listings for delete to authenticated
  using (status in ('draft', 'unpublished')
         and ((select private.has_perm('approve_listings'))
              or ((select private.is_sales()) and (select private.current_email()) in (lower(agent_email), lower(created_by)))));
