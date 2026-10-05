"""Download the USACE National Structure Inventory (NSI) for the tiles that
FEMA assessed after Hurricane Michael (all tiles) and Maria (a random sample).

NSI gives one record per structure: construction type, storeys, foundation,
occupancy, floor area and replacement value. A tile is 0.1 x 0.1 degrees and
is pulled if it holds at least 5 FEMA damage points.

    python scripts/fetch_nsi.py
"""
from __future__ import annotations

import json
import os
import time
import urllib.request

import numpy as np
import pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = os.path.join(ROOT, "data", "raw")
API = "https://nsi.sec.usace.army.mil/nsiapi/structures?bbox={}"
KEEP = ["fd_id", "bid", "x", "y", "bldgtype", "num_story", "found_type", "found_ht", "occtype",
        "st_damcat", "sqft", "ftprntsqft", "med_yr_blt", "val_struct", "resunits", "firmzone",
        "ground_elv", "source"]
MARIA_TILES = int(os.environ.get("HV_MARIA_TILES", 45))


def tiles():
    p = pd.read_csv(os.path.join(RAW, "fema_rs_wind_points.csv"))
    p["tx"] = np.floor(p.LONGITUDE * 10).astype(int)
    p["ty"] = np.floor(p.LATITUDE * 10).astype(int)
    out = []
    for ev, g in p.groupby("EVENT_NAME"):
        t = g.groupby(["tx", "ty"]).size()
        t = t[t >= 5].index.tolist()
        if "Maria" in ev:
            rng = np.random.default_rng(2017)
            t = [t[i] for i in sorted(rng.choice(len(t), min(MARIA_TILES, len(t)), replace=False))]
        out += [(ev, tx, ty) for tx, ty in t]
    return out


def fetch(tx, ty, tries=6):
    x0, y0, x1, y1 = tx / 10, ty / 10, (tx + 1) / 10, (ty + 1) / 10
    poly = f"{x0},{y0},{x0},{y1},{x1},{y1},{x1},{y0},{x0},{y0}"
    for k in range(tries):
        try:
            with urllib.request.urlopen(API.format(poly), timeout=300) as r:
                fc = json.loads(r.read())
            return [{c: f["properties"].get(c) for c in KEEP} for f in fc.get("features", [])]
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(5 * (k + 1))


def main():
    todo = tiles()
    print("tiles:", len(todo), flush=True)
    frames = []
    for i, (ev, tx, ty) in enumerate(todo):
        cache = os.path.join(RAW, "nsi", f"{tx}_{ty}.csv")
        if os.path.exists(cache):
            df = pd.read_csv(cache)
        else:
            df = pd.DataFrame(fetch(tx, ty), columns=KEEP)
            df.to_csv(cache, index=False)
        df["event"] = ev
        df["tile"] = f"{tx}_{ty}"
        frames.append(df)
        print(f"  {i + 1}/{len(todo)} {ev[-7:]} tile {tx},{ty}: {len(df):,}", flush=True)
    out = pd.concat(frames, ignore_index=True)
    out.to_csv(os.path.join(RAW, "nsi_structures.csv"), index=False)
    print("structures:", len(out))


if __name__ == "__main__":
    main()
