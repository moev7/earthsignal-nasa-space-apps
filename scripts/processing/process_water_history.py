"""Reproduce a pinned observed gauge series; never infer gauge height from water pixels."""
import hashlib
import json
import math
import urllib.request
from datetime import datetime
from pathlib import Path

COMMIT = "452c0145b1dbdd5ca82c6d13d7fadc8fba0bbd06"
ASSET = "DSWx/Reservoir/data/accumweb_09192023.json"
BLOB = "f1839d5db7628b2be521175e982c9468e68fa226"
REPO = "OPERA-Cal-Val/OPERA_Applications"

def process():
    url = f"https://raw.githubusercontent.com/{REPO}/{COMMIT}/{ASSET}"
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read(1_000_001)
    assert len(raw) <= 1_000_000
    assert hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest() == BLOB
    source = json.loads(raw)
    series = source["Series"][0]
    assert source["DataSource"] == "Observed" and source["TimeStep"] == "DAY"
    assert series["SiteName"] == "Lake Mead" and series["DataTypeUnit"] == "feet"
    points = []
    missing = []
    for item in series["Data"]:
        date = datetime.strptime(item["t"], "%m/%d/%Y %I:%M:%S %p").strftime("%Y-%m-%d")
        if item["v"] is None or str(item["v"]).strip() == "":
            missing.append(date)
            continue
        value = float(item["v"])
        if not math.isfinite(value) or not 0 < value < 2000:
            raise ValueError("Unrecognized gauge value; refuse implicit imputation")
        points.append({"date": date, "value": value})
    points.sort(key=lambda p: p["date"])
    assert len({p['date'] for p in points}) == len(points)
    result = {
        "schemaVersion": "1.0", "id": "lake-mead-observed-elevation", "title": "Lake Mead reservoir elevation",
        "quantity": series["DataTypeName"], "unit": "ft", "status": "historical-observed",
        "dateRange": [points[0]["date"], points[-1]["date"]], "points": points, "missingDates": missing,
        "source": {"url": f"https://github.com/{REPO}/blob/{COMMIT}/{ASSET}", "commit": COMMIT, "blobSha": BLOB,
                   "sha256": hashlib.sha256(raw).hexdigest(), "seriesId": series["SDI"], "database": series["DB"],
                   "queryDate": source["QueryDate"], "sourceLabel": "Observed gauge export archived in OPERA Applications"},
        "notice": "Historical daily gauge elevations, not satellite water area or current conditions. Vertical datum is not specified in the archived export. No conversion to water volume. Forecasts are retrospective experiments at the selected historical cutoff."
    }
    output = Path(__file__).resolve().parents[2] / "public/data/water-history.json"
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(json.dumps({"observations": len(points), "dates": result["dateRange"], "sha256": result["source"]["sha256"]}))

if __name__ == "__main__":
    process()
