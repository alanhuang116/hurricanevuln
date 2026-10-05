"""Model components for HurricaneVuln.

GroupLogit   logistic regression with a partially pooled intercept per group
             (assessment county for fragility, storm for household loss)
GroupGauss   Gaussian regression for log loss with a partially pooled
             intercept per group (lognormal severity)
Design       one-hot categorical fields plus numeric terms, with the
             statistics needed to rebuild the design in JavaScript

'unknown' is never a parameter: an unknown field takes the training
frequencies of its known levels (its average contribution).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

UNKNOWN = "unknown"
GH_X, GH_W = np.polynomial.hermite.hermgauss(24)
V_REF = 50.0          # m/s, reference wind for the log-wind terms


def wind_terms(v_ms):
    lv = np.log(np.maximum(np.asarray(v_ms, float), 5.0) / V_REF)
    return {"log_wind": lv, "log_wind_sq": lv * lv}


class Design:
    def __init__(self, cats, refs, num=("log_wind", "log_wind_sq"), extra=()):
        self.cats, self.refs = list(cats), dict(refs)
        self.num, self.extra = list(num), list(extra)

    def numeric(self, df):
        out = wind_terms(df["wind_ms"].to_numpy(float))
        for k in self.extra:
            out[k] = df[k].to_numpy(float)
        return out

    def fit(self, df):
        self.levels, self.freq = {}, {}
        for c in self.cats:
            known = df[c][df[c] != UNKNOWN]
            self.levels[c] = sorted(v for v in known.unique() if v != self.refs[c])
            vc = known.value_counts(normalize=True)
            self.freq[c] = {v: float(vc.get(v, 0.0)) for v in self.levels[c]}
        num = self.numeric(df)
        keys = self.num + self.extra
        self.mean = {k: float(np.mean(num[k])) for k in keys}
        self.sd = {k: float(np.std(num[k]) or 1.0) for k in keys}
        self.columns = [f"{c}={v}" for c in self.cats for v in self.levels[c]] + keys
        return self

    def transform(self, df):
        cols = []
        for c in self.cats:
            vals = df[c].to_numpy()
            unk = vals == UNKNOWN
            for v in self.levels[c]:
                col = (vals == v).astype(float)
                col[unk] = self.freq[c][v]
                cols.append(col)
        num = self.numeric(df)
        for k in self.num + self.extra:
            cols.append((num[k] - self.mean[k]) / self.sd[k])
        return np.column_stack(cols)

    def to_json(self):
        return {"cats": self.cats, "refs": self.refs, "levels": self.levels, "freq": self.freq,
                "num": self.num, "extra": self.extra, "mean": self.mean, "sd": self.sd,
                "columns": self.columns, "v_ref": V_REF}


def _groups(df, col):
    if col is None:
        return np.array([]), np.zeros(len(df), int), 0
    codes, idx = np.unique(df[col].astype(str).to_numpy(), return_inverse=True)
    return codes, idx, len(codes)


class GroupLogit:
    def __init__(self, design, group="group", ridge=1.0, em_iter=15):
        self.design, self.group, self.ridge, self.em_iter = design, group, ridge, em_iter

    def _nll(self, th, X, y, g, ng, tau2):
        k = X.shape[1]
        eta = th[0] + X @ th[1:k + 1] + (th[k + 1:][g] if ng else 0.0)
        p = expit(eta)
        r = p - y
        f = np.sum(np.logaddexp(0.0, eta) - y * eta) + 0.5 * self.ridge * th[1:k + 1] @ th[1:k + 1]
        grad = np.empty_like(th)
        grad[0] = r.sum()
        grad[1:k + 1] = X.T @ r + self.ridge * th[1:k + 1]
        if ng:
            u = th[k + 1:]
            f += 0.5 * u @ u / tau2
            grad[k + 1:] = np.bincount(g, weights=r, minlength=ng) + u / tau2
        return f, grad

    def fit(self, df, y):
        y = np.asarray(y, float)
        self.design.fit(df)
        X = self.design.transform(df)
        k = X.shape[1]
        codes, g, ng = _groups(df, self.group)
        th = np.zeros(1 + k + ng)
        th[0] = np.log((y.mean() + 1e-4) / (1 - y.mean() + 1e-4))
        tau2 = 1.0
        for _ in range(self.em_iter if ng else 1):
            th = minimize(self._nll, th, args=(X, y, g, ng, tau2), jac=True, method="L-BFGS-B",
                          options={"maxiter": 3000}).x
            if not ng:
                break
            u = th[k + 1:]
            p = expit(th[0] + X @ th[1:k + 1] + u[g])
            h = np.bincount(g, weights=p * (1 - p), minlength=ng) + 1.0 / tau2
            new = float(np.mean(u ** 2 + 1.0 / h))
            if abs(new - tau2) < 1e-4:
                tau2 = new
                break
            tau2 = max(new, 1e-4)
        self.mu, self.beta = float(th[0]), th[1:k + 1]
        self.tau2 = tau2 if ng else 0.0
        self.groups = {str(c): float(v) for c, v in zip(codes, th[k + 1:])}
        p = expit(th[0] + X @ self.beta + (th[k + 1:][g] if ng else 0.0))
        Xa = np.column_stack([np.ones(len(X)), X])
        H = (Xa * (p * (1 - p))[:, None]).T @ Xa
        H[1:, 1:] += self.ridge * np.eye(k)
        self.cov = np.linalg.pinv(H)
        return self

    def linpred(self, df):
        return self.mu + self.design.transform(df) @ self.beta

    def predict(self, df, group_known=False, u_mean=0.0, u_var=None):
        eta = self.linpred(df)
        if group_known and self.group is not None:
            return expit(eta + df[self.group].astype(str).map(self.groups).fillna(0.0).to_numpy())
        var = self.tau2 if u_var is None else u_var
        if var <= 0:
            return expit(eta + u_mean)
        s = np.sqrt(2 * var)
        return expit(eta[:, None] + u_mean + s * GH_X[None, :]) @ GH_W / np.sqrt(np.pi)

    def to_json(self):
        return {"mu": self.mu, "beta": self.beta.tolist(), "tau2": self.tau2,
                "groups": self.groups, "design": self.design.to_json(),
                "se": np.sqrt(np.clip(np.diag(self.cov), 0, None)).tolist()}


class GroupGauss:
    """log(loss) = mu + x'beta + u_group + e,  u ~ N(0, tau2), e ~ N(0, sigma2)."""

    def __init__(self, design, group="group", ridge=1.0, em_iter=30):
        self.design, self.group, self.ridge, self.em_iter = design, group, ridge, em_iter

    def fit(self, df, z):
        z = np.asarray(z, float)
        self.design.fit(df)
        X = np.column_stack([np.ones(len(df)), self.design.transform(df)])
        codes, g, ng = _groups(df, self.group)
        k = X.shape[1]
        u = np.zeros(ng)
        tau2, sig2 = 0.5, 1.0
        pen = np.eye(k) * self.ridge
        pen[0, 0] = 0.0
        XtX = X.T @ X
        for _ in range(self.em_iter):
            r = z - (u[g] if ng else 0.0)
            b = np.linalg.solve(XtX + pen * sig2, X.T @ r)
            res = z - X @ b
            if ng:
                n_g = np.bincount(g, minlength=ng)
                s_g = np.bincount(g, weights=res, minlength=ng)
                shrink = tau2 / (tau2 + sig2 / np.maximum(n_g, 1))
                u = shrink * s_g / np.maximum(n_g, 1)
                post_var = 1.0 / (n_g / sig2 + 1.0 / tau2)
                tau2 = max(float(np.mean(u ** 2 + post_var)), 1e-4)
            e = res - (u[g] if ng else 0.0)
            sig2 = float(np.mean(e ** 2))
        self.mu, self.beta = float(b[0]), b[1:]
        self.tau2, self.sigma2 = (tau2 if ng else 0.0), sig2
        self.groups = {str(c): float(v) for c, v in zip(codes, u)}
        return self

    def linpred(self, df):
        return self.mu + self.design.transform(df) @ self.beta

    def predictive(self, df, group_known=False):
        """Mean and sd of log loss for new records."""
        m = self.linpred(df)
        if group_known and self.group is not None:
            m = m + df[self.group].astype(str).map(self.groups).fillna(0.0).to_numpy()
            return m, np.full(len(m), np.sqrt(self.sigma2))
        return m, np.full(len(m), np.sqrt(self.sigma2 + self.tau2))

    def to_json(self):
        return {"mu": self.mu, "beta": self.beta.tolist(), "tau2": self.tau2,
                "sigma2": self.sigma2, "groups": self.groups, "design": self.design.to_json()}
