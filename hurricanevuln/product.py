"""The shipped specification.

Fragility: a building attribute level enters only if its grade in
reports/fragility_factors.csv is 'supported'; other levels are merged into
the reference (no credit, no surcharge). Household loss: the full
specification in hurricanevuln/loss.py, predicted under the current
(2019 on) FEMA inspection regime.
"""
from __future__ import annotations

import os

import pandas as pd

from .fragility import CATS, REFS, UNKNOWN

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FACTORS = os.path.join(ROOT, "reports", "fragility_factors.csv")


def spec(path=FACTORS):
    g = pd.read_csv(path)
    keep = {}
    for r in g[g.grade == "supported"].itertuples():
        keep.setdefault(r.field, []).append(r.value)
    return {c: sorted(keep[c]) for c in CATS if c in keep}


def apply(df, sp):
    out = df.copy()
    for c in CATS:
        ok = set(sp.get(c, [])) | {REFS[c], UNKNOWN}
        out[c] = out[c].where(out[c].isin(ok), REFS[c])
    return out
