-- Merge duplicate owner rows that are the SAME PERSON on the SAME UNIT (approved 20 Oct 2026).
-- Same person = all words of the shorter name appear in the longer name, or the same phone number.
-- Different people on one unit (joint / previous owners) are left alone.
-- Keeper = the most recently worked row (status set, contacted, remarks or manual notes); if none was worked,
--          the newest row (highest id = latest import).
-- Keeper gets: the fullest name, missing phones filled from the others, empty remarks filled; differing
--          remarks are kept as a note. All notes / logs of removed rows are moved to the keeper.
-- Every removed row is copied to owners_merged_20261020 first, so the merge can be reversed.

create table if not exists public.owner_merge_plan (
  keep_id bigint not null,
  remove_id bigint primary key,
  community text, cluster text, unit text,
  keep_owner text, remove_owner text,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.owner_merge_plan enable row level security;

create table if not exists public.owners_merged_20261020 (like public.owners including all);
alter table public.owners_merged_20261020 add column if not exists merged_into bigint;
alter table public.owners_merged_20261020 add column if not exists merged_at timestamptz default now();
alter table public.owners_merged_20261020 enable row level security;

create or replace function private.name_words(s text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct w), '{}') from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(s, ''), '[^a-zA-Z ]', ' ', 'g')), '\s+')) w
  where length(w) > 1
$$;

create or replace function private.build_owner_merge_plan() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  g record; ids bigint[]; parent bigint[]; i int; j int; ri record; rj record; n int := 0;
  rows_ jsonb; comp jsonb; k bigint;
begin
  delete from public.owner_merge_plan;
  for g in
    select community, cluster, unit from public.owners
    where community is not null and cluster is not null and coalesce(unit, '') <> ''
    group by 1, 2, 3 having count(*) > 1
  loop
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'words', to_jsonb(private.name_words(o.owner)),
             'p1', public.crm_norm_phone(o.phone1), 'p2', public.crm_norm_phone(o.phone2),
             'worked', (coalesce(nullif(o.status, ''), 'New') not in ('New', '-') or o.last_contacted is not null
                        or coalesce(o.admin_remarks, '') <> '' or coalesce(o.agent_remarks, '') <> ''
                        or exists (select 1 from public.owner_activities a where a.owner_id = o.id::text
                                   and coalesce(a.created_by, '') not in ('dld-import', 'alana-repair', 'dxbinteract-import'))),
             'last', greatest(o.last_contacted::timestamptz,
                              (select max(a.created_at) from public.owner_activities a where a.owner_id = o.id::text
                               and coalesce(a.created_by, '') not in ('dld-import', 'alana-repair', 'dxbinteract-import'))))
           order by o.id)
      into rows_
      from public.owners o where o.community = g.community and o.cluster = g.cluster and o.unit = g.unit;
    -- union-find over "same person" pairs
    parent := array(select (r ->> 'id')::bigint from jsonb_array_elements(rows_) r);
    ids := parent;
    for i in 0 .. jsonb_array_length(rows_) - 1 loop
      for j in i + 1 .. jsonb_array_length(rows_) - 1 loop
        if (
             (jsonb_array_length(rows_ -> i -> 'words') > 0 and jsonb_array_length(rows_ -> j -> 'words') > 0 and
              ((rows_ -> i -> 'words') <@ (rows_ -> j -> 'words') or (rows_ -> j -> 'words') <@ (rows_ -> i -> 'words')))
             or (coalesce(rows_ -> i ->> 'p1', '') <> '' and (rows_ -> i ->> 'p1') in (rows_ -> j ->> 'p1', rows_ -> j ->> 'p2'))
             or (coalesce(rows_ -> i ->> 'p2', '') <> '' and (rows_ -> i ->> 'p2') in (rows_ -> j ->> 'p1', rows_ -> j ->> 'p2'))
           ) then
          -- merge components: relabel every member of j's component to i's root
          k := parent[j + 1];
          for ri in select generate_subscripts(parent, 1) s loop
            if parent[ri.s] = k then parent[ri.s] := parent[i + 1]; end if;
          end loop;
        end if;
      end loop;
    end loop;
    -- for each component with >1 member choose the keeper
    for ri in select distinct unnest(parent) root loop
      select jsonb_agg(r order by (r ->> 'worked')::boolean desc, (r ->> 'last') desc nulls last, (r ->> 'id')::bigint desc)
        into comp
        from jsonb_array_elements(rows_) r where parent[array_position(ids, (r ->> 'id')::bigint)] = ri.root;
      if jsonb_array_length(comp) > 1 then
        k := (comp -> 0 ->> 'id')::bigint;
        insert into public.owner_merge_plan (keep_id, remove_id, community, cluster, unit, reason)
        select k, (c ->> 'id')::bigint, g.community, g.cluster, g.unit,
               case when (comp -> 0 ->> 'worked')::boolean then 'kept most recently worked row' else 'kept newest row' end
        from jsonb_array_elements(comp) c where (c ->> 'id')::bigint <> k;
        n := n + jsonb_array_length(comp) - 1;
      end if;
    end loop;
  end loop;
  update public.owner_merge_plan p set keep_owner = o.owner from public.owners o where o.id = p.keep_id;
  update public.owner_merge_plan p set remove_owner = o.owner from public.owners o where o.id = p.remove_id;
  return n;
