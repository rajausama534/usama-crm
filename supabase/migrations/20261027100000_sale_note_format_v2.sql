-- Sale notes in the format Usama asked for on 27 Oct 2026:  4BR 4.5M Dec-2026 4500 sq ft
-- (developer-only properties are summarised separately as "4BR - 4500sq ft").
-- Applied in the SQL editor on 27 Oct 2026 together with the DXB Interact update; kept here so the repo matches the database.
-- Sale note builder in the new format (used by DXBinteract imports and the reformat helpers):
--    4BR 4.5M Dec-2026 4500 sq ft   (bedrooms / size left out when unknown)
create or replace function private.crm_sale_note(beds text, amount numeric, sold_on date, size_sqft numeric)
returns text language sql immutable set search_path = '' as $$
  select concat_ws(' ',
           (regexp_match(coalesce(beds, ''), '(\d+)'))[1] || 'BR',
           case when amount >= 1000000 then trim(trailing '.' from trim(trailing '0' from to_char(round(amount / 1000000, 2), 'FM9999990.00'))) || 'M'
                when amount >= 1000 then trim(trailing '.' from trim(trailing '0' from to_char(round(amount / 1000, 1), 'FM9999990.0'))) || 'K'
                else to_char(amount, 'FM999,999,990') end,
           to_char(sold_on, 'Mon-YYYY'),
           case when size_sqft > 0 then round(size_sqft)::text || ' sq ft' end)
$$;

-- Old line "4BR SOLD 7.05M Aug-2026, size 6,444 sq ft" -> "4BR 7.05M Aug-2026 6444 sq ft" (other text kept).
create or replace function private.crm_old_sale_to_new(txt text, fb_beds text default null, fb_size numeric default null)
returns text language plpgsql immutable set search_path = '' as $$
declare m text[]; out text := txt; g int := 0; p int; rep text;
begin
  loop
    g := g + 1; exit when g > 50;
    m := regexp_match(out, '((?:(\d+)BR )?SOLD ([\d.]+[MK]) ([A-Z][a-z]{2}-\d{4})(?:, size ([\d,]+) sq ft)?)');
    exit when m is null;
    rep := concat_ws(' ', coalesce(m[2], (regexp_match(coalesce(fb_beds, ''), '(\d+)'))[1]) || 'BR', m[3], m[4],
                     coalesce(replace(m[5], ',', ''), round(fb_size)::text) || ' sq ft');
    p := position(m[1] in out);
    out := left(out, p - 1) || rep || substr(out, p + length(m[1]));
  end loop;
  return out;
end $$;

