"""Build supabase/manual/05_cluster_guide_seed.sql: The Valley cluster guides from verified sources only.
- Emaar official project pages (checked 19 Oct 2026): bedrooms, property type, design styles, listed starting price,
  and for Farm Gardens the published plot range.
- DLD open-data sales Jan-Oct 2026 (data/dld-size-ranges-2026.json): recorded area range per bedroom type.
Fields not published by either source stay empty and are listed in open_questions. Re-runnable (skips existing names).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DLD = json.load(open(ROOT / "data" / "dld-size-ranges-2026.json"))
E = "https://www.emaar.com/en/properties/"
# name: (bedrooms, type, styles, start_price_aed, slug, extra)
OFFICIAL = {
    "Eden": ([3, 4], "Villas", "Three architectural styles", None, "eden", {}),
    "Nara": ([3, 4, 5], "Townhouses / villas", "Three contemporary designs (3 and 4-bed single-row townhouses)", None, "nara", {}),
    "Talia": ([3, 4], "Townhouses", "Three contemporary designs", None, "talia", {}),
    "Orania": ([3, 4, 5], "Villas", "Two styles: Bold and Sleek", None, "orania-at-the-valley", {}),
    "Farm Gardens": ([4, 5], "Villas", "Two exterior design schemes", None, "the-farm-gardens", {"plot": (8000, 10000)}),
    "Farm Gardens 2": ([4, 5], "Villas", "Two styles", 7_260_000, "farm-gardens-2", {}),
    "Farm Grove": ([4, 5], "Villas", None, 4_800_000, "farm-grove-at-the-valley", {}),
    "Alana": ([3, 4, 5], "Twin villas", "Two styles", 3_500_000, "alana", {}),
    "Rivana": ([3, 4, 5], "Twin villas", "Two styles: Kai and Clara", 2_800_000, "rivana", {}),
    "Nima": ([3, 4], "Townhouses", "Two styles", 2_100_000, "nima", {}),
    "Elora": ([3, 4], "Townhouses", "Two styles: Moon and Mysk", 1_600_000, "elora", {}),
    "Lillia": ([3, 4], "Townhouses", "Two styles", 2_000_000, "lillia", {}),
    "Velora": ([3, 4], "Townhouses", None, 2_480_000, "velora-at-the-valley", {}),
    "Velora 2": ([3, 4], "Townhouses", None, 2_930_000, "velora-2-at-the-valley-phase-2", {}),
    "Vindera": ([3, 4], "Townhouses", None, 3_170_000, "vindera-at-the-valley", {}),
    "Elea": ([3, 4], "Homes", None, 2_990_000, "elea-at-the-valley", {}),
    "Kaia": ([3, 4], "Homes", "Two façade options", 2_720_000, "kaia-at-the-valley", {}),
    "Elva": ([3, 4], "Townhouses", "Two façade options", 2_890_000, "elva-at-the-valley", {}),
    "Avena": ([4], "Villas", "Three façade styles", 4_360_000, "avena-at-the-valley", {}),
    "Venera": ([3, 4], "Townhouses", None, 2_480_000, "venera-at-the-valley", {}),
    "Avena 2": (None, None, None, None, None, {}),
    "Rivera": (None, None, None, None, None, {}),
    "Farm Grove 2": (None, None, None, None, None, {}),
}


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


rows = []
for name, (beds, ptype, styles, price, slug, extra) in OFFICIAL.items():
    dld = DLD.get(f"The Valley|{name}", [])
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
        if extra.get("plot"):
            cfg.update({"plot_min_sqft": extra["plot"][0], "plot_max_sqft": extra["plot"][1]})
        if land:
            cfg.update({"dld_plot_min_sqft": land[0]["min"], "dld_plot_max_sqft": land[0]["max"], "dld_plot_sales": land[0]["n"]})
        mix.append(cfg)
    sources = []
    if slug:
        sources.append({"label": "Emaar official project page", "url": E + slug, "checked": "2026-10-19",
                        "fields": ["developer", "bedrooms", "property type", "design styles"] + (["listed starting price"] if price else []) + (["plot range"] if extra.get("plot") else [])})
    if dld:
        sources.append({"label": "Dubai Land Department open data — sales 1 Jan–19 Oct 2026", "url": "https://dubailand.gov.ae/en/open-data/real-estate-data/",
                        "checked": "2026-10-19", "fields": ["recorded area ranges per bedroom type" if built else "recorded plot range"]})
    missing = ["launch date", "handover date", "total units"] + ([] if beds else ["bedroom types (official page not found)"])
    rows.append("(" + ",".join([
        q(name), "'The Valley'", "'Emaar Properties'", q(ptype), q(styles or ""),
        q(f"Emaar listed starting price AED {price:,} (checked 19 Oct 2026; not necessarily the original launch price)" if price else None),
        q(json.dumps(mix)) + "::jsonb", q(json.dumps(sources)) + "::jsonb", "'2026-10-19'",
        q("Not published on the official page, so left empty: " + ", ".join(missing) + "."),
        "0",
    ]) + ")")

sql = """-- Cluster Guide seed for The Valley (verified sources only; re-runnable).
insert into public.cluster_guides (name, community, developer, development_type, usp, original_price_note, unit_mix, sources, verified_on, open_questions, total_units)
values
""" + ",\n".join(rows) + """
on conflict (lower(name), lower(community)) do nothing;
"""
(ROOT / "supabase" / "manual" / "05_cluster_guide_seed.sql").write_text(sql)
print(len(rows), "clusters")
