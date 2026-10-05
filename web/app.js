/* HurricaneVuln front end. The engine block mirrors hurricanevuln/windfield.py,
   model.py, fragility.py and loss.py; tests/test_js_parity.js runs it against
   Python reference cases. */
"use strict";
const $ = s => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const fmt$ = x => "$" + Math.round(x).toLocaleString("en-US");
const fmtK = x => x >= 1e6 ? "$" + (x / 1e6).toFixed(2) + "m" : x >= 1e4 ? "$" + Math.round(x / 1e3) + "k" : fmt$(x);
function el(tag, attrs = {}, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }

/* ===== engine ===== */
const KT = 0.514444, R_EARTH = 6371.0, STEP_MIN = 15, Z80 = 1.2815516;
const sig = z => 1 / (1 + Math.exp(-z));
function interpTrack(tr) {
  // Linear in time between best-track records, 15-minute grid (pandas time interpolation).
  const t = tr.t, n = t.length, out = { t: [], lat: [], lon: [], v: [], rmw: [] };
  for (let m = t[0]; m <= t[n - 1]; m += STEP_MIN) {
    let i = 0; while (i < n - 2 && t[i + 1] < m) i++;
    const f = t[i + 1] === t[i] ? 0 : (m - t[i]) / (t[i + 1] - t[i]);
    out.t.push(m); out.lat.push(tr.lat[i] + f * (tr.lat[i + 1] - tr.lat[i]));
    out.lon.push(tr.lon[i] + f * (tr.lon[i + 1] - tr.lon[i])); out.v.push((tr.v[i] + f * (tr.v[i + 1] - tr.v[i])) * KT);
    // rmw: interpolate only between valid records, otherwise missing
    let a = -1, b = -1;
    for (let k = n - 1; k >= 0; k--) if (t[k] <= m && tr.rmw[k] > 0) { a = k; break; }
    for (let k = 0; k < n; k++) if (t[k] >= m && tr.rmw[k] > 0) { b = k; break; }
    let r = NaN;
    if (a >= 0 && b >= 0) r = t[b] === t[a] ? tr.rmw[a] : tr.rmw[a] + (m - t[a]) / (t[b] - t[a]) * (tr.rmw[b] - tr.rmw[a]);
    out.rmw.push(r);
  }
  const N = out.t.length, rad = Math.PI / 180, grad = x => x.map((_, i) => i === 0 ? x[1] - x[0] : i === N - 1 ? x[N - 1] - x[N - 2] : (x[i + 1] - x[i - 1]) / 2);
  const la = out.lat.map(x => x * rad), lo = out.lon.map(x => x * rad), dla = grad(la), dlo = grad(lo);
  out.vt = []; out.head = []; out.rm = []; out.b = []; out.vsym = []; out.clat = la; out.clon = lo;
  for (let i = 0; i < N; i++) {
    const dy = dla[i] * R_EARTH, dx = dlo[i] * R_EARTH * Math.cos(la[i]);
    const vt = Math.hypot(dx, dy) * 1000 / (STEP_MIN * 60);
    out.vt.push(vt); out.head.push(Math.atan2(dx, dy));
    const obs = out.rmw[i] * 1.852;
    const rm = (isFinite(obs) && obs > 0) ? obs : 46.4 * Math.exp(-0.0155 * out.v[i] + 0.0169 * Math.abs(out.lat[i]));
    out.rm.push(rm); out.b.push(Math.min(2.2, Math.max(0.8, 1.881 - 0.00557 * rm - 0.01097 * Math.abs(out.lat[i]))));
    out.vsym.push(Math.max(out.v[i] - 0.5 * vt, 0));
  }
  out.n = N; return out;
}
function windStep(S, i, laR, loR) {
  const dy = (laR - S.clat[i]) * R_EARTH, dx = (loR - S.clon[i]) * R_EARTH * Math.cos(S.clat[i]);
  const r = Math.max(Math.hypot(dx, dy), 0.5);
  if (r > 900) return 0;
  const phi = Math.atan2(dx, dy), x = Math.pow(S.rm[i] / r, S.b[i]);
  return (S.vsym[i] + 0.5 * S.vt[i] * Math.cos(phi - S.head[i] - Math.PI / 2)) * Math.sqrt(x * Math.exp(1 - x));
}
function peakWind(S, lat, lon, upTo = S.n - 1) {
  const laR = lat * Math.PI / 180, loR = lon * Math.PI / 180; let m = 0;
  for (let i = 0; i <= upTo; i++) { const v = windStep(S, i, laR, loR); if (v > m) m = v; }
  return m;
}
function category(kt) { return kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : kt >= 34 ? 0 : -1; }
const CAT_NAME = c => c === -1 ? "Below TS" : c === 0 ? "Tropical Storm" : "Category " + c;

function designRow(D, x) {
  const v = [];
  for (const c of D.cats) for (const lv of D.levels[c]) v.push(x[c] === "unknown" ? D.freq[c][lv] : (x[c] === lv ? 1 : 0));
  const lw = Math.log(Math.max(x.wind_ms, 5) / D.v_ref), num = { log_wind: lw, log_wind_sq: lw * lw };
  for (const k of D.num) v.push((num[k] - D.mean[k]) / D.sd[k]);
  for (const k of D.extra) v.push((x[k] - D.mean[k]) / D.sd[k]);
  return v;
}
function linpred(M, x) { const v = designRow(M.design, x); let e = M.mu; for (let j = 0; j < v.length; j++) e += v[j] * M.beta[j]; return e; }
function pInt(e, v, um = 0) {
  if (v <= 0) return sig(e + um);
  const s = Math.sqrt(2 * v); let p = 0;
  for (let i = 0; i < B.gh.x.length; i++) p += B.gh.w[i] * sig(e + um + s * B.gh.x[i]);
  return p / Math.sqrt(Math.PI);
}
const FREFS = { construction: "wood", use: "single_family", storeys: "1", era: "1970_1993", quality: "average", foundation: "slab" };
function graded(x) {
  const o = { ...x };
  for (const c in FREFS) { const ok = new Set([...(B.spec[c] || []), FREFS[c], "unknown"]); if (!ok.has(o[c])) o[c] = FREFS[c]; }
  return o;
}
function fragility(x) {
  const g = graded(x), A = B.frag.any, Dm = B.frag.des;
  const ea = linpred(A, g), ed = linpred(Dm, g);
  const pa = pInt(ea, A.tau2), pd = pInt(ed, Dm.tau2);
  const sa = Math.sqrt(A.tau2);
  return { any: pa, des: pa * pd, lo: sig(ea - Z80 * sa), hi: sig(ea + Z80 * sa), eta: ea };
}
function lossFeatures(h) {
  const kt = h.wind_ms / KT, lw = Math.log(Math.max(h.wind_ms, 5) / 50), mh = h.residence === "mobile_home" ? 1 : 0;
  const reg = h.year >= 2019 ? 1 : 0, w = Math.min(h.water_in, 120), lwat = Math.log1p(w);
  const x = { residence: h.residence, wind_ms: h.wind_ms, flood: h.flood, log_water: lwat, insured: h.insured,
    regime_2019: reg, mh_wind: lw * mh, flood_reg: h.flood * reg, ins_reg: h.insured * reg, water_reg: lwat * reg,
    mh_reg: mh * reg, wind_reg: lw * reg, wind_flood: lw * h.flood, flood_mh: h.flood * mh,
    flood_fins: h.flood * h.flood_insured, flood_ins: h.flood * h.insured };
  for (const hh of B.loss.wind_hinges) x["h" + hh] = Math.max(kt - hh, 0) / 20;
  for (const hh of B.loss.water_hinges) x["w" + hh] = Math.log1p(Math.max(w - hh, 0));
  return x;
}
function household(h) {
  const x = lossFeatures(h), L = B.loss;
  const ppos = pInt(linpred(L.pos, x), L.pos.tau2);
  const mu = linpred(L.sev, x), sd = Math.sqrt(L.sev.sigma2 + L.sev.tau2);
  return { ppos, mu, sd, mean: Math.exp(mu + sd * sd / 2), unh: pInt(linpred(L.unh, x), L.unh.tau2),
           des: pInt(linpred(L.des, x), L.des.tau2), q: p => Math.exp(mu + sd * probit(p)) };
}
function probit(p) { // Acklam's rational approximation
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function eraOf(y) { y = +y; if (!y || y < 1800) return "unknown"; return y < 1970 ? "pre1970" : y < 1994 ? "1970_1993" : y < 2002 ? "1994_2001" : y < 2010 ? "2002_2009" : "2010_2018"; }
function residenceOf(b) { return b.construction === "manufactured" || b.use === "mobile_home" ? "mobile_home" : b.use === "condo" ? "condo" : "house_duplex"; }
const RESIDENTIAL = new Set(["single_family", "mobile_home", "condo", "multi_family", "unknown"]);
/* ===== end engine ===== */

/* ===== shared state ===== */
const TRACKS = B.tracks.map(t => ({ ...t, S: interpTrack(t) }));
const byName = Object.fromEntries(TRACKS.map(t => [t.storm, t]));
const STATS = Object.fromEntries(B.storm_stats.map(s => [s.storm, s]));
const bldg = { construction: "wood", use: "single_family", storeys: "1", year: 1985, quality: "average", foundation: "slab",
  sqft: 1800, low_ground: false, coastal_v: false, wind_src: "pin", wind_mph: 130, water_in: 0, insured: true, flood_insured: false };
const pin = { lat: 30.17, lon: -85.66, storm: "Michael 2018", wind_ms: null };
const tip = $("#tip");
function showTip(ev, html) { tip.innerHTML = html; tip.hidden = false; const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 10), y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 10); tip.style.left = x + "px"; tip.style.top = y + "px"; }
function hideTip() { tip.hidden = true; }
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== numbers in copy ===== */
const LB = B.loss_bench, FB = B.frag_bench;
const lsum = Object.fromEntries(LB.summary.map(r => [r.model, r]));
const nCov = Math.round(LB.coverage80 * B.meta.n_storms);
const K = {
  n_buildings: B.meta.n_buildings.toLocaleString("en-US"), n_households: B.meta.n_households.toLocaleString("en-US"),
  n_storms: B.meta.n_storms, cov_storms: nCov + " of " + B.meta.n_storms, dmg_share: pct(B.meta.damaged_share),
  version: "v" + B.meta.version, built: B.meta.built,
};
document.querySelectorAll("[data-k]").forEach(n => { if (K[n.dataset.k] !== undefined) n.textContent = K[n.dataset.k]; });

