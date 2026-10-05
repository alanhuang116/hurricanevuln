"""Building-level fragility table: NSI structures in FEMA-assessed tiles,
labelled with FEMA remote-sensing wind damage, with modelled peak wind.

FEMA records only damaged structures. Every NSI structure in an assessed tile
(a 0.1 degree tile holding at least 5 FEMA points) that no FEMA point matches
within MATCH_M is labelled 'no visible damage'.
"""
from __future__ import annotations

import json
import os
import pickle
import sys

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
import shapely
from shapely import STRtree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from hurricanevuln import taxonomy as T, windfield as W  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed", "fragility.csv")
MATCH_M = 30.0
# Maria (Puerto Rico) is assessed by FEMA too, but NSI has no Puerto Rico
# inventory, so there is no denominator; see reports/qa_fragility.csv.
EVENTS = {"2018 Hurricane Michael": ("MICHAEL", 2018)}


def xy(lat, lon, lat0, lon0):
    return np.c_[(lon - lon0) * 111320.0 * np.cos(np.radians(lat0)), (lat - lat0) * 110540.0]


PARCEL_COUNTS = {13: 133971, 17: 11616, 29: 18506, 30: 27290, 33: 19102, 40: 14897,
                 42: 42997, 49: 6347, 77: 43762}


def join_parcels(out):
    """Attach Florida property-appraiser attributes by point-in-parcel.

    The roll is the 2026 roll. A building whose parcel shows an actual year
    built of 2019 or later either replaced a building Michael damaged (it has
    a FEMA damage point) or is new construction on land that had no building
    in October 2018 (no damage point). The first keeps its outcome with its
    attributes set to unknown; the second is removed, because it was not
    there to be damaged.
    """
    recs = pickle.load(open(os.path.join(RAW, "fl_parcels_michael.pkl"), "rb"))
    attrs = pd.DataFrame([r[0] for r in recs])
    got = attrs.CO_NO.value_counts()
    # Parcels without a polygon (mostly condominium units, which share the
    # common-element parcel) cannot be joined; anything beyond 10% missing
    # means the download itself was cut short.
    short = {c: (int(got.get(c, 0)), n) for c, n in PARCEL_COUNTS.items() if got.get(c, 0) < 0.90 * n}
    if short:
        raise SystemExit(f"parcel download incomplete (got, expected): {short}")
    no_geom = sum(PARCEL_COUNTS.values()) - len(attrs)
    tree = STRtree([r[1] for r in recs])
    fl = (out.county_fips.str[:2] == "12").to_numpy()
    pts = shapely.points(out.lon.to_numpy()[fl], out.lat.to_numpy()[fl])
    src, tgt = tree.query(pts, predicate="within")
    pidx = np.full(len(out), -1)
    flpos = np.flatnonzero(fl)
    pidx[flpos[src]] = tgt
    has = pidx >= 0
    a = attrs.iloc[np.where(has, pidx, 0)].reset_index(drop=True)
    yb = pd.to_numeric(a.ACT_YR_BLT, errors="coerce").where(has)
    out["year_built"] = yb.where(yb > 1800).to_numpy()
    out["era"] = [T.parcel_era(y) if np.isfinite(y) else T.UNKNOWN for y in out.year_built.fillna(-1)]
    out["use"] = np.where(has, a.DOR_UC.map(T.parcel_use), T.UNKNOWN)
    out["quality"] = np.where(has, a.IMP_QUAL.map(T.parcel_quality), T.UNKNOWN)
    pc = pd.to_numeric(a.CONST_CLAS, errors="coerce").map(T.PARCEL_CONSTRUCTION)
    out["construction_source"] = np.where(has & pc.notna().to_numpy(), "parcel", "nsi")
    out["construction"] = np.where(has & pc.notna().to_numpy(), pc.fillna(T.UNKNOWN), out.construction)
    la = pd.to_numeric(a.TOT_LVG_AR, errors="coerce").where(has)
    out["living_sqft"] = la.where(la > 100).to_numpy()
    qa = [("Florida parcels on the 2026 roll without a polygon (not joinable)", int(no_geom)),
          ("Florida buildings inside a parcel", int(has.sum())),
          ("Georgia buildings (no parcel roll; parcel fields unknown)", int((~fl).sum()))]
    post = out.year_built >= 2019
    rebuilt = post & (out.damage > 0)
    new = post & (out.damage == 0)
    for c in ["era", "use", "quality"]:
        out.loc[rebuilt, c] = T.UNKNOWN
    out.loc[rebuilt, ["year_built", "living_sqft"]] = np.nan
    qa.append(("rebuilt after a damage record: attributes set to unknown", int(rebuilt.sum())))
    qa.append(("built 2019 or later with no damage record: removed (not there in 2018)", int(new.sum())))
    return out[~new].reset_index(drop=True), qa


