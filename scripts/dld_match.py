"""Match DLD open-data sales to specific CRM units, without guessing.

DLD's public data has no unit numbers. A sale is linked to a unit only when one of the
unit-numbered sales reports in data/ says "unit X sold for AED A on date D" and DLD has
exactly ONE sale in the same cluster on date D for exactly AED A. Anything ambiguous is skipped.

Usage: python3 scripts/dld_match.py dld.jsonl crm_units.json out.json
  crm_units.json: [{"community": ..., "cluster": ..., "unit": ...}, ...] (distinct CRM units)
"""
import collections, datetime as dt, json, re, sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
SQM_TO_SQFT = 10.7639


def money(s):
    return int(round(float(re.sub(r"[^\d.]", "", s))))


def day(s):
    return dt.datetime.strptime(s.strip(), "%d %b %Y").date()


def unit_key(u):
    nums = re.findall(r"\d+", str(u))
    return str(int(nums[-1])) if nums else ""


def norm(s):
    """Compare cluster names across sources: 'Elie Saab ll' (DLD) == 'Elie Saab 2' (reports)."""
    n = re.sub(r"[^a-z0-9]", "", str(s or "").lower()).replace("lll", "iii").replace("ll", "ii")
    n = re.sub(r"(?<=[a-z])ii$", "2", re.sub(r"(?<=[a-z])iii$", "3", n))
    return {"eliesaab": "eliesaab1"}.get(n, n)


# (community, cluster, file, parser) -> yields (unit, amount, date)
def simple(cols_unit, cols_amount, cols_date, cluster_col=None):
    def parse(line):
        p = line.split("|")
        return (p[cluster_col] if cluster_col is not None else None, p[cols_unit], money(p[cols_amount]), day(p[cols_date]))
    return parse


SOURCES = [
    ("The Valley", "Alana", ["alana-sales-transactions.txt"], simple(0, 1, 2)),
    ("The Valley", "Rivana", ["rivana-sales-transactions.txt"], simple(0, 1, 2)),
    ("The Valley", "Rivana", ["rivana-part-1.txt", "rivana-part-2.txt", "rivana-part-3.txt"], simple(0, 3, 4)),
    ("The Valley", "Farm Gardens 2", ["fg2-part-1.txt", "fg2-part-2.txt", "fg2-part-3.txt", "fg2-part-4.txt"], simple(0, 3, 4)),
    ("Arabian Ranches 3", "Caya", ["caya-latest-transactions.txt"], simple(0, 3, 4)),
    ("Arabian Ranches 3", None, ["elie-saab-latest-transactions.txt"], simple(1, 3, 4, cluster_col=0)),
    ("The Oasis", "Palmiera", ["palmiera-sales-transactions.txt"], simple(0, 3, 4)),
]


def dld_cluster(project):
    """'The Valley - Alana' -> 'Alana'; 'Arabian Ranches lll - Elie Saab ll' -> 'Elie Saab ll'."""
    return project.split(" - ", 1)[1].strip() if project and " - " in project else project


def main(dld_path, units_path, out_path):
    dld = [json.loads(l) for l in open(dld_path)]
    by_key = collections.defaultdict(list)  # (norm cluster, date, amount) -> dld rows
    for r in dld:
        c = dld_cluster(r.get("PROJECT_EN") or "")
        d = dt.date.fromisoformat(r["INSTANCE_DATE"][:10])
        by_key[(norm(c), d, int(round(r["TRANS_VALUE"])))].append(r)

    # "-" skips the CRM check (it is then done against the live database before import).
    crm = [] if units_path == "-" else json.load(open(units_path))
    crm_units = collections.defaultdict(list)  # (community, norm cluster, unit key) -> CRM labels
    for u in crm:
        crm_units[(u["community"], norm(u["cluster"]), unit_key(u["unit"]))].append(u)

    cutoff = max(dt.date.fromisoformat(r["INSTANCE_DATE"][:10]) for r in dld) - dt.timedelta(days=366)
    matched, skipped = [], collections.Counter()
    for community, cluster, files, parse in SOURCES:
        for f in files:
            for line in (DATA / f).read_text().splitlines():
                if not line.strip():
                    continue
                file_cluster, unit, amount, date = parse(line)
                cl = file_cluster or cluster
                if date < cutoff:
                    skipped["older than 12 months"] += 1
                    continue
                hits = by_key.get((norm(cl), date, amount), [])
                if len(hits) != 1:
                    skipped["no DLD sale with same cluster/date/price" if not hits else "several DLD sales match"] += 1
                    continue
                targets = crm_units.get((community, norm(cl), unit_key(unit)), [])
                labels = {(t["cluster"], t["unit"]) for t in targets} if crm else {(cl, unit_key(unit))}
                if len(labels) != 1:
                    skipped["unit not in CRM" if not labels else "unit ambiguous in CRM"] += 1
                    continue
                r = hits[0]
                crm_cluster, crm_unit = labels.pop()
                is_land = (r.get("PROP_TYPE_EN") or "").lower() == "land"
                area_sqm = r.get("ACTUAL_AREA") or r.get("PROCEDURE_AREA")
                matched.append({
                    "community": community, "cluster": crm_cluster, "unit": crm_unit,
                    "transaction_date": date.isoformat(), "amount": amount,
                    "area_sqft": round(area_sqm * SQM_TO_SQFT) if area_sqm else None,
                    "area_type": "plot" if is_land else "property",
                    "dld_transaction_number": r["TRANSACTION_NUMBER"],
                    "dld_procedure": r.get("PROCEDURE_EN"), "source_file": f,
                })
    # Two report lines pointing at the same DLD sale would be a contradiction: drop both.
    counts = collections.Counter(m["dld_transaction_number"] for m in matched)
    clean = [m for m in matched if counts[m["dld_transaction_number"]] == 1]
    skipped["same DLD sale claimed by two units"] += len(matched) - len(clean)
    json.dump({"matched": clean, "skipped": skipped}, open(out_path, "w"), indent=1)
    print(len(clean), "verified unit matches;", dict(skipped))


if __name__ == "__main__":
    main(*sys.argv[1:4])
