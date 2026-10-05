"""Export everything the website shows into web/bundle.json.

Every number on the page is produced here from the fitted models, the
validation record and the data-quality logs. Observed damage is shown only
as 500 m cells with at least 5 buildings.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd
from shapely.geometry import box, shape, mapping

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from hurricanevuln import loss as L, product, taxonomy as T, windfield as W  # noqa: E402
from hurricanevuln.fragility import Fragility, prepare as prep_frag  # noqa: E402
from hurricanevuln.model import GH_W, GH_X, GroupGauss, GroupLogit  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")
REP = os.path.join(ROOT, "reports")
OUT = os.path.join(ROOT, "web", "bundle.json")
BBOX = (-100.0, 14.0, -58.0, 38.5)
CELL = 0.005


def r(x, d=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if np.isfinite(x) else None


def clean(o):
    """Replace NaN and infinity with None so the bundle is strict JSON."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, float) and not np.isfinite(o):
        return None
    if isinstance(o, (np.floating,)):
        return clean(float(o))
    if isinstance(o, (np.integer,)):
        return int(o)
    return o


def schema_stats(df, cats, nums):
    """Per-field summary for the documentation's data dictionary."""
    out = {}
    for c in cats:
        vc = df[c].fillna("missing").astype(str).value_counts()
        out[c] = {"type": "categorical", "n": int(len(df)),
                  "levels": [[k, int(v)] for k, v in vc.items()]}
    for c in nums:
        x = pd.to_numeric(df[c], errors="coerce")
        out[c] = {"type": "numeric", "n": int(len(df)), "missing": int(x.isna().sum()),
                  "mean": r(x.mean()), "sd": r(x.std()), "min": r(x.min()), "p10": r(x.quantile(.1)),
                  "p50": r(x.quantile(.5)), "p90": r(x.quantile(.9)), "max": r(x.max())}
    return out


def geo_crop(path, tol):
    gj = json.load(open(path))
    clip = box(*BBOX)
    out = []
    for f in gj["features"]:
        g = shape(f["geometry"])
        if not g.intersects(clip):
            continue
        g = g.intersection(clip).simplify(tol, preserve_topology=True)
        if g.is_empty:
            continue
        m = mapping(g)
        polys = m["coordinates"] if m["type"] in ("MultiPolygon", "MultiLineString") else [m["coordinates"]]
        for p in polys:
            rings = p if m["type"].endswith("Polygon") else [p]
            for ring in rings:
                if len(ring) >= 2:
                    out.append([[round(x, 3), round(y, 3)] for x, y in ring])
    return out


