// Runs the engine block of web/app.js against Python reference cases in web/bundle.json.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
const B = JSON.parse(fs.readFileSync(path.join(root, "web", "bundle.json"), "utf8"));
const a = app.indexOf("/* ===== engine ===== */"), b = app.indexOf("/* ===== end engine ===== */");
if (a < 0 || b < 0) throw new Error("engine block not found");
const E = new Function("B", app.slice(a, b) + "return {interpTrack, peakWind, fragility, household};")(B);
const tracks = Object.fromEntries(B.tracks.map(t => [t.storm, E.interpTrack(t)]));
let wW = 0, wF = 0, wL = 0;
for (const c of B.wind_cases) wW = Math.max(wW, Math.abs(E.peakWind(tracks[c.storm], c.lat, c.lon) - c.v));
for (const c of B.frag_cases) { const f = E.fragility(c.x); wF = Math.max(wF, Math.abs(f.any - c.p_any), Math.abs(f.des - c.p_des)); }
for (const c of B.loss_cases) { const h = E.household(c.x); wL = Math.max(wL, Math.abs(h.ppos - c.p_pos), Math.abs(h.mu - c.mu), Math.abs(h.sd - c.sd)); }
console.log(`wind ${B.wind_cases.length} cases, max |diff| ${wW.toExponential(2)} m/s`);
console.log(`fragility ${B.frag_cases.length} cases, max |diff| ${wF.toExponential(2)}`);
console.log(`loss ${B.loss_cases.length} cases, max |diff| ${wL.toExponential(2)}`);
if (wW > 1e-3 || wF > 1e-6 || wL > 1e-6) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
