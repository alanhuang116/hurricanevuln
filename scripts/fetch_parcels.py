"""Download Florida DOR cadastral parcels (polygons + building attributes) for
the Florida counties in Hurricane Michael's assessed footprint.

Source: Florida Statewide Cadastral (FDOR roll, published by the Florida
Geographic Information Office). Only building attributes are requested:
no owner names or mailing addresses.

    python scripts/fetch_parcels.py
"""
from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
import pickle
import time
import urllib.parse
import urllib.request

from shapely.geometry import Polygon, MultiPolygon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "raw", "fl_parcels_michael.pkl")
URL = ("https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/"
       "Florida_Statewide_Cadastral/FeatureServer/0/query")
# FDOR county numbers: Bay, Calhoun, Franklin, Gadsden, Gulf, Holmes, Jackson, Liberty, Washington
COUNTIES = [13, 17, 29, 30, 33, 40, 42, 49, 77]
FIELDS = ("PARCEL_ID,CO_NO,ASMNT_YR,DOR_UC,IMP_QUAL,CONST_CLAS,EFF_YR_BLT,ACT_YR_BLT,"
          "TOT_LVG_AR,NO_BULDNG,NO_RES_UNT,JV,LND_VAL,SPEC_FEAT_")


PAGE = 500


def esri_to_shape(g):
    rings = [r for r in g.get("rings", []) if len(r) >= 4]
    if not rings:
        return None
    polys = [Polygon(r) for r in rings]
    return polys[0] if len(polys) == 1 else MultiPolygon([p for p in polys if p.is_valid] or polys[:1])


def page(co, off):
    d = get({"where": f"CO_NO={co}", "outFields": FIELDS, "outSR": 4326,
             "maxAllowableOffset": 0.00001, "geometryPrecision": 6, "orderByFields": "OBJECTID",
             "resultOffset": off, "resultRecordCount": PAGE, "f": "json"})
    out = []
    for f in d.get("features", []):
        g = esri_to_shape(f.get("geometry") or {})
        if g is not None:
            out.append((f["attributes"], g))
    return out


def get(params, tries=8):
    url = URL + "?" + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(5 * (k + 1))


def main():
    recs = []
    os.makedirs(os.path.join(ROOT, "data", "raw", "parcels"), exist_ok=True)
    for co in COUNTIES:
        cache = os.path.join(ROOT, "data", "raw", "parcels", f"co{co}.pkl")
        if os.path.exists(cache):
            part = pickle.load(open(cache, "rb"))
            recs += part
            print(f"county {co}: cached {len(part):,}", flush=True)
            continue
        n = get({"where": f"CO_NO={co}", "returnCountOnly": "true", "f": "json"})["count"]
        with ThreadPoolExecutor(max_workers=6) as ex:
            pages = list(ex.map(lambda o: page(co, o), range(0, n, PAGE)))
        part = [r for pg in pages for r in pg]
        pickle.dump(part, open(cache, "wb"))
        recs += part
        print(f"county {co}: {n:,}", flush=True)
    pickle.dump(recs, open(OUT, "wb"))
    print("parcels:", len(recs))


if __name__ == "__main__":
    main()