/* ===== hero vortex ===== */
(function vortex() {
  const cv = $("#vortex"), ctx = cv.getContext("2d");
  let W, H, dpr, P = [], cx, cy, Rm, Rout, t0 = performance.now(), running = true, raf;
  const N = innerWidth < 700 ? 1400 : 3200, ALPHA = 20 * Math.PI / 180, Bh = 1.35;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2); const r = cv.getBoundingClientRect();
    W = cv.width = Math.round(r.width * dpr); H = cv.height = Math.round(r.height * dpr);
    Rm = Math.min(W, H) * 0.06; Rout = Math.hypot(W, H) * 0.5; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  }
  function spawn(p, anywhere) {
    for (let k = 0; k < 20; k++) {
      const r = anywhere ? Rm * 1.1 + Math.pow(Math.random(), 0.7) * Rout : Rout * (0.55 + 0.45 * Math.random());
      const th = Math.random() * Math.PI * 2;
      const band = 0.5 + 0.5 * Math.cos(2 * (th + 1.9 * Math.log(r / Rm)));
      if (Math.random() < 0.12 + 0.88 * band) { p.r = r; p.th = th; p.age = 0; p.life = 260 + Math.random() * 420; return; }
    }
  }
  function init() { P = []; for (let i = 0; i < N; i++) { const p = {}; spawn(p, true); P.push(p); } }
  function frame(now) {
    const t = (now - t0) / 1000;
    const narrow = W / dpr < 760;
    cx = W * ((narrow ? 0.5 : 0.76) + 0.02 * Math.sin(t * 0.07)); cy = H * ((narrow ? 0.86 : 0.64) + 0.015 * Math.cos(t * 0.05));
    ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    // Central dense overcast: a faint glow added every frame settles at a
    // steady brightness against the fade, with a clear eye in the middle.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rm * 11);
    glow.addColorStop(0, "rgba(160,200,255,0)"); glow.addColorStop(0.07, "rgba(160,200,255,0)");
    glow.addColorStop(0.15, "rgba(205,225,255,0.016)"); glow.addColorStop(0.4, "rgba(160,195,240,0.008)"); glow.addColorStop(1, "rgba(120,160,220,0)");
    ctx.fillStyle = glow; ctx.fillRect(cx - Rm * 11, cy - Rm * 11, Rm * 22, Rm * 22);
    ctx.lineWidth = 1.5 * dpr;
    for (const p of P) {
      const x0 = cx + p.r * Math.cos(p.th), y0 = cy - p.r * Math.sin(p.th);
      const xx = Math.pow(Rm / p.r, Bh), s = Math.sqrt(xx * Math.exp(1 - xx));
      const v = 13 * dpr * s;
      p.th += v * Math.cos(ALPHA) / p.r; p.r -= v * Math.sin(ALPHA) * (p.r > Rm * 1.3 ? 1 : -0.6);
      p.age++;
      if (p.r < Rm * 0.9 || p.age > p.life) { spawn(p, false); continue; }
      const x1 = cx + p.r * Math.cos(p.th), y1 = cy - p.r * Math.sin(p.th);
      const a = Math.min(1, p.age / 30) * (0.12 + 0.62 * s);
      ctx.strokeStyle = `rgba(${180 + 75 * s | 0},${210 + 45 * s | 0},255,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    if (running) raf = requestAnimationFrame(frame);
  }
  resize(); init();
  addEventListener("resize", () => { resize(); });
  if (reduced) { running = false; for (let i = 0; i < 420; i++) frame(t0 + i * 16); return; }
  new IntersectionObserver(es => { const vis = es[0].isIntersecting; if (vis && !running) { running = true; raf = requestAnimationFrame(frame); } else if (!vis) { running = false; cancelAnimationFrame(raf); } }).observe(cv);
  raf = requestAnimationFrame(frame);
})();

/* ===== map renderer ===== */
const CITIES = [["Panama City", 30.159, -85.66], ["Mexico Beach", 29.948, -85.42], ["Tallahassee", 30.438, -84.281], ["Pensacola", 30.421, -87.217],
  ["Tampa", 27.95, -82.457], ["Miami", 25.762, -80.192], ["Fort Myers", 26.64, -81.872], ["Orlando", 28.538, -81.379], ["Jacksonville", 30.332, -81.656],
  ["New Orleans", 29.951, -90.072], ["Lake Charles", 30.226, -93.217], ["Houston", 29.76, -95.37], ["Corpus Christi", 27.801, -97.396],
  ["Savannah", 32.081, -81.091], ["Charleston", 32.776, -79.931], ["Wilmington", 34.226, -77.945], ["Mobile", 30.695, -88.04],
  ["Albany, GA", 31.578, -84.156], ["San Juan", 18.466, -66.106], ["Key West", 24.555, -81.78], ["Asheville", 35.595, -82.551]];
function catColor(kt, alpha = 1) {
  const c = category(kt); if (c < 0) return null;
  const v = ["--c0", "--c1", "--c2", "--c3", "--c4", "--c5"][c]; return { hex: css(v), alpha };
}
function hexRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
class StormMap {
  constructor(canvas, opts = {}) { this.cv = canvas; this.ctx = canvas.getContext("2d"); this.nx = opts.nx || 140; this.opts = opts; }
  setView(bbox) {
    const W = this.cv.width, H = this.cv.height; let [x0, y0, x1, y1] = bbox;
    const lat0 = (y0 + y1) / 2, kx = Math.cos(lat0 * Math.PI / 180);
    const w = (x1 - x0) * kx, h = y1 - y0;
    if (w / h > W / H) { const nh = w * H / W; y0 = lat0 - nh / 2; y1 = lat0 + nh / 2; } else { const nw = h * W / H / kx, mx = (x0 + x1) / 2; x0 = mx - nw / 2; x1 = mx + nw / 2; }
    this.bb = [x0, y0, x1, y1]; this.kx = kx; this.sx = W / (x1 - x0); this.sy = H / (y1 - y0);
    this.ny = Math.round(this.nx * H / W); this.grid = null; this.snaps = null;
  }
  P(lon, lat) { return [(lon - this.bb[0]) * this.sx, (this.bb[3] - lat) * this.sy]; }
  inv(px, py) { return [this.bb[0] + px / this.sx, this.bb[3] - py / this.sy]; }
  cellLL(i, j) { return [this.bb[0] + (i + 0.5) * (this.bb[2] - this.bb[0]) / this.nx, this.bb[3] - (j + 0.5) * (this.bb[3] - this.bb[1]) / this.ny]; }
  // Peak-wind swath with checkpoints every 24 steps so scrubbing is instant.
  prepare(S, i0, i1, done) {
    const n = this.nx * this.ny, la = new Float32Array(n), lo = new Float32Array(n);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) { const [x, y] = this.cellLL(i, j); la[j * this.nx + i] = y * Math.PI / 180; lo[j * this.nx + i] = x * Math.PI / 180; }
    const cur = new Float32Array(n), snaps = new Map(); snaps.set(i0, cur.slice());
    this.S = S; this.i0 = i0; this.i1 = i1; this.la = la; this.lo = lo; this.snaps = snaps; this.ready = false;
    let k = i0; const token = this.token = Symbol();
    const work = () => {
      if (token !== this.token) return;
      const end = Math.min(i1, k + 24);
      for (; k < end; k++) for (let c = 0; c < n; c++) { const v = windStep(S, k + 1, la[c], lo[c]); if (v > cur[c]) cur[c] = v; }
      snaps.set(k, cur.slice());
      if (k < i1) setTimeout(work, 0); else { this.ready = true; done && done(); }
    };
    work();
  }
  swathAt(idx) {
    if (!this.snaps) return null;
    let base = this.i0; for (const key of this.snaps.keys()) if (key <= idx && key > base) base = key;
    const g = this.snaps.get(base).slice(), n = g.length;
    for (let k = base; k < Math.min(idx, this.i1); k++) for (let c = 0; c < n; c++) { const v = windStep(this.S, k + 1, this.la[c], this.lo[c]); if (v > g[c]) g[c] = v; }
    return g;
  }
  draw({ idx, showFuture = true, cells = null, cellAlpha = 0, pinLL = null }) {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = css("--ocean"); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css("--land"); ctx.beginPath();
    for (const ring of B.land) { ring.forEach(([x, y], k) => { const [px, py] = this.P(x, y); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
    ctx.fill("evenodd");
    // swath
    const g = this.swathAt(idx);
    if (g) {
      if (!this.off) { this.off = document.createElement("canvas"); }
      this.off.width = this.nx; this.off.height = this.ny; const octx = this.off.getContext("2d"), img = octx.createImageData(this.nx, this.ny);
      const cols = ["--c0", "--c1", "--c2", "--c3", "--c4", "--c5"].map(v => hexRgb(css(v)));
      for (let c = 0; c < g.length; c++) {
        const kt = g[c] / KT, cat = category(kt); if (cat < 0) continue;
        const [r, gg, b] = cols[cat]; const a = cat === 0 ? 110 : 190;
        img.data[c * 4] = r; img.data[c * 4 + 1] = gg; img.data[c * 4 + 2] = b; img.data[c * 4 + 3] = a;
      }
      octx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(this.off, 0, 0, W, H);
    }
    // observed damage cells
    if (cells && cellAlpha > 0) {
      ctx.globalAlpha = cellAlpha;
      const dmg = hexRgb(css("--c3"));
      for (const [lon, lat, s, n] of cells) { const [px, py] = this.P(lon, lat), [qx, qy] = this.P(lon + s, lat - s); const sh = Math.min(1, n);
        ctx.fillStyle = `rgba(${dmg[0]},${dmg[1]},${dmg[2]},${(0.25 + 0.75 * sh).toFixed(2)})`; ctx.fillRect(px - (qx - px) / 2, py - (qy - py) / 2, Math.max(qx - px, 2), Math.max(qy - py, 2)); }
      ctx.globalAlpha = 1;
    }
    // coast and states
    ctx.lineWidth = 1.2; ctx.strokeStyle = css("--coast"); ctx.beginPath();
    for (const ring of B.land) { ring.forEach(([x, y], k) => { const [px, py] = this.P(x, y); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); }
    ctx.stroke();
    ctx.lineWidth = 0.8; ctx.strokeStyle = css("--border-st"); ctx.setLineDash([4, 4]); ctx.beginPath();
    for (const line of B.states) { line.forEach(([x, y], k) => { const [px, py] = this.P(x, y); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); }
    ctx.stroke(); ctx.setLineDash([]);
    // graticule labels
    ctx.fillStyle = css("--ink-3"); ctx.font = `500 ${Math.round(W / 70)}px ${getComputedStyle(document.body).fontFamily}`;
    const step = (this.bb[2] - this.bb[0]) > 14 ? 5 : 2;
    for (let lon = Math.ceil(this.bb[0] / step) * step; lon < this.bb[2]; lon += step) { const [px] = this.P(lon, 0); ctx.fillText(`${Math.abs(lon)}°W`, px + 4, H - 10); }
    for (let lat = Math.ceil(this.bb[1] / step) * step; lat < this.bb[3]; lat += step) { const [, py] = this.P(0, lat); ctx.fillText(`${lat}°N`, 8, py - 4); }
    // cities
    ctx.font = `500 ${Math.round(W / 62)}px ${getComputedStyle(document.body).fontFamily}`;
    const placed = [];
    for (const [nm, la, lo] of CITIES) { if (lo < this.bb[0] || lo > this.bb[2] || la < this.bb[1] || la > this.bb[3]) continue; const [px, py] = this.P(lo, la);
      if (placed.some(([qx, qy]) => Math.abs(qx - px) < W / 9 && Math.abs(qy - py) < W / 45)) continue; placed.push([px, py]);
      ctx.fillStyle = css("--ink"); ctx.beginPath(); ctx.arc(px, py, W / 300, 0, 7); ctx.fill(); ctx.fillStyle = css("--ink-2"); ctx.fillText(nm, px + W / 150, py - W / 200); }
    // track
    const S = this.S; if (!S) return;
    const end = Math.max(0, Math.min(idx, S.n - 1));
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (showFuture) { ctx.lineWidth = 2; ctx.strokeStyle = css("--ink-3"); ctx.globalAlpha = 0.45; ctx.setLineDash([3, 6]); ctx.beginPath();
      for (let i = end; i < S.n; i += 2) { const [px, py] = this.P(S.lon[i], S.lat[i]); i === end ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    for (let i = 1; i <= end; i++) {
      const [ax, ay] = this.P(S.lon[i - 1], S.lat[i - 1]), [bx, by] = this.P(S.lon[i], S.lat[i]);
      ctx.lineWidth = W / 260 + 2.5; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const cc = catColor(S.v[i] / KT); ctx.lineWidth = W / 260; ctx.strokeStyle = cc ? cc.hex : css("--ink-3"); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    // eye glyph
    const [ex, ey] = this.P(S.lon[end], S.lat[end]), rr = W / 38, rot = performance.now() / 600;
    const grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, rr * 2.2); grd.addColorStop(0, "rgba(255,255,255,.55)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(ex, ey, rr * 2.2, 0, 7); ctx.fill();
    ctx.strokeStyle = css("--ink"); ctx.lineWidth = W / 380;
    for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc(ex, ey, rr, -rot + k * Math.PI, -rot + k * Math.PI + 1.9, false); ctx.stroke(); }
    ctx.fillStyle = css("--ink"); ctx.beginPath(); ctx.arc(ex, ey, rr * 0.28, 0, 7); ctx.fill();
    if (pinLL) { const [px, py] = this.P(pinLL[1], pinLL[0]); const s = W / 90;
      ctx.fillStyle = css("--accent"); ctx.strokeStyle = "#fff"; ctx.lineWidth = W / 500;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.bezierCurveTo(px - s, py - s * 1.2, px - s, py - s * 2.4, px, py - s * 2.4); ctx.bezierCurveTo(px + s, py - s * 2.4, px + s, py - s * 1.2, px, py); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py - s * 1.6, s * 0.35, 0, 7); ctx.fill(); }
  }
}
function legend(elId) {
  $(elId).innerHTML = ["Tropical Storm", "Cat 1", "Cat 2", "Cat 3", "Cat 4", "Cat 5"].map((t, i) => `<span><i style="background:var(--c${i})"></i>${t}</span>`).join("");
}
function stormBBox(S) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < S.n; i++) { if (S.v[i] / KT < 50) continue; const la = S.lat[i], lo = S.lon[i]; if (lo < -100 || lo > -58 || la < 14 || la > 38.5) continue;
    x0 = Math.min(x0, lo); x1 = Math.max(x1, lo); y0 = Math.min(y0, la); y1 = Math.max(y1, la); }
  if (x0 > x1) { x0 = -90; x1 = -78; y0 = 24; y1 = 34; }
  const m = 3.2; return [Math.max(-100, x0 - m), Math.max(14, y0 - m * 0.8), Math.min(-58, x1 + m), Math.min(38.5, y1 + m * 0.8)];
}

/* ===== landfall scrolly ===== */
(function landfall() {
  const T = byName["Michael 2018"], S = T.S, map = new StormMap($("#lfmap"), { nx: 120 });
  const tStart = Date.UTC(2018, 9, 9, 6) / 60000, tEnd = Date.UTC(2018, 9, 11, 6) / 60000;
  const i0 = S.t.findIndex(t => t >= tStart), i1 = S.t.findIndex(t => t >= tEnd);
  map.setView([-89.4, 27.2, -81.6, 33.2]);
  // aggregate observed cells to 0.05 degrees for this zoom
  const agg = new Map();
  for (const [lon, lat, n, a] of B.cells) { const k = Math.floor(lon / 0.05) + "," + Math.floor(lat / 0.05); const o = agg.get(k) || [0, 0]; o[0] += n; o[1] += a; agg.set(k, o); }
  const cells = [...agg].map(([k, [n, a]]) => { const [x, y] = k.split(",").map(Number); return [(x + 0.5) * 0.05, (y + 0.5) * 0.05, 0.05, a / n]; }).filter(c => c[3] > 0.02);
  legend("#lflegend"); $("#lflegend").insertAdjacentHTML("beforeend", `<span><i style="background:var(--c3); opacity:.9"></i>Observed Damage</span>`);
  let prog = reduced ? 1 : 0, ready = false;
  map.prepare(S, i0, i1, () => { ready = true; render(); });
  const steps = [...document.querySelectorAll("#steps .step")];
  function render() {
    const idx = Math.round(i0 + prog * 0.82 * (i1 - i0) / 0.82 * Math.min(1, prog / 0.82));
    const id = Math.min(i1, Math.round(i0 + Math.min(1, prog / 0.82) * (i1 - i0)));
    map.draw({ idx: id, showFuture: true, cells, cellAlpha: Math.max(0, Math.min(1, (prog - 0.8) / 0.15)) });
    const kt = S.v[id] / KT; $("#lf-wind").textContent = Math.round(kt) + " kt"; $("#lf-cat").textContent = category(kt) > 0 ? category(kt) : "TS";
    const d = new Date(S.t[id] * 60000); $("#lf-time").textContent = d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    $("#lf-prog").style.width = (prog * 100).toFixed(1) + "%";
    let cur = 0; steps.forEach((s, k) => { if (prog >= +s.dataset.at) cur = k; }); steps.forEach((s, k) => s.classList.toggle("on", k === cur));
  }
  steps[0].classList.add("on");
  const box = $("#scrolly");
  function onScroll() { const r = box.getBoundingClientRect(), span = r.height - innerHeight; const p = Math.max(0, Math.min(1, -r.top / Math.max(span, 1))); if (Math.abs(p - prog) > 0.001) { prog = p; if (ready) requestAnimationFrame(render); } }
  if (!reduced) addEventListener("scroll", onScroll, { passive: true });
  render();
  (function spin() { if (ready && !reduced) render(); setTimeout(() => requestAnimationFrame(spin), 120); })();
  window.__lfRender = () => ready && render();
})();

/* ===== storm replay ===== */
const replay = (function () {
  const map = new StormMap($("#rpmap"), { nx: 150 });
  let T = null, idx = 0, playing = false, last = 0, rafId;
  legend("#rplegend");
  const chips = $("#stormchips");
  const order = [...TRACKS].sort((a, b) => b.t[0] - a.t[0]);
  for (const t of order) { const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = t.storm; b.id = "storm-" + t.id; b.onclick = () => select(t.storm); chips.appendChild(b); }
  function select(name) {
    T = byName[name]; pin.storm = name;
    chips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", c.textContent === name));
    map.setView(stormBBox(T.S)); idx = T.S.n - 1; $("#rp-time").value = 1000;
    $("#rp-title").textContent = "Hurricane " + name.replace(/ (\d{4})$/, ", $1");
    const pk = Math.max(...T.v); $("#rp-peak").textContent = `${pk} kt · ${CAT_NAME(category(pk))}`;
    const st = STATS[name]; $("#rp-n").textContent = st ? st.n.toLocaleString("en-US") : "–"; $("#rp-med").textContent = st && st.med ? fmt$(st.med) + " (2024 $)" : "–";
    map.prepare(T.S, 0, T.S.n - 1, () => { updatePin(); draw(); });
    draw(); updatePin();
  }
  function draw() { map.draw({ idx, showFuture: true, pinLL: pin.wind_ms !== null && pin.storm === T.storm ? [pin.lat, pin.lon] : null });
    const d = new Date(T.S.t[idx] * 60000); $("#rp-clock").textContent = d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC · " + Math.round(T.S.v[idx] / KT) + " kt"; }
  function updatePin() {
    if (!T) return; pin.wind_ms = peakWind(T.S, pin.lat, pin.lon, idx);
    $("#pin-loc").textContent = `${pin.lat.toFixed(3)}°, ${pin.lon.toFixed(3)}°`;
    const kt = pin.wind_ms / KT; $("#pin-wind").textContent = `${Math.round(kt)} kt · ${Math.round(kt * 1.15078)} mph`;
    const f = fragility(buildingX(pin.wind_ms)); $("#pin-p").textContent = pct(f.any);
    if (bldg.wind_src === "pin" && $("#wm-o")) updateBuilding();
  }
  $("#rpmap").addEventListener("click", ev => {
    const r = ev.target.getBoundingClientRect(), px = (ev.clientX - r.left) * ev.target.width / r.width, py = (ev.clientY - r.top) * ev.target.height / r.height;
    const [lon, lat] = map.inv(px, py); pin.lat = lat; pin.lon = lon; updatePin(); draw();
  });
  $("#rp-time").addEventListener("input", e => { idx = Math.round(+e.target.value / 1000 * (T.S.n - 1)); stop(); draw(); updatePin(); });
  function loop(now) { if (!playing) return; if (now - last > 30) { last = now; idx = Math.min(T.S.n - 1, idx + 3); $("#rp-time").value = Math.round(idx / (T.S.n - 1) * 1000); draw(); if (idx >= T.S.n - 1) { stop(); updatePin(); } } rafId = requestAnimationFrame(loop); }
  function stop() { playing = false; cancelAnimationFrame(rafId); $("#rp-icon").setAttribute("d", "M4 2.5v11l9-5.5z"); $("#rp-play").setAttribute("aria-label", "Play"); }
  $("#rp-play").onclick = () => { if (playing) { stop(); updatePin(); return; } if (idx >= T.S.n - 1) idx = 0; playing = true; $("#rp-icon").setAttribute("d", "M4 2.5h3v11H4zM9 2.5h3v11H9z"); $("#rp-play").setAttribute("aria-label", "Pause"); last = 0; rafId = requestAnimationFrame(loop); };
  select("Michael 2018");
  return { redraw: () => T && draw(), select, map };
})();

/* ===== building configurator ===== */
const FACT = Object.fromEntries(FB.factors.map(f => [f.level, f]));
const OPTS = [
  { k: "construction", t: "Construction", opts: ["wood", "masonry", "concrete", "steel", "manufactured"] },
  { k: "use", t: "Use", opts: ["single_family", "mobile_home", "condo", "multi_family", "commercial", "industrial", "institutional"] },
  { k: "storeys", t: "Storeys", opts: ["1", "2", "3plus"] },
  { k: "foundation", t: "Foundation", opts: ["slab", "crawl", "pier", "pile", "basement"] },
  { k: "quality", t: "Construction Quality", opts: ["low", "average", "high"] },
];
const NAME = (f, v) => (B.names[f] || {})[v] || v;
function isPriced(f, v) { return v === FREFS[f] || (B.spec[f] || []).includes(v); }
function buildingX(wind_ms) {
  return { construction: bldg.construction, use: bldg.use, storeys: bldg.storeys, era: eraOf(bldg.year), quality: bldg.quality,
    foundation: bldg.foundation, log_area: Math.log(Math.min(50000, Math.max(200, bldg.sqft))), low_ground: bldg.low_ground ? 1 : 0,
    coastal_v: bldg.coastal_v ? 1 : 0, wind_ms };
}
function currentWind() { return bldg.wind_src === "pin" && pin.wind_ms !== null ? pin.wind_ms : bldg.wind_mph / 1.15078 * KT; }
function buildOpts() {
  const box = $("#opts"); box.innerHTML = "";
  for (const o of OPTS) {
    const w = document.createElement("div"); w.className = "opt";
    w.innerHTML = `<span class="t" id="lab-${o.k}">${o.t}</span>`;
    const seg = document.createElement("div"); seg.className = "seg"; seg.setAttribute("role", "group"); seg.setAttribute("aria-labelledby", "lab-" + o.k);
    for (const v of o.opts) { const b = document.createElement("button"); b.type = "button"; b.id = `o-${o.k}-${v}`; b.textContent = NAME(o.k, v); if (!isPriced(o.k, v)) b.classList.add("nc");
      b.setAttribute("aria-pressed", bldg[o.k] === v); b.onclick = () => { bldg[o.k] = v; seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); updateBuilding(); }; seg.appendChild(b); }
    w.appendChild(seg); const fn = document.createElement("p"); fn.className = "factor-note"; fn.id = "fn-" + o.k; w.appendChild(fn); box.appendChild(w);
  }
  const rng = (id, t, min, max, step, val, fmt, on) => { const w = document.createElement("div"); w.className = "opt";
    w.innerHTML = `<label class="t" for="${id}">${t}</label><div class="rangebox"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-o" class="num"></output></div><p class="factor-note" id="${id}-n"></p>`;
    box.appendChild(w); const inp = w.querySelector("input"), out = w.querySelector("output"); const set = () => { out.textContent = fmt(+inp.value); on(+inp.value); }; inp.oninput = () => { set(); updateBuilding(); }; set(); };
  rng("yb", "Year Built", 1940, 2018, 1, bldg.year, v => v, v => { bldg.year = v; });
  rng("sq", "Living Area", 600, 6000, 50, bldg.sqft, v => v.toLocaleString("en-US") + " sq ft", v => { bldg.sqft = v; });
  const ws = document.createElement("div"); ws.className = "opt";
  ws.innerHTML = `<span class="t" id="lab-ws">Wind</span><div class="seg" role="group" aria-labelledby="lab-ws"><button type="button" id="ws-pin" aria-pressed="true">From the Replay Pin</button><button type="button" id="ws-set" aria-pressed="false">Set a Wind Speed</button></div>
    <div class="rangebox" style="margin-top:12px"><input type="range" id="wm" min="60" max="190" step="1" value="${bldg.wind_mph}" aria-label="Wind speed in mph"><output id="wm-o" class="num"></output></div>`;
  box.appendChild(ws);
  const setSrc = s => { bldg.wind_src = s; $("#ws-pin").setAttribute("aria-pressed", s === "pin"); $("#ws-set").setAttribute("aria-pressed", s === "set"); updateBuilding(); };
  $("#ws-pin").onclick = () => setSrc("pin"); $("#ws-set").onclick = () => setSrc("set");
  $("#wm").oninput = e => { bldg.wind_mph = +e.target.value; bldg.wind_src = "set"; $("#ws-pin").setAttribute("aria-pressed", false); $("#ws-set").setAttribute("aria-pressed", true); updateBuilding(); };
  rng("fd", "Flood Water Inside the Home", 0, 72, 1, bldg.water_in, v => v === 0 ? "None" : v + " in", v => { bldg.water_in = v; });
  const tg = (id, t, key) => { const w = document.createElement("label"); w.className = "toggle"; w.innerHTML = `<input type="checkbox" id="${id}" ${bldg[key] ? "checked" : ""}>${t}`; box.appendChild(w); w.querySelector("input").onchange = e => { bldg[key] = e.target.checked; updateBuilding(); }; };
  tg("ins", "Homeowners Policy in Force", "insured"); tg("fins", "Flood Policy in Force", "flood_insured");
  tg("lg", "Ground Below 10 ft Elevation", "low_ground"); tg("cv", "FEMA Coastal High-Hazard Zone (V)", "coastal_v");
}
function ring(svgSel, p, colorVar) {
  const s = $(svgSel); s.innerHTML = ""; const r = 34, c = 2 * Math.PI * r;
  el("circle", { cx: 42, cy: 42, r, fill: "none", stroke: css("--line-2"), "stroke-width": 9 }, s);
  el("circle", { cx: 42, cy: 42, r, fill: "none", stroke: css(colorVar), "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": `${Math.max(0.001, p) * c} ${c}`, transform: "rotate(-90 42 42)", style: "transition:stroke-dasharray .5s ease" }, s);
}
function updateBuilding() {
  if (!$("#wm-o")) return;
  const w = currentWind(), kt = w / KT, x = buildingX(w), f = fragility(x);
  $("#wm-o").textContent = bldg.wind_src === "pin" ? `${Math.round(kt * 1.15078)} mph (pin)` : `${bldg.wind_mph} mph`;
  const cat = category(kt); $("#r-cat").innerHTML = `<i style="background:${cat >= 0 ? "var(--c" + cat + ")" : "var(--line)"}"></i>${Math.round(kt)} kt · ${CAT_NAME(cat)}`;
  $("#r-any").textContent = pct(f.any); $("#r-des").textContent = pct(f.des, f.des < 0.01 ? 2 : 1);
  ring("#g1", f.any, "--c3"); ring("#g2", Math.min(1, f.des * 4), "--c5");
  $("#r-range").textContent = `The chance of damage ranges from ${pct(f.lo)} to ${pct(f.hi)} across assessment areas (80%). Most of that spread is how completely FEMA's imagery covered each county, not the building.`;
  const resi = RESIDENTIAL.has(bldg.use);
  $("#lossblock").hidden = !resi;
  if (resi) {
    const h = household({ residence: residenceOf(bldg), wind_ms: w, flood: bldg.water_in > 0 ? 1 : 0, water_in: bldg.water_in, insured: bldg.insured ? 1 : 0, flood_insured: bldg.flood_insured ? 1 : 0, year: 2025 });
    const q10 = h.q(0.1), q50 = h.q(0.5), q90 = h.q(0.9), mx = Math.max(q90 * 1.15, 1);
    const X = v => Math.min(100, v / mx * 100);
    $("#lossbar").innerHTML = `<div class="track"></div><div class="range" style="left:${X(q10)}%;width:${X(q90) - X(q10)}%"></div><div class="mid" style="left:${X(q50)}%"></div>
      <span class="lab" style="left:${Math.max(6, X(q10))}%">${fmtK(q10)}</span><span class="lab" style="left:${X(q50)}%; font-weight:600; color:var(--ink)">${fmtK(q50)}</span><span class="lab" style="left:${Math.min(94, X(q90))}%">${fmtK(q90)}</span>`;
    $("#r-el").textContent = fmt$(f.any * h.mean);
    $("#r-unh").textContent = pct(h.unh) + " if inspected";
  }
  // factor notes
  for (const o of OPTS) { const v = bldg[o.k], n = $("#fn-" + o.k); if (!n) continue; const fr = FACT[o.k + "=" + v];
    n.textContent = v === FREFS[o.k] ? "Reference option." : !isPriced(o.k, v) ? `Scored as ${NAME(o.k, FREFS[o.k]).toLowerCase()}: the evidence is ${fr ? fr.grade : "not available"}.` : fr ? `Odds of damage ×${fr.odds_ratio.toFixed(2)} versus ${NAME(o.k, FREFS[o.k]).toLowerCase()} (90%: ${Math.exp(fr.lo90).toFixed(2)}–${Math.exp(fr.hi90).toFixed(2)}).` : ""; }
  const era = eraOf(bldg.year), fe = FACT["era=" + era];
  $("#yb-n").textContent = `${NAME("era", era)}. ` + (era === FREFS.era ? "Reference era." : !isPriced("era", era) ? `Scored as 1970–1993: the evidence is ${fe ? fe.grade : "thin"}.` : fe ? `Odds of damage ×${fe.odds_ratio.toFixed(2)} versus 1970–1993.` : "");
  drawCurve();
  const pp = $("#pin-p"); if (pin.wind_ms !== null) pp.textContent = pct(fragility(buildingX(pin.wind_ms)).any);
}
function drawCurve() {
  const W = 560, H = 280, pl = 46, pr = 18, pt = 16, pb = 38, box = $("#curve");
  const x = k => pl + (k - 60) / 100 * (W - pl - pr), y = p => pt + (1 - p) * (H - pt - pb);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Chance of visible damage by wind speed" });
  for (const t of [0, .25, .5, .75, 1]) { el("line", { x1: pl, x2: W - pr, y1: y(t), y2: y(t), stroke: css("--line-2") }, svg); el("text", { x: pl - 8, y: y(t) + 4, "text-anchor": "end", "font-size": 11 }, svg).textContent = pct(t); }
  for (const k of [64, 83, 96, 113, 137]) { el("line", { x1: x(k), x2: x(k), y1: pt, y2: H - pb, stroke: css("--line-2"), "stroke-dasharray": "3 4" }, svg); el("text", { x: x(k), y: H - pb + 16, "text-anchor": "middle", "font-size": 11 }, svg).textContent = k; }
  el("text", { x: (pl + W - pr) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11 }, svg).textContent = "Peak sustained wind (knots); dashed lines mark category thresholds";
  const ks = []; for (let k = 60; k <= 160; k += 2) ks.push(k);
  const ref = { ...bldg, construction: "wood", use: "single_family", storeys: "1", foundation: "slab", quality: "average", year: 1985 };
  const refX = k => ({ construction: "wood", use: "single_family", storeys: "1", era: "1970_1993", quality: "average", foundation: "slab", log_area: Math.log(ref.sqft), low_ground: 0, coastal_v: 0, wind_ms: k * KT });
  const pth = fn => ks.map((k, i) => (i ? "L" : "M") + x(k).toFixed(1) + " " + y(fn(k)).toFixed(1)).join(" ");
  el("path", { d: pth(k => fragility(refX(k)).any), fill: "none", stroke: css("--ink-3"), "stroke-width": 2, "stroke-dasharray": "5 4" }, svg);
  el("path", { d: pth(k => fragility(buildingX(k * KT)).any), fill: "none", stroke: css("--accent"), "stroke-width": 2.6 }, svg);
  const kt = currentWind() / KT; if (kt >= 60 && kt <= 160) el("circle", { cx: x(kt), cy: y(fragility(buildingX(kt * KT)).any), r: 5.5, fill: css("--accent"), stroke: css("--card"), "stroke-width": 2 }, svg);
  el("text", { x: W - pr, y: pt + 12, "text-anchor": "end", "font-size": 12, style: `fill:${css("--accent")};font-weight:600` }, svg).textContent = "This Building";
  el("text", { x: W - pr, y: pt + 28, "text-anchor": "end", "font-size": 12 }, svg).textContent = "Wood-frame single-family, 1970–1993";
  const hit = el("rect", { x: pl, y: pt, width: W - pl - pr, height: H - pt - pb, fill: "transparent" }, svg), cross = el("line", { y1: pt, y2: H - pb, stroke: css("--ink-3"), visibility: "hidden" }, svg);
  hit.addEventListener("mousemove", ev => { const r = svg.getBoundingClientRect(), k = Math.max(60, Math.min(160, 60 + ((ev.clientX - r.left) / r.width * W - pl) / (W - pl - pr) * 100)); cross.setAttribute("x1", x(k)); cross.setAttribute("x2", x(k)); cross.setAttribute("visibility", "visible");
    showTip(ev, `<b>${Math.round(k)} kt</b> · ${CAT_NAME(category(k))}<br>This building ${pct(fragility(buildingX(k * KT)).any)}<br>Reference ${pct(fragility(refX(k)).any)}`); });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  box.innerHTML = ""; box.appendChild(svg);
}
function drawFactors() {
  const rows = FB.factors.filter(f => ["construction", "use", "storeys", "era", "quality"].includes(f.field)), W = 560, rh = 24, pl = 210, pr = 20, pt = 22, H = rows.length * rh + pt + 30;
  const lo = Math.log(0.1), hi = Math.log(3), x = v => pl + (Math.log(Math.max(0.1, Math.min(3, v))) - lo) / (hi - lo) * (W - pl - pr);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Odds ratios of damage by building attribute" });
  for (const t of [0.1, 0.25, 0.5, 1, 2, 3]) { el("line", { x1: x(t), x2: x(t), y1: pt - 6, y2: H - 24, stroke: t === 1 ? css("--ink-3") : css("--line-2") }, svg); el("text", { x: x(t), y: H - 8, "text-anchor": "middle", "font-size": 11 }, svg).textContent = "×" + t; }
  el("text", { x: x(0.35), y: 12, "text-anchor": "middle", "font-size": 11 }, svg).textContent = "less damage";
  el("text", { x: x(1.8), y: 12, "text-anchor": "middle", "font-size": 11 }, svg).textContent = "more damage";
  rows.forEach((f, i) => { const cy = pt + i * rh + rh / 2, ok = f.grade === "supported", col = ok ? css("--accent") : css("--ink-3");
    const g = el("g", {}, svg); el("text", { x: pl - 10, y: cy + 4, "text-anchor": "end", "font-size": 12, style: ok ? `fill:${css("--ink")}` : "" }, g).textContent = `${f.value_name}`;
    el("line", { x1: x(Math.exp(f.lo90)), x2: x(Math.exp(f.hi90)), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round", opacity: ok ? 1 : .6 }, g);
    if (ok) el("circle", { cx: x(f.odds_ratio), cy, r: 5, fill: col, stroke: css("--card"), "stroke-width": 2 }, g); else el("circle", { cx: x(f.odds_ratio), cy, r: 4.5, fill: css("--card"), stroke: col, "stroke-width": 1.6 }, g);
    el("rect", { x: 0, y: cy - rh / 2, width: W, height: rh, fill: "transparent" }, g);
    g.addEventListener("mousemove", ev => showTip(ev, `<b>${f.value_name}</b> vs ${f.reference}<br>odds ×${f.odds_ratio.toFixed(2)} (90%: ${Math.exp(f.lo90).toFixed(2)}–${Math.exp(f.hi90).toFixed(2)})<br>${f.grade}${f.prior_sign ? ", engineering expectation " + (f.prior_sign < 0 ? "less damage" : "more damage") : ", no engineering expectation"}<br>${f.n_level.toLocaleString("en-US")} buildings`)); g.addEventListener("mouseleave", hideTip); });
  $("#factors").innerHTML = ""; $("#factors").appendChild(svg);
  $("#factors").insertAdjacentHTML("beforeend", `<p class="note" style="margin-top:10px">Filled dots are priced (supported: the interval excludes no effect and agrees with engineering expectation where one exists). Open dots are shown, not priced.</p>`);
}

/* ===== portfolio ===== */
const SAMPLE = `id,lat,lon,construction,use,storeys,year_built,sqft,value,loan,insured
EX-01,30.1602,-85.6614,wood,single_family,1,1978,1650,240000,180000,1
EX-02,30.1868,-85.7012,masonry,single_family,1,2012,2100,365000,290000,1
EX-03,30.2405,-85.6475,manufactured,mobile_home,1,1996,1100,85000,61000,0
EX-04,29.9472,-85.4170,wood,single_family,2,2006,1900,410000,300000,1
EX-05,30.1530,-85.6630,masonry,commercial,1,1988,6400,1250000,900000,1
EX-06,30.7740,-85.2270,wood,single_family,1,1965,1400,145000,90000,0
EX-07,30.2190,-85.5820,steel,industrial,1,2001,18000,2400000,1500000,1
EX-08,30.1790,-85.8040,wood,condo,3plus,2015,1200,330000,250000,1
EX-09,30.9030,-84.5760,wood,single_family,1,1972,1500,120000,70000,0
EX-10,30.4383,-84.2807,masonry,single_family,2,1999,2600,390000,260000,1
EX-11,29.8130,-85.3030,manufactured,mobile_home,1,1985,980,52000,30000,0
EX-12,30.3600,-85.4200,wood,single_family,1,2014,1750,230000,205000,1`;
let pfCsv = "";
function scoreBook() {
  const err = $("#pf-err"); err.hidden = true;
  const T = byName[$("#pf-storm").value]; const lines = $("#pf-csv").value.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { err.textContent = "Add a header row and at least one building."; err.hidden = false; return; }
  const hdr = lines[0].split(",").map(s => s.trim().toLowerCase()); const miss = ["lat", "lon"].filter(c => !hdr.includes(c));
  if (miss.length) { err.textContent = "The header needs lat and lon columns."; err.hidden = false; return; }
  const out = []; const bad = [];
  for (const line of lines.slice(1)) {
    const c = line.split(","), r = {}; hdr.forEach((h, i) => r[h] = (c[i] || "").trim());
    const lat = +r.lat, lon = +r.lon; if (!isFinite(lat) || !isFinite(lon)) { bad.push(r.id || "?"); continue; }
    const ok = (v, list) => list.includes(v) ? v : "unknown";
    const b = { construction: ok(r.construction, ["wood", "masonry", "concrete", "steel", "manufactured"]), use: ok(r.use, ["single_family", "mobile_home", "condo", "multi_family", "commercial", "industrial", "institutional", "other"]),
      storeys: r.storeys === "1" ? "1" : r.storeys === "2" ? "2" : (+r.storeys >= 3 ? "3plus" : "unknown") };
    const w = peakWind(T.S, lat, lon), f = fragility({ ...b, era: eraOf(r.year_built), quality: "unknown", foundation: "unknown", log_area: Math.log(Math.min(50000, Math.max(200, +r.sqft || 1800))), low_ground: 0, coastal_v: 0, wind_ms: w });
    const resi = RESIDENTIAL.has(b.use), ins = r.insured === "1" ? 1 : 0;
    let el_ = 0, unh = 0;
    if (resi) { const h = household({ residence: residenceOf(b), wind_ms: w, flood: 0, water_in: 0, insured: ins, flood_insured: 0, year: 2025 }); el_ = f.any * h.mean; unh = f.any * h.unh; }
    out.push({ id: r.id || "", kt: w / KT, f, resi, el: el_, unh, ins, value: +r.value || 0, loan: +r.loan || 0 });
  }
  if (bad.length) { err.textContent = "Skipped rows without coordinates: " + bad.join(", "); err.hidden = false; }
  if (!out.length) return;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  $("#pf-n").textContent = out.length; $("#pf-v").textContent = fmtK(sum(out, r => r.value)) + " insured value";
  $("#pf-d").textContent = sum(out, r => r.f.any).toFixed(1); $("#pf-dr").textContent = sum(out, r => r.f.des).toFixed(2) + " expected destroyed";
  $("#pf-l").textContent = fmtK(sum(out, r => r.el)); $("#pf-u").textContent = sum(out.filter(r => r.resi && !r.ins), r => r.unh).toFixed(2);
  let t = '<thead><tr><th>ID</th><th class="n">Wind</th><th class="n">Damage</th><th class="n">Destroyed</th><th class="n">Expected Loss</th><th>Lender Flag</th></tr></thead><tbody>';
  for (const r of out) { const flag = r.resi && !r.ins && r.f.any > 0.3 ? '<span class="badge"><i style="background:var(--bad)"></i>Uninsured, High Damage</span>' : r.f.any > 0.5 ? '<span class="badge"><i style="background:var(--warn)"></i>High Damage</span>' : '<span class="badge"><i style="background:var(--good)"></i>Clear</span>';
    t += `<tr><td>${r.id}</td><td class="n">${Math.round(r.kt)} kt</td><td class="n">${pct(r.f.any)}</td><td class="n">${pct(r.f.des, 2)}</td><td class="n">${r.resi ? fmt$(r.el) : "<small>n/a</small>"}</td><td>${flag}</td></tr>`; }
  $("#pf-table").innerHTML = t + "</tbody>";
  pfCsv = "id,peak_wind_kt,p_damage,p_destroyed,expected_verified_loss,uninsured\n" + out.map(r => [r.id, r.kt.toFixed(1), r.f.any.toFixed(4), r.f.des.toFixed(5), r.resi ? r.el.toFixed(0) : "", r.ins ? 0 : 1].join(",")).join("\n");
  const dl = $("#pf-dl"); dl.hidden = false; dl.href = URL.createObjectURL(new Blob([pfCsv], { type: "text/csv" })); dl.download = "hurricanevuln_scores.csv";
}
function setupPortfolio() {
  const s = $("#pf-storm"); for (const t of [...TRACKS].sort((a, b) => b.t[0] - a.t[0])) { const o = document.createElement("option"); o.value = t.storm; o.textContent = t.storm; s.appendChild(o); }
  s.value = "Michael 2018"; $("#pf-csv").value = SAMPLE; $("#pf-run").onclick = scoreBook; s.onchange = scoreBook;
  $("#pf-file").onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $("#pf-csv").value = rd.result; scoreBook(); }; rd.readAsText(f); };
  scoreBook();
}