def main():
    storms = W.parse_hurdat2(os.path.join(RAW, "hurdat2_atlantic.txt"))
    sp = product.spec()

    fr = prep_frag(pd.read_csv(os.path.join(ROOT, "data", "processed", "fragility.csv"),
                               dtype={"county_fips": str}))
    frag = Fragility().fit(product.apply(fr, sp))

    hl = L.prepare(pd.read_csv(os.path.join(ROOT, "data", "processed", "household_loss.csv"),
                               dtype={"geoid": str}))
    m_pos, m_sev, m_unh, m_des = L.fit_models(hl)

    # Storm tracks (raw best-track records) for every storm in the loss data.
    tracks = []
    for s in sorted(hl.storm.unique(), key=lambda x: (int(x[-4:]), x)):
        name, year = s.rsplit(" ", 1)
        st = W.find(storms, name, int(year))
        t = st["track"]
        tracks.append({"storm": s, "id": st["id"],
                       "t": [int(x.timestamp() // 60) for x in t.time],
                       "lat": t.lat.round(2).tolist(), "lon": t.lon.round(2).tolist(),
                       "v": t.vmax_kt.astype(int).tolist(),
                       "rmw": [None if not np.isfinite(x) else float(x) for x in t.rmw_nm],
                       "n_households": int((hl.storm == s).sum())})

    # Wind-field parity cases for the JavaScript port.
    rng = np.random.default_rng(3)
    wind_cases = []
    for s in ["Michael 2018", "Ian 2022", "Helene 2024", "Maria 2017"]:
        name, year = s.rsplit(" ", 1)
        tr = W.find(storms, name, int(year))["track"]
        i = tr.vmax_kt.idxmax()
        la = tr.lat[i] + rng.uniform(-1.5, 1.5, 12)
        lo = tr.lon[i] + rng.uniform(-1.5, 1.5, 12)
        v = W.peak_wind(tr, la, lo)
        wind_cases += [{"storm": s, "lat": float(a), "lon": float(b), "v": float(c)} for a, b, c in zip(la, lo, v)]

    # Model parity cases.
    sample = product.apply(fr, sp).sample(25, random_state=1)
    pa, pd_ = frag.predict(sample)
    frag_cases = [{"x": {c: row[c] for c in ["construction", "use", "storeys", "era", "quality", "foundation",
                                             "log_area", "low_ground", "coastal_v", "wind_ms"]},
                   "p_any": float(a), "p_des": float(b)} for (_, row), a, b in zip(sample.iterrows(), pa, pd_)]
    hs = hl.sample(25, random_state=2)
    m, sd = m_sev.predictive(hs)
    loss_cases = [{"x": {c: (float(row[c]) if c not in ("residence",) else row[c])
                         for c in ["residence", "wind_ms", "flood", "water_in", "insured", "flood_insured", "year"]},
                   "p_pos": float(a), "mu": float(b), "sd": float(c)}
                  for (_, row), a, b, c in zip(hs.iterrows(), m_pos.predict(hs), m, sd)]

    # Observed Michael damage, 500 m cells.
    g = fr.assign(cx=np.floor(fr.lon / CELL), cy=np.floor(fr.lat / CELL)).groupby(["cx", "cy"]).agg(
        n=("damage", "size"), a=("any", "sum"), d=("des", "sum"))
    g = g[g.n >= 5].reset_index()
    cells = [[r((x + .5) * CELL, 4), r((y + .5) * CELL, 4), int(n), int(a), int(d)]
             for x, y, n, a, d in g[["cx", "cy", "n", "a", "d"]].itertuples(index=False)]

    # Wind check: our open-terrain wind vs FEMA's wind category on damage points.
    pts = pd.read_csv(os.path.join(RAW, "fema_rs_wind_points.csv"))
    pts = pts[pts.EVENT_NAME.str.contains("Michael")]
    vk = W.peak_wind(W.find(storms, "Michael", 2018)["track"], pts.LATITUDE, pts.LONGITUDE) / W.KT
    wind_check = pts.assign(kt=vk).groupby("WIND_SPEED").kt.agg(["size", "mean", "min", "max"]).round(1)

    fsum = json.load(open(os.path.join(REP, "fragility_summary.json")))
    lsum = json.load(open(os.path.join(REP, "bench_loss_summary.json")))
    bench_loss = pd.read_csv(os.path.join(REP, "bench_loss.csv"))
    storm_iv = pd.read_csv(os.path.join(REP, "bench_loss_storm.csv"))
    manifest = json.load(open(os.path.join(RAW, "manifest.json")))
    ihp_counts = json.load(open(os.path.join(RAW, "ihp_counts.json")))
    qa_f = pd.read_csv(os.path.join(REP, "qa_fragility.csv"))
    qa_l = pd.read_csv(os.path.join(REP, "qa_loss.csv"))
    match = json.load(open(os.path.join(REP, "fragility_matching.json")))

    storm_stats = hl.groupby("storm").agg(n=("loss", "size"), pos=("loss_pos", "mean"),
                                          med=("loss", lambda s: s[s > 0].median()),
                                          mean=("loss", "mean"), unh=("uninhabitable", "mean"),
                                          flood=("flood", "mean"),
                                          kt=("wind_ms", lambda s: (s / W.KT).median()),
                                          roof_recorded=("roof", "max")).reset_index()

    raw_frag = pd.read_csv(os.path.join(ROOT, "data", "processed", "fragility.csv"), dtype={"county_fips": str})
    raw_loss = pd.read_csv(os.path.join(ROOT, "data", "processed", "household_loss.csv"), dtype={"geoid": str})
    schema = {
        "fragility": schema_stats(raw_frag, ["event", "construction", "construction_source", "occupancy", "use", "storeys",
                                             "foundation", "era", "quality", "county_fips", "damage"],
                                  ["lat", "lon", "sqft", "living_sqft", "year_built", "val_struct", "coastal_v",
                                   "ground_elv_ft", "wind_ms"]),
        "loss": schema_stats(raw_loss, ["storm", "state", "residence", "insured", "flood_insured", "flood", "roof",
                                        "destroyed", "uninhabitable"],
                             ["year", "lat", "lon", "water_in", "wind_ms", "loss", "roof_loss"]),
    }
    bundle = {
        "meta": {"built": pd.Timestamp.now().strftime("%Y-%m-%d"), "version": "1.0.0",
                 "n_buildings": int(len(fr)), "n_households": int(len(hl)),
                 "n_storms": int(hl.storm.nunique()), "n_counties": int(fr.county_fips.nunique()),
                 "n_parcels": 310987, "damaged_share": r(fr["any"].mean()),
                 "destroyed_share": r(fr["des"].mean(), 5), "hurdat": manifest["hurdat2_atlantic"]["url"].rsplit("/", 1)[-1]},
        "gh": {"x": GH_X.tolist(), "w": GH_W.tolist()},
        "spec": sp,
        "frag": {"any": frag.any.to_json(), "des": frag.des.to_json()},
        "loss": {"pos": m_pos.to_json(), "sev": m_sev.to_json(), "unh": m_unh.to_json(), "des": m_des.to_json(),
                 "wind_hinges": list(L.WIND_HINGES), "water_hinges": list(L.WATER_HINGES)},
        "names": T.LEVEL_NAMES,
        "tracks": tracks, "wind_cases": wind_cases, "frag_cases": frag_cases, "loss_cases": loss_cases,
        "cells": cells, "cell_deg": CELL,
        "land": geo_crop(os.path.join(RAW, "ne_50m_land.geojson"), 0.02),
        "states": geo_crop(os.path.join(RAW, "ne_50m_state_lines.geojson"), 0.02),
        "frag_bench": fsum, "loss_bench": lsum,
        "loss_per_storm": bench_loss.round(2).to_dict("records"),
        "storm_intervals": storm_iv.round(1).to_dict("records"),
        "storm_stats": storm_stats.round(4).replace({np.nan: None}).to_dict("records"),
        "wind_check": wind_check.reset_index().to_dict("records"),
        "qa_fragility": qa_f.to_dict("records"), "qa_loss": qa_l.to_dict("records"),
        "matching": match, "ihp_counts": ihp_counts, "schema": schema,
        "manifest": {k: {kk: v[kk] for kk in ("url", "retrieved", "sha256", "bytes")} for k, v in manifest.items()
                     if not k.startswith("cenpop")},
    }
    json.dump(clean(bundle), open(OUT, "w", encoding="utf-8"), separators=(",", ":"), allow_nan=False)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB; cells", len(cells), "; land rings", len(bundle["land"]))
    print("tau any", np.sqrt(frag.any.tau2), "tau des", np.sqrt(frag.des.tau2),
          "| loss tau pos", np.sqrt(m_pos.tau2), "sev", np.sqrt(m_sev.tau2), "sigma", np.sqrt(m_sev.sigma2))


if __name__ == "__main__":
    main()
