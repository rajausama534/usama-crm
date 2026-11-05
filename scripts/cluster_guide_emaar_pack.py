"""Build SQL that saves the Emaar agent-pack facts (data/cluster-research/emaar-pack.json) into public.cluster_guides.

Only fields present in the JSON are changed. Layouts are replaced; launch prices too, labelled with their source.
Afterwards every touched guide gets its units re-tagged by BUA and its stored stats refreshed.
Usage: python3 scripts/cluster_guide_emaar_pack.py > /tmp/emaar_pack.sql
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "data/cluster-research/emaar-pack.json").read_text())
CHECKED = "2026-11-05"
SOURCE = {"label": "Emaar agent pack (factsheet + floor plans)",
          "url": "https://www.dropbox.com/scl/fi/wjal2kqhieajq0yzxw5lh/AGENTS_PACK_LINKS.xlsx?rlkey=48mbu506g5yt5dn0cte112p26",
          "checked": CHECKED,
          "fields": ["layout / style names", "floor-plan sizes", "differences between types", "units",
                     "starting prices", "payment plan", "handover"]}


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def j(v):
    return q(json.dumps(v, ensure_ascii=False)) + "::jsonb"


out = ["begin;"]
for c in data["clusters"]:
    layouts = []
    for l in c["layouts"]:
        l = dict(l)
        if "bua_sqft" in l:
            l.setdefault("bua_min_sqft", l["bua_sqft"]); l.setdefault("bua_max_sqft", l["bua_sqft"])
        elif "bua_min_sqft" in l:
            l["bua_sqft"] = round((l["bua_min_sqft"] + l["bua_max_sqft"]) / 2)
        l["source"] = "Emaar agent pack"
        layouts.append(l)
    sets = [f"layouts = {j(layouts)}", f"research_checked_on = {q(CHECKED)}", "updated_by = 'claude-research'",
            "updated_at = now()",
            f"sources = (select coalesce(jsonb_agg(s), '[]'::jsonb) from jsonb_array_elements(coalesce(sources, '[]'::jsonb)) s"
            f" where s ->> 'label' <> {q(SOURCE['label'])}) || jsonb_build_array({j(SOURCE)})"]
    if "launch_prices" in c:
        lp = [{"bedrooms": p["bedrooms"], "aed": p["aed"],
               "source": p.get("source", "Emaar factsheet starting price (agent pack)")} for p in c["launch_prices"]]
        sets.append(f"launch_prices = {j(lp)}")
    for k in ("launch_on", "launch_date", "handover_date", "payment_plan", "usp", "open_questions"):
        if k in c:
            sets.append(f"{k} = {q(c[k])}")
    if "total_units" in c:
        sets.append(f"total_units = {int(c['total_units'])}")
    out.append(f"update public.cluster_guides set {', '.join(sets)}\n where community = {q(c['community'])} and lower(name) = lower({q(c['name'])});")

names = ", ".join(f"({q(c['community'])}, lower({q(c['name'])}))" for c in data["clusters"])
out.append(f"""select g.name, public.cluster_guide_tag_layouts(g.id) as tagged
  from public.cluster_guides g where (g.community, lower(g.name)) in ({names}) order by g.community, g.name;""")
out.append(f"""update public.cluster_guides g set stats = public.cluster_guide_stats(g.id), stats_refreshed_at = now()
 where (g.community, lower(g.name)) in ({names}) or g.stats is not null;""")
out.append("commit;")
print("\n".join(out))
