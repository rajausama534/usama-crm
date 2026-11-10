-- Speed: the bunty_reader_* rules called private.is_bunty_reader() once per ROW (it has SET search_path, so
-- Postgres can't inline it). On owners (30k rows) that cost ~0.6 s per search, for every user, because the
-- restrictive insert/update/delete rules apply to everyone. Wrapping the call in (select ...) makes Postgres
-- run it once per query. Same true/false result, same access: nothing about who can do what changes.
-- Measured on live owners search (rolled back test): 663 ms -> 49 ms.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and policyname like 'bunty_reader_%'
  loop
    if p.policyname = 'bunty_reader_select' then
      execute format('alter policy %I on %I.%I using ((select private.is_bunty_reader()))',
                     p.policyname, p.schemaname, p.tablename);
    elsif p.policyname = 'bunty_reader_insert' then
      execute format('alter policy %I on %I.%I with check (not (select private.is_bunty_reader()))',
                     p.policyname, p.schemaname, p.tablename);
    elsif p.policyname = 'bunty_reader_update' then
      execute format('alter policy %I on %I.%I using (not (select private.is_bunty_reader())) with check (not (select private.is_bunty_reader()))',
                     p.policyname, p.schemaname, p.tablename);
    elsif p.policyname = 'bunty_reader_delete' then
      execute format('alter policy %I on %I.%I using (not (select private.is_bunty_reader()))',
                     p.policyname, p.schemaname, p.tablename);
    end if;
  end loop;
end $$;
