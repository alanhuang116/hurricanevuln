"""Download the small public inputs: HURDAT2 best tracks, Census block-group
population centroids, and FEMA remote-sensing wind damage points.

    python scripts/fetch_public.py

Every file lands in data/raw with its source URL and retrieval time recorded
in data/raw/manifest.json.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request

import pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = os.path.join(ROOT, "data", "raw")
MANIFEST = os.path.join(RAW, "manifest.json")

HURDAT_DIR = "https://www.nhc.noaa.gov/data/hurdat/"
CENPOP = "https://www2.census.gov/geo/docs/reference/cenpop{y}/blkgrp/CenPop{y}_Mean_BG{s}.txt"
STATES = ["01", "12", "13", "22", "28", "37", "45", "48", "72"]
FEMA_DA = ("https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/"
           "FEMA_Historical_Geospatial_Damage_Assessment_Database/FeatureServer/0/query")
# Observed (remote-sensing) wind assessments only; modelled ones are excluded.
DA_EVENTS = ["2018 Hurricane Michael", "2017 Hurricane Maria"]


def get(url, tries=5, timeout=120):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            print("  retry", k + 1, e)
            time.sleep(3 * (k + 1))


def record(manifest, name, url, path):
    with open(path, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    manifest[name] = {"url": url, "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                      "sha256": sha, "bytes": os.path.getsize(path)}


def main():
    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}

    listing = get(HURDAT_DIR).decode()
    name = sorted(set(re.findall(r'href="(hurdat2-1851-[^"]+\.txt)"', listing)))[-1]
    path = os.path.join(RAW, "hurdat2_atlantic.txt")
    open(path, "wb").write(get(HURDAT_DIR + name))
    record(manifest, "hurdat2_atlantic", HURDAT_DIR + name, path)
    print("HURDAT2:", name)

    for y in (2010, 2020):
        frames = []
        for s in STATES:
            url = CENPOP.format(y=y, s=s)
            txt = get(url).decode("utf-8-sig", "replace")
            path = os.path.join(RAW, f"cenpop{y}_bg{s}.txt")
            open(path, "w", encoding="utf-8").write(txt)
            record(manifest, f"cenpop{y}_bg{s}", url, path)
            frames.append(pd.read_csv(path, dtype=str))
        bg = pd.concat(frames)
        bg["geoid"] = bg.STATEFP + bg.COUNTYFP + bg.TRACTCE + bg.BLKGRPCE
        bg[["geoid", "POPULATION", "LATITUDE", "LONGITUDE"]].to_csv(
            os.path.join(RAW, f"bg_centroids_{y}.csv"), index=False)
        print(f"block groups {y}:", len(bg))

    rows = []
    for ev in DA_EVENTS:
        where = f"EVENT_NAME='{ev}' AND ASMT_TYPE='RS' AND DMG_TYPE='WI'"
        n = json.loads(get(FEMA_DA + "?" + urllib.parse.urlencode(
            {"where": where, "returnCountOnly": "true", "f": "json"})))["count"]
        off = 0
        while off < n:
            q = {"where": where, "outFields": "OBJECTID,DMG_LEVEL,WIND_SPEED,COUNTY,STATE,EVENT_NAME,"
                 "IMG_DATE,SOURCE,LONGITUDE,LATITUDE", "returnGeometry": "false",
                 "orderByFields": "OBJECTID", "resultOffset": off, "resultRecordCount": 2000, "f": "json"}
            feats = json.loads(get(FEMA_DA + "?" + urllib.parse.urlencode(q)))["features"]
            if not feats:
                break
            rows += [f["attributes"] for f in feats]
            off += len(feats)
        print(ev, n)
    path = os.path.join(RAW, "fema_rs_wind_points.csv")
    pd.DataFrame(rows).to_csv(path, index=False)
    record(manifest, "fema_rs_wind_points", FEMA_DA, path)
    json.dump(manifest, open(MANIFEST, "w"), indent=1)


if __name__ == "__main__":
    main()
