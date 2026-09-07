/**
 * Plugin: linework (Linework Editor)
 * plugins/linework/linework.js
 *
 * Import linework from FIELD DATA — a point file (P,N,E,Z,D) or a bearing/distance
 * call list — check it for the common field blunders, and edit vertices and courses
 * interactively on an SVG canvas. DXF linework is corrected in the DXF Auditor.
 *
 * Depends on core/cogo.js (window.COGO). Registers via window.PluginRegistry.
 * Exposes window.Linework = { parsePointFile, buildFigures, parseCalls, checkModel }.
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "linework",
        version: "1.0.0",
        description: "Import & check linework from field data (point file or bearing/distance calls); interactive SVG vertex/course editor with DXF / PNEZD / Map Check export.",
        tab: "tab-linework",
        icon: "fa-pen-ruler",
        tier: "Pro",
        dependencies: []
    };

    const SVGNS = "http://www.w3.org/2000/svg";
    const FL_ENV = { minE: 50000, maxE: 3500000, minN: 50000, maxN: 4500000 };
    const clean = s => window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(String(s ?? "")) : String(s ?? "");
    const nz = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

    // Realistic Florida State Plane East (US ft) coordinates. Contains, on purpose:
    //  - BND: a normal closed boundary (closes fine)
    //  - BLDG: a closed building, but the crew re-shot the POB as the last point (redundant)
    //  - EP: an open line with a duplicated shot (#11 == #10) — a zero-length course
    //  - BOW: a closed figure with the point order wrong — a bow-tie
    const SAMPLE = [
        "1,2015000.00,642000.00,12.5,BND B",
        "2,2015300.00,642000.00,12.6,BND",
        "3,2015300.00,642210.00,12.4,BND",
        "4,2015000.00,642210.00,12.5,BND Z",
        "5,2015050.00,642050.00,11.9,BLDG B",
        "6,2015050.00,642120.00,11.9,BLDG",
        "7,2015095.00,642120.00,11.9,BLDG",
        "8,2015095.00,642050.00,11.9,BLDG",
        "9,2015050.00,642050.00,11.9,BLDG Z",
        "10,2015400.00,642000.00,12.5,EP",
        "11,2015600.00,642000.00,12.5,EP",
        "12,2015600.00,642000.00,12.5,EP",
        "13,2015610.00,642400.00,12.4,EP",
        "14,2016000.00,643000.00,10.0,BOW B",
        "15,2016100.00,643100.00,10.0,BOW",
        "16,2016000.00,643100.00,10.0,BOW",
        "17,2016100.00,643000.00,10.0,BOW Z"
    ].join("\n");

    // ── Parsing ──────────────────────────────────────────────────────────────

    /** Parse a P,N,E,Z,D point file. order = "NE" (default) or "EN". */
    function parsePointFile(text, order) {
        const en = order === "EN";
        const points = [];
        const bad = [];
        const lines = String(text || "").split(/\r?\n/);
        lines.forEach((raw, i) => {
            const line = raw.trim();
            if (!line || line.startsWith("#") || line.startsWith(";")) return;
            const delim = line.includes(",") ? "," : (line.includes("\t") ? "\t" : /\s+/);
            const toks = line.split(delim).map(t => t.trim()).filter(t => t.length);
            if (toks.length < 3) { bad.push(i + 1); return; }
            const a = parseFloat(toks[1]), b = parseFloat(toks[2]);
            if (!Number.isFinite(a) || !Number.isFinite(b)) { if (points.length) bad.push(i + 1); return; }
            let z = parseFloat(toks[3]);
            let descStart = 4;
            if (!Number.isFinite(z)) { z = 0; descStart = 3; }
            const desc = toks.slice(descStart).join(" ").replace(/^["']+|["']+$/g, "").trim();
            const pn = parseInt(toks[0], 10);
            points.push({
                ptNum: Number.isFinite(pn) ? pn : toks[0],
                n: en ? b : a,
                e: en ? a : b,
                z, desc, srcLine: i + 1
            });
        });
        return { points, bad };
    }

    const CTRL_BEGIN = /^(B|BEG|BEGIN|START|PB)$/i;
    const CTRL_CLOSE = /^(Z|C|E|END|CLS|CLOSE|PE)$/i;

    function splitDesc(desc) {
        const toks = String(desc || "").split(/[\s/]+/).filter(Boolean);
        let closeFlag = false, fig = "", code = [];
        for (const t of toks) {
            if (CTRL_CLOSE.test(t)) closeFlag = true;
            else if (CTRL_BEGIN.test(t)) { /* marker only */ }
            else if (/^\d{1,3}$/.test(t)) fig = t;
            else code.push(t);
        }
        return { code: code.join(" ") || String(desc || "").trim() || "LINE", fig: fig || "1", closeFlag };
    }

    function defaultLayer(code) {
        const c = String(code || "").toUpperCase();
        const map = [
            [/BND|BOUND|PROP|PARCEL|\bLOT\b/, "SURV_BND_PR"],
            [/R\/?W|ROW|RIGHT.?OF.?WAY/, "RW_LINE_PR"],
            [/EOP|\bEP\b|EDGE.?OF.?PAV|PAVE/, "ROAD_EOP_EX"],
            [/\bCL\b|CENTERLINE|C\/L|ALIGN/, "ROAD_ALIGN_EX"],
            [/CURB|C&G|\bBOC\b|\bFOC\b/, "ROAD_CURB_PR"],
            [/\bSW\b|SIDEWALK/, "ROAD_SWK_PR"],
            [/BLD|BUILD|STRUCT/, "SURV_BND_PR"],
            [/DITCH|SWALE|\bTOB\b|\bTOE\b|FLOW/, "DRAIN_FLOW_DIR"],
            [/CONT|CONTOUR/, "SURV_MIN_CONT"]
        ];
        for (const [re, l] of map) if (re.test(c)) return l;
        const disc = window.BoundaryQCCMS && window.BoundaryQCCMS.getActiveTemplateSetting
            ? window.BoundaryQCCMS.getActiveTemplateSetting("discipline", "SURV") : "SURV";
        const first = (window.FDOT_DATA && window.FDOT_DATA.layers || []).find(x => x.discipline === disc);
        return first ? first.name : "SURV_BND_PR";
    }

    const byNum = (x, y) => {
        const a = typeof x.ptNum === "number" ? x.ptNum : parseFloat(x.ptNum);
        const b = typeof y.ptNum === "number" ? y.ptNum : parseFloat(y.ptNum);
        if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
        return String(x.ptNum).localeCompare(String(y.ptNum));
    };

    /** Group points into figures. mode = "byCode" | "byFigure" | "single". */
    function buildFigures(points, mode) {
        if (mode === "single") {
            const pts = points.slice().sort(byNum).map(p => ({ e: p.e, n: p.n, z: p.z, ptNum: p.ptNum, desc: p.desc }));
            return pts.length ? [{ id: "F1", name: "LINE-1", layer: defaultLayer("LINE"), closed: false, pts }] : [];
        }
        const groups = new Map();
        points.forEach(p => {
            const { code, fig, closeFlag } = splitDesc(p.desc);
            const key = mode === "byFigure" ? `${code} #${fig}` : code;
            let g = groups.get(key);
            if (!g) { g = { key, code, closed: false, items: [] }; groups.set(key, g); }
            g.items.push(p);
            if (closeFlag) g.closed = true;
        });
        let idx = 0;
        return Array.from(groups.values()).map(g => ({
            id: "F" + (++idx),
            name: g.key,
            layer: defaultLayer(g.code),
            closed: g.closed,
            pts: g.items.slice().sort(byNum).map(p => ({ e: p.e, n: p.n, z: p.z, ptNum: p.ptNum, desc: p.desc }))
        })).filter(f => f.pts.length);
    }

    /** Parse a bearing/distance call list into a single figure. */
    function parseCalls(text, start) {
        const legs = [];
        String(text || "").split(/\r?\n/).forEach(line => {
            const s = line.trim();
            if (!s) return;
            const b = window.COGO.parseBearing(s);
            const d = s.match(/([\d,]+(?:\.\d+)?)\s*(?:feet|foot|ft|')?\s*$/i);
            if (b && d) legs.push({ kind: "line", azimuthDeg: b.azimuthDeg, distance: parseFloat(d[1].replace(/,/g, "")) });
        });
        if (!legs.length) return null;
        const tr = window.COGO.runTraverse(legs, start || { e: 0, n: 0 });
        const pts = tr.vertices.map((v, i) => ({ e: v.e, n: v.n, ptNum: 500 + i, desc: "COGO " + (i === 0 ? "POB" : "P" + i) }));
        // A call list is a traverse: closure/misclosure is meaningful here (unlike a
        // polygon of located corners). Flag it so checkModel runs the closure test.
        const closes = pts.length >= 3 && window.COGO.distanceBetween(pts[pts.length - 1], pts[0]) < 1;
        return {
            id: "F1", name: "TRAVERSE-1", layer: defaultLayer("BND"),
            closed: closes, fromCalls: true, pts
        };
    }

    // ── Checks ───────────────────────────────────────────────────────────────

    function segsProperlyCross(a, b, c, d) {
        const cr = (p, q, r) => (r.n - p.n) * (q.e - p.e) - (q.n - p.n) * (r.e - p.e);
        const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
        return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
               ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
    }

    function selfIntersection(pts, closed) {
        const n = closed ? pts.length : pts.length - 1;
        const P = i => pts[i % pts.length];
        for (let i = 0; i < n; i++) {
            for (let j = i + 2; j < n; j++) {
                if (i === 0 && j === n - 1 && closed) continue;
                if (segsProperlyCross(P(i), P(i + 1), P(j), P(j + 1))) return { i: i + 1, j: j + 1 };
            }
        }
        return null;
    }

    function checkModel(model, opts) {
        opts = opts || {};
        const closeTol = nz(opts.closeTol, 0.1);
        const snapTol = nz(opts.snapTol, 0.1);
        const out = [];
        const add = (sev, msg, figId, idx, fix) => out.push({ sev, msg, figId, idx, fix });

        // duplicate point numbers across the whole dataset
        const seen = new Map();
        model.figures.forEach(f => f.pts.forEach(p => {
            if (p.ptNum == null) return;
            seen.set(p.ptNum, (seen.get(p.ptNum) || 0) + 1);
        }));
        const dups = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
        if (dups.length) add("WARNING", `Duplicate point number(s): ${dups.slice(0, 12).join(", ")}${dups.length > 12 ? "…" : ""}`, null, null, null);

        model.figures.forEach(f => {
            const pts = f.pts;
            if (pts.length < 2) { add("WARNING", `${f.name}: only ${pts.length} point — nothing to draw.`, f.id, null, null); return; }

            // zero-length / duplicate consecutive
            for (let i = 1; i < pts.length; i++) {
                if (window.COGO.distanceBetween(pts[i - 1], pts[i]) < Math.max(1e-6, snapTol / 5)) {
                    add("ERROR", `${f.name}: coincident consecutive points at #${pts[i].ptNum ?? i} (zero-length course).`,
                        f.id, i, { type: "delVertex", figId: f.id, idx: i });
                }
            }
            // spike / backtrack (interior included angle ~0) — skip when an adjacent
            // course is near-zero-length (that case is reported separately).
            for (let i = 1; i < pts.length - 1; i++) {
                const inLen = window.COGO.distanceBetween(pts[i - 1], pts[i]);
                const outLen = window.COGO.distanceBetween(pts[i], pts[i + 1]);
                if (inLen < 0.05 || outLen < 0.05) continue;
                const ang = window.COGO.includedAngleDeg(pts[i - 1], pts[i], pts[i + 1]);
                if (ang < 3) {
                    add("WARNING", `${f.name}: spike / backtrack at #${pts[i].ptNum ?? i} (course reverses ~${ang.toFixed(1)}°). Likely a mis-sequenced shot.`,
                        f.id, i, { type: "delVertex", figId: f.id, idx: i });
                }
            }
            // non-consecutive near-coincident vertices → merge candidates
            let merges = 0;
            for (let i = 0; i < pts.length && merges < 4; i++) {
                for (let j = i + 2; j < pts.length && merges < 4; j++) {
                    if (i === 0 && j === pts.length - 1) continue;
                    if (window.COGO.distanceBetween(pts[i], pts[j]) < snapTol) {
                        add("INFO", `${f.name}: #${pts[i].ptNum ?? i} and #${pts[j].ptNum ?? j} are within ${snapTol} ft — merge?`,
                            f.id, i, { type: "merge", figId: f.id, i, j });
                        merges++;
                    }
                }
            }
            // envelope — not meaningful for a local call-list traverse (no SPC position)
            if (!f.fromCalls) {
                const oob = pts.find(p => p.e < FL_ENV.minE || p.e > FL_ENV.maxE || p.n < FL_ENV.minN || p.n > FL_ENV.maxN);
                if (oob) add("WARNING", `${f.name}: coordinates outside the Florida State Plane envelope (e.g. E ${oob.e.toFixed(1)}, N ${oob.n.toFixed(1)}).`, f.id, null, null);
            }

            // self-intersection
            const bt = selfIntersection(pts, f.closed);
            if (bt) add("ERROR", `${f.name}: self-intersecting (bow-tie) — course ${bt.i} crosses course ${bt.j}. Check bearing quadrant / point order.`,
                f.id, bt.i - 1, { type: "untangle", figId: f.id });

            // Closed figures.
            if (f.closed && pts.length >= 3) {
                const gap = window.COGO.distanceBetween(pts[pts.length - 1], pts[0]);
                const area = window.COGO.shoelaceArea(pts);
                if (f.fromCalls) {
                    // A traverse from bearing/distance calls: the end-to-POB gap IS the misclosure.
                    let per = 0;
                    for (let i = 1; i < pts.length; i++) per += window.COGO.distanceBetween(pts[i - 1], pts[i]);
                    const prec = gap > 1e-4 ? per / gap : Infinity;
                    if (gap > 0.1) {
                        add("WARNING", `${f.name}: traverse misclosure ${gap.toFixed(3)} ft (precision ${prec === Infinity ? "exact" : "1:" + Math.round(prec).toLocaleString()}). Review the courses.`, f.id, null, null);
                    } else {
                        add("INFO", `${f.name}: closes ${gap.toFixed(3)} ft · precision ${prec === Infinity ? "exact" : "1:" + Math.round(prec).toLocaleString()} · area ${(area / window.COGO.SQFT_PER_ACRE).toFixed(3)} ac.`, f.id, null, null);
                    }
                } else if (gap < Math.max(closeTol, 0.05)) {
                    // Located corners with the POB re-shot as the last point → redundant.
                    add("INFO", `${f.name}: last shot #${pts[pts.length - 1].ptNum ?? "last"} duplicates the POB — redundant, safe to remove. Area ${(area / window.COGO.SQFT_PER_ACRE).toFixed(3)} ac.`,
                        f.id, pts.length - 1, { type: "delVertex", figId: f.id, idx: pts.length - 1 });
                } else {
                    add("INFO", `${f.name}: closed polygon · ${pts.length} corners · area ${(area / window.COGO.SQFT_PER_ACRE).toFixed(3)} ac (${area.toFixed(0)} sf).`, f.id, null, null);
                }
            }
        });

        // figure-to-figure crossing
        for (let a = 0; a < model.figures.length; a++) {
            for (let b = a + 1; b < model.figures.length; b++) {
                const fa = model.figures[a], fb = model.figures[b];
                let crossed = false;
                const segs = f => { const n = f.closed ? f.pts.length : f.pts.length - 1; const r = []; for (let i = 0; i < n; i++) r.push([f.pts[i], f.pts[(i + 1) % f.pts.length]]); return r; };
                const A = segs(fa), B = segs(fb);
                for (const s of A) { for (const t of B) { if (segsProperlyCross(s[0], s[1], t[0], t[1])) { crossed = true; break; } } if (crossed) break; }
                if (crossed) add("INFO", `${fa.name} crosses ${fb.name}.`, fa.id, null, null);
            }
        }

        const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
        return out.sort((x, y) => rank[x.sev] - rank[y.sev]);
    }

    // ── Editor ───────────────────────────────────────────────────────────────

    const Ed = {
        root: null, svg: null, ctx: null,
        model: { figures: [] },
        sel: null,                 // { figId, kind:"vert"|"seg", idx }
        view: { x: -50, y: -50, w: 100, h: 100 },
        hist: [], hidx: -1, drag: null, pan: null,

        mount(rootId, ctx) {
            this.ctx = ctx;
            this.root = document.getElementById(rootId);
            if (!this.root) return;
            this.svg = document.createElementNS(SVGNS, "svg");
            this.svg.setAttribute("width", "100%");
            this.svg.setAttribute("height", "100%");
            this.svg.style.cssText = "display:block; touch-action:none; cursor:grab;";
            this.root.textContent = "";
            this.root.appendChild(this.svg);
            this._bind();
        },

        setModel(m) {
            this.model = m && m.figures ? m : { figures: [] };
            this.sel = null;
            this.hist = []; this.hidx = -1;
            this._snapshot();
            this.fit();
            this._afterChange();
        },

        _fig(id) { return this.model.figures.find(f => f.id === id); },
        _allPts() { return this.model.figures.reduce((a, f) => a.concat(f.pts), []); },
        _opts() {
            return {
                closeTol: nz(document.getElementById("lw-closetol") && document.getElementById("lw-closetol").value, 0.1),
                snapTol: nz(document.getElementById("lw-snaptol") && document.getElementById("lw-snaptol").value, 0.1)
            };
        },
        _traverseMode() { const c = document.getElementById("lw-traverse-mode"); return !!(c && c.checked); },

        _snapshot() {
            this.hist = this.hist.slice(0, this.hidx + 1);
            this.hist.push(JSON.stringify(this.model));
            if (this.hist.length > 100) this.hist.shift();
            this.hidx = this.hist.length - 1;
        },
        undo() { if (this.hidx > 0) { this.hidx--; this.model = JSON.parse(this.hist[this.hidx]); this.sel = null; this._afterChange(); } },
        redo() { if (this.hidx < this.hist.length - 1) { this.hidx++; this.model = JSON.parse(this.hist[this.hidx]); this.sel = null; this._afterChange(); } },
        _commit() { this._snapshot(); this._afterChange(); },

        fit() {
            const pts = this._allPts();
            const r = this.root.getBoundingClientRect();
            const aspect = (r.width || 600) / (r.height || 400);
            if (!pts.length) { this.view = { x: -50, y: -50, w: 100 * aspect, h: 100 }; this._applyView(); this.render(); return; }
            let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
            for (const p of pts) { const x = p.e, y = -p.n; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
            let w = Math.max(maxx - minx, 1), h = Math.max(maxy - miny, 1);
            const pad = Math.max(w, h) * 0.12;
            let vw = w + pad * 2, vh = h + pad * 2;
            if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
            this.view = { x: (minx + maxx) / 2 - vw / 2, y: (miny + maxy) / 2 - vh / 2, w: vw, h: vh };
            this._applyView();
            this.render();
        },
        _applyView() { this.svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`); },
        _mk(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; },

        render() {
            if (!this.svg) return;
            while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
            const u = this.view.w / 620; // ~1px in world units

            this.model.figures.forEach(f => {
                if (f.pts.length < 1) return;
                const selFig = this.sel && this.sel.figId === f.id;
                if (f.pts.length >= 2) {
                    const dstr = f.pts.map(p => `${p.e},${-p.n}`).join(" ");
                    this.svg.appendChild(this._mk(f.closed ? "polygon" : "polyline", {
                        points: dstr,
                        fill: f.closed ? "rgba(56,189,248,0.07)" : "none",
                        stroke: f.__bt ? "#f43f5e" : (selFig ? "#7dd3fc" : "#38bdf8"),
                        "stroke-width": u * 1.6, "stroke-linejoin": "round", "stroke-linecap": "round"
                    }));
                    const segN = f.closed ? f.pts.length : f.pts.length - 1;
                    for (let i = 0; i < segN; i++) {
                        const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
                        const on = this.sel && this.sel.figId === f.id && this.sel.kind === "seg" && this.sel.idx === i;
                        this.svg.appendChild(this._mk("line", {
                            x1: a.e, y1: -a.n, x2: b.e, y2: -b.n,
                            stroke: on ? "#facc15" : "#000",
                            "stroke-opacity": on ? 0.9 : 0.001,
                            "stroke-width": u * (on ? 3 : 12),
                            "data-fig": f.id, "data-seg": i, style: "cursor:pointer"
                        }));
                    }
                }
                f.pts.forEach((p, idx) => {
                    const on = this.sel && this.sel.figId === f.id && this.sel.kind === "vert" && this.sel.idx === idx;
                    this.svg.appendChild(this._mk("circle", {
                        cx: p.e, cy: -p.n, r: u * (on ? 5 : 3.4),
                        fill: on ? "#facc15" : "#ef4444", stroke: "#fff", "stroke-width": u,
                        "data-fig": f.id, "data-vert": idx, style: "cursor:pointer"
                    }));
                });
            });
        },

        _svgWorld(evt) {
            const m = this.svg.getScreenCTM();
            if (!m) return null;
            const pt = this.svg.createSVGPoint();
            pt.x = evt.clientX; pt.y = evt.clientY;
            const p = pt.matrixTransform(m.inverse());
            return { e: p.x, n: -p.y };
        },

        _bind() {
            const svg = this.svg;

            svg.addEventListener("wheel", e => {
                e.preventDefault();
                const r = this.root.getBoundingClientRect();
                const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
                const wx = this.view.x + fx * this.view.w, wy = this.view.y + fy * this.view.h;
                const k = e.deltaY < 0 ? 0.84 : 1.19;
                this.view.w *= k; this.view.h *= k;
                this.view.x = wx - fx * this.view.w;
                this.view.y = wy - fy * this.view.h;
                this._applyView();
                this.render();
            }, { passive: false });

            svg.addEventListener("pointerdown", e => {
                const t = e.target;
                if (t && t.getAttribute && t.getAttribute("data-vert") != null) {
                    const figId = t.getAttribute("data-fig"), idx = +t.getAttribute("data-vert");
                    const f = this._fig(figId);
                    this.sel = { figId, kind: "vert", idx };
                    this.drag = { figId, idx, moved: false, e0: f.pts[idx].e, n0: f.pts[idx].n };
                    try { svg.setPointerCapture(e.pointerId); } catch (x) {}
                    this.render(); this._renderSelection();
                    return;
                }
                if (t && t.getAttribute && t.getAttribute("data-seg") != null) {
                    this.sel = { figId: t.getAttribute("data-fig"), kind: "seg", idx: +t.getAttribute("data-seg") };
                    this.render(); this._renderSelection();
                    return;
                }
                this.sel = null;
                this.pan = { cx: e.clientX, cy: e.clientY, vx: this.view.x, vy: this.view.y };
                svg.style.cursor = "grabbing";
                try { svg.setPointerCapture(e.pointerId); } catch (x) {}
                this.render(); this._renderSelection();
            });

            svg.addEventListener("pointermove", e => {
                if (this.drag) {
                    const w = this._svgWorld(e); if (!w) return;
                    const f = this._fig(this.drag.figId);
                    if (!f || !f.pts[this.drag.idx]) return;
                    let { e: ee, n: nn } = w;
                    // snap to nearest other vertex within ~10px
                    const r = this.root.getBoundingClientRect();
                    const tol = (this.view.w / (r.width || 600)) * 9;
                    let best = null, bd = tol;
                    for (const f2 of this.model.figures) for (let k = 0; k < f2.pts.length; k++) {
                        if (f2.id === this.drag.figId && k === this.drag.idx) continue;
                        const dd = Math.hypot(f2.pts[k].e - ee, f2.pts[k].n - nn);
                        if (dd < bd) { bd = dd; best = f2.pts[k]; }
                    }
                    if (best) { ee = best.e; nn = best.n; }
                    f.pts[this.drag.idx].e = ee; f.pts[this.drag.idx].n = nn;
                    this.drag.moved = true;
                    this.render();
                    this._hud(`vertex → E ${ee.toFixed(2)}  N ${nn.toFixed(2)}${best ? "  (snapped)" : ""}`);
                    return;
                }
                if (this.pan) {
                    const r = this.root.getBoundingClientRect();
                    this.view.x = this.pan.vx - (e.clientX - this.pan.cx) * (this.view.w / r.width);
                    this.view.y = this.pan.vy - (e.clientY - this.pan.cy) * (this.view.h / r.height);
                    this._applyView();
                }
            });

            const end = e => {
                if (this.drag) {
                    const d = this.drag; this.drag = null;
                    try { svg.releasePointerCapture(e.pointerId); } catch (x) {}
                    if (d.moved) this._commit();
                    else this._renderSelection();
                }
                if (this.pan) { this.pan = null; svg.style.cursor = "grab"; }
            };
            svg.addEventListener("pointerup", end);
            svg.addEventListener("pointercancel", end);
        },

        // ── operations ─────────────────────────────────────────────
        applyVertex(figId, idx, e, n) { const f = this._fig(figId); if (!f || !f.pts[idx]) return; f.pts[idx].e = nz(e, f.pts[idx].e); f.pts[idx].n = nz(n, f.pts[idx].n); this._commit(); },
        deleteVertex(figId, idx) { const f = this._fig(figId); if (!f) return; f.pts.splice(idx, 1); this.sel = null; this._commit(); },
        swapNext(figId, idx) {
            const f = this._fig(figId); if (!f) return;
            const j = idx + 1; if (j >= f.pts.length) return;
            const t = f.pts[idx]; f.pts[idx] = f.pts[j]; f.pts[j] = t;
            this.sel = { figId, kind: "vert", idx: j };
            this._commit();
        },
        insertMid(figId, segIdx) {
            const f = this._fig(figId); if (!f) return;
            const a = f.pts[segIdx], b = f.pts[(segIdx + 1) % f.pts.length];
            f.pts.splice(segIdx + 1, 0, { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2, desc: a.desc });
            this.sel = { figId, kind: "vert", idx: segIdx + 1 };
            this._commit();
        },
        setSegment(figId, segIdx, azDeg, dist) {
            const f = this._fig(figId); if (!f) return;
            const a = f.pts[segIdx], jb = (segIdx + 1) % f.pts.length, b = f.pts[jb];
            const nb = window.COGO.advance(a, azDeg, dist);
            if (this._traverseMode() && !f.closed) {
                const de = nb.e - b.e, dn = nb.n - b.n;
                for (let k = jb; k < f.pts.length; k++) { f.pts[k].e += de; f.pts[k].n += dn; }
            } else { b.e = nb.e; b.n = nb.n; }
            this._commit();
        },
        flipSeg(figId, segIdx, axis) {
            const f = this._fig(figId); if (!f) return;
            const a = f.pts[segIdx], b = f.pts[(segIdx + 1) % f.pts.length];
            const az = window.COGO.azimuthDegBetween(a, b);
            const dist = window.COGO.distanceBetween(a, b);
            const naz = axis === "EW" ? (360 - az) % 360 : (180 - az + 360) % 360;
            this.setSegment(figId, segIdx, naz, dist);
        },
        reverseFig(figId) { const f = this._fig(figId); if (!f) return; f.pts.reverse(); this._commit(); },
        /** Try each single adjacent-vertex swap; keep the first that removes the self-intersection. */
        untangle(figId) {
            const f = this._fig(figId); if (!f || f.pts.length < 4) return false;
            if (!selfIntersection(f.pts, f.closed)) return true;
            for (let i = 0; i < f.pts.length - 1; i++) {
                const t = f.pts[i]; f.pts[i] = f.pts[i + 1]; f.pts[i + 1] = t;
                if (!selfIntersection(f.pts, f.closed)) { this.sel = null; this._commit(); return true; }
                const u = f.pts[i]; f.pts[i] = f.pts[i + 1]; f.pts[i + 1] = u; // revert
            }
            return false;
        },
        snapPob(figId) {
            const f = this._fig(figId); if (!f || f.pts.length < 2) return;
            const last = f.pts[f.pts.length - 1];
            last.e = f.pts[0].e; last.n = f.pts[0].n; f.closed = true;
            this._commit();
        },
        mergePts(figId, i, j) {
            const f = this._fig(figId); if (!f) return;
            const lo = Math.min(i, j), hi = Math.max(i, j);
            f.pts[lo].e = (f.pts[lo].e + f.pts[hi].e) / 2;
            f.pts[lo].n = (f.pts[lo].n + f.pts[hi].n) / 2;
            f.pts.splice(hi, 1); this.sel = null; this._commit();
        },
        setClosed(figId, v) { const f = this._fig(figId); if (!f) return; f.closed = !!v; this._commit(); },
        setLayer(figId, l) { const f = this._fig(figId); if (!f) return; f.layer = l; this._commit(); },
        renameFig(figId, name) { const f = this._fig(figId); if (!f) return; f.name = clean(name) || f.name; this._commit(); },
        deleteFig(figId) { this.model.figures = this.model.figures.filter(f => f.id !== figId); this.sel = null; this._commit(); },
        addFig() {
            const id = "F" + Date.now().toString(36);
            this.model.figures.push({ id, name: "NEW-" + (this.model.figures.length + 1), layer: defaultLayer("LINE"), closed: false, pts: [] });
            this._commit();
        },
        gotoSel(figId, kind, idx) {
            this.sel = { figId, kind: kind || "vert", idx: idx || 0 };
            const f = this._fig(figId);
            if (f && f.pts.length) {
                let cx, cy;
                if (kind === "seg") { const a = f.pts[idx], b = f.pts[(idx + 1) % f.pts.length]; cx = (a.e + b.e) / 2; cy = -(a.n + b.n) / 2; }
                else { cx = f.pts[idx].e; cy = -f.pts[idx].n; }
                this.view.x = cx - this.view.w / 2; this.view.y = cy - this.view.h / 2;
                this._applyView();
            }
            this.render(); this._renderSelection();
        },
        applyFix(fix) {
            if (!fix) return;
            if (fix.type === "delVertex") this.deleteVertex(fix.figId, fix.idx);
            else if (fix.type === "merge") this.mergePts(fix.figId, fix.i, fix.j);
            else if (fix.type === "snapPob") this.snapPob(fix.figId);
            else if (fix.type === "goto") this.gotoSel(fix.figId, fix.kind, fix.idx);
            else if (fix.type === "untangle") {
                if (!this.untangle(fix.figId) && this.ctx) this.ctx.showToast("Could not auto-untangle — select the crossing course and edit the bearing / point order.", true);
            }
        },

        // ── right-rail panels ──────────────────────────────────────
        _afterChange() { this._renderChecks(); this._renderFigures(); this._renderSelection(); this._hud(); this.render(); },

        _hud(msg) {
            const el = document.getElementById("lw-hud");
            if (!el) return;
            if (msg) { el.textContent = msg; return; }
            const nf = this.model.figures.length, np = this._allPts().length;
            el.textContent = nf ? `${nf} figure(s) · ${np} point(s) · scroll to zoom, drag background to pan, drag a red vertex to move it` : "Load field data to begin.";
        },

        _renderSelection() {
            const box = document.getElementById("lw-selection");
            if (!box) return;
            const s = this.sel;
            if (!s) { window.setSafeHTML(box, `Nothing selected. Click a vertex or a course.`); return; }
            const f = this._fig(s.figId);
            if (!f) { this.sel = null; window.setSafeHTML(box, `Nothing selected.`); return; }

            if (s.kind === "vert") {
                const p = f.pts[s.idx];
                if (!p) { this.sel = null; return; }
                window.setSafeHTML(box, `
                    <div style="font-size:0.78rem;">
                      <strong>${f.name}</strong> · vertex ${s.idx + 1} of ${f.pts.length}${p.ptNum != null ? ` · pt #${p.ptNum}` : ""}${p.desc ? ` · ${clean(p.desc)}` : ""}
                      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.4rem; margin-top:0.4rem;">
                        <label style="font-size:0.7rem;">Easting<input type="number" id="lw-v-e" value="${p.e.toFixed(3)}" step="0.01" style="width:100%;"></label>
                        <label style="font-size:0.7rem;">Northing<input type="number" id="lw-v-n" value="${p.n.toFixed(3)}" step="0.01" style="width:100%;"></label>
                      </div>
                      <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-top:0.5rem;">
                        <button class="btn btn-primary btn-sm" data-lw="v-apply">Apply</button>
                        <button class="btn btn-secondary btn-sm" data-lw="v-snap">Snap to nearest</button>
                        <button class="btn btn-secondary btn-sm" data-lw="v-swap" title="Fix a point-order bow-tie">Swap with next</button>
                        <button class="btn btn-secondary btn-sm" data-lw="v-del" style="color:var(--danger); border-color:var(--danger-light);">Delete vertex</button>
                      </div>
                    </div>`);
            } else {
                const a = f.pts[s.idx], b = f.pts[(s.idx + 1) % f.pts.length];
                const az = window.COGO.azimuthDegBetween(a, b);
                const dist = window.COGO.distanceBetween(a, b);
                window.setSafeHTML(box, `
                    <div style="font-size:0.78rem;">
                      <strong>${f.name}</strong> · course ${s.idx + 1}: vertex ${s.idx + 1} → ${((s.idx + 1) % f.pts.length) + 1}
                      <div style="margin-top:0.4rem;">
                        <label style="font-size:0.7rem; display:block;">Bearing<input type="text" id="lw-s-brg" value="${window.COGO.azimuthToBearing(az)}" style="width:100%; font-family:var(--font-mono);"></label>
                        <label style="font-size:0.7rem; display:block; margin-top:0.3rem;">Distance (ft)<input type="number" id="lw-s-dist" value="${dist.toFixed(3)}" step="0.01" style="width:100%;"></label>
                      </div>
                      <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.2rem;">${this._traverseMode() ? "Traverse edit: vertices after this course shift with it." : "Free edit: only the far vertex moves."}</div>
                      <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-top:0.5rem;">
                        <button class="btn btn-primary btn-sm" data-lw="s-apply">Apply</button>
                        <button class="btn btn-secondary btn-sm" data-lw="s-flipew">Flip E/W</button>
                        <button class="btn btn-secondary btn-sm" data-lw="s-flipns">Flip N/S</button>
                        <button class="btn btn-secondary btn-sm" data-lw="s-insert">Insert vertex</button>
                      </div>
                    </div>`);
            }
        },

        _renderFigures() {
            const box = document.getElementById("lw-figures");
            if (!box) return;
            const layers = (window.FDOT_DATA && window.FDOT_DATA.layers || []).map(l => l.name);
            const rows = this.model.figures.map(f => {
                const layerOpts = [f.layer].concat(layers.filter(n => n !== f.layer))
                    .map(n => `<option value="${n}">${n}</option>`).join("");
                let stat = `${f.pts.length} pt`;
                if (f.closed && f.pts.length >= 3) {
                    const gap = window.COGO.distanceBetween(f.pts[f.pts.length - 1], f.pts[0]);
                    const area = window.COGO.shoelaceArea(f.pts);
                    stat += ` · ${(area / window.COGO.SQFT_PER_ACRE).toFixed(2)} ac · gap ${gap.toFixed(2)}′`;
                }
                return `
                  <div style="border:1px solid ${this.sel && this.sel.figId === f.id ? "var(--accent)" : "var(--glass-border)"}; border-radius:var(--radius-sm); padding:0.45rem; margin-bottom:0.4rem;">
                    <div style="display:flex; gap:0.3rem; align-items:center;">
                      <input type="text" value="${clean(f.name)}" data-lw="fig-name" data-fig="${f.id}" style="flex:1; font-size:0.75rem; padding:0.2rem 0.35rem;">
                      <button class="btn btn-secondary btn-sm" data-lw="fig-sel" data-fig="${f.id}" style="padding:0.1rem 0.4rem;">Select</button>
                      <button class="btn btn-secondary btn-sm" data-lw="fig-del" data-fig="${f.id}" style="padding:0.1rem 0.4rem; color:var(--danger);">×</button>
                    </div>
                    <div style="display:flex; gap:0.3rem; align-items:center; margin-top:0.3rem;">
                      <select data-lw="fig-layer" data-fig="${f.id}" style="flex:1; font-size:0.7rem; padding:0.15rem;">${layerOpts}</select>
                      <label style="font-size:0.68rem; display:flex; align-items:center; gap:0.2rem;"><input type="checkbox" data-lw="fig-closed" data-fig="${f.id}" ${f.closed ? "checked" : ""} style="width:auto;">closed</label>
                      <button class="btn btn-secondary btn-sm" data-lw="fig-rev" data-fig="${f.id}" style="padding:0.1rem 0.4rem;" title="Reverse point order">⇄</button>
                    </div>
                    <div style="font-size:0.66rem; color:var(--text-muted); margin-top:0.2rem;">${stat}</div>
                  </div>`;
            }).join("");
            window.setSafeHTML(box, (rows || `<div style="color:var(--text-muted); font-size:0.76rem;">No figures.</div>`) +
                `<button class="btn btn-secondary btn-sm" data-lw="fig-add" style="margin-top:0.2rem;"><i class="fa-solid fa-plus"></i> Add figure</button>`);
        },

        _renderChecks() {
            const box = document.getElementById("lw-checks");
            const cnt = document.getElementById("lw-check-count");
            if (!box) return;
            if (!this.model.figures.length) {
                window.setSafeHTML(box, `<div style="color:var(--text-muted);">Import field data to run the checks.</div>`);
                box.__findings = [];
                if (cnt) { cnt.textContent = "—"; cnt.style.color = "var(--text-secondary)"; }
                return;
            }
            const findings = checkModel(this.model, this._opts());
            // mark bow-tie figures for red rendering
            const btFigs = new Set(findings.filter(x => x.sev === "ERROR" && /bow-tie/i.test(x.msg)).map(x => x.figId));
            this.model.figures.forEach(f => { f.__bt = btFigs.has(f.id); });

            const nErr = findings.filter(f => f.sev === "ERROR").length;
            const nWarn = findings.filter(f => f.sev === "WARNING").length;
            if (cnt) {
                cnt.textContent = findings.length ? `${nErr} err · ${nWarn} warn` : "clean";
                cnt.style.color = nErr ? "var(--danger)" : (nWarn ? "var(--warning)" : "var(--success)");
            }
            if (!findings.length) { window.setSafeHTML(box, `<div style="color:var(--success);"><i class="fa-solid fa-circle-check"></i> No field-data issues.</div>`); box.__findings = []; return; }
            const color = s => s === "ERROR" ? "var(--danger)" : (s === "WARNING" ? "var(--warning)" : "var(--text-muted)");
            window.setSafeHTML(box, findings.map((f, i) => `
                <div style="border-left:2px solid ${color(f.sev)}; padding:0.3rem 0.5rem;">
                  <div><span class="badge" style="background:${color(f.sev)}; font-size:0.6rem;">${f.sev}</span> ${clean(f.msg)}</div>
                  <div style="display:flex; gap:0.3rem; margin-top:0.25rem;">
                    ${f.figId ? `<button class="btn btn-secondary btn-sm" data-lw="chk-goto" data-i="${i}" style="padding:0.05rem 0.4rem; font-size:0.68rem;">Go to</button>` : ""}
                    ${f.fix && f.fix.type !== "goto" ? `<button class="btn btn-primary btn-sm" data-lw="chk-fix" data-i="${i}" style="padding:0.05rem 0.4rem; font-size:0.68rem;">Fix</button>` : ""}
                  </div>
                </div>`).join(""));
            box.__findings = findings;
        }
    };

    // ── Exports ──────────────────────────────────────────────────────────────

    function exportDXF() {
        const figs = Ed.model.figures.filter(f => f.pts.length >= 2);
        if (!figs.length) return null;
        const layers = [...new Set(figs.map(f => f.layer || "0"))].map(n => ({ name: n, color: 4 }));
        const polylines = figs.map(f => ({ layer: f.layer || "0", closed: !!f.closed, points: f.pts.map(p => ({ e: p.e, n: p.n })) }));
        return window.COGO.buildDxf({ layers, polylines, texts: [] });
    }
    function exportPNEZD() {
        const rows = ["P,N,E,Z,D"];
        let auto = 500;
        Ed.model.figures.forEach(f => f.pts.forEach(p => {
            const pn = (typeof p.ptNum === "number" && Number.isFinite(p.ptNum)) ? p.ptNum : auto++;
            rows.push(`${pn},${p.n.toFixed(3)},${p.e.toFixed(3)},${(p.z || 0).toFixed(3)},${clean(f.name)}`);
        }));
        return rows.join("\r\n") + "\r\n";
    }
    function exportCalls() {
        const L = [];
        Ed.model.figures.forEach(f => {
            if (f.pts.length < 2) return;
            L.push(`; Figure: ${f.name}  [layer ${f.layer}]${f.closed ? "  (closed)" : ""}`);
            const n = f.closed ? f.pts.length : f.pts.length - 1;
            for (let i = 0; i < n; i++) {
                const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
                L.push(`  L${i + 1}  ${window.COGO.azimuthToBearing(window.COGO.azimuthDegBetween(a, b))}  ${window.COGO.distanceBetween(a, b).toFixed(2)}`);
            }
            L.push("");
        });
        return L.join("\r\n");
    }
    function exportReport() {
        const thr = window.BoundaryQCCMS && window.BoundaryQCCMS.getActiveTemplateSetting
            ? Number(window.BoundaryQCCMS.getActiveTemplateSetting("precisionPass", 10000)) || 10000 : 10000;
        const L = ["=== Linework Map Check ===", `Generated: ${new Date().toISOString()}`, `Closure pass threshold: 1:${thr.toLocaleString()}`, ""];
        Ed.model.figures.forEach(f => {
            L.push(`Figure: ${f.name}  [layer ${f.layer}]  ${f.pts.length} pts${f.closed ? "  (closed)" : ""}`);
            if (f.pts.length >= 2) {
                let per = 0;
                const n = f.closed ? f.pts.length : f.pts.length - 1;
                for (let i = 0; i < n; i++) per += window.COGO.distanceBetween(f.pts[i], f.pts[(i + 1) % f.pts.length]);
                L.push(`  Perimeter: ${per.toFixed(2)} ft`);
                if (f.closed && f.pts.length >= 3) {
                    const gap = window.COGO.distanceBetween(f.pts[f.pts.length - 1], f.pts[0]);
                    const area = window.COGO.shoelaceArea(f.pts);
                    const prec = gap > 1e-4 ? per / gap : Infinity;
                    L.push(`  Misclosure: ${gap.toFixed(3)} ft   Precision: ${prec === Infinity ? "exact" : "1:" + Math.round(prec).toLocaleString()}   ${prec >= thr || prec === Infinity ? "[PASS]" : "[REVIEW]"}`);
                    L.push(`  Area: ${area.toFixed(2)} sf = ${(area / window.COGO.SQFT_PER_ACRE).toFixed(3)} ac`);
                }
                const bt = selfIntersection(f.pts, f.closed);
                L.push(`  Self-intersection: ${bt ? `YES (course ${bt.i} × ${bt.j})` : "none"}`);
            }
            L.push("");
        });
        L.push("[Checks]");
        checkModel(Ed.model, Ed._opts()).forEach(c => L.push(`  [${c.sev}] ${c.msg}`));
        L.push("", "[Coordinates — P,N,E,Z,D]", exportPNEZD());
        return L.join("\r\n");
    }

    // ── Plugin ───────────────────────────────────────────────────────────────

    function loadPoints(text, ctx) {
        const order = document.getElementById("lw-order") ? document.getElementById("lw-order").value : "NE";
        const mode = document.getElementById("lw-group") ? document.getElementById("lw-group").value : "byCode";
        const { points, bad } = parsePointFile(text, order);
        if (!points.length) { ctx.showToast("No point rows recognized. Check the coordinate order.", true); return; }
        const figs = buildFigures(points, mode);
        Ed.setModel({ figures: figs });
        ctx.showToast(`Imported ${points.length} points → ${figs.length} figure(s)${bad.length ? `, ${bad.length} row(s) skipped` : ""}.`, bad.length > 0);
    }
    function loadCalls(text, ctx) {
        const fig = parseCalls(text, { e: 0, n: 0 });
        if (!fig) { ctx.showToast("No bearing/distance calls recognized.", true); return; }
        Ed.setModel({ figures: [fig] });
        ctx.showToast(`Imported ${fig.pts.length - 1} course(s) as a traverse.`);
    }

    const Plugin = {
        init(ctx) { Ed.mount("lw-editor", ctx); },
        onTabActivate() { Ed.fit(); Ed._afterChange(); },

        setupEvents(ctx) {
            const paste = () => (document.getElementById("lw-paste") || {}).value || "";

            document.getElementById("btn-lw-sample")?.addEventListener("click", () => {
                const ta = document.getElementById("lw-paste"); if (ta) ta.value = SAMPLE;
                loadPoints(SAMPLE, ctx);
            });
            document.getElementById("lw-file")?.addEventListener("change", e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const r = new FileReader();
                r.onload = ev => loadPoints(String(ev.target.result || ""), ctx);
                r.readAsText(file);
            });
            document.getElementById("btn-lw-parse-points")?.addEventListener("click", () => loadPoints(paste(), ctx));
            document.getElementById("btn-lw-parse-calls")?.addEventListener("click", () => loadCalls(paste(), ctx));
            ["lw-order", "lw-group"].forEach(id => document.getElementById(id)?.addEventListener("change", () => {
                const t = paste(); if (t.trim()) loadPoints(t, ctx);
            }));
            ["lw-closetol", "lw-snaptol"].forEach(id => document.getElementById(id)?.addEventListener("change", () => Ed._afterChange()));

            document.getElementById("btn-lw-fit")?.addEventListener("click", () => Ed.fit());
            document.getElementById("btn-lw-undo")?.addEventListener("click", () => Ed.undo());
            document.getElementById("btn-lw-redo")?.addEventListener("click", () => Ed.redo());
            document.getElementById("lw-traverse-mode")?.addEventListener("change", () => Ed._renderSelection());

            const dl = (name, txt, mime) => { if (!txt) { ctx.showToast("Nothing to export.", true); return; } window.COGO.downloadText(name, txt, mime); ctx.showToast("Exported " + name); };
            document.getElementById("btn-lw-exp-dxf")?.addEventListener("click", () => dl("linework.dxf", exportDXF(), "application/dxf"));
            document.getElementById("btn-lw-exp-pnezd")?.addEventListener("click", () => dl("linework_coordinates.txt", exportPNEZD(), "text/csv"));
            document.getElementById("btn-lw-exp-calls")?.addEventListener("click", () => dl("linework_calls.txt", exportCalls()));
            document.getElementById("btn-lw-exp-report")?.addEventListener("click", () => dl("linework_mapcheck.log", exportReport()));

            // Selection panel (event delegation)
            document.getElementById("lw-selection")?.addEventListener("click", e => {
                const b = e.target.closest("[data-lw]"); if (!b || !Ed.sel) return;
                const act = b.getAttribute("data-lw");
                const s = Ed.sel;
                if (act === "v-apply") Ed.applyVertex(s.figId, s.idx, document.getElementById("lw-v-e").value, document.getElementById("lw-v-n").value);
                else if (act === "v-del") Ed.deleteVertex(s.figId, s.idx);
                else if (act === "v-swap") Ed.swapNext(s.figId, s.idx);
                else if (act === "v-snap") {
                    const f = Ed._fig(s.figId), p = f.pts[s.idx];
                    let best = null, bd = nz(document.getElementById("lw-snaptol").value, 0.1) * 20;
                    for (const f2 of Ed.model.figures) for (let k = 0; k < f2.pts.length; k++) {
                        if (f2.id === s.figId && k === s.idx) continue;
                        const dd = window.COGO.distanceBetween(f2.pts[k], p);
                        if (dd < bd) { bd = dd; best = f2.pts[k]; }
                    }
                    if (best) Ed.applyVertex(s.figId, s.idx, best.e, best.n); else ctx.showToast("No vertex within tolerance.", true);
                }
                else if (act === "s-apply") {
                    const brg = window.COGO.parseBearing(document.getElementById("lw-s-brg").value);
                    if (!brg) { ctx.showToast("Could not parse that bearing.", true); return; }
                    Ed.setSegment(s.figId, s.idx, brg.azimuthDeg, nz(document.getElementById("lw-s-dist").value, 0));
                }
                else if (act === "s-flipew") Ed.flipSeg(s.figId, s.idx, "EW");
                else if (act === "s-flipns") Ed.flipSeg(s.figId, s.idx, "NS");
                else if (act === "s-insert") Ed.insertMid(s.figId, s.idx);
            });

            // Figures panel
            const figBox = document.getElementById("lw-figures");
            figBox?.addEventListener("click", e => {
                const b = e.target.closest("[data-lw]"); if (!b) return;
                const act = b.getAttribute("data-lw"), figId = b.getAttribute("data-fig");
                if (act === "fig-add") Ed.addFig();
                else if (act === "fig-del") Ed.deleteFig(figId);
                else if (act === "fig-sel") Ed.gotoSel(figId, "vert", 0);
                else if (act === "fig-rev") Ed.reverseFig(figId);
            });
            figBox?.addEventListener("change", e => {
                const b = e.target.closest("[data-lw]"); if (!b) return;
                const act = b.getAttribute("data-lw"), figId = b.getAttribute("data-fig");
                if (act === "fig-layer") Ed.setLayer(figId, b.value);
                else if (act === "fig-closed") Ed.setClosed(figId, b.checked);
            });
            figBox?.addEventListener("blur", e => {
                const b = e.target.closest("[data-lw='fig-name']"); if (b) Ed.renameFig(b.getAttribute("data-fig"), b.value);
            }, true);

            // Checks panel
            document.getElementById("lw-checks")?.addEventListener("click", e => {
                const b = e.target.closest("[data-lw]"); if (!b) return;
                const box = document.getElementById("lw-checks");
                const f = box.__findings && box.__findings[+b.getAttribute("data-i")];
                if (!f) return;
                if (b.getAttribute("data-lw") === "chk-goto") Ed.gotoSel(f.figId, f.fix && f.fix.kind || "vert", f.idx || 0);
                else Ed.applyFix(f.fix);
            });

            // Keyboard: undo/redo, delete selected vertex
            window.addEventListener("keydown", e => {
                if (Ed.model.figures.length === 0) return;
                const tag = (e.target.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" || tag === "select") return;
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); Ed.undo(); }
                else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); Ed.redo(); }
                else if ((e.key === "Delete" || e.key === "Backspace") && Ed.sel && Ed.sel.kind === "vert" &&
                         document.getElementById("tab-linework")?.classList.contains("active")) {
                    e.preventDefault(); Ed.deleteVertex(Ed.sel.figId, Ed.sel.idx);
                }
            });
        }
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
    window.Linework = { parsePointFile, buildFigures, parseCalls, checkModel, _Ed: Ed };
})();
