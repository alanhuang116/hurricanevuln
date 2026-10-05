/* Renders the documentation page from the build bundle. */
(function () {
"use strict";
const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const N = (x, d = 0) => x == null || !isFinite(x) ? "–" : (+x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => x == null ? "–" : (x * 100).toFixed(d) + "%";
const fmt$ = x => x == null ? "–" : "$" + Math.round(x).toLocaleString("en-US");
function table(id, cols, rows) {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  el.innerHTML = `<thead><tr>${cols.map(c => `<th class="${c.n ? "n" : ""}">${c.h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr class="${r._hl ? "hl" : ""}">${cols.map(c => `<td class="${c.n ? "n" : ""}${c.m ? " m" : ""}">${c.f ? c.f(r[c.k], r) : (r[c.k] ?? "–")}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
const FB = B.frag_bench, LB = B.loss_bench, meta = B.meta;
const COUNTY = { "12005": "Bay, FL", "12013": "Calhoun, FL", "12037": "Franklin, FL", "12039": "Gadsden, FL", "12045": "Gulf, FL", "12059": "Holmes, FL", "12063": "Jackson, FL", "12077": "Liberty, FL", "12133": "Washington, FL",
  "13007": "Baker, GA", "13087": "Decatur, GA", "13099": "Early, GA", "13201": "Miller, GA", "13205": "Mitchell, GA", "13253": "Seminole, GA" };
const K = { version: "v" + meta.version, built: meta.built, hurdat: meta.hurdat, n_buildings: N(meta.n_buildings), n_households: N(meta.n_households), n_storms: meta.n_storms, boot: FB.bootstrap };
document.querySelectorAll("[data-k]").forEach(n => { if (K[n.dataset.k] !== undefined) n.textContent = K[n.dataset.k]; });

/* ----- architecture diagram ----- */
function drawArch() {
  const s = $("#arch"); s.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";
  const add = (tag, a, txt) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (txt) e.textContent = txt; s.appendChild(e); return e; };
  const card = css("--card"), line = css("--line"), ink = css("--ink"), ink3 = css("--ink-3"), acc = css("--accent"), wash = css("--bg-alt");
  const defs = add("defs", {}); const mk = document.createElementNS(NS, "marker");
  mk.setAttribute("id", "ar"); mk.setAttribute("viewBox", "0 0 10 10"); mk.setAttribute("refX", "9"); mk.setAttribute("refY", "5"); mk.setAttribute("markerWidth", "7"); mk.setAttribute("markerHeight", "7"); mk.setAttribute("orient", "auto-start-reverse");
  const p = document.createElementNS(NS, "path"); p.setAttribute("d", "M0,0 L10,5 L0,10 z"); p.setAttribute("fill", ink3); mk.appendChild(p); defs.appendChild(mk);
  const box = (x, y, w, h, t, sub, strong) => { add("rect", { x, y, width: w, height: h, rx: 14, fill: strong ? acc : card, stroke: strong ? acc : line });
    add("text", { x: x + 14, y: y + 24, "font-size": 14, "font-weight": 600, fill: strong ? "#fff" : ink }, t);
    (sub || []).forEach((l, i) => add("text", { x: x + 14, y: y + 44 + i * 17, "font-size": 12, fill: strong ? "rgba(255,255,255,.85)" : ink3 }, l)); };
  const arrow = (x1, y1, x2, y2) => add("path", { d: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`, fill: "none", stroke: ink3, "stroke-width": 1.4, "marker-end": "url(#ar)" });
  add("rect", { x: 0, y: 0, width: 980, height: 420, rx: 18, fill: wash });
  add("text", { x: 22, y: 30, "font-size": 12, fill: ink3, "font-weight": 600 }, "Sources");
  add("text", { x: 300, y: 30, "font-size": 12, fill: ink3, "font-weight": 600 }, "Processing");
  add("text", { x: 560, y: 30, "font-size": 12, fill: ink3, "font-weight": 600 }, "Models");
  add("text", { x: 800, y: 30, "font-size": 12, fill: ink3, "font-weight": 600 }, "Outputs");
  box(18, 44, 230, 62, "NOAA HURDAT2", ["Best tracks, 1851–2025"]);
  box(18, 118, 230, 80, "FEMA + NSI + FL parcels", ["Damage points, inventory,", "year built and use"]);
  box(18, 212, 230, 80, "OpenFEMA IHP", ["Inspected owner homes,", "19 storms"]);
  box(18, 306, 230, 80, "Census + BLS", ["Block-group centres,", "CPI-U deflator"]);
  box(292, 44, 220, 62, "Wind field", ["Holland profile, 15-min steps"]);
  box(292, 130, 220, 80, "Fragility table", [`${N(meta.n_buildings)} buildings`, "labels, wind, attributes"]);
  box(292, 250, 220, 80, "Household table", [`${N(meta.n_households)} homes`, "loss in 2024 $, wind"]);
  box(556, 120, 210, 100, "Fragility model", ["Two logistic stages", "county effect pooled", "graded attributes"], true);
  box(556, 246, 210, 100, "Loss model", ["Hurdle: logistic +", "lognormal, storm effect", "regime-aware"], true);
  box(800, 120, 162, 100, "Per building", ["P(damage), P(destroyed)", "80% range"]);
  box(800, 246, 162, 100, "Per home", ["Repair-cost quantiles", "uninhabitable, expected"]);
  arrow(248, 75, 292, 75); arrow(248, 158, 292, 170); arrow(248, 252, 292, 290); arrow(248, 346, 292, 300);
  arrow(402, 106, 402, 130); arrow(512, 90, 556, 150); arrow(512, 170, 556, 170); arrow(512, 290, 556, 296); arrow(512, 80, 556, 270);
  arrow(766, 170, 800, 170); arrow(766, 296, 800, 296);
}

/* ----- outputs ----- */
table("outputs", [{ h: "Output", k: "o" }, { h: "Definition", k: "d" }, { h: "Model", k: "m" }], [
  { o: "Chance of visible damage", d: "Probability that FEMA imagery would mark the building affected, minor, major or destroyed", m: "Fragility, stage 1" },
  { o: "Chance destroyed", d: "Probability of destruction; stage 1 times stage 2", m: "Fragility" },
  { o: "80% range", d: "Chance of damage with the county effect at its 10th and 90th percentiles", m: "Fragility" },
  { o: "Repair cost quantiles", d: "10th, 50th and 90th percentile of FEMA-verified loss for a damaged home, 2024 dollars", m: "Loss, severity" },
  { o: "Expected verified loss", d: "Chance of damage times the expected verified loss of a damaged home", m: "Both" },
  { o: "Chance uninhabitable", d: "Probability FEMA's inspector requires habitability repairs, for an inspected home", m: "Loss, habitability" },
  { o: "Peak sustained wind", d: "Maximum 1-minute, 10 m, open-terrain wind along the storm track at the location", m: "Wind field" },
]);

/* ----- source cards ----- */
const SOURCES = [
  { key: "hurdat2_atlantic", t: "NOAA National Hurricane Center: HURDAT2 Atlantic Best Track", provider: "NOAA National Hurricane Center", access: "Text file over HTTPS; latest Atlantic file in the HURDAT directory", used: "Tracks of the 19 storms; every 6-hourly fix plus landfall and intensity-peak records", fields: [
    ["Date, time", "string", "YYYYMMDD, HHMM UTC", "Time of the fix"], ["Status", "code", "TD, TS, HU, EX, SS, SD, LO, WV, DB", "System type"],
    ["Latitude, longitude", "float", "degrees, 0.1° resolution", "Centre position"], ["Maximum sustained wind", "integer", "knots", "1-minute mean at 10 m"],
    ["Minimum pressure", "integer", "hPa", "Not used"], ["34/50/64 kt wind radii", "integer", "nautical miles by quadrant", "Not used"],
    ["Radius of maximum wind", "integer", "nautical miles; −999 if absent", "Used when present (2021 on and some reanalysed fixes)"]],
    note: "Best-track intensity has an uncertainty of roughly 10 knots for major hurricanes at landfall (Landsea and Franklin, 2013)." },
  { key: "fema_rs_wind_points", t: "FEMA Historical Geospatial Damage Assessment Database", provider: "FEMA (ArcGIS feature service FEMA_Historical_Geospatial_Damage_Assessment_Database)", access: "ArcGIS REST query, 2,000 records per page; filter ASMT_TYPE = 'RS' and DMG_TYPE = 'WI'", used: "Hurricane Michael remote-sensing wind assessments (Maria pulled but not usable without an inventory)", fields: [
    ["DMG_LEVEL", "code", "NOD, AFF, MIN, MAJ, DES, UNK", "Damage level from imagery; Michael records only AFF and DES"], ["DMG_TYPE", "code", "WI, FL, MUL, …", "Damage type; WI kept"],
    ["ASMT_TYPE", "code", "RS, MOD, FA", "Assessment type; RS (remote sensing) kept, MOD (modelled) excluded"], ["WIND_SPEED", "code", "CAT1–CAT5", "FEMA's wind class; used only for the wind check"],
    ["EVENT_NAME, COUNTY, STATE", "string", "", "Event and location labels"], ["LATITUDE, LONGITUDE", "float", "degrees", "Structure location"]],
    note: "Only damaged structures are recorded. Undamaged buildings are inferred from the inventory (assumption A-01). Imagery coverage differs by county." },
  { key: "nsi_structures", t: "USACE National Structure Inventory", provider: "U.S. Army Corps of Engineers", access: "NSI API, structures within a polygon, one call per 0.1° tile", used: "Every structure in the assessed tiles", fields: [
    ["bid", "string", "", "Building identifier (shared by records in one footprint)"], ["x, y", "float", "degrees", "Location"],
    ["bldgtype", "code", "W wood, M masonry, C concrete, S steel, H manufactured", "Construction type; imputed for many buildings"], ["num_story", "integer", "", "Storeys"],
    ["found_type", "code", "S slab, C crawl, B basement, P pier, I pile, F fill, W solid wall", "Foundation"], ["occtype", "code", "Hazus occupancy, e.g. RES1-1SNB", "Occupancy class"],
    ["sqft", "float", "square feet", "Floor area"], ["med_yr_blt", "integer", "year", "Median year built of the census block, not the building"],
    ["val_struct", "float", "US dollars", "Structure replacement value"], ["firmzone", "code", "FEMA flood zone", "V-zone flag derived"], ["ground_elv", "float", "feet", "Ground elevation"],
    ["source", "code", "P parcel, H Hazus", "Origin of the record's attributes"]],
    note: "NSI is a current inventory. Buildings destroyed and not rebuilt may be missing, which would understate destruction. Puerto Rico is not covered." },
  { key: "fl_parcels_michael", t: "Florida Department of Revenue Cadastral Roll", provider: "Florida Department of Revenue, published by the Florida Geographic Information Office", access: "ArcGIS REST query by county number, 500 records per page, polygons reprojected to EPSG:4326 and generalised to 0.00001°", used: "Bay, Calhoun, Franklin, Gadsden, Gulf, Holmes, Jackson, Liberty and Washington counties", fields: [
    ["PARCEL_ID, CO_NO", "string, integer", "", "Parcel and DOR county number"], ["ACT_YR_BLT", "integer", "year", "Actual year built of the main improvement"],
    ["EFF_YR_BLT", "integer", "year", "Effective year built; not used"], ["DOR_UC", "code", "3-digit land-use code", "Mapped to use class"],
    ["CONST_CLAS", "integer", "1 fireproof steel, 2 reinforced concrete, 3 masonry, 4 wood, 5 steel", "Construction class (often blank)"],
    ["IMP_QUAL", "integer", "1–6", "Improvement quality grade"], ["TOT_LVG_AR", "integer", "square feet", "Living area"],
    ["NO_BULDNG, NO_RES_UNT", "integer", "", "Buildings and residential units; not used"], ["JV, LND_VAL", "float", "US dollars", "Just value and land value; not used"], ["Geometry", "polygon", "EPSG:4326", "Parcel boundary"]],
    note: "Owner names and mailing addresses were not requested. The roll is post-storm; see the post-storm rule in section 4.1." },
  { key: "ihp_owners", t: "OpenFEMA Individuals and Households Program Valid Registrations", provider: "FEMA, OpenFEMA API v2", access: "OData query per disaster number; ownRent eq 'O' and inspnReturned eq true; ordered by id; capped at 60,000 per declaration", used: "31 declarations covering 19 storms, 2016–2024", fields: [
    ["disasterNumber", "integer", "", "Declaration (DR) number"], ["censusGeoid, censusYear", "string, integer", "12-digit block-group GEOID; 2010 or 2020", "Location"],
    ["residenceType", "code", "H, M, T, C, A, B, O, …", "Dwelling type"], ["primaryResidence", "boolean", "", "Primary residence"], ["homeOwnersInsurance, floodInsurance", "boolean", "", "Policies held"],
    ["rpfvl", "float", "US dollars", "Real property FEMA verified loss"], ["roofDamage, roofDamageAmount", "boolean, float", "US dollars", "Roof damage (recorded to 2018 only)"],
    ["floodDamage, waterLevel", "boolean, integer", "inches", "Flood damage and water depth above the floor"], ["habitabilityRepairsRequired", "boolean", "", "Inspector required habitability repairs"],
    ["destroyed", "boolean", "", "Destroyed flag"], ["foundationDamage, floodDamageAmount", "boolean, float", "", "Pulled; not used"]],
    note: "Registrants self-select: the population is households that applied for assistance. Losses are verified to FEMA's habitability standard." },
  { key: "cenpop", t: "U.S. Census Bureau Centers of Population by Block Group", provider: "U.S. Census Bureau", access: "Text files per state, 2010 and 2020", used: "AL, FL, GA, LA, MS, NC, SC, TX, PR", fields: [
    ["STATEFP, COUNTYFP, TRACTCE, BLKGRPCE", "string", "", "Concatenated to the 12-digit GEOID"], ["POPULATION", "integer", "persons", "Not used"], ["LATITUDE, LONGITUDE", "float", "degrees", "Population-weighted centre"]],
    note: "Households are placed at the population centre of their block group, typically within 1–2 km of the home in suburban areas." },
  { key: "cpi", t: "BLS Consumer Price Index, All Urban Consumers", provider: "U.S. Bureau of Labor Statistics", access: "Annual averages, entered in scripts/build_loss.py", used: "Deflator to 2024 dollars", fields: [["Annual average", "float", "index, 1982–84 = 100", "See the table in section 4.2"]], note: "A general price index, not a construction-cost index." },
  { key: "ne_50m_land", t: "Natural Earth 1:50m Land and State Lines", provider: "Natural Earth", access: "GeoJSON from the natural-earth-vector repository", used: "Map backgrounds only", fields: [["Geometry", "polygon, line", "EPSG:4326", "Clipped to the Gulf and Atlantic coast and simplified at 0.02°"]], note: "Not used by any model." },
];
function sourceCards() {
  const box = $("#sourcecards"); box.innerHTML = "";
  for (const s of SOURCES) {
    const m = B.manifest[s.key] || (s.key === "cenpop" ? null : null);
    const div = document.createElement("div"); div.className = "card";
    div.innerHTML = `<h4>${s.t}</h4><dl><dt>Provider</dt><dd>${s.provider}</dd><dt>Access</dt><dd>${s.access}</dd><dt>Used for</dt><dd>${s.used}</dd>
      ${m ? `<dt>Endpoint</dt><dd><a href="${m.url}">${m.url.replace(/^https?:\/\//, "").slice(0, 90)}</a></dd><dt>Retrieved</dt><dd>${m.retrieved}</dd><dt>Size</dt><dd>${N(m.bytes / 1048576, 1)} MB</dd><dt>SHA-256</dt><dd class="hash">${m.sha256}</dd>` : ""}
      <dt>Known issues</dt><dd>${s.note}</dd></dl><div class="scroll-x"><table class="tbl"></table></div>`;
    table(div.querySelector("table"), [{ h: "Field", k: 0, m: true }, { h: "Type", k: 1 }, { h: "Units or Codes", k: 2 }, { h: "Meaning and Use", k: 3 }], s.fields);
    box.appendChild(div);
  }
}

/* ----- data dictionary ----- */
const DICT_F = [
  ["event", "string", "", "FEMA event", "Storm label (Michael 2018)"], ["tile", "string", "0.1° tile", "Derived", "floor(10·lon)_floor(10·lat)"],
  ["lat, lon", "float", "degrees", "NSI", "Building location"], ["construction", "category", "", "Parcel class, else NSI", "Construction type"],
  ["construction_source", "category", "parcel / nsi", "Derived", "Which source gave construction"], ["occupancy", "category", "", "NSI", "Occupancy class from the Hazus code"],
  ["use", "category", "", "Parcel DOR_UC", "Use class"], ["storeys", "category", "1, 2, 3plus", "NSI", "Storey band"],
  ["foundation", "category", "", "NSI", "Foundation type"], ["era", "category", "", "Parcel ACT_YR_BLT", "Design era from the building's year built"],
  ["quality", "category", "low, average, high", "Parcel IMP_QUAL", "1–2 low, 3 average, 4–6 high"], ["year_built", "integer", "year", "Parcel", "Actual year built (blank if unknown)"],
  ["sqft, living_sqft", "float", "sq ft", "NSI, parcel", "Floor area; living area preferred in the model"], ["val_struct", "float", "US dollars", "NSI", "Replacement value; not a model input"],
  ["coastal_v", "0/1", "", "NSI firmzone", "FEMA V zone (coastal high hazard)"], ["ground_elv_ft", "float", "feet", "NSI", "Ground elevation; below 10 ft flags low ground"],
  ["county_fips", "string", "5-digit FIPS", "Census centres", "Assessment unit"], ["wind_ms", "float", "m/s", "Wind field", "Peak sustained wind of Michael"],
  ["damage", "integer", "0 none, 1 damaged, 2 destroyed", "FEMA", "Outcome"]];
const DICT_L = [
  ["storm", "string", "", "Declaration map", "Storm label"], ["year", "integer", "", "Derived", "Storm year; sets the regime"], ["state", "string", "", "IHP", "Damaged state"],
  ["geoid", "string", "12 digits", "IHP", "Block group"], ["lat, lon", "float", "degrees", "Census centres", "Block-group population centre"],
  ["residence", "category", "", "IHP residenceType", "Dwelling type"], ["insured, flood_insured", "0/1", "", "IHP", "Homeowners and flood policies"],
  ["flood", "0/1", "", "IHP", "Flood damage or water level above zero"], ["water_in", "float", "inches", "IHP waterLevel", "Water depth above the floor"],
  ["wind_ms", "float", "m/s", "Wind field", "Peak sustained wind at the block-group centre"], ["loss", "float", "2024 US dollars", "IHP rpfvl × CPI", "Verified real property loss"],
  ["roof_loss", "float", "2024 US dollars", "IHP", "Roof damage amount; not a model input"], ["roof", "0/1", "", "IHP", "Roof damage (to 2018 only)"],
  ["destroyed, uninhabitable", "0/1", "", "IHP", "Outcomes"]];
function numFmt(k, v) {
  if (v == null || !isFinite(v)) return "–";
  if (/year/.test(k)) return String(Math.round(v));
  return Math.abs(v) >= 1000 ? N(v, 0) : N(v, 2);
}
function summ(stats, field) {
  const keys = field.split(", ").map(f => f.trim()); const out = [];
  for (const k of keys) { const s = stats[k]; if (!s) continue;
    if (s.type === "numeric") out.push(`${keys.length > 1 ? k + ": " : ""}mean ${numFmt(k, s.mean)}, median ${numFmt(k, s.p50)}, range ${numFmt(k, s.min)} to ${numFmt(k, s.max)}${s.missing ? `, ${N(s.missing)} missing` : ""}`);
    else out.push(`${keys.length > 1 ? k + ": " : ""}${s.levels.length} levels; most common ${s.levels.slice(0, 2).map(l => `${l[0]} (${N(l[1])})`).join(", ")}`); }
  return out.join("<br>") || "<small>derived label</small>";
}
function dictionary() {
  const cols = [{ h: "Field", k: 0, m: true }, { h: "Type", k: 1 }, { h: "Units or Codes", k: 2 }, { h: "Source", k: 3 }, { h: "Definition", k: 4 }, { h: "Distribution", k: 5 }];
  table("dict-frag", cols, DICT_F.map(r => [...r, summ(B.schema.fragility, r[0])]));
  table("dict-loss-t", cols, DICT_L.map(r => [...r, summ(B.schema.loss, r[0])]));
  const box = $("#levels"); box.innerHTML = "";
  const show = (title, stats) => { for (const [k, s] of Object.entries(stats)) { if (s.type !== "categorical" || s.levels.length > 25) continue;
    const h = document.createElement("h4"); h.textContent = `${title}: ${k}`; box.appendChild(h);
    const d = document.createElement("div"); d.className = "scroll-x"; const t = document.createElement("table"); t.className = "tbl"; d.appendChild(t); box.appendChild(d);
    table(t, [{ h: "Level", k: 0, m: true }, { h: "Records", k: 1, n: true, f: v => N(v) }, { h: "Share", k: 2, n: true }], s.levels.map(([l, n]) => [k === "county_fips" && COUNTY[l] ? `${l} ${COUNTY[l]}` : l, n, pct(n / s.n)])); } };
  show("Fragility table", B.schema.fragility); show("Household table", B.schema.loss);
}

/* ----- pipeline tables ----- */
function pipeline() {
  table("qa-frag", [{ h: "Step", k: "step" }, { h: "Records", k: "records", n: true, f: v => N(v) }], B.qa_fragility);
  const m = Object.values(B.matching)[0];
  $("#match-note").textContent = `FEMA points in assessed tiles: ${N(m.points_in_tiles)}; matched to a building within 30 m: ${N(m.matched)} (${pct(m.matched / m.points_in_tiles)}), median match distance ${N(m.median_distance_m, 1)} m.`;
  table("qa-loss", [{ h: "Step", k: "step" }, { h: "Records", k: "records", n: true, f: v => N(v) }], B.qa_loss);
  table("ihp", [{ h: "Declaration", k: "dr" }, { h: "Storm", k: "storm" }, { h: "Owner Inspections", k: "eligible", n: true, f: v => N(v) }, { h: "Pulled", k: "pulled", n: true, f: v => N(v) }, { h: "Sampling Fraction", k: "frac", n: true }],
    Object.entries(B.ihp_counts).map(([k, v]) => ({ dr: "DR-" + k, ...v, frac: pct(v.pulled / Math.max(v.eligible, 1), 0) })));
  const CPI = { 2016: 240.007, 2017: 245.120, 2018: 251.107, 2019: 255.657, 2020: 258.811, 2021: 270.970, 2022: 292.655, 2023: 304.702, 2024: 313.689 };
  table("cpi", [{ h: "Year", k: 0 }, { h: "CPI-U Annual Average", k: 1, n: true, f: v => v.toFixed(3) }, { h: "Multiplier to 2024 $", k: 2, n: true, f: v => v.toFixed(4) }], Object.entries(CPI).map(([y, v]) => [y, v, CPI[2024] / v]));
  table("windcheck", [{ h: "FEMA Class", k: "WIND_SPEED" }, { h: "Points", k: "size", n: true, f: v => N(v) }, { h: "Modelled Mean (kt)", k: "mean", n: true, f: v => N(v, 1) }, { h: "Min", k: "min", n: true, f: v => N(v, 1) }, { h: "Max", k: "max", n: true, f: v => N(v, 1) }], B.wind_check);
}

/* ----- fragility ----- */
const NM = (f, v) => (B.names[f] || {})[v] || v;

function colLabel(c) {
  if (c.includes("=")) { const [f, v] = c.split("="); return `${f} = ${NM(f, v)}`; }
  return { log_wind: "log(V / 50 m/s)", log_wind_sq: "log(V / 50)²", log_area: "log(floor area)", low_ground: "Ground below 10 ft", coastal_v: "FEMA V zone" }[c] || c;
}
function designTable() {
  const D = B.frag.any.design, rows = [];
  for (const c of D.cats) { rows.push({ col: `<b>${c}</b>`, kind: "categorical", ref: NM(c, D.refs[c]), detail: D.levels[c].length ? D.levels[c].map(l => `${NM(c, l)} (unknown → ${D.freq[c][l].toFixed(3)})`).join("; ") : "<small>no supported level; all values scored as the reference</small>" }); }
  for (const k of [...D.num, ...D.extra]) rows.push({ col: colLabel(k), kind: "numeric, standardised", ref: "–", detail: `mean ${D.mean[k].toFixed(4)}, sd ${D.sd[k].toFixed(4)}` });
  table("frag-design-t", [{ h: "Column", k: "col" }, { h: "Kind", k: "kind" }, { h: "Reference", k: "ref" }, { h: "Levels and Encoding", k: "detail" }], rows);
}
function paramTable(id, M, logistic) {
  const rows = [{ c: "Intercept", b: M.mu, se: M.se ? M.se[0] : null }];
  M.design.columns.forEach((c, j) => rows.push({ c: colLabel(c), b: M.beta[j], se: M.se ? M.se[j + 1] : null }));
  const cols = [{ h: "Term", k: "c" }, { h: "Estimate", k: "b", n: true, f: v => v.toFixed(4) }, { h: "Std. Error", k: "se", n: true, f: v => v == null ? "–" : v.toFixed(4) }, { h: "z", k: "z", n: true }];
  rows.forEach(r => { r.z = r.se ? (r.b / r.se).toFixed(1) : "–"; r.or = Math.exp(r.b).toFixed(3); });
  if (logistic) cols.push({ h: "Odds Ratio", k: "or", n: true });
  table(id, cols, rows);
  const t = document.getElementById(id);
  t.insertAdjacentHTML("afterend", `<p style="font-size:14px">${logistic ? "County or storm effect spread" : "Storm effect spread"} τ = ${Math.sqrt(M.tau2).toFixed(4)}${M.sigma2 != null ? `; residual σ = ${Math.sqrt(M.sigma2).toFixed(4)}` : ""}.</p>`);
}
function fragilitySection() {
  designTable();
  table("grades", [{ h: "Level", k: "level", m: true }, { h: "Odds Ratio", k: "odds_ratio", n: true, f: v => v.toFixed(3) }, { h: "90% Low", k: "lo90", n: true, f: v => Math.exp(v).toFixed(3) }, { h: "90% High", k: "hi90", n: true, f: v => Math.exp(v).toFixed(3) },
    { h: "Expected Direction", k: "prior_sign", f: v => v < 0 ? "Less damage" : v > 0 ? "More damage" : "None" }, { h: "Grade", k: "grade", f: v => `<span class="pill ${v === "supported" ? "ok" : "no"}">${v[0].toUpperCase() + v.slice(1)}</span>` },
    { h: "Buildings", k: "n_level", n: true, f: v => N(v) }], FB.factors);
  paramTable("p-any", B.frag.any, true); paramTable("p-des", B.frag.des, true);
  const cn = Object.fromEntries(B.schema.fragility.county_fips.levels);
  const ids = [...new Set([...Object.keys(B.frag.any.groups), ...Object.keys(B.frag.des.groups)])].sort();
  table("p-county", [{ h: "County", k: "c" }, { h: "FIPS", k: "f", m: true }, { h: "Buildings", k: "n", n: true, f: v => N(v) }, { h: "Damage Effect", k: "a", n: true, f: v => v == null ? "–" : v.toFixed(3) }, { h: "Destroyed Effect", k: "d", n: true, f: v => v == null ? "–" : v.toFixed(3) }],
    ids.map(f => ({ c: COUNTY[f] || f, f, n: cn[f], a: B.frag.any.groups[f], d: B.frag.des.groups[f] })));
}

/* ----- loss ----- */
function lossSection() {
  const F = [
    ["residence", "One-hot against house/duplex", "Dwelling type"], ["log(V / 50)", "\\(\\log(V/50)\\)", "Wind, standardised"],
    ["flood", "\\(\\mathbb 1[\\text{flooded}]\\)", "Flood damage or water above the floor"], ["log_water", "\\(\\log(1+w)\\)", "Water depth"],
    ["insured", "\\(\\mathbb 1[\\text{homeowners policy}]\\)", ""], ["regime_2019", "\\(R\\)", "Inspection regime"],
    ["mh_wind", "\\(\\log(V/50)\\cdot\\mathbb 1[\\text{mobile home}]\\)", "Mobile-home wind slope"],
    ["h50 … h113", "\\(\\max(k-h,0)/20\\), \\(h\\in\\{50,64,83,96,113\\}\\)", "Wind hinges at category thresholds"],
    ["flood_reg, ins_reg, water_reg, mh_reg, wind_reg", "Each term times \\(R\\)", "Regime interactions"],
    ["wind_flood", "\\(\\log(V/50)\\cdot\\text{flood}\\)", "Wind slope for flooded homes"],
    ["w6, w18, w36", "\\(\\log(1+\\max(w-h,0))\\)", "Water-depth hinges"],
    ["flood_mh, flood_fins, flood_ins", "flood × mobile home, × flood policy, × homeowners policy", "Flood interactions"]];
  table("loss-feat", [{ h: "Column", k: 0, m: true }, { h: "Definition", k: 1 }, { h: "Meaning", k: 2 }], F);
  paramTable("p-pos", B.loss.pos, true); paramTable("p-sev", B.loss.sev, false); paramTable("p-unh", B.loss.unh, true); paramTable("p-hdes", B.loss.des, true);
  const st = Object.keys(B.loss.sev.groups).sort((a, b) => +a.slice(-4) - +b.slice(-4) || a.localeCompare(b));
  const n = Object.fromEntries(B.schema.loss.storm.levels);
  table("p-storm", [{ h: "Storm", k: "s" }, { h: "Households", k: "n", n: true, f: v => N(v) }, { h: "P(Loss > 0)", k: "p", n: true, f: v => v.toFixed(3) }, { h: "Log Loss", k: "l", n: true, f: v => v.toFixed(3) }, { h: "Uninhabitable", k: "h", n: true, f: v => v.toFixed(3) }, { h: "Destroyed", k: "d", n: true, f: v => v.toFixed(3) }],
    st.map(s => ({ s, n: n[s], p: B.loss.pos.groups[s], l: B.loss.sev.groups[s], h: B.loss.unh.groups[s], d: B.loss.des.groups[s] })));
  table("mapping", [{ h: "Building", k: 0 }, { h: "Household Profile", k: 1 }], [["Manufactured construction or mobile-home use", "mobile_home"], ["Condominium use", "condo"], ["Other residential uses", "house_duplex"], ["Commercial, industrial, institutional", "Loss not shown (not in the household data)"]]);
}

/* ----- validation ----- */
const NICE = { hurricanevuln: "HurricaneVuln", gbm: "Gradient boosting", class_curves: "Construction-class curves", wind_only: "Wind only", climatology: "Historical distribution" };
function validation() {
  table("baselines", [{ h: "Baseline", k: 0 }, { h: "Used In", k: 1 }, { h: "Definition", k: 2 }], [
    ["Wind only", "Both", "Same model form with wind terms only and no group effect (fragility), or wind hinges with storm effect (loss)"],
    ["Construction-class curves", "Fragility", "Wind plus construction type, the structure of a catastrophe-model vulnerability table"],
    ["Gradient boosting", "Both", "scikit-learn HistGradientBoosting on the same inputs: fragility 250 trees, learning rate 0.06; loss 200 trees, learning rate 0.08 (classifier for P(L>0), regressor for log L with the residual sd as spread)"],
    ["Historical distribution", "Loss", "The pooled empirical distribution of losses in the training storms"]]);
  const rows = [];
  for (const sch of ["tiles", "county"]) for (const m of ["hurricanevuln", "gbm", "class_curves", "wind_only"]) { const r = FB.summary.find(x => x.scheme === sch && x.model === m); if (r) rows.push({ ...r, _hl: m === "hurricanevuln" }); }
  table("r-frag", [{ h: "Scheme", k: "scheme", f: v => v === "tiles" ? "New tiles" : "New county" }, { h: "Model", k: "model", f: v => NICE[v] }, { h: "Damage Brier", k: "any_brier", n: true, f: v => v.toFixed(4) }, { h: "Damage Log Loss", k: "any_logloss", n: true, f: v => v.toFixed(4) },
    { h: "Damage AUC", k: "any_auc", n: true, f: v => v.toFixed(3) }, { h: "Share Error", k: "any_share_err", n: true, f: v => v.toFixed(3) }, { h: "Destroyed Brier", k: "des_brier", n: true, f: v => v.toFixed(4) }, { h: "Destroyed AUC", k: "des_auc", n: true, f: v => v.toFixed(3) }], rows);
  table("r-county", [{ h: "County", k: "county", f: v => COUNTY[v] || v }, { h: "Buildings", k: "n", n: true, f: v => N(v) }, { h: "Observed", k: "obs", n: true, f: v => pct(v) }, { h: "Predicted", k: "pred", n: true, f: v => pct(v) }, { h: "80% Low", k: "lo80", n: true, f: v => pct(v) }, { h: "80% High", k: "hi80", n: true, f: v => pct(v) },
    { h: "Inside", k: "in", f: (v, r) => r.obs >= r.lo80 && r.obs <= r.hi80 ? "Yes" : "No" }], FB.county_intervals);
  const bin = Object.fromEntries(LB.binary.map(r => [r.model, r]));
  table("r-loss", [{ h: "Model", k: "model", f: v => NICE[v] }, { h: "CRPS", k: "crps", n: true, f: fmt$ }, { h: "Median Abs. Error", k: "median_abs_err", n: true, f: fmt$ }, { h: "80% Coverage", k: "cov80", n: true, f: v => pct(v) }, { h: "Storms Won", k: "storms_won", n: true },
    { h: "P(Loss > 0) AUC", k: "auc", n: true, f: (v, r) => bin[r.model] && bin[r.model].pos_auc != null ? bin[r.model].pos_auc.toFixed(3) : "–" }, { h: "Uninhabitable AUC", k: "u", n: true, f: (v, r) => bin[r.model] && bin[r.model].unh_auc != null ? bin[r.model].unh_auc.toFixed(3) : "–" }],
    LB.summary.map(r => ({ ...r, _hl: r.model === "hurricanevuln" })));
  const per = {}; for (const r of B.loss_per_storm) { (per[r.storm] = per[r.storm] || { storm: r.storm, n: r.n })[r.model] = r.crps; }
  const iv = Object.fromEntries(B.storm_intervals.map(r => [r.storm, r]));
  table("r-storm", [{ h: "Storm", k: "storm" }, { h: "Scored", k: "n", n: true, f: v => N(v) }, { h: "HurricaneVuln CRPS", k: "hurricanevuln", n: true, f: fmt$ }, { h: "Boosting CRPS", k: "gbm", n: true, f: fmt$ }, { h: "Historical CRPS", k: "climatology", n: true, f: fmt$ },
    { h: "Verified Mean", k: "o", n: true, f: (v, r) => fmt$(iv[r.storm].obs_mean) }, { h: "Predicted Mean", k: "p", n: true, f: (v, r) => fmt$(iv[r.storm].pred_mean) }, { h: "80% Range", k: "r", n: true, f: (v, r) => `${fmt$(iv[r.storm].lo80)} – ${fmt$(iv[r.storm].hi80)}` }],
    Object.values(per).sort((a, b) => a.storm.localeCompare(b.storm)));
}

/* ----- implementation ----- */
function implementation() {
  table("modules", [{ h: "File", k: 0, m: true }, { h: "Role", k: 1 }], [
    ["hurricanevuln/windfield.py", "HURDAT2 parser, track interpolation, Holland peak-wind field"], ["hurricanevuln/taxonomy.py", "Code maps for NSI, parcel roll and IHP; design eras"],
    ["hurricanevuln/model.py", "Design matrix, GroupLogit (penalised logistic with pooled group effect, Laplace-EM), GroupGauss (Gaussian mixed model by EM)"],
    ["hurricanevuln/fragility.py", "Two-stage fragility, validation folds, tile bootstrap"], ["hurricanevuln/loss.py", "Household features, hurdle model, CRPS, validation folds"],
    ["hurricanevuln/product.py", "Shipped specification from the attribute grades"], ["scripts/fetch_*.py", "Downloads, with manifest and checksums"],
    ["scripts/build_fragility.py, build_loss.py", "Analysis tables and data-quality logs"], ["experiments/run_fragility.py, run_loss_validation.py", "Validation and grading"],
    ["scripts/export_to_web.py, build_site.py", "Bundle and website build"], ["web/app.js", "Browser engine and product interface"], ["tests/test_core.py, test_js_parity.js", "Property tests and engine parity"]]);
  try {
    const tracks = Object.fromEntries(B.tracks.map(t => [t.storm, interpTrack(t)]));
    let w = 0, f = 0, l = 0;
    for (const c of B.wind_cases) w = Math.max(w, Math.abs(peakWind(tracks[c.storm], c.lat, c.lon) - c.v));
    for (const c of B.frag_cases) { const r = fragility(c.x); f = Math.max(f, Math.abs(r.any - c.p_any), Math.abs(r.des - c.p_des)); }
    for (const c of B.loss_cases) { const h = household(c.x); l = Math.max(l, Math.abs(h.ppos - c.p_pos), Math.abs(h.mu - c.mu), Math.abs(h.sd - c.sd)); }
    $("#parity").innerHTML = [["Wind field", w, B.wind_cases.length, "m/s"], ["Fragility", f, B.frag_cases.length, "probability"], ["Household loss", l, B.loss_cases.length, "probability, log $"]]
      .map(([t, v, n, u]) => `<div><span>${t}, ${n} cases</span><b>${v.toExponential(1)}</b><span>Largest difference (${u})</span></div>`).join("");
  } catch (e) { $("#parity").innerHTML = `<div><span>The parity check could not run in this browser.</span></div>`; }
}

/* ----- assumptions, glossary, references ----- */
function staticTables() {
  table("assume", [{ h: "ID", k: 0, m: true }, { h: "Assumption", k: 1 }, { h: "Statement and Consequence", k: 2 }], [
    ["A-01", "Undamaged buildings", "FEMA imagery records only damaged structures; inventory buildings in assessed tiles with no point within 30 m are taken as undamaged. Missed damage would lower estimated fragility."],
    ["A-02", "Wind reference", "Open-terrain 1-minute wind at 10 m from a parametric profile. Local roughness, topography and gust structure are not represented."],
    ["A-03", "Assessment unit", "County effects absorb differences in imagery coverage; new locations integrate over them, which widens ranges."],
    ["A-04", "Post-storm roll", "Buildings built 2019+ are removed unless a damage point marks them as rebuilds, whose attributes become unknown."],
    ["A-05", "Unknown attributes", "Unknown values take the average contribution of known values and have no parameter, so missingness cannot carry the outcome."],
    ["A-06", "Inventory quality", "NSI construction type is often imputed and its year built is a block median; Florida parcels override where available, Georgia relies on NSI."],
    ["A-07", "Verified loss", "FEMA-verified real property loss to a habitability standard, for registered and inspected owners; below a full insured loss."],
    ["A-08", "Inspection regime", "A 2019 regime indicator absorbs FEMA's change in practice; predictions use the current regime."],
    ["A-09", "Household location", "Households sit at the block-group population centre; wind there stands for wind at the home."],
    ["A-10", "Combination", "Expected loss multiplies the building's damage probability by the mean verified loss of a damaged home."],
    ["A-11", "Geography", "Fragility: Florida Panhandle and south-west Georgia, one storm. Loss: 19 storms from Texas to Puerto Rico and the Carolinas."],
    ["A-12", "Perils", "Surge is represented by V-zone and low-ground indicators (fragility) and household flood water (loss), not as a separate peril."],
    ["A-13", "Sampling", "Declarations above 60,000 owner inspections are randomly sampled to 60,000; storms are weighted by their sampled size."],
    ["A-14", "Prices", "Losses are deflated with CPI-U; construction costs rose faster than CPI after 2020, so earlier storms may be understated in real terms."]]);
  table("gloss", [{ h: "Term", k: 0 }, { h: "Meaning", k: 1 }], [
    ["AUC", "Area under the ROC curve: the probability a randomly chosen positive case is scored above a randomly chosen negative one."],
    ["Best track", "The National Hurricane Center's post-season estimate of a storm's position and intensity."],
    ["Brier score", "Mean squared difference between predicted probability and outcome."],
    ["CRPS", "Continuous ranked probability score: the integrated squared difference between a predictive distribution and the observed value, in the units of the outcome."],
    ["Fragility curve", "Probability of reaching a damage state as a function of hazard intensity."],
    ["Gauss-Hermite quadrature", "A numerical rule for integrals against a normal density using fixed nodes and weights."],
    ["Hurdle model", "A model with one part for whether an outcome is zero and another for its size when positive."],
    ["Partial pooling", "Group effects drawn from a common distribution, so small groups borrow strength from the rest."],
    ["Radius of maximum wind", "Distance from the storm centre to the strongest winds."],
    ["Saffir-Simpson category", "Category 1: 64–82 kt; 2: 83–95; 3: 96–112; 4: 113–136; 5: 137 kt or more."],
    ["Verified loss", "FEMA's inspected estimate of real property repairs needed to make a home safe, sanitary and functional."]]);
  $("#refs").innerHTML = [
    "Breslow, N. E., and Clayton, D. G. (1993). Approximate inference in generalized linear mixed models. <i>Journal of the American Statistical Association</i>, 88(421), 9–25.",
    "Gneiting, T., and Raftery, A. E. (2007). Strictly proper scoring rules, prediction, and estimation. <i>Journal of the American Statistical Association</i>, 102(477), 359–378.",
    "Gneiting, T., and Ranjan, R. (2011). Comparing density forecasts using threshold- and quantile-weighted scoring rules. <i>Journal of Business and Economic Statistics</i>, 29(3), 411–422.",
    "Holland, G. J. (1980). An analytic model of the wind and pressure profiles in hurricanes. <i>Monthly Weather Review</i>, 108(8), 1212–1218.",
    "Ke, G., et al. (2017). LightGBM: A highly efficient gradient boosting decision tree. <i>Advances in Neural Information Processing Systems</i>, 30.",
    "Landsea, C. W., and Franklin, J. L. (2013). Atlantic hurricane database uncertainty and presentation of a new database format. <i>Monthly Weather Review</i>, 141(10), 3576–3592.",
    "Pedregosa, F., et al. (2011). Scikit-learn: Machine learning in Python. <i>Journal of Machine Learning Research</i>, 12, 2825–2830.",
    "Vickery, P. J., and Wadhera, D. (2008). Statistical models of Holland pressure profile parameter and radius to maximum winds of hurricanes from flight-level pressure and H*Wind data. <i>Journal of Applied Meteorology and Climatology</i>, 47(10), 2497–2517.",
    "Willoughby, H. E., Darling, R. W. R., and Rahn, M. E. (2006). Parametric representation of the primary hurricane vortex. Part II: A new family of sectionally continuous profiles. <i>Monthly Weather Review</i>, 134(4), 1102–1120.",
    "FEMA. OpenFEMA Dataset: Individuals and Households Program – Valid Registrations, v2. Data dictionary and terms of use.",
    "FEMA. Historical Geospatial Damage Assessment Database (ArcGIS feature service).",
    "U.S. Army Corps of Engineers. National Structure Inventory technical documentation.",
    "Florida Department of Revenue. Name-Address-Legal (NAL) file user guide, property tax oversight data portal.",
  ].map(x => `<li>${x}</li>`).join("");
}

/* ----- contents and scroll spy ----- */
function toc() {
  const box = $("#toc"), links = [];
  document.querySelectorAll("#doc section").forEach(sec => {
    const h = sec.querySelector("h2"); const a = document.createElement("a"); a.href = "#" + sec.id; a.textContent = h.textContent.replace(/^\d+/, "").trim(); box.appendChild(a); links.push([sec, a]);
    sec.querySelectorAll("h3[id]").forEach(h3 => { const b = document.createElement("a"); b.href = "#" + h3.id; b.className = "sub"; b.textContent = h3.textContent.replace(/^[\d.]+\s*/, ""); box.appendChild(b); });
  });
  const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) { links.forEach(([, a]) => a.classList.remove("on")); const l = links.find(([s]) => s === e.target); if (l) l[1].classList.add("on"); } }); }, { rootMargin: "-20% 0px -70% 0px" });
  links.forEach(([s]) => io.observe(s));
}

/* ----- theme ----- */
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
try { const t = localStorage.getItem("hv-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
function syncTheme() { $("#theme").textContent = isDark() ? "Light" : "Dark"; drawArch(); }
$("#theme").onclick = () => { const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("hv-theme", t); } catch (e) {} syncTheme(); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);

sourceCards(); dictionary(); pipeline(); fragilitySection(); lossSection(); validation(); implementation(); staticTables(); toc(); syncTheme();
if (window.renderMathInElement) renderMathInElement(document.getElementById("doc"), { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\(", right: "\\)", display: false }], throwOnError: false });
})();
