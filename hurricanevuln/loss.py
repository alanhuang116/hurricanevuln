"""Household loss model (conditional on a FEMA inspection of an owner-occupied
primary residence) and the fold logic for leave-one-storm-out validation.

    P(loss > 0)        GroupLogit, storm effect partially pooled
    log loss | > 0     GroupGauss, storm effect partially pooled
    P(uninhabitable)   GroupLogit
    P(destroyed)       GroupLogit

FEMA changed how it records inspections around 2019: verified losses jump
roughly fourfold at similar winds and the roof-damage flag stops being
filled. 'regime_2019' is therefore an explicit covariate, and the product
predicts under the current (2019 on) regime.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.special import expit
from scipy.stats import norm
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import roc_auc_score

from .model import Design, GroupGauss, GroupLogit, wind_terms

REFS = {"residence": "house_duplex"}
WIND_HINGES = (50, 64, 83, 96, 113)          # knots
WATER_HINGES = (6, 18, 36)                   # inches above floor
EXTRA = (["flood", "log_water", "insured", "regime_2019", "mh_wind"]
         + [f"h{h}" for h in WIND_HINGES]
         + ["flood_reg", "ins_reg", "water_reg", "mh_reg", "wind_reg", "wind_flood"]
         + [f"w{h}" for h in WATER_HINGES] + ["flood_mh", "flood_fins", "flood_ins"])
NUM = ("log_wind",)
TAUS = (np.arange(99) + 0.5) / 99.0
EPS = 1e-6


def prepare(df):
    d = df.copy()
    d["log_water"] = np.log1p(d.water_in.clip(upper=120))
    d["regime_2019"] = (d.year >= 2019).astype(float)
    d["mh_wind"] = wind_terms(d.wind_ms)["log_wind"] * (d.residence == "mobile_home")
    d["loss_pos"] = (d.loss > 0).astype(int)
    for c in ["flood", "insured", "flood_insured"]:
        d[c] = d[c].astype(float)
    kt = d.wind_ms / 0.514444
    for h in WIND_HINGES:
        d[f"h{h}"] = np.maximum(kt - h, 0) / 20.0
    lw = wind_terms(d.wind_ms)["log_wind"]
    mh = (d.residence == "mobile_home").astype(float)
    d["flood_reg"] = d.flood * d.regime_2019
    d["ins_reg"] = d.insured * d.regime_2019
    d["water_reg"] = d.log_water * d.regime_2019
    d["mh_reg"] = mh * d.regime_2019
    d["wind_reg"] = lw * d.regime_2019
    d["wind_flood"] = lw * d.flood
    for h in WATER_HINGES:
        d[f"w{h}"] = np.log1p(np.maximum(d.water_in.clip(upper=120) - h, 0))
    d["flood_mh"] = d.flood * mh
    d["flood_fins"] = d.flood * d.flood_insured
    d["flood_ins"] = d.flood * d.insured
    return d


def design():
    return Design(["residence"], REFS, num=NUM, extra=EXTRA)


def hurdle_quantiles(p, m, s):
    """Quantiles at TAUS of a mixture: 0 w.p. 1-p, lognormal(m, s) w.p. p."""
    p = np.clip(p, EPS, 1 - EPS)[:, None]
    t = TAUS[None, :]
    inner = np.clip((t - (1 - p)) / p, EPS, 1 - EPS)
    q = np.exp(m[:, None] + s[:, None] * norm.ppf(inner))
    return np.where(t <= 1 - p, 0.0, q)


def crps(q, y):
    """CRPS from quantiles via the pinball-loss integral."""
    y = y[:, None]
    return np.mean(2 * ((y < q) - TAUS[None, :]) * (q - y), axis=1)


def binary_metrics(y, p, prefix):
    p = np.clip(p, EPS, 1 - EPS)
    out = {f"{prefix}_brier": float(np.mean((p - y) ** 2)),
           f"{prefix}_logloss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))}
    out[f"{prefix}_auc"] = float(roc_auc_score(y, p)) if 0 < y.mean() < 1 else np.nan
    return out


def fit_models(tr):
    m_pos = GroupLogit(design(), group="storm").fit(tr, tr.loss_pos)
    pos = tr[tr.loss > 0]
    m_sev = GroupGauss(design(), group="storm").fit(pos, np.log(pos.loss))
    m_unh = GroupLogit(design(), group="storm").fit(tr, tr.uninhabitable)
    m_des = GroupLogit(design(), group="storm").fit(tr, tr.destroyed)
    return m_pos, m_sev, m_unh, m_des


def fold(d, storm, max_test=20000, seed=0):
    tr, te = d[d.storm != storm], d[d.storm == storm]
    if len(te) > max_test:
        te = te.sample(max_test, random_state=seed)
    y = te.loss.to_numpy()
    preds = {}

    # Climatology: the pooled training distribution of loss.
    q_clim = np.quantile(tr.loss.to_numpy(), TAUS)
    preds["climatology"] = np.tile(q_clim, (len(te), 1))

    # Wind only: same hurdle form with wind terms and no other covariates.
    wd = lambda: Design([], {}, num=NUM, extra=[f"h{h}" for h in WIND_HINGES])  # noqa: E731
    pw = GroupLogit(wd(), group="storm").fit(tr, tr.loss_pos)
    pos = tr[tr.loss > 0]
    sw = GroupGauss(wd(), group="storm").fit(pos, np.log(pos.loss))
    mw, sdw = sw.predictive(te)
    preds["wind_only"] = hurdle_quantiles(pw.predict(te), mw, sdw)

    # Gradient boosting hurdle, no storm structure.
    dz = design().fit(tr)
    Xtr, Xte = dz.transform(tr), dz.transform(te)
    clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08, random_state=0).fit(Xtr, tr.loss_pos)
    Xp = dz.transform(pos)
    reg = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.08, random_state=0).fit(Xp, np.log(pos.loss))
    sd_g = float(np.std(np.log(pos.loss) - reg.predict(Xp)))
    p_gbm = clf.predict_proba(Xte)[:, 1]
    preds["gbm"] = hurdle_quantiles(p_gbm, reg.predict(Xte), np.full(len(te), sd_g))

    m_pos, m_sev, m_unh, m_des = fit_models(tr)
    p_hv = m_pos.predict(te)
    m, sd = m_sev.predictive(te)
    preds["hurricanevuln"] = hurdle_quantiles(p_hv, m, sd)

    rows = []
    for k, q in preds.items():
        r = {"storm": storm, "model": k, "n": len(te), "crps": float(np.mean(crps(q, y))),
             "median_abs_err": float(np.mean(np.abs(q[:, 49] - y))),
             "cov80": float(np.mean((y >= q[:, 9]) & (y <= q[:, 89])))}
        rows.append(r)
    bins = [{"storm": storm, "model": "hurricanevuln", **binary_metrics(te.loss_pos.to_numpy(), p_hv, "pos"),
             **binary_metrics(te.uninhabitable.to_numpy(), m_unh.predict(te), "unh"),
             **binary_metrics(te.destroyed.to_numpy(), m_des.predict(te), "des")},
            {"storm": storm, "model": "gbm", **binary_metrics(te.loss_pos.to_numpy(), p_gbm, "pos")},
            {"storm": storm, "model": "wind_only", **binary_metrics(te.loss_pos.to_numpy(), pw.predict(te), "pos")}]
    # Storm-level: predicted vs observed mean loss, with an 80% range from
    # the storm effect of the severity and frequency models.
    eta_p = m_pos.linpred(te)
    z = 1.2815516
    def mean_loss(up, us):
        p = expit(eta_p + up)
        return float(np.mean(p * np.exp(m_sev.linpred(te) + us + 0.5 * m_sev.sigma2)))
    st = {"storm": storm, "n": len(te), "obs_mean": float(y.mean()),
          "pred_mean": mean_loss(0, 0),
          "lo80": mean_loss(-z * np.sqrt(m_pos.tau2), -z * np.sqrt(m_sev.tau2)),
          "hi80": mean_loss(z * np.sqrt(m_pos.tau2), z * np.sqrt(m_sev.tau2))}
    return rows, bins, st