def main():
    storms = W.parse_hurdat2(os.path.join(RAW, "hurdat2_atlantic.txt"))
    nsi = pd.read_csv(os.path.join(RAW, "nsi_structures.csv"), low_memory=False)
    pts = pd.read_csv(os.path.join(RAW, "fema_rs_wind_points.csv"))
    qa = [("NSI structure records in assessed tiles", len(nsi)),
          ("FEMA remote-sensing wind damage points", len(pts))]
    # One record per building: NSI repeats a footprint for each occupancy in it.
    nsi = nsi.sort_values("val_struct", ascending=False).drop_duplicates(["event", "bid"])
    qa.append(("unique buildings (NSI building id)", len(nsi)))

    parts, match = [], {}
    for ev, (name, year) in EVENTS.items():
        b = nsi[nsi.event == ev].reset_index(drop=True)
        p = pts[pts.EVENT_NAME == ev]
        p = p[np.floor(p.LONGITUDE * 10).astype(int).astype(str).str.cat(
            np.floor(p.LATITUDE * 10).astype(int).astype(str), sep="_").isin(set(b.tile))]
        lat0, lon0 = b.y.mean(), b.x.mean()
        tree = cKDTree(xy(b.y.to_numpy(), b.x.to_numpy(), lat0, lon0))
        dist, idx = tree.query(xy(p.LATITUDE.to_numpy(), p.LONGITUDE.to_numpy(), lat0, lon0))
        ok = dist <= MATCH_M
        state = p.DMG_LEVEL.map(T.DAMAGE_STATE).fillna(1).to_numpy().astype(int)
        dmg = np.zeros(len(b), int)
        np.maximum.at(dmg, idx[ok], state[ok])
        match[ev] = {"points_in_tiles": int(len(p)), "matched": int(ok.sum()),
                     "median_distance_m": float(np.median(dist[ok])) if ok.any() else None}
        b["damage"] = dmg
        b["wind_ms"] = W.peak_wind(W.find(storms, name, year)["track"], b.y, b.x)
        parts.append(b)
        print(f"{ev}: {len(b):,} buildings, {ok.sum():,}/{len(p):,} points matched, "
              f"damaged {np.mean(dmg > 0):.3f}, destroyed {np.mean(dmg == 2):.4f}")
    d = pd.concat(parts, ignore_index=True)

    out = pd.DataFrame({
        "event": d.event.str.replace(r"^\d{4} Hurricane ", "", regex=True) + " " + d.event.str[:4],
        "tile": d.tile, "lat": d.y, "lon": d.x,
        "construction": d.bldgtype.map(T.CONSTRUCTION).fillna(T.UNKNOWN),
        "occupancy": d.occtype.map(T.occupancy),
        "storeys": d.num_story.map(T.storeys),
        "foundation": d.found_type.map(T.FOUNDATION).fillna(T.UNKNOWN),
        "era": d.med_yr_blt.map(T.design_era),
        "sqft": d.sqft.clip(lower=100), "val_struct": d.val_struct,
        "coastal_v": d.firmzone.astype(str).str.startswith("V").astype(int),
        "ground_elv_ft": d.ground_elv, "wind_ms": d.wind_ms, "damage": d.damage,
    })
    # County from the nearest 2020 block-group population centroid. FEMA
    # assessment coverage differs by county, so county is the assessment unit.
    bg = pd.read_csv(os.path.join(RAW, "bg_centroids_2020.csv"), dtype={"geoid": str})
    bg = bg[bg.geoid.str[:2].isin(["01", "12", "13"])]
    lat0, lon0 = out.lat.mean(), out.lon.mean()
    _, j = cKDTree(xy(bg.LATITUDE.to_numpy(float), bg.LONGITUDE.to_numpy(float), lat0, lon0)).query(
        xy(out.lat.to_numpy(), out.lon.to_numpy(), lat0, lon0))
    out["county_fips"] = bg.geoid.str[:5].to_numpy()[j]
    out, pqa = join_parcels(out)
    qa += pqa
    out["manufactured"] = ((out.construction == "manufactured") | (out.use == "mobile_home")).astype(int)
    out.to_csv(OUT, index=False)
    qa.append(("buildings in fragility table", len(out)))
    pd.DataFrame(qa, columns=["step", "records"]).to_csv(
        os.path.join(ROOT, "reports", "qa_fragility.csv"), index=False)
    json.dump(match, open(os.path.join(ROOT, "reports", "fragility_matching.json"), "w"), indent=1)
    for s, n in qa:
        print(f"{n:>9,}  {s}")


if __name__ == "__main__":
    main()
