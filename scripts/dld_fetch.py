"""Fetch DLD open-data sales transactions (the same public feed the dubailand.gov.ae
open-data page uses) for a date range, politely (one request at a time, with a pause).

Usage: python3 scripts/dld_fetch.py 2025-10-19 2026-10-19 out.jsonl
Writes one JSON object per transaction. Re-running is safe: rows are keyed by TRANSACTION_NUMBER.
"""
import datetime as dt, json, sys, time, urllib.request

URL = "https://gateway.dubailand.gov.ae/open-data/transactions"
PAGE = 5000


def fetch(day_from, day_to, skip):
    body = {
        "P_FROM_DATE": day_from.strftime("%m/%d/%Y"), "P_TO_DATE": day_to.strftime("%m/%d/%Y"),
        "P_GROUP_ID": "1",  # Sales
        "P_IS_OFFPLAN": "", "P_IS_FREE_HOLD": "", "P_AREA_ID": "", "P_USAGE_ID": "", "P_PROP_TYPE_ID": "",
        "P_TAKE": str(PAGE), "P_SKIP": str(skip), "P_SORT": "TRANSACTION_NUMBER_ASC",
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "Origin": "https://dubailand.gov.ae", "Referer": "https://dubailand.gov.ae/",
        "User-Agent": "usama-crm-dld-sync/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)["response"]["result"]
        except Exception as e:  # network hiccup: back off and retry
            print("retry", attempt, e, file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("DLD request failed repeatedly")


def main(start, end, out_path):
    start, end = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    seen = set()
    with open(out_path, "w") as out:
        day = start
        while day <= end:
            stop = min(day + dt.timedelta(days=13), end)
            skip = 0
            while True:
                rows = fetch(day, stop, skip)
                for r in rows:
                    if r["TRANSACTION_NUMBER"] not in seen:
                        seen.add(r["TRANSACTION_NUMBER"])
                        out.write(json.dumps(r, ensure_ascii=False) + "\n")
                print(day, stop, "skip", skip, "got", len(rows), "total", len(seen), flush=True)
                if len(rows) < PAGE:
                    break
                skip += PAGE
                time.sleep(2)
            day = stop + dt.timedelta(days=1)
            time.sleep(2)


if __name__ == "__main__":
    main(*sys.argv[1:4])
