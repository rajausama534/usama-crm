"""Build supabase/manual/07_cluster_guide_research.sql from data/cluster-research/pf-raw.jsonl.

pf-raw.jsonl holds what Claude read from each project's Propertyfinder new-projects page (checked 4 Nov 2026):
sales start, planned delivery, payment plan, floor plans per bedroom type (name + area) and the "from" price per
bedroom type (the launch price list for sold-out Emaar projects). Joy and Spring have no Propertyfinder page;
their rows come from broker pages and are marked unverified.

Per cluster this writes: launch_date (text) + launch_on (date, drives the "first recorded sales" price),
handover_date, payment_plan, layouts (one row per bedroom type x layout), launch_prices (one row per bedroom type),
total_units when published, the Propertyfinder source and an open-questions note. Existing Emaar sources are kept.
Re-runnable: upserts on (name, community).
"""
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "cluster-research" / "pf-raw.jsonl"
OUT = ROOT / "supabase" / "manual" / "07_cluster_guide_research.sql"
CHECKED = "2026-11-04"
TODAY = dt.date(2026, 11, 4)
VALLEY = {"Alana", "Avena", "Avena 2", "Eden", "Elea", "Elora", "Elva", "Farm Gardens", "Farm Gardens 2", "Farm Grove",
          "Farm Grove 2", "Kaia", "Lillia", "Nara", "Nima", "Orania", "Rivana", "Rivera", "Talia", "Velora", "Velora 2",
          "Venera", "Vindera"}
# Sales-start dates that look like Propertyfinder placeholders: shown, but not used for the first-sales window.
DOUBTFUL_START = {"Bliss 2", "Elie Saab II", "June 2"}
NOISE = {"type", "mirrored", "unit", "villa", "townhouse", "plex", "end", "middle", "the"}
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}


def style_of(name):
    """'Type B Lilac Mirrored' -> 'Lilac'; 'Bold, Type A' -> 'Bold'; 'Type 4B' -> '' (plan variant only)."""
    words = [w for w in re.split(r"[\s,\-/]+", name or "") if w]
    keep = [w for w in words if re.fullmatch(r"[A-Za-z]{3,}", w) and w.lower() not in NOISE]
    if any(w.lower() in ("end", "middle") for w in words) and not keep:
        keep = ["End unit" if "end" in (w.lower() for w in words) else "Middle unit"]
    return " ".join(w if w.isupper() is False else w.title() for w in keep).replace("May bell", "May Bell").strip()


def size_groups(plans, gap=0.03):
    """Group plan variants whose areas are within 3% of each other."""
    groups = []
    for p in sorted(plans, key=lambda p: p["area"] or 0):
        if groups and p["area"] and groups[-1][-1]["area"] and p["area"] <= groups[-1][-1]["area"] * (1 + gap):
            groups[-1].append(p)
        else:
            groups.append([p])
    return groups


def layouts_for(rec):
    rows = []
    styles_seen = []
    for t in rec["types"]:
        for p in t["layouts"]:
            s = style_of(p["name"])
            if s and s not in styles_seen:
                styles_seen.append(s)
    styles_seen = styles_seen or rec.get("styles") or []
    for t in rec["types"]:
        b = str(t["bedrooms"])
        plans = [p for p in t["layouts"] if p.get("area")]
        named = {}
        for p in plans:
            s = style_of(p["name"])
            if s:
                named.setdefault(s, []).append(p["area"])
        if named:
            for s, areas in named.items():
                rows.append({"bedrooms": b, "name": s, "bua_min_sqft": min(areas), "bua_max_sqft": max(areas)})
        elif plans:
            groups = size_groups(plans)
            if len(groups) == 1:
                types = sorted({re.sub(r"(?i)\bmirrored\b", "", p["name"]).strip() for p in plans}, key=lambda x: (len(x), x))
                areas = [p["area"] for p in plans]
                rows.append({"bedrooms": b, "name": "Standard", "bua_min_sqft": min(areas), "bua_max_sqft": max(areas),
                             "note": f"{len(types)} floor plan{'s' if len(types) > 1 else ''}: {', '.join(types)}"})
            else:
                for g in groups:
                    types = sorted({re.sub(r"(?i)\bmirrored\b", "", p["name"]).strip() for p in g}, key=lambda x: (len(x), x))
                    areas = [p["area"] for p in g]
                    rows.append({"bedrooms": b, "name": " / ".join(types), "bua_min_sqft": min(areas), "bua_max_sqft": max(areas)})
        elif styles_seen:
            # Bedroom type listed without plans: offer the cluster's styles with the bedroom type's size range.
            for s in styles_seen:
                rows.append({"bedrooms": b, "name": s, "bua_min_sqft": t.get("area_from") or 0, "bua_max_sqft": t.get("area_to") or 0})
        elif t.get("area_from"):
            rows.append({"bedrooms": b, "name": "Standard", "bua_min_sqft": t["area_from"], "bua_max_sqft": t["area_to"]})
        for r in rows:
            if r["bedrooms"] == b and t.get("plot"):
                r["plot_min_sqft"], r["plot_max_sqft"] = t["plot"]
    for r in rows:
        r["bua_sqft"] = round((r["bua_min_sqft"] + r["bua_max_sqft"]) / 2) if r.get("bua_min_sqft") else 0
    return rows


