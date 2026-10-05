"""Building fragility: P(visible damage) and P(destroyed | damaged) given peak
wind and the building's attributes, from Hurricane Michael.

Two GroupLogit stages with a partially pooled county (assessment unit)
effect. P(destroyed) = P(damage) * P(destroyed | damage), so the destroyed
probability can never exceed the damage probability.
"""
from __future__ import annotations

import zlib

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from .model import Design, GroupLogit

UNKNOWN = "unknown"
REFS = {"construction": "wood", "use": "single_family", "storeys": "1", "era": "1970_1993",
        "quality": "average", "foundation": "slab"}
CATS = list(REFS)
EXTRA = ["log_area", "low_ground", "coastal_v"]
EPS = 1e-6

# Expected sign relative to the reference, from post-storm engineering
# reviews (FEMA Mitigation Assessment Team reports) and code intent.
PRIOR = {
    "era=2002_2009": -1, "era=2010_2018": -1, "era=1994_2001": -1, "era=pre1970": +1,
    "construction=manufactured": +1, "construction=concrete": -1,
    "use=mobile_home": +1, "quality=high": -1, "quality=low": +1,
}


def prepare(df):
    d = df.copy()
    for c in CATS:
        d[c] = d[c].fillna(UNKNOWN).astype(str)
    area = d.living_sqft.where(d.living_sqft > 100, d.sqft)
    d["log_area"] = np.log(area.clip(200, 50000))
    d["low_ground"] = (d.ground_elv_ft < 10).astype(float)
    d["coastal_v"] = d.coastal_v.astype(float)
    d["any"] = (d.damage > 0).astype(int)
    d["des"] = (d.damage == 2).astype(int)
    return d


def design(cats=CATS, extra=EXTRA, num=("log_wind",)):
    # Logistic in log wind: the classic fragility form, monotone by
    # construction. A quadratic term fitted the 85-140 kt range slightly
    # better but turned upward below it, which no building does.
    return Design(cats, {c: REFS[c] for c in cats}, num=num, extra=extra)


class Fragility:
    def __init__(self, cats=CATS, extra=EXTRA, group="county_fips"):
        self.cats, self.extra, self.group = cats, extra, group

    def fit(self, d):
        self.any = GroupLogit(design(self.cats, self.extra), group=self.group).fit(d, d["any"])
        dd = d[d["any"] == 1]
        self.des = GroupLogit(design(self.cats, self.extra), group=self.group).fit(dd, dd["des"])
        return self

    def predict(self, d, group_known=False):
        pa = self.any.predict(d, group_known=group_known)
        pd_ = self.des.predict(d, group_known=group_known)
        return pa, pa * pd_


def draw_impute(df, ref, cats, seed):
    rng = np.random.default_rng(seed)
    out = df.copy()
    for c in cats:
        known = ref[c][ref[c] != UNKNOWN].value_counts(normalize=True)
        m = (out[c] == UNKNOWN).to_numpy()
        if m.any() and len(known):
            out.loc[m, c] = rng.choice(known.index.to_numpy(), m.sum(), p=known.to_numpy())
    return out


def metrics(y, p, tag):
    p = np.clip(p, EPS, 1 - EPS)
    return {f"{tag}_brier": float(np.mean((p - y) ** 2)),
            f"{tag}_logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            f"{tag}_auc": float(roc_auc_score(y, p)) if 0 < y.mean() < 1 else np.nan,
            f"{tag}_share_err": float(abs(p.mean() - y.mean()))}


def models_predict(tr, te, group_known):
    out = {}
    w = Fragility(cats=[], extra=[], group=None).fit(tr)
    out["wind_only"] = w.predict(te)
    c = Fragility(cats=["construction"], extra=[], group=None).fit(tr)
    out["class_curves"] = c.predict(te)
    seed = zlib.crc32(str(len(te)).encode())
    trd, ted = draw_impute(tr, tr, CATS, seed), draw_impute(te, tr, CATS, seed + 1)
    dz = design().fit(trd)
    Xtr, Xte = dz.transform(trd), dz.transform(ted)
    g1 = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, random_state=0).fit(Xtr, tr["any"])
    m = tr["any"].to_numpy() == 1
    g2 = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, random_state=0).fit(Xtr[m], tr["des"][m])
    pa = g1.predict_proba(Xte)[:, 1]
    out["gbm"] = (pa, pa * g2.predict_proba(Xte)[:, 1])
    hv = Fragility().fit(tr)
    out["hurricanevuln"] = hv.predict(te, group_known=group_known)
    return out, hv


def county_fold(d, county):
    tr, te = d[d.county_fips != county], d[d.county_fips == county]
    preds, hv = models_predict(tr, te, group_known=False)
    rows = []
    for k, (pa, pdes) in preds.items():
        rows.append({"fold": county, "scheme": "county", "model": k, "n": len(te),
                     **metrics(te["any"].to_numpy(), pa, "any"), **metrics(te["des"].to_numpy(), pdes, "des")})
    eta = hv.any.linpred(te)
    z = 1.2815516 * np.sqrt(hv.any.tau2)
    from scipy.special import expit
    inter = {"county": county, "n": len(te), "obs": float(te["any"].mean()),
             "pred": float(preds["hurricanevuln"][0].mean()),
             "lo80": float(expit(eta - z).mean()), "hi80": float(expit(eta + z).mean())}
    return rows, inter


def tile_fold(d, k, folds=5):
    tiles = np.array(sorted(d.tile.unique()))
    rng = np.random.default_rng(7)
    assign = dict(zip(tiles, rng.permutation(len(tiles)) % folds))
    f = d.tile.map(assign)
    tr, te = d[f != k], d[f == k]
    preds, _ = models_predict(tr, te, group_known=True)
    return [{"fold": f"tiles-{k}", "scheme": "tiles", "model": m, "n": len(te),
             **metrics(te["any"].to_numpy(), pa, "any"), **metrics(te["des"].to_numpy(), pdes, "des")}
            for m, (pa, pdes) in preds.items()]


def boot_tiles(d, seed):
    rng = np.random.default_rng(seed)
    tiles = d.tile.unique()
    pick = rng.choice(tiles, len(tiles), replace=True)
    parts = [d[d.tile == t] for t in pick]
    bd = pd.concat(parts, ignore_index=True)
    m = GroupLogit(design(), group="county_fips", em_iter=8).fit(bd, bd["any"])
    return pd.Series(m.beta, index=m.design.columns)
