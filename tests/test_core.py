"""Property tests for the wind field, design and models."""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from hurricanevuln import taxonomy as T, windfield as W  # noqa: E402
from hurricanevuln.loss import crps, hurdle_quantiles  # noqa: E402
from hurricanevuln.model import Design, GroupGauss, GroupLogit  # noqa: E402

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "raw")


def test_wind_peak_matches_best_track():
    s = W.find(W.parse_hurdat2(os.path.join(RAW, "hurdat2_atlantic.txt")), "Michael", 2018)
    tr = W.interpolate(s["track"])
    i = int(np.argmax(tr.vmax_kt.to_numpy()))
    rm = W.rmax_km(tr.vmax_kt[i] * W.KT, tr.lat[i], tr.rmw_nm[i])
    # A site at Rm on the right of the motion sees the best-track maximum.
    ang = tr.heading[i] + np.pi / 2
    lat = tr.lat[i] + np.degrees(rm * np.cos(ang) / W.R_EARTH)
    lon = tr.lon[i] + np.degrees(rm * np.sin(ang) / (W.R_EARTH * np.cos(np.radians(tr.lat[i]))))
    v = W.peak_wind(s["track"], [lat], [lon])[0] / W.KT
    assert abs(v - tr.vmax_kt[i]) < 6, v
    assert W.peak_wind(s["track"], [45.0], [-60.0])[0] / W.KT < tr.vmax_kt.max()


def test_categories():
    assert list(W.category(np.array([30, 64, 100, 140]) * W.KT)) == ["TD", "CAT1", "CAT3", "CAT5"]
    assert T.parcel_era(2012) == "2010_2018" and T.parcel_use("001") == "single_family"


def test_unknown_has_no_parameter():
    df = pd.DataFrame({"c": ["a", "b", "unknown", "b"], "wind_ms": [40, 50, 60, 70]})
    d = Design(["c"], {"c": "a"}).fit(df)
    assert d.columns[0] == "c=b" and abs(d.transform(df)[2, 0] - 2 / 3) < 1e-12


def test_group_models_recover_effects():
    rng = np.random.default_rng(0)
    n = 8000
    df = pd.DataFrame({"g": rng.integers(0, 15, n).astype(str), "wind_ms": rng.uniform(30, 75, n), "c": "a"})
    u = rng.normal(0, 0.8, 15)
    eta = -1 + 3 * np.log(df.wind_ms / 50) + u[df.g.astype(int)]
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-eta))).astype(int)
    m = GroupLogit(Design([], {}, num=("log_wind",)), group="g").fit(df, y)
    assert 0.4 < np.sqrt(m.tau2) < 1.3
    z = 8 + 0.5 * np.log(df.wind_ms / 50) + 0.3 * u[df.g.astype(int)] + rng.normal(0, 1, n)
    s = GroupGauss(Design([], {}, num=("log_wind",)), group="g").fit(df, z)
    assert abs(np.sqrt(s.sigma2) - 1) < 0.05


def test_crps_prefers_the_truth():
    rng = np.random.default_rng(1)
    y = np.where(rng.uniform(size=4000) < 0.6, np.exp(rng.normal(8, 1, 4000)), 0.0)
    good = hurdle_quantiles(np.full(4000, 0.6), np.full(4000, 8.0), np.full(4000, 1.0))
    bad = hurdle_quantiles(np.full(4000, 0.3), np.full(4000, 9.0), np.full(4000, 0.5))
    assert crps(good, y).mean() < crps(bad, y).mean()


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f()
            print("ok", k)