end $$;

create or replace function private.apply_owner_merge_plan() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k record; moved int := 0; removed int := 0; best text; ph1 text; ph2 text; rem record;
begin
  for k in select keep_id, array_agg(remove_id) rm from public.owner_merge_plan group by keep_id loop
    -- fullest name among the same person's rows
    select o.owner into best from public.owners o where o.id = k.keep_id or o.id = any(k.rm)
      order by array_length(private.name_words(o.owner), 1) desc nulls last, length(coalesce(o.owner, '')) desc limit 1;
    -- phones: keep keeper's, fill blanks from the others (newest first)
    select coalesce(nullif(kp.phone1, ''), (select o.phone1 from public.owners o where o.id = any(k.rm) and coalesce(o.phone1, '') <> '' order by o.id desc limit 1)),
           coalesce(nullif(kp.phone2, ''), (select o.phone2 from public.owners o where o.id = any(k.rm) and coalesce(o.phone2, '') <> '' and o.phone2 is distinct from kp.phone1 order by o.id desc limit 1))
      into ph1, ph2 from public.owners kp where kp.id = k.keep_id;
    update public.owners o set
      owner = coalesce(best, o.owner),
      phone1 = ph1,
      phone2 = case when ph2 is not distinct from ph1 then o.phone2 else ph2 end,
      admin_remarks = coalesce(nullif(o.admin_remarks, ''), (select x.admin_remarks from public.owners x where x.id = any(k.rm) and coalesce(x.admin_remarks, '') <> '' order by x.id desc limit 1)),
      agent_remarks = coalesce(nullif(o.agent_remarks, ''), (select x.agent_remarks from public.owners x where x.id = any(k.rm) and coalesce(x.agent_remarks, '') <> '' order by x.id desc limit 1)),
      remarks = coalesce(nullif(o.remarks, ''), (select x.remarks from public.owners x where x.id = any(k.rm) and coalesce(x.remarks, '') <> '' order by x.id desc limit 1)),
      email = coalesce(nullif(o.email, ''), (select x.email from public.owners x where x.id = any(k.rm) and coalesce(x.email, '') <> '' order by x.id desc limit 1)),
      last_contacted = greatest(o.last_contacted, (select max(x.last_contacted) from public.owners x where x.id = any(k.rm)))
    where o.id = k.keep_id;
    -- remarks that differ from the keeper's are kept as a note on the keeper
    for rem in select x.id, x.owner, nullif(x.admin_remarks, '') ar, nullif(x.agent_remarks, '') gr, nullif(x.remarks, '') r
               from public.owners x where x.id = any(k.rm) loop
      insert into public.owner_activities (owner_id, activity_type, details, created_by)
      select k.keep_id::text, 'Merged note', 'From merged duplicate (' || coalesce(rem.owner, '-') || '): ' || t, 'owner-merge'
      from unnest(array[rem.ar, rem.gr, rem.r]) t
      where t is not null
        and t not in (select coalesce(admin_remarks, '') from public.owners where id = k.keep_id
                      union select coalesce(agent_remarks, '') from public.owners where id = k.keep_id
                      union select coalesce(remarks, '') from public.owners where id = k.keep_id);
    end loop;
    -- notes and WhatsApp logs follow the keeper
    update public.owner_activities set owner_id = k.keep_id::text where owner_id = any(select x::text from unnest(k.rm) x);
    get diagnostics moved = row_count;
    update public.whatsapp_broadcast_log set owner_id = k.keep_id::text where owner_id = any(select x::text from unnest(k.rm) x);
    -- back up, then remove
    insert into public.owners_merged_20261020 select o.*, k.keep_id, now() from public.owners o where o.id = any(k.rm) on conflict do nothing;
    delete from public.owners o where o.id = any(k.rm)
      and exists (select 1 from public.owners_merged_20261020 b where b.id = o.id);
    get diagnostics removed = row_count;
  end loop;
  return jsonb_build_object('backed_up', (select count(*) from public.owners_merged_20261020), 'owners_now', (select count(*) from public.owners));
end $$;
revoke all on function private.build_owner_merge_plan(), private.apply_owner_merge_plan() from public, anon, authenticated;
