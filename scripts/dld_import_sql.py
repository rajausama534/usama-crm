"""Build the SQL that loads DLD sales into the CRM (run it in the Supabase SQL editor).

  python3 scripts/dld_import_sql.py dld.jsonl matches.json out.sql

1. dld_transactions: every DLD sale whose project maps to exactly ONE CRM community/cluster.
   The project must name the community (e.g. "The Valley - Alana", "Arabian Ranches lll - Caya");
   a bare cluster name such as "Spring" elsewhere in Dubai is never attached.
2. property_transactions + one standard note per owner row: only the verified unit matches from
   dld_match.py, and only when the unit exists exactly once in that CRM cluster.
Everything uses ON CONFLICT / NOT EXISTS, so the script can be re-run safely.
"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dld_match import norm, SQM_TO_SQFT  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CLUSTERS = json.load(open(ROOT / "data" / "crm-clusters.json"))
HINTS = {  # the DLD project text must mention the community
    "The Valley": ["thevalley"], "Arabian Ranches 1": ["arabianranches"], "Arabian Ranches 2": ["arabianranches", "arii"],
    "Arabian Ranches 3": ["arabianranches", "arabainranches"], "The Oasis": ["oasis"], "Mudon": ["mudon"],
    "Tilal Al Ghaf": ["tilalalghaf"], "Emaar South": ["emaarsouth", "expogolf"],
}
LABELS = {}
for community, names in CLUSTERS.items():
    for name in names:
        LABELS.setdefault(norm(name), []).append((community, name))


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def crm_target(project):
    p = project or ""
    flat = re.sub(r"[^a-z0-9]", "", p.lower())
    parts = re.split(r"\s*-\s*", p, maxsplit=1)
    tail = parts[1] if len(parts) == 2 else ""
    keys = {norm(p), norm(tail), norm(re.sub(r"^mudon\s+", "", p, flags=re.I))} - {""}
    hits = {hit for k in keys for hit in LABELS.get(k, []) if any(h in flat for h in HINTS[hit[0]])}
    return hits.pop() if len(hits) == 1 else None


def money_text(amount):
    if amount >= 1_000_000:
        return f"AED {amount / 1_000_000:.2f}".rstrip("0").rstrip(".") + "M"
    return f"AED {amount:,.0f}"


def main(dld_path, matches_path, out_path):
    rows = [json.loads(l) for l in open(dld_path)]
    out = ["begin;"]
    values = []
    for r in rows:
        target = crm_target(r.get("PROJECT_EN"))
        if not target:
            continue
        area = r.get("ACTUAL_AREA") or r.get("PROCEDURE_AREA")
        values.append("(" + ",".join([q(r["TRANSACTION_NUMBER"]), q(r["INSTANCE_DATE"][:10]), q(r.get("PROCEDURE_EN")),
                         "true" if r.get("IS_OFFPLAN") == 1 else "false", q(r.get("PROP_TYPE_EN")), q(r.get("PROP_SB_TYPE_EN")),
                         q(r.get("ROOMS_EN")), str(r["TRANS_VALUE"]), str(area) if area else "null",
                         str(round(area * SQM_TO_SQFT)) if area else "null", q(r.get("AREA_EN")), q(r.get("PROJECT_EN")),
                         q(target[0]), q(target[1])]) + ")")
    mapped = len(values)
    out.append("insert into public.dld_transactions (transaction_number, transaction_date, procedure, is_offplan, property_type, "
               "property_sub_type, rooms, amount, area_sqm, area_sqft, dld_area, dld_project, crm_community, crm_cluster) values\n"
               + ",\n".join(values) + "\non conflict (transaction_number) do nothing;")

    matches = json.load(open(matches_path))["matched"]
    linked = 0
    for m in matches:
        target = LABELS.get(norm(m["cluster"]), [])
        target = [t for t in target if t[0] == m["community"]]
        if len(target) != 1:
            continue  # e.g. "Palmiera" in a report vs Palmiera 1/2/3 in the CRM: phase unknown, skip
        community, cluster = target[0]
        n = int(m["unit"])
        area_label = "Plot" if m["area_type"] == "plot" else "Area"
        date_text = __import__("datetime").date.fromisoformat(m["transaction_date"]).strftime("%-d %b %Y")
        note = f"Sold {money_text(m['amount'])} — {date_text}" + (f" — {area_label} {m['area_sqft']:,} sq ft" if m["area_sqft"] else "")
        unit_rows = f"from public.owners o where o.community = {q(community)} and o.cluster = {q(cluster)} and private.unit_number(o.unit) = {n}"
        # Only link when the CRM has exactly one unit label for this number in this cluster.
        out.append(
            "insert into public.property_transactions (community, cluster, unit, transaction_date, kind, amount, area_sqft, area_type, "
            "dld_transaction_number, source, match_method) "
            f"select {q(community)}, {q(cluster)}, min(o.unit), {q(m['transaction_date'])}, 'Sold', {m['amount']}, "
            f"{m['area_sqft'] or 'null'}, {q(m['area_type'])}, {q(m['dld_transaction_number'])}, {q(m['source_file'])}, "
            f"'report unit + DLD same cluster, date and price' {unit_rows} having count(distinct o.unit) = 1 "
            "and exists (select 1 from public.dld_transactions d where d.transaction_number = " + q(m["dld_transaction_number"]) + ") "
            "on conflict (dld_transaction_number) do nothing;")
        out.append(
            "insert into public.owner_activities (owner_id, activity_type, details, created_by) "
            f"select o.id::text, 'DLD Transaction', {q(note)}, 'dld-import' {unit_rows} "
            "and exists (select 1 from public.property_transactions p where p.dld_transaction_number = " + q(m["dld_transaction_number"]) + ") "
            f"and not exists (select 1 from public.owner_activities a where a.owner_id = o.id::text and a.details = {q(note)});")
        linked += 1
    out.append("select json_build_object('dld_transactions', (select count(*) from public.dld_transactions), "
               "'property_transactions', (select count(*) from public.property_transactions), "
               "'dld_notes', (select count(*) from public.owner_activities where created_by = 'dld-import'))::text as result;")
    out.append("commit;")
    Path(out_path).write_text("\n".join(out) + "\n")
    print(f"{mapped} DLD sales mapped to a CRM cluster; {linked} unit-level matches written to {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
