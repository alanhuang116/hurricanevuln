"""Fragility validation and building-factor grades (Hurricane Michael).

1. Leave-one-county-out: counties with at least 1,000 buildings. The
   withheld county's assessment effect is unknown, so predictions integrate
   over it (a new assessment area).
2. Spatial tiles: 0.1 degree tiles split into 5 folds; county effects known
   (new neighbourhoods inside assessed counties).
3. Factor grades: each building-attribute effect on P(damage) with a 90%
   interval from resampling tiles. 'supported' = interval excludes zero and
   the sign agrees with engineering expectation where one exists.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from hurricanevuln import taxonomy as T  # noqa: E402
from hurricanevuln.fragility import (PRIOR, REFS, Fragility, boot_tiles, county_fold,  # noqa: E402
                                     prepare, tile_fold)

REP = os.path.join(ROOT, "reports")
B = int(os.environ.get("HV_BOOT", 100))


def main():
    d = prepare(pd.read_csv(os.path.join(ROOT, "data", "processed", "fragility.csv"),
                            dtype={"county_fips": str}))
    big = d.county_fips.value_counts()
    counties = list(big[big >= 1000].index)
    print("county folds:", len(counties))
    res = Parallel(n_jobs=6)(delayed(county_fold)(d, c) for c in counties)
    rows = [r for x in res for r in x[0]]
    inter = pd.DataFrame([x[1] for x in res])
    rows += [r for x in Parallel(n_jobs=5)(delayed(tile_fold)(d, k) for k in range(5)) for r in x]
    rows = pd.DataFrame(rows)
    rows.to_csv(os.path.join(REP, "bench_fragility.csv"), index=False)
    inter.to_csv(os.path.join(REP, "bench_fragility_county.csv"), index=False)
    cols = ["any_brier", "any_logloss", "any_auc", "any_share_err", "des_brier", "des_logloss", "des_auc"]
    summ = rows.groupby(["scheme", "model"])[cols].mean()
    print(summ.round(4).to_string())
    cov = float(((inter.obs >= inter.lo80) & (inter.obs <= inter.hi80)).mean())
    print(f"county damage-share 80% coverage: {cov:.3f} over {len(inter)} counties")
    print(inter.round(3).to_string())

    full = Fragility().fit(d)
    est = pd.Series(full.any.beta, index=full.any.design.columns)
    est_d = pd.Series(full.des.beta, index=full.des.design.columns)
    boots = Parallel(n_jobs=6)(delayed(boot_tiles)(d, s) for s in range(B))
    bm = pd.concat(boots, axis=1).reindex(est.index)
    grades = []
    for lv in est.index:
        if "=" not in lv:
            continue
        f, v = lv.split("=")
        lo, hi = float(bm.loc[lv].quantile(0.05)), float(bm.loc[lv].quantile(0.95))
        prior = PRIOR.get(lv, 0)
        clear = lo > 0 or hi < 0
        ok = clear and (prior == 0 or np.sign(est[lv]) == prior)
        grades.append({"level": lv, "field": f, "value": v,
                       "value_name": T.LEVEL_NAMES.get(f if f != "use" else "use", {}).get(v, v),
                       "reference": T.LEVEL_NAMES.get(f, {}).get(REFS[f], REFS[f]),
                       "beta_any": float(est[lv]), "lo90": lo, "hi90": hi,
                       "odds_ratio": float(np.exp(est[lv])), "beta_destroyed_given_damage": float(est_d.get(lv, np.nan)),
                       "prior_sign": prior, "grade": "supported" if ok else "contested",
                       "n_level": int((d[f] == v).sum())})
    g = pd.DataFrame(grades)
    g.to_csv(os.path.join(REP, "fragility_factors.csv"), index=False)
    print(g[["level", "beta_any", "lo90", "hi90", "prior_sign", "grade", "beta_destroyed_given_damage", "n_level"]]
          .round(3).to_string(index=False))
    json.dump({"summary": summ.reset_index().to_dict("records"), "coverage80": cov,
               "county_intervals": inter.to_dict("records"), "factors": g.to_dict("records"),
               "tau_any": float(np.sqrt(full.any.tau2)), "tau_des": float(np.sqrt(full.des.tau2)),
               "n": int(len(d)), "bootstrap": B},
              open(os.path.join(REP, "fragility_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
