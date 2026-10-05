"""Parametric peak-wind field from HURDAT2 best tracks.

At each 15-minute step of the interpolated track, the wind at a site is a
Holland (1980) radial profile scaled so that its peak equals the best-track
intensity, plus half the forward speed on the right of the motion:

    V(r, phi) = (Vsym + 0.5 Vt cos(phi - heading - 90deg)) * S(r)
    S(r)      = sqrt((Rm/r)^B * exp(1 - (Rm/r)^B))        (S(Rm) = 1)
    Vsym      = max(Vmax - 0.5 Vt, 0)

Rm is the best-track radius of maximum wind when HURDAT2 has it (2021 on),
otherwise Willoughby et al. (2006). B follows Vickery and Wadhera (2008).
The result is the peak 1-minute sustained wind at 10 m in open terrain, the
same reference as the best track. The website runs the same formula
(see web/site_template.html, windAt()).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

KT = 0.514444          # m/s per knot
STEP_MIN = 15
R_EARTH = 6371.0


def parse_hurdat2(path):
    storms, cur = {}, None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            p = [x.strip() for x in line.split(",")]
            if p[0][:2] in ("AL", "EP", "CP") and len(p) <= 4:
                cur = p[0]
                storms[cur] = {"id": cur, "name": p[1], "year": int(cur[-4:]), "rows": []}
                continue
            lat = float(p[4][:-1]) * (1 if p[4][-1] == "N" else -1)
            lon = float(p[5][:-1]) * (-1 if p[5][-1] == "W" else 1)
            rmw = float(p[20]) if len(p) > 20 and p[20] not in ("", "-999") else np.nan
            storms[cur]["rows"].append({
                "time": pd.Timestamp(f"{p[0]} {p[1][:2]}:{p[1][2:]}"),
                "status": p[3], "lat": lat, "lon": lon, "vmax_kt": float(p[6]),
                "pmin": float(p[7]) if float(p[7]) > 0 else np.nan,
                "rmw_nm": rmw if rmw > 0 else np.nan})
    for s in storms.values():
        s["track"] = pd.DataFrame(s.pop("rows"))
    return storms


def find(storms, name, year):
    for s in storms.values():
        if s["name"] == name.upper() and s["year"] == year:
            return s
    raise KeyError(f"{name} {year}")


def interpolate(track, step_min=STEP_MIN):
    t = track.drop_duplicates("time").set_index("time")
    grid = pd.date_range(t.index[0], t.index[-1], freq=f"{step_min}min")
    num = t[["lat", "lon", "vmax_kt", "rmw_nm"]].reindex(t.index.union(grid))
    num = num.interpolate(method="time", limit_area="inside").reindex(grid)
    num["rmw_nm"] = num["rmw_nm"].where(num["rmw_nm"] > 0)
    lat, lon = np.radians(num.lat.to_numpy()), np.radians(num.lon.to_numpy())
    dlat, dlon = np.gradient(lat), np.gradient(lon)
    dy = dlat * R_EARTH
    dx = dlon * R_EARTH * np.cos(lat)
    dt = step_min * 60.0
    num["vt"] = np.hypot(dx, dy) * 1000.0 / dt                  # m/s
    num["heading"] = np.arctan2(dx, dy)                         # radians from north, clockwise
    return num.reset_index(names="time")


def rmax_km(vmax_ms, lat, rmw_nm=np.nan):
    est = 46.4 * np.exp(-0.0155 * vmax_ms + 0.0169 * np.abs(lat))
    obs = rmw_nm * 1.852
    return np.where(np.isfinite(obs) & (obs > 0), obs, est)


def holland_b(rm_km, lat):
    return np.clip(1.881 - 0.00557 * rm_km - 0.01097 * np.abs(lat), 0.8, 2.2)


def peak_wind(track, lat, lon, chunk=4000):
    """Peak sustained wind (m/s) at each site over the whole track."""
    tr = interpolate(track)
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    out = np.zeros(len(lat))
    vmax = tr.vmax_kt.to_numpy() * KT
    vt = tr.vt.to_numpy()
    rm = rmax_km(vmax, tr.lat.to_numpy(), tr.rmw_nm.to_numpy())
    b = holland_b(rm, tr.lat.to_numpy())
    vsym = np.maximum(vmax - 0.5 * vt, 0.0)
    clat, clon = np.radians(tr.lat.to_numpy()), np.radians(tr.lon.to_numpy())
    head = tr.heading.to_numpy()
    for s in range(0, len(lat), chunk):
        la = np.radians(lat[s:s + chunk])[:, None]
        lo = np.radians(lon[s:s + chunk])[:, None]
        dy = (la - clat[None, :]) * R_EARTH
        dx = (lo - clon[None, :]) * R_EARTH * np.cos(clat[None, :])
        r = np.maximum(np.hypot(dx, dy), 0.5)
        phi = np.arctan2(dx, dy)
        x = (rm[None, :] / r) ** b[None, :]
        shape = np.sqrt(x * np.exp(1.0 - x))
        v = (vsym[None, :] + 0.5 * vt[None, :] * np.cos(phi - head[None, :] - np.pi / 2)) * shape
        out[s:s + chunk] = np.nanmax(v, axis=1)
    return out


def category(v_ms):
    kt = np.asarray(v_ms) / KT
    return np.select([kt >= 137, kt >= 113, kt >= 96, kt >= 83, kt >= 64, kt >= 34],
                     ["CAT5", "CAT4", "CAT3", "CAT2", "CAT1", "TS"], "TD")