/* ===== evidence ===== */
const NICE = { hurricanevuln: "HurricaneVuln", gbm: "Gradient boosting", climatology: "Historical distribution", wind_only: "Wind only",
  class_curves: "Construction-class curves", };
const NOTE = { hurricanevuln: "Hurdle model, storm effect pooled, regime-aware", gbm: "Same inputs, no storm structure", climatology: "Pooled losses of the training storms", wind_only: "Peak wind and nothing else",
  class_curves: "Wind plus construction type, like a catastrophe-model class table" };
function buildEvidence() {
  const bin = Object.fromEntries(LB.binary.map(r => [r.model, r]));
  let t = '<thead><tr><th>Model</th><th class="n">CRPS</th><th class="n">Median Error</th><th class="n">80% Coverage</th><th class="n">Storms Won</th><th class="n">Any-Loss AUC</th></tr></thead><tbody>';
  const best = Math.min(...LB.summary.map(r => r.crps));
  for (const m of ["hurricanevuln", "gbm", "climatology", "wind_only"]) { const r = lsum[m]; if (!r) continue;
    t += `<tr class="${m === "hurricanevuln" ? "ours" : ""}"><td>${NICE[m]}<br><small>${NOTE[m]}</small></td><td class="n">${r.crps === best ? "<b>" + fmt$(r.crps) + "</b>" : fmt$(r.crps)}</td><td class="n">${fmt$(r.median_abs_err)}</td><td class="n">${pct(r.cov80, 1)}</td><td class="n">${r.storms_won}</td><td class="n">${bin[m] ? bin[m].pos_auc.toFixed(3) : "–"}</td></tr>`; }
  $("#ev-loss").innerHTML = t + "</tbody>";
  // storm intervals
  const rows = [...B.storm_intervals].sort((a, b) => a.obs_mean - b.obs_mean), W = 560, rh = 21, pl = 120, pr = 16, pt = 8, H = rows.length * rh + pt + 30;
  const lo = Math.log(500), hi = Math.log(40000), x = v => pl + (Math.log(Math.max(500, Math.min(40000, v))) - lo) / (hi - lo) * (W - pl - pr);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Predicted range and observed average loss for each withheld storm" });
  for (const v of [500, 1000, 2500, 5000, 10000, 25000]) { el("line", { x1: x(v), x2: x(v), y1: pt, y2: H - 24, stroke: css("--line-2") }, svg); el("text", { x: x(v), y: H - 8, "text-anchor": "middle", "font-size": 11 }, svg).textContent = fmtK(v); }
  rows.forEach((r, i) => { const cy = pt + i * rh + rh / 2, inside = r.obs_mean >= r.lo80 && r.obs_mean <= r.hi80; const g = el("g", {}, svg);
    el("text", { x: pl - 8, y: cy + 4, "text-anchor": "end", "font-size": 11.5 }, g).textContent = r.storm;
    el("rect", { x: x(r.lo80), y: cy - 4, width: Math.max(2, x(r.hi80) - x(r.lo80)), height: 8, rx: 4, fill: css("--accent-wash"), stroke: css("--accent") }, g);
    el("circle", { cx: x(r.obs_mean), cy, r: 4.5, fill: inside ? css("--ink") : css("--bad"), stroke: css("--card"), "stroke-width": 1.5 }, g);
    el("rect", { x: 0, y: cy - rh / 2, width: W, height: rh, fill: "transparent" }, g);
    g.addEventListener("mousemove", ev => showTip(ev, `<b>${r.storm}</b><br>Predicted ${fmt$(r.pred_mean)} (80%: ${fmt$(r.lo80)}–${fmt$(r.hi80)})<br>Verified ${fmt$(r.obs_mean)} ${inside ? "· inside" : "· outside"}`)); g.addEventListener("mouseleave", hideTip); });
  $("#ev-storms").innerHTML = ""; $("#ev-storms").appendChild(svg);
  // fragility table
  const fs = FB.summary.filter(r => r.scheme === "tiles");
  const bestA = Math.max(...fs.map(r => r.any_auc)), bestB = Math.min(...fs.map(r => r.any_brier)), bestD = Math.max(...fs.map(r => r.des_auc));
  let f = '<thead><tr><th>Model</th><th class="n">Damage Brier</th><th class="n">Damage AUC</th><th class="n">Destroyed AUC</th></tr></thead><tbody>';
  for (const m of ["hurricanevuln", "gbm", "class_curves", "wind_only"]) { const r = fs.find(x => x.model === m); if (!r) continue;
    const b = (v, best, d) => Math.abs(v - best) < 1e-12 ? `<b>${v.toFixed(d)}</b>` : v.toFixed(d);
    f += `<tr class="${m === "hurricanevuln" ? "ours" : ""}"><td>${NICE[m]}</td><td class="n">${b(r.any_brier, bestB, 4)}</td><td class="n">${b(r.any_auc, bestA, 3)}</td><td class="n">${b(r.des_auc, bestD, 3)}</td></tr>`; }
  $("#ev-frag").innerHTML = f + "</tbody>";
  const ci = FB.county_intervals, cov = Math.round(FB.coverage80 * ci.length), gulf = ci.find(c => c.county === "12045");
  $("#ev-county").textContent = `New counties are harder. Withholding a whole county, the 80% range for its damage share covered ${cov} of ${ci.length} counties. FEMA's imagery coverage differs by county: in Gulf County the model expected ${gulf ? pct(gulf.pred) : "–"} damaged and the assessment recorded ${gulf ? pct(gulf.obs) : "–"}.`;
  const hv = lsum.hurricanevuln, gb = lsum.gbm, tH = fs.find(r => r.model === "hurricanevuln"), tG = fs.find(r => r.model === "gbm");
  $("#win").textContent = `Inside assessed counties it ranks buildings best (damage AUC ${tH.any_auc.toFixed(3)} against ${tG.any_auc.toFixed(3)} for boosting; destroyed AUC ${tH.des_auc.toFixed(3)}). Its storm-level ranges are calibrated: ${nCov} of ${B.meta.n_storms} withheld storms fell inside the 80% range. It is the best model for the probability of any loss (AUC ${bin.hurricanevuln.pos_auc.toFixed(3)}), and every effect it uses is a published coefficient.`;
  $("#win").textContent += "";
  $("#lose").textContent = `Gradient boosting has a lower household CRPS (${fmt$(gb.crps)} against ${fmt$(hv.crps)}) and wins ${gb.storms_won} of ${B.meta.n_storms} storms. Building fragility rests on one storm, and predictions for counties outside Michael's footprint carry the assessment-coverage uncertainty above.`;
}

