"""Leave-one-storm-out validation of the household loss model.

Each of the 19 storms is withheld in turn; models are trained on the other
18 and scored on (up to 20,000 sampled) households of the withheld storm.
Loss distributions are scored by CRPS in 2024 dollars.
"""
from __future__ import annotations

import json
import os
import sys

import pandas as pd
from joblib import Parallel, delayed

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
from hurricanevuln.loss import fold, prepare  # noqa: E402

REP = os.path.join(ROOT, "reports")


def main():
    d = prepare(pd.read_csv(os.path.join(ROOT, "data", "processed", "household_loss.csv"),
                            dtype={"geoid": str}))
    storms = sorted(d.storm.unique())
    res = Parallel(n_jobs=6)(delayed(fold)(d, s) for s in storms)
    rows = pd.DataFrame([r for x in res for r in x[0]])
    bins = pd.DataFrame([r for x in res for r in x[1]])
    st = pd.DataFrame([x[2] for x in res])
    rows.to_csv(os.path.join(REP, "bench_loss.csv"), index=False)
    bins.to_csv(os.path.join(REP, "bench_loss_binary.csv"), index=False)
    st.to_csv(os.path.join(REP, "bench_loss_storm.csv"), index=False)
    summ = rows.groupby("model")[["crps", "median_abs_err", "cov80"]].mean().sort_values("crps")
    wins = rows.pivot(index="storm", columns="model", values="crps").idxmin(axis=1).value_counts()
    summ["storms_won"] = [int(wins.get(m, 0)) for m in summ.index]
    print(summ.round(3).to_string())
    print(bins.groupby("model").mean(numeric_only=True).round(4).to_string())
    cov = float(((st.obs_mean >= st.lo80) & (st.obs_mean <= st.hi80)).mean())
    print(f"storm mean-loss 80% range coverage: {cov:.3f} over {len(st)} storms")
    print(st.round(0).to_string())
    json.dump({"summary": summ.reset_index().to_dict("records"), "coverage80": cov,
               "binary": bins.groupby("model").mean(numeric_only=True).reset_index().to_dict("records")},
              open(os.path.join(REP, "bench_loss_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
