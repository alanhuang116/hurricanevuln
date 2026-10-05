"""Diagnostic: which changes to the household loss model close the gap to
gradient boosting? Scored by CRPS on six withheld storms."""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from hurricanevuln.loss import crps, hurdle_quantiles, prepare  # noqa: E402
from hurricanevuln.model import Design, GroupGauss, GroupLogit, wind_terms  # noqa: E402

STORMS = ["Michael 2018", "Ian 2022", "Harvey 2017", "Fiona 2022", "Helene 2024", "Laura 2020"]


def add_terms(d):
    kt = d.wind_ms / 0.514444
    for h in (50, 64, 83, 96, 113):
        d[f"h{h}"] = np.maximum(kt - h, 0) / 20.0
    d["flood_reg"] = d.flood * d.regime_2019
    d["ins_reg"] = d.insured * d.regime_2019
    d["water_reg"] = d.log_water * d.regime_2019
    d["mh_reg"] = (d.residence == "mobile_home") * d.regime_2019
    lw = wind_terms(d.wind_ms)["log_wind"]
    d["wind_reg"] = lw * d.regime_2019
    d["wind_flood"] = lw * d.flood
    for h in (6, 18, 36):
        d[f"w{h}"] = np.log1p(np.maximum(d.water_in.clip(upper=120) - h, 0))
    d["flood_mh"] = d.flood * (d.residence == "mobile_home")
    d["flood_fins"] = d.flood * d.flood_insured
    d["flood_ins"] = d.flood * d.insured
    return d


BASE = ["flood", "log_water", "insured", "regime_2019", "mh_wind"]
FULL = BASE + ["h50", "h64", "h83", "h96", "h113", "flood_reg", "ins_reg", "water_reg", "mh_reg",
               "wind_reg", "wind_flood", "w6", "w18", "w36", "flood_mh", "flood_fins", "flood_ins"]
VARIANTS = {
    "full": (FULL, ("log_wind",), True),

    "hinge_regime": (BASE + ["h50", "h64", "h83", "h96", "h113", "flood_reg", "ins_reg",
                             "water_reg", "mh_reg", "wind_reg", "wind_flood"], ("log_wind",), True),

}


def run(d, storm, name):
    extra, num, use_tau = VARIANTS[name]
    tr, te = d[d.storm != storm], d[d.storm == storm].sample(min(20000, (d.storm == storm).sum()), random_state=0)
    ds = lambda: Design(["residence"], {"residence": "house_duplex"}, num=num, extra=extra)  # noqa: E731
    mp = GroupLogit(ds(), group="storm").fit(tr, tr.loss_pos)
    pos = tr[tr.loss > 0]
    ms = GroupGauss(ds(), group="storm").fit(pos, np.log(pos.loss))
    m, sd = ms.predictive(te)
    if not use_tau:
        sd = np.full(len(te), np.sqrt(ms.sigma2))
    q = hurdle_quantiles(mp.predict(te), m, sd)
    return {"storm": storm, "variant": name, "crps": float(np.mean(crps(q, te.loss.to_numpy()))),
            "tau_sev": float(np.sqrt(ms.tau2)), "sigma": float(np.sqrt(ms.sigma2))}


def main():
    d = add_terms(prepare(pd.read_csv(os.path.join(ROOT, "data", "processed", "household_loss.csv"),
                                      dtype={"geoid": str})))
    res = Parallel(n_jobs=6)(delayed(run)(d, s, v) for s in STORMS for v in VARIANTS)
    r = pd.DataFrame(res)
    print(r.pivot(index="storm", columns="variant", values="crps").round(0).to_string())
    print(r.groupby("variant")[["crps", "tau_sev", "sigma"]].mean().round(3).to_string())
    g = pd.read_csv(os.path.join(ROOT, "reports", "bench_loss.csv"))
    print(g[g.storm.isin(STORMS)].pivot(index="storm", columns="model", values="crps").round(0).to_string())


if __name__ == "__main__":
    main()