/* ===== records ===== */
function lineageTable(rows, cols) { return `<div class="scroll-x"><table class="tbl"><thead><tr>${cols.map(c => `<th class="${c[2] || ""}">${c[1]}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c[2] || ""}">${c[3] ? c[3](r[c[0]], r) : r[c[0]]}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }
const SRC = { hurdat2_atlantic: "NOAA NHC HURDAT2 Atlantic best tracks", fema_rs_wind_points: "FEMA Historical Geospatial Damage Assessments (remote sensing, wind)", nsi_structures: "USACE National Structure Inventory",
  ihp_owners: "OpenFEMA IHP valid registrations (owners, inspected)", fl_parcels_michael: "Florida DOR cadastral roll (FGIO statewide parcels)", ne_50m_land: "Natural Earth 1:50m land", ne_50m_state_lines: "Natural Earth 1:50m state lines" };
const ASSUMPTIONS = [
  ["A-01", "Undamaged buildings", "FEMA's imagery records only damaged structures. Every inventory building in an assessed 0.1° tile with no damage point within 30 m is treated as having no visible damage."],
  ["A-02", "Wind reference", "Peak 1-minute sustained wind at 10 m in open terrain from a Holland profile scaled to the best-track intensity. Over land it runs about one category above FEMA's own wind classes for the same points, consistent with ground roughness."],
  ["A-03", "Assessment unit", "County is treated as the assessment unit with a partially pooled effect, because imagery coverage differs by county. New-county predictions integrate over that effect."],
  ["A-04", "Post-storm roll", "The parcel roll is from 2026. Buildings built in 2019 or later are removed unless a damage point marks them as rebuilds, whose attributes are set to unknown."],
  ["A-05", "Unknown attributes", "An unknown attribute contributes the average of its known values and never has its own parameter, so missing data cannot carry the outcome."],
  ["A-06", "Inventory attributes", "NSI construction type is imputed for many buildings and its year built is a census-block median. Year built and use come from the parcel roll in Florida; Georgia buildings rely on NSI only."],
  ["A-07", "Household losses", "Losses are FEMA-verified real property losses for owner-occupied primary residences that registered and were inspected, in 2024 dollars. They measure repairs for safety and habitability and sit below full insured losses."],
  ["A-08", "Inspection regime", "FEMA's verified losses roughly quadruple from 2019 at similar winds and the roof-damage flag stops being recorded. A regime indicator absorbs the change and the product predicts under the 2019-on regime."],
  ["A-09", "Location of households", "Households are located to the population centre of their census block group; wind is computed there."],
  ["A-10", "Combining the models", "Expected verified loss for a building is its chance of visible damage times the household model's mean loss given a positive verified loss."],
  ["A-11", "Geography", "Fragility is calibrated on the Florida Panhandle and south-west Georgia; household losses cover 19 storms from Texas to Puerto Rico and the Carolinas. Puerto Rico buildings are not in the fragility data because NSI has no Puerto Rico inventory."],
  ["A-12", "Perils", "Storm surge is not modelled separately. Coastal high-hazard zone and low ground enter the fragility model as surge-exposure indicators; household flood water enters the loss model directly."],
];
function buildRecords() {
  const meta = B.meta, man = B.manifest, docs = $("#docs");
  const hv = lsum.hurricanevuln, tH = FB.summary.find(r => r.scheme === "tiles" && r.model === "hurricanevuln");
  const pages = {
    card: `<div class="doc"><h3>Model Card</h3>
      <dl><dt>Name and Version</dt><dd>HurricaneVuln ${K.version}, built ${meta.built}</dd>
      <dt>Purpose</dt><dd>Estimate how a specific building responds to a specific hurricane: chance of visible damage, chance destroyed, and FEMA-verified repair cost for residential units.</dd>
      <dt>Intended Users</dt><dd>Property insurers (underwriting, accumulation, claims staffing) and lenders (collateral stress, uninsured exposure).</dd>
      <dt>Inputs</dt><dd>Location or wind speed; construction, use, storeys, year built, foundation, quality, living area; flood water depth; homeowners and flood policy flags.</dd>
      <dt>Fragility Training Data</dt><dd>${meta.n_buildings.toLocaleString("en-US")} buildings in Hurricane Michael's FEMA-assessed footprint, ${meta.n_counties} counties, damaged share ${pct(meta.damaged_share, 1)}, destroyed share ${pct(meta.destroyed_share, 2)}.</dd>
      <dt>Loss Training Data</dt><dd>${meta.n_households.toLocaleString("en-US")} inspected owner-occupied homes from ${meta.n_storms} storms, 2016–2024.</dd>
      <dt>Structure</dt><dd>Fragility: two logistic stages (any damage; destroyed given damage) with log-wind terms, graded building attributes and a partially pooled county effect (spread ${FB.tau_any.toFixed(2)} on the logit scale). Loss: hurdle model, logistic for any verified loss and lognormal for its size, each with a partially pooled storm effect.</dd>
      <dt>Performance</dt><dd>Household CRPS ${fmt$(hv.crps)} over ${meta.n_storms} withheld storms; storm-level 80% coverage ${nCov}/${meta.n_storms}. Fragility on withheld map tiles: damage AUC ${tH.any_auc.toFixed(3)}, destroyed AUC ${tH.des_auc.toFixed(3)}.</dd>
      <dt>Not For</dt><dd>Contents, business interruption, storm-surge structural loss, regions or building types far outside the calibration data, or replacing a hazard model's event set.</dd></dl></div>`,
    lineage: `<div class="doc"><h3>Data Lineage</h3><p>Every input file, where it came from, when it was retrieved, and its SHA-256 digest. Re-running the fetch scripts and comparing digests shows whether a source has changed.</p>
      ${lineageTable(Object.entries(man).filter(([k]) => SRC[k] || k.startsWith("cenpop")).map(([k, v]) => ({ k, ...v })), [["k", "Source", "", (v) => SRC[v] || v], ["retrieved", "Retrieved"], ["bytes", "Size", "n", v => (v / 1048576).toFixed(1) + " MB"], ["sha256", "SHA-256", "", v => `<span class="hash">${v}</span>`], ["url", "Link", "", v => `<a href="${v}">Open</a>`]])}
      <h4>Fragility Table, Record by Record</h4>${lineageTable(B.qa_fragility, [["step", "Step"], ["records", "Records", "n", v => (+v).toLocaleString("en-US")]])}
      <p>FEMA points matched to a building within 30 m: ${Object.values(B.matching).map(m => `${m.matched.toLocaleString("en-US")} of ${m.points_in_tiles.toLocaleString("en-US")}, median distance ${m.median_distance_m.toFixed(1)} m`).join("; ")}.</p>
      <h4>Household Loss Table</h4>${lineageTable(B.qa_loss, [["step", "Step"], ["records", "Records", "n", v => (+v).toLocaleString("en-US")]])}
      <h4>Registrations by Disaster Declaration</h4>${lineageTable(Object.entries(B.ihp_counts).map(([k, v]) => ({ dr: "DR-" + k, ...v })), [["dr", "Declaration"], ["storm", "Storm"], ["eligible", "Owner Inspections", "n", v => v.toLocaleString("en-US")], ["pulled", "Used (Random Sample Above 60,000)", "n", v => v.toLocaleString("en-US")]])}
      <h4>Wind Check Against FEMA's Wind Classes (Michael Damage Points)</h4>${lineageTable(B.wind_check, [["WIND_SPEED", "FEMA Class"], ["size", "Points", "n", v => v.toLocaleString("en-US")], ["mean", "Our Mean Wind (kt)", "n"], ["min", "Min", "n"], ["max", "Max", "n"]])}</div>`,
    assumptions: `<div class="doc"><h3>Assumptions Register</h3><p>Each assumption, stated once, with its identifier for model-risk review.</p><div class="reg">${ASSUMPTIONS.map(([id, t, d]) => `<div><code>${id}</code><b>${t}</b><p>${d}</p></div>`).join("")}</div></div>`,
    validation: `<div class="doc"><h3>Validation Record</h3>
      <h4>Household Loss, Every Withheld Storm</h4>${lineageTable(B.storm_intervals.map(r => ({ ...r, inside: r.obs_mean >= r.lo80 && r.obs_mean <= r.hi80 })), [["storm", "Storm"], ["n", "Homes Scored", "n", v => v.toLocaleString("en-US")], ["obs_mean", "Verified Mean", "n", fmt$], ["pred_mean", "Predicted", "n", fmt$], ["lo80", "80% Low", "n", fmt$], ["hi80", "80% High", "n", fmt$], ["inside", "Inside", "", v => v ? "Yes" : "No"]])}
      <h4>Fragility, Withheld Counties</h4>${lineageTable(FB.county_intervals, [["county", "County FIPS"], ["n", "Buildings", "n", v => v.toLocaleString("en-US")], ["obs", "Observed Damaged", "n", v => pct(v, 1)], ["pred", "Predicted", "n", v => pct(v, 1)], ["lo80", "80% Low", "n", v => pct(v, 1)], ["hi80", "80% High", "n", v => pct(v, 1)]])}
      <h4>Building Attribute Grades</h4>${lineageTable(FB.factors, [["level", "Level"], ["odds_ratio", "Odds Ratio", "n", v => v.toFixed(2)], ["lo90", "90% Low", "n", v => Math.exp(v).toFixed(2)], ["hi90", "90% High", "n", v => Math.exp(v).toFixed(2)], ["prior_sign", "Expectation", "", v => v < 0 ? "Less damage" : v > 0 ? "More damage" : "None"], ["grade", "Grade", "", v => v[0].toUpperCase() + v.slice(1)], ["n_level", "Buildings", "n", v => v.toLocaleString("en-US")]])}</div>`,
    changes: `<div class="doc"><h3>Change Log</h3><h4>${K.version} · ${meta.built}</h4><ul>
      <li>First release: building fragility from Hurricane Michael (FEMA remote sensing, NSI inventory, Florida parcel roll) and household loss from ${meta.n_storms} storms.</li>
      <li>Leave-one-storm-out validation of the loss model; spatial-tile and leave-one-county-out validation of fragility.</li>
      <li>Inspection-regime covariate added after finding the 2019 break in FEMA verified losses; regime interactions cut household CRPS from $3,095 to ${fmt$(hv.crps)}.</li>
      <li>County assessment effect added after finding that Gulf County's imagery coverage was incomplete.</li>
      <li>Post-storm parcel rule added after finding rebuilt homes carry post-storm attributes on the 2026 roll.</li></ul></div>`,
    reproduce: `<div class="doc"><h3>Reproduce</h3><p>Everything on this page rebuilds from public sources with these commands, in order. Python 3.11 with numpy, scipy, pandas, scikit-learn, shapely and joblib; Node 18 or later for the parity test.</p>
      <pre class="cmd">python scripts/fetch_public.py      # HURDAT2, block-group centres, FEMA damage points
python scripts/fetch_nsi.py         # building inventory for assessed tiles
python scripts/fetch_parcels.py     # Florida parcel roll, nine counties
python scripts/fetch_ihp.py         # OpenFEMA registrations, 19 storms
python scripts/build_fragility.py
python scripts/build_loss.py
python experiments/run_fragility.py
python experiments/run_loss_validation.py
python scripts/export_to_web.py
python scripts/build_site.py
python tests/test_core.py
node tests/test_js_parity.js docs/index.html</pre>
      <p>The parity test runs this page's own engine against the Python models: wind field, fragility and household loss.</p></div>`,
  };
  const show = k => { docs.innerHTML = pages[k]; document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === k)); };
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  show("card");
}

/* ===== theme & boot ===== */
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem("hv-theme", t); } catch (e) {} redraw(); }
try { const t = localStorage.getItem("hv-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
$("#theme").onclick = () => setTheme(isDark() ? "light" : "dark");
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => redraw());
function redraw() { $("#theme").textContent = isDark() ? "Light" : "Dark"; replay.redraw(); window.__lfRender && window.__lfRender(); updateBuilding(); drawFactors(); buildEvidence(); }
buildOpts(); setupPortfolio(); buildRecords(); redraw();
