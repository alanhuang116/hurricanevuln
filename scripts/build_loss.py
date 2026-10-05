"""Household loss table from FEMA IHP owner registrations.

Admissible: owner-occupied primary residence, FEMA inspection returned,
block group located. Each household is placed at its block group's population
centroid (2010 or 2020 vintage, as recorded) and given the storm's modelled
peak wind there. Verified real property loss is converted to 2024 dollars
with the BLS CPI-U annual average.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from hurricanevuln import taxonomy as T, windfield as W  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed", "household_loss.csv")
# BLS CPI-U, US city average, annual averages (1982-84 = 100).
CPI = {2016: 240.007, 2017: 245.120, 2018: 251.107, 2019: 255.657, 2020: 258.811,
       2021: 270.970, 2022: 292.655, 2023: 304.702, 2024: 313.689}
TO_YEAR = 2024


def main():
    storms = W.parse_hurdat2(os.path.join(RAW, "hurdat2_atlantic.txt"))
    d = pd.read_csv(os.path.join(RAW, "ihp_owners.csv"), dtype={"censusGeoid": str}, low_memory=False)
    qa = [("owner-occupied registrations with a returned inspection (pulled)", len(d))]
    d = d[d.primaryResidence.astype(str).str.lower() == "true"]
    qa.append(("primary residence", len(d)))
    d = d[d.censusGeoid.notna() & (d.censusGeoid.str.len() == 12)]
    qa.append(("located to a census block group", len(d)))

    cents = {}
    for y in (2010, 2020):
        c = pd.read_csv(os.path.join(RAW, f"bg_centroids_{y}.csv"), dtype={"geoid": str})
        cents[y] = c.set_index("geoid")[["LATITUDE", "LONGITUDE"]].astype(float)
    yr = np.where(pd.to_numeric(d.censusYear, errors="coerce") >= 2020, 2020, 2010)
    lat = np.full(len(d), np.nan)
    lon = np.full(len(d), np.nan)
    for y in (2010, 2020):
        m = yr == y
        j = cents[y].reindex(d.censusGeoid[m])
        lat[m], lon[m] = j.LATITUDE.to_numpy(), j.LONGITUDE.to_numpy()
    d = d.assign(lat=lat, lon=lon)
    d = d[np.isfinite(d.lat)]
    qa.append(("block group found in the Census centroid file", len(d)))

    wind = np.full(len(d), np.nan)
    for storm, idx in d.groupby("storm").groups.items():
        name, year = storm.rsplit(" ", 1)
        g = d.loc[idx]
        tr = W.find(storms, name, int(year))["track"]
        # Peak wind per block group, then broadcast.
        u = g[["censusGeoid", "lat", "lon"]].drop_duplicates("censusGeoid")
        v = pd.Series(W.peak_wind(tr, u.lat, u.lon), index=u.censusGeoid)
        wind[d.index.get_indexer(idx)] = v.reindex(g.censusGeoid).to_numpy()
    d["wind_ms"] = wind

    year = d.storm.str[-4:].astype(int)
    defl = CPI[TO_YEAR] / year.map(CPI)
    flood = (d.floodDamage.astype(str).str.lower() == "true") | (pd.to_numeric(d.waterLevel, errors="coerce") > 0)
    tf = lambda c: (d[c].astype(str).str.lower() == "true").astype(int)  # noqa: E731
    out = pd.DataFrame({
        "storm": d.storm, "year": year, "state": d.damagedStateAbbreviation,
        "geoid": d.censusGeoid, "lat": d.lat.round(5), "lon": d.lon.round(5),
        "residence": d.residenceType.map(T.RESIDENCE).fillna(T.UNKNOWN),
        "insured": tf("homeOwnersInsurance"), "flood_insured": tf("floodInsurance"),
        "flood": flood.astype(int),
        "water_in": pd.to_numeric(d.waterLevel, errors="coerce").fillna(0).clip(lower=0),
        "wind_ms": d.wind_ms,
        "loss": (pd.to_numeric(d.rpfvl, errors="coerce").fillna(0).clip(lower=0) * defl).round(2),
        "roof_loss": (pd.to_numeric(d.roofDamageAmount, errors="coerce").fillna(0).clip(lower=0) * defl).round(2),
        "roof": tf("roofDamage"), "destroyed": tf("destroyed"),
        "uninhabitable": tf("habitabilityRepairsRequired"),
    })
    out = out[np.isfinite(out.wind_ms)]
    out.to_csv(OUT, index=False)
    qa.append(("household loss table", len(out)))
    pd.DataFrame(qa, columns=["step", "records"]).to_csv(os.path.join(ROOT, "reports", "qa_loss.csv"), index=False)
    for s, n in qa:
        print(f"{n:>9,}  {s}")
    print(out.groupby("storm").agg(n=("loss", "size"), pos=("loss", lambda s: (s > 0).mean()),
                                   med=("loss", lambda s: s[s > 0].median()), roof=("roof", "mean"),
                                   flood=("flood", "mean"), kt=("wind_ms", lambda s: (s / W.KT).median()))
          .round(3).to_string())
    print(out.residence.value_counts().to_dict())


if __name__ == "__main__":
    main()
