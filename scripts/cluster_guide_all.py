"""Build supabase/manual/06_cluster_guide_all.sql: a guide for every CRM cluster outside The Valley.
Verified sources only: developer per community, Emaar official project pages (Arabian Ranches III, checked
20 Oct 2026) and DLD open-data recorded areas (data/dld-size-ranges-2026.json). Missing facts stay empty."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLUSTERS = json.load(open(ROOT / "data" / "crm-clusters.json"))
DLD = json.load(open(ROOT / "data" / "dld-size-ranges-2026.json"))
DEV = {"Arabian Ranches 1": "Emaar Properties", "Arabian Ranches 2": "Emaar Properties", "Arabian Ranches 3": "Emaar Properties",
       "Emaar South": "Emaar Properties", "The Oasis": "Emaar Properties", "Mudon": "Dubai Properties", "Tilal Al Ghaf": "Majid Al Futtaim"}
E = "https://www.emaar.com/en/properties/"
# AR3 official facts: (bedrooms, type, styles, start price, slug, total units, note)
AR3 = {
    "Anya": ([3, 4], "Townhouses", "Contemporary townhouses", 2_010_000, "anya", None, None),
    "May": ([3, 4], "Townhouses", None, 2_370_000, "may", None, None),
    "Spring": ([3, 4], "Townhouses and villas", "Two modern contemporary designs", None, "spring", None, None),
    "Bliss 2": ([3, 4], "Villas", "3BR duplex, 4BR duplex or 4BR triplex", None, "bliss-2", 269, None),
    "Caya": ([3, 4, 5], "Standalone villas", "Contemporary standalone villas", None, "caya-2", None,
             "A second Emaar page (/caya) lists 1–4 bedroom apartments for a project of the same name; the Arabian Ranches III page (/caya-2) says 3–5 bedroom standalone villas, which is used here."),
    "Joy": ([3, 4], "Townhouses", None, None, "joy", None, None),
    "Ruba": ([3, 4], "Townhouses", "Three collections", None, "ruba", None, None),
    "Sun": ([3, 4], "Townhouses", "Two colour schemes", None, "sun", None, None),
    "Bliss": ([3, 4], "Townhouses", "Modern neoclassical", None, "bliss", None, None),
    "Raya": ([3, 4], "Townhouses", None, None, "raya", None, None),
    "June": ([4, 5], "Villas", "Contemporary", None, "june", None, None),
}
REPORTED = {  # trade-press reports, kept as notes only (not official developer pages)
    ("Tilal Al Ghaf", "Elysian Mansions"): "Trade press (Feb 2024) reports 94 waterfront villas with 5–6 bedrooms; not confirmed on an official developer page.",
    ("Tilal Al Ghaf", "Alaya"): "Trade press (Jan 2024) reports 130 villas; one other source says 407, so the total is unconfirmed.",
}


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


rows = []
for community, names in CLUSTERS.items():
    if community == "The Valley":
        continue
    for name in names:
        beds, ptype, styles, price, slug, units, note = AR3.get(name, (None,) * 7) if community == "Arabian Ranches 3" else (None,) * 7
        dld = DLD.get(f"{community}|{name}", [])
        land = [d for d in dld if d["prop_type"] == "Land"]
        built = {d["rooms"]: d for d in dld if d["prop_type"] == "Building" and d["rooms"]}
        bed_list = beds or sorted({int(r.split()[0]) for r in built if r.split()[0].isdigit()})
        mix = []
        for b in bed_list:
            d = built.get(f"{b} B/R")
            cfg = {"bedrooms": f"{b}", "unit_type": ptype or (d["sub_type"] if d else ""), "units": 0, "layouts": [], "layout_count": 0,
                   "bua_min_sqft": 0, "bua_max_sqft": 0, "plot_min_sqft": 0, "plot_max_sqft": 0, "op_min_aed": 0, "op_max_aed": 0}
            if d:
                cfg.update({"dld_area_min_sqft": d["min"], "dld_area_max_sqft": d["max"], "dld_sales": d["n"]})
            if land:
                cfg.update({"dld_plot_min_sqft": land[0]["min"], "dld_plot_max_sqft": land[0]["max"], "dld_plot_sales": land[0]["n"]})
            mix.append(cfg)
        if not mix and land:
            mix.append({"bedrooms": "", "unit_type": "Plots", "units": 0, "layouts": [], "layout_count": 0, "bua_min_sqft": 0, "bua_max_sqft": 0,
                        "plot_min_sqft": 0, "plot_max_sqft": 0, "op_min_aed": 0, "op_max_aed": 0,
                        "dld_plot_min_sqft": land[0]["min"], "dld_plot_max_sqft": land[0]["max"], "dld_plot_sales": land[0]["n"]})
        sources = []
        if slug:
            sources.append({"label": "Emaar official project page", "url": E + slug, "checked": "2026-10-20",
                            "fields": ["bedrooms", "property type"] + (["design"] if styles else []) + (["listed starting price"] if price else []) + (["total units"] if units else [])})
        if dld:
            sources.append({"label": "Dubai Land Department open data — sales 1 Jan–19 Oct 2026", "url": "https://dubailand.gov.ae/en/open-data/real-estate-data/",
                            "checked": "2026-10-19", "fields": ["recorded area ranges per bedroom type" if built else "recorded plot range"]})
        missing = ["launch date", "handover date"] + ([] if units else ["total units"]) + ([] if (beds or built) else ["bedroom types"])
        oq = "Not published by the sources used, so left empty: " + ", ".join(missing) + "."
        extra = " ".join(x for x in [note, REPORTED.get((community, name))] if x)
        rows.append("(" + ",".join([
            q(name), q(community), q(DEV.get(community)), q(ptype), q(styles or ""),
            q(f"Emaar listed starting price AED {price:,} (checked 20 Oct 2026; not necessarily the original launch price)" if price else None),
            q(json.dumps(mix)) + "::jsonb", q(json.dumps(sources)) + "::jsonb", "'2026-10-20'", q((oq + " " + extra).strip()), str(units or 0),
        ]) + ")")

sql = """-- Cluster Guide for every CRM community outside The Valley (verified sources only; re-runnable).
insert into public.cluster_guides (name, community, developer, development_type, usp, original_price_note, unit_mix, sources, verified_on, open_questions, total_units)
values
""" + ",\n".join(rows) + """
on conflict (lower(name), lower(community)) do nothing;
"""
(ROOT / "supabase" / "manual" / "06_cluster_guide_all.sql").write_text(sql)
print(len(rows), "clusters")