def handover_text(delivery):
    d = (delivery or "").strip()
    if not d:
        return ""
    if "completed" in d.lower():
        return d
    m = re.match(r"(?i)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:\d{1,2},\s*)?(\d{4})", d)
    q = re.match(r"(?i)q([1-4])\s+(\d{4})", d)
    if m:
        when = dt.date(int(m.group(2)), MONTHS[m.group(1).lower()], 1)
        label = f"{m.group(1)[:3].title()} {m.group(2)}"
    elif q:
        when = dt.date(int(q.group(2)), int(q.group(1)) * 3, 1)
        label = f"Q{q.group(1)} {q.group(2)}"
    else:
        return d
    return f"{label} (planned)"


def plan_text(rec):
    lines = []
    for p in rec["payment_plan"]:
        lines.append(f"{p['percent']}% {p['phase'][0].lower() + p['phase'][1:]}" if p.get("percent") is not None else p["phase"])
    if rec.get("payment_plan_alt"):
        lines.append(rec["payment_plan_alt"])
    return "\n".join(lines)


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


rows = []
for line in RAW.read_text().splitlines():
    rec = json.loads(line)
    name = rec["cluster"]
    community = "The Valley" if name in VALLEY else "Arabian Ranches 3"
    start = rec.get("sales_start")
    launch_text = dt.date.fromisoformat(start).strftime("%b %Y") if start else rec.get("launch_text", "")
    launch_on = start if start and name not in DOUBTFUL_START else None
    layouts = layouts_for(rec)
    prices = [{"bedrooms": str(t["bedrooms"]), "aed": t["starting_price"],
               "source": "Launch price list (Propertyfinder project page)", "url": f"https://www.propertyfinder.ae/en/new-projects/emaar-properties/{rec['slug']}"}
              for t in rec["types"] if t.get("starting_price")]
    if rec.get("slug"):
        src = {"label": "Propertyfinder new-projects page", "url": f"https://www.propertyfinder.ae/en/new-projects/emaar-properties/{rec['slug']}",
               "checked": CHECKED, "fields": ["sales start", "planned handover", "payment plan", "floor plans and sizes", "launch prices per bedroom type"]}
    else:
        src = {"label": f"Broker page ({rec['source']})", "url": rec["source_url"], "checked": CHECKED,
               "fields": ["launch year", "handover", "payment plan", "design styles"]}
    notes = []
    if rec.get("note"):
        notes.append(rec["note"])
    if name in DOUBTFUL_START:
        notes.append("Launch date not used for the first-sales price.")
    notes.append("Sizes are Emaar plan areas (they can differ from DLD-recorded areas).")
    rows.append("(" + ",".join([
        q(name), q(community), q(launch_text), q(launch_on) + "::date", q(handover_text(rec.get("delivery"))), q(plan_text(rec)),
        q(json.dumps(layouts)) + "::jsonb", q(json.dumps(prices)) + "::jsonb", str(int(rec.get("total_units") or 0)),
        q(json.dumps([src])) + "::jsonb", q(" ".join(notes)),
    ]) + ")")

sql = f"""-- Cluster Guide research for The Valley and Arabian Ranches 3 (checked {CHECKED}). Generated by
-- scripts/cluster_guide_research.py from data/cluster-research/pf-raw.jsonl. Re-runnable.
-- Keeps existing Emaar sources and replaces any earlier Propertyfinder / broker source.
with r(name, community, launch_date, launch_on, handover_date, payment_plan, layouts, launch_prices, total_units, sources, notes) as (values
{(','+chr(10)).join(rows)}
), ins as (
  insert into public.cluster_guides (name, community, developer, launch_date, launch_on, handover_date, payment_plan, layouts, launch_prices,
                                     total_units, sources, open_questions, research_checked_on, verified_on, updated_by)
  select r.name, r.community, 'Emaar Properties', r.launch_date, r.launch_on, r.handover_date, r.payment_plan, r.layouts, r.launch_prices,
         r.total_units, r.sources, r.notes, '{CHECKED}'::date, '{CHECKED}'::date, 'claude-research'
  from r
  on conflict ((lower(name)), (lower(community))) do update set
    launch_date = excluded.launch_date, launch_on = excluded.launch_on, handover_date = excluded.handover_date,
    payment_plan = excluded.payment_plan, layouts = excluded.layouts, launch_prices = excluded.launch_prices,
    total_units = case when excluded.total_units > 0 then excluded.total_units else public.cluster_guides.total_units end,
    sources = coalesce((select jsonb_agg(s) from jsonb_array_elements(coalesce(public.cluster_guides.sources, '[]'::jsonb)) s
                        where s ->> 'label' not like 'Propertyfinder%' and s ->> 'label' not like 'Broker page%'), '[]'::jsonb) || excluded.sources,
    open_questions = excluded.open_questions, research_checked_on = excluded.research_checked_on,
    updated_by = 'claude-research', updated_at = now()
  returning id
)
select count(*) as guides_written from ins;
"""
OUT.write_text(sql)
print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} clusters")
