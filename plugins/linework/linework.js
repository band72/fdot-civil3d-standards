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

    // Realistic Florida State Plane East (US ft) coordinates. Field-coded per the
    // Civil 3D linework code set (B begin, C continue, E end, CLS close). On purpose:
    //  - BND:  a normal closed boundary
    //  - BLDG: a closed building, POB re-shot as the last point (redundant)
    //  - EP:   an open line, interrupted by a TREE shot then continued (C); a
    //          duplicated shot (#12 == #11) makes a zero-length course
    //  - BOW:  a closed figure with the point order wrong — a bow-tie
    const SAMPLE = [
        "1,2015000.00,642000.00,12.5,BND B",
        "2,2015300.00,642000.00,12.6,BND",
        "3,2015300.00,642210.00,12.4,BND",
        "4,2015000.00,642210.00,12.5,BND CLS",
        "5,2015050.00,642050.00,11.9,BLDG B",
        "6,2015050.00,642120.00,11.9,BLDG",
        "7,2015095.00,642120.00,11.9,BLDG",
        "8,2015095.00,642050.00,11.9,BLDG",
        "9,2015050.00,642050.00,11.9,BLDG CLS",
        "10,2015400.00,642000.00,12.5,EP B",
        "11,2015600.00,642000.00,12.5,EP",
        "12,2015600.00,642000.00,12.5,EP",
        "13,2015700.00,642050.00,11.8,TREE",
        "14,2015610.00,642400.00,12.4,EP C",
        "15,2015620.00,642700.00,12.4,EP E",
        "16,2016000.00,643000.00,10.0,BOW B",
        "17,2016100.00,643100.00,10.0,BOW",
        "18,2016000.00,643100.00,10.0,BOW",
        "19,2016100.00,643000.00,10.0,BOW CLS",
        "20,2015680.00,642000.00,10.0,ARC B",
        "21,2015729.50,642040.50,10.0,ARC BC",
        "22,2015750.00,642090.00,10.0,ARC",
        "23,2015729.50,642139.50,10.0,ARC EC",
        "24,2015680.00,642180.00,10.0,ARC E",
        "25,2016315.00,642000.00,9.0,MH CIR",
        "26,2016300.00,642015.00,9.0,MH",
        "27,2016285.00,642000.00,9.0,MH"
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

    // Linework Code Set — matches the Civil 3D "Edit Linework Code Set" defaults.
    // Editable at runtime via window.Linework.CODESET before importing. Token
    // ORDER within a description is not significant — "EP B" and "B EP" both
    // parse the same way: whichever token isn't a recognized keyword is the
    // feature code. (Some offices' point-file exports put the control word
    // first; Civil 3D's own default puts the code first.)
    const CODESET = {
        delimiter: " ",          // Feature/Code delimiter (<Space>)
        escape: "/",             // Field code escape — ALSO marks multi-figure
                                  // membership: a token "<code><escape><ctrl>"
                                  // (e.g. "SD1/B" with escape "/", or "SD1XB"
                                  // with escape "X") cross-references a SECOND
                                  // figure from this same shot — see splitDesc.
        begin:    ["B", "BEG", "BEGIN", "START"],
        continue: ["C", "CONT"],                 // resume an interrupted figure of this code
        end:      ["E", "END"],                  // end the figure — NO closing segment
        close:    ["CLS", "CLO", "CLOSE", "CL", "Z"], // end AND draw the closing segment
        // Curve segment codes — resolved into real circular geometry (see resolveGeometry):
        curveBegin: ["BC", "PC", "MCS"],   // begin curve / point of curvature / mid-curve start
        curveEnd:   ["EC", "PT", "MCE"],   // end curve / point of tangency / mid-curve end
        curvePoint: ["OC", "POC"],      // on-curve shot (informational)
        circleWhole: ["CIR"],           // the whole figure is a circle
        // Line segment codes — RECT is built; the rest are recognized only:
        lineSeg:  ["RECT", "RT", "X", "RPN", "CPN"],
        curveSeg: ["BC", "EC", "PC", "PT", "CIR", "OC", "POC", "MCS", "MCE"],
        offset:   ["SO"],        // plus H<n> / V<n>, matched by regex
        // Codes that never form a figure even when 2+ shots share the code with
        // no B/C/E at all — the default "same bare code → auto-chain" behavior
        // (below) is what Civil 3D itself does for a code configured as linear,
        // but a point-only code (e.g. scattered grade shots, monuments) would
        // otherwise get wrongly strung into one figure across the whole site.
        // Empty by default — zero effect until a project opts a code in.
        pointOnly: []
    };

    // ── Named CODESET profiles — reusable starting points for a field crew's
    // own point-file convention, refined over time as real projects surface
    // more of it (each is a starting point, not a guarantee — a new project
    // on a known profile may still need its own pointOnly additions; see
    // applyCodesetProfile). Apply with window.Linework.applyCodesetProfile
    // ("name") before importing; "default" restores the Civil 3D stock set.
    const CODESET_PROFILES = {
        "default": { escape: "/", pointOnly: [] },
        // Control-word-first descriptions ("B TCL", not Civil 3D's stock
        // "TCL B"), "X" as the multi-figure-membership escape character,
        // MCS/MCE curve markers. Confirmed against a real project (a point
        // file cross-checked point-for-point against its compiled Civil 3D
        // field-book script). pointOnly lists standard point-feature codes —
        // never linework in any normal survey convention — that this
        // convention's exports leave with no B/C/E at all.
        "control-first-x-escape": {
            escape: "X",
            pointOnly: ["G", "TV", "IPF", "TBM", "LP", "LPP", "WV", "FH", "CO", "JB", "LINE"],
        },
        // Official FDOT Civil 3D State Kit Survey Database convention:
        // Delimiter: Space, Escape: "/", standard point codes (MONU*, BENCH*, TREE*, FH*, etc.)
        // that never chain into figures unless explicitly coded with B/C.
        "fdot-state-kit": {
            escape: "/",
            pointOnly: [
                "MONU", "BENCH", "BM", "PRM", "PCP", "PK", "IP", "IR", "CONC", "CM",
                "TREE", "PALM", "OAK", "PINE", "STUMP", "SOIL", "SPT", "TEST",
                "FH", "WM", "WV", "GM", "GV", "EM", "PED", "JB", "POLE", "LP", "PPC",
                "GUY", "TEL", "CATV", "SIGN", "MAIL", "WELL"
            ]
        },
    };

    /** Apply a window.Linework.CODESET_PROFILES preset onto the live CODESET
     *  (the object splitDesc/buildFigures actually read) — in place, so it
     *  takes effect immediately for the next import. A profile only needs to
     *  list what differs from the stock defaults; every other CODESET field
     *  (begin/continue/curveBegin/…) is left as it currently is. Add a new
     *  named entry to CODESET_PROFILES as new conventions get confirmed —
     *  that's the "train over time" part; nothing here is hardcoded to one
     *  project. */
    function applyCodesetProfile(name) {
        const profile = CODESET_PROFILES[name];
        if (!profile) throw new Error(`Unknown CODESET profile "${name}". Known: ${Object.keys(CODESET_PROFILES).join(", ")}`);
        Object.keys(profile).forEach(k => { CODESET[k] = profile[k]; });
        return CODESET;
    }
    const inSet = (arr, t) => arr.indexOf(t) !== -1;

    // How close a BC..EC (or MCS..MCE) span's shots must lie to a fitted circle
    // before it's drawn as a real arc. A single absolute distance doesn't work
    // across a realistic range of radii — a tight curb return and a gentle
    // roadway curve don't fail at the same absolute deviation — so it's
    // relative-or-absolute: accept if dev<=absFt OR dev/radius<=relFrac.
    // Editable at runtime via window.Linework.ARC_FIT before importing, same
    // as CODESET.
    const ARC_FIT = { absFt: 0.15, relFrac: 0.06 };

    /** Classify one already-uppercased token against the control/curve/offset
     *  keyword sets. Returns {kind, value} or null if it's not a keyword at all
     *  (kind: "begin"|"continue"|"end"|"close"|"fig"|"seg"). Shared by the
     *  primary-token pass and the compound cross-reference pass in splitDesc. */
    function classifyToken(t) {
        if (inSet(CODESET.begin, t)) return { kind: "begin" };
        if (inSet(CODESET.continue, t)) return { kind: "continue" };
        if (inSet(CODESET.end, t)) return { kind: "end" };
        if (inSet(CODESET.close, t)) return { kind: "close" };
        if (/^\d{1,3}$/.test(t)) return { kind: "fig", value: t };
        if (inSet(CODESET.lineSeg, t) || inSet(CODESET.curveSeg, t) ||
            inSet(CODESET.offset, t) || /^[HV]-?\d/.test(t)) return { kind: "seg", value: t };
        return null;
    }

    /**
     * Parse a survey description into
     *   { code, fig, control, closeFlag, segCodes, crossRefs }.
     * control ∈ "" | "begin" | "continue" | "end" | "close".
     * crossRefs: [{ code, control, closeFlag, segCodes }] — other figures this
     * SAME shot also belongs to, via an escape-joined compound token (e.g.
     * "SD1XB" with escape "X" → this shot also begins figure SD1). A
     * cross-reference to the SAME code as the primary is folded into the
     * primary's own control/segCodes instead of creating a duplicate vertex.
     */
    function splitDesc(desc) {
        const toks = String(desc || "").trim().split(/\s+/).filter(Boolean);
        if (!toks.length) return { code: "LINE", fig: "1", control: "", closeFlag: false, segCodes: [], crossRefs: [] };

        let control = "", fig = "", primaryTok = null;
        const segCodes = [];
        const compoundToks = [];
        for (const raw of toks) {
            // Only a genuine "<code><escape><word>" split (content on both sides)
            // counts as compound — a bare escape char alone (e.g. a lone "X"
            // token when escape is also configured as "X") falls through to
            // ordinary keyword/primary classification instead of being dropped.
            if (raw.includes(CODESET.escape) && raw.split(CODESET.escape).filter(Boolean).length >= 2) {
                compoundToks.push(raw); continue;
            }
            const t = raw.toUpperCase();
            const c = classifyToken(t);
            if (!c) { if (primaryTok == null) primaryTok = raw; continue; }
            if (c.kind === "begin") control = control || "begin";
            else if (c.kind === "continue") control = "continue";
            else if (c.kind === "end") control = control || "end";
            else if (c.kind === "close") control = "close";
            else if (c.kind === "fig") fig = c.value;
            else if (c.kind === "seg") segCodes.push(c.value);
        }
        const primary = (primaryTok || toks[0]).split(CODESET.escape)[0].toUpperCase() || "LINE";

        // Compound tokens: "<code><escape><word>[<escape><word>...]" — the
        // leading segment names the (possibly different) figure; each
        // trailing segment is a control/curve word for THAT figure.
        const crossRefs = [];
        for (const raw of compoundToks) {
            const segs = raw.split(CODESET.escape).filter(Boolean);
            if (segs.length < 2) continue;
            const refCode = segs[0].toUpperCase();
            let refControl = "", refSeg = [];
            for (const s of segs.slice(1)) {
                const c = classifyToken(s.toUpperCase());
                if (!c) continue;                       // unrecognized (e.g. "C3") — ignored, not fatal
                if (c.kind === "begin") refControl = refControl || "begin";
                else if (c.kind === "continue") refControl = "continue";
                else if (c.kind === "end") refControl = refControl || "end";
                else if (c.kind === "close") refControl = "close";
                else if (c.kind === "seg") refSeg.push(c.value);
            }
            if (refCode === primary) {
                // Same figure as the primary token — merge, don't duplicate the vertex.
                if (refControl && !control) control = refControl;
                else if (refControl === "close") control = "close";
                refSeg.forEach(s => { if (segCodes.indexOf(s) === -1) segCodes.push(s); });
            } else if (refControl || refSeg.length) {
                crossRefs.push({ code: refCode, control: refControl, closeFlag: refControl === "close", segCodes: refSeg });
            }
        }

        return { code: primary, fig: fig || "1", control, closeFlag: control === "close", segCodes, crossRefs };
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

    /**
     * Group points into figures, honoring the linework code set:
     *  - B / begin   → start a new figure of that code (a second B on the same code
     *                  starts a separate figure — "Automatic begin on figure prefix match")
     *  - C / continue → resume the current (or most recent) figure of that code
     *  - E / end      → finish the figure, no closing segment
     *  - CLS / close  → finish the figure AND draw the segment back to the start
     * Points within a figure connect in point-number order.
     * mode = "byCode" | "byFigure" | "single".
     */
    // ── Circle geometry (for BC/EC arcs and CIR circles) ─────────────────────

    // Circle fits are done on data shifted to its own centroid — State Plane
    // coordinates (~2,000,000) otherwise swamp the radius (~100) in double precision.

    /** Exact circle through 3 points, or null if (near-)collinear. */
    function circumcircle(a, b, c) {
        const mx = (a.e + b.e + c.e) / 3, my = (a.n + b.n + c.n) / 3;
        const ax = a.e - mx, ay = a.n - my, bx = b.e - mx, by = b.n - my, cx = c.e - mx, cy = c.n - my;
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(d) < 1e-6) return null;
        const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
        const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
        return { cx: ux + mx, cy: uy + my, r: Math.hypot(ax - ux, ay - uy) };
    }

    /** Kåsa algebraic least-squares circle fit through N>=3 points. */
    function fitCircle(pts) {
        if (pts.length === 3) return circumcircle(pts[0], pts[1], pts[2]);
        const n = pts.length;
        const mx = pts.reduce((s, p) => s + p.e, 0) / n;
        const my = pts.reduce((s, p) => s + p.n, 0) / n;
        let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
        for (const p of pts) {
            const x = p.e - mx, y = p.n - my, z = x * x + y * y;
            sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
        }
        // Centered => Σx = Σy = 0, so C = sz/n and [sxx sxy; sxy syy][A B] = [sxz syz].
        const det = sxx * syy - sxy * sxy;
        if (Math.abs(det) < 1e-9) return null;
        const A = (sxz * syy - syz * sxy) / det;
        const B = (syz * sxx - sxz * sxy) / det;
        const r2 = (A * A + B * B) / 4 + sz / n;
        return r2 > 0 ? { cx: mx + A / 2, cy: my + B / 2, r: Math.sqrt(r2) } : null;
    }

    /** Resolve BC..EC arc spans, CIR circles and RECT rectangles from per-point codes.
     *  Idempotent — safe to re-run after an edit (RECT only fires while pts.length === 3). */
    function resolveGeometry(figs) {
        figs.forEach(f => {
            delete f.arcs; delete f.circle; delete f.isCircle; delete f.geomWarn; delete f.geomNote;
            if (!f.pts) return;
            const codesAt = i => (f.pts[i] && f.pts[i].codes) || [];
            const anyAt = (i, set) => codesAt(i).some(c => set.indexOf(c) !== -1);

            // Whole-figure circle
            if (f.pts.some((_, i) => anyAt(i, CODESET.circleWhole))) {
                const ps = f.pts;
                let cir = null;
                if (ps.length === 2) cir = { cx: ps[0].e, cy: ps[0].n, r: window.COGO.distanceBetween(ps[0], ps[1]) };
                else if (ps.length >= 3) cir = fitCircle(ps.slice(0, 3));
                if (cir && cir.r > 0) { f.circle = cir; f.isCircle = true; f.closed = true; }
                else f.geomWarn = "CIR code but points are collinear — cannot fit a circle.";
                return;
            }

            // RECT: 3 points → parallelogram (4th corner computed)
            if (f.pts.length === 3 && f.pts.some((_, i) => anyAt(i, ["RECT"]))) {
                const [a, b, c] = f.pts;
                f.pts.push({ e: a.e + (c.e - b.e), n: a.n + (c.n - b.n), z: a.z, desc: a.desc, codes: [] });
                f.closed = true;
                f.geomNote = "rectangle from RECT code (3 shots + computed 4th corner)";
            }

            // BC..EC arc spans
            const arcs = [];
            let bc = -1;
            for (let i = 0; i < f.pts.length; i++) {
                if (anyAt(i, CODESET.curveBegin)) bc = i;
                else if (anyAt(i, CODESET.curveEnd) && bc >= 0) {
                    const span = f.pts.slice(bc, i + 1);
                    const cir = span.length >= 3 ? fitCircle(span) : null;
                    const label = `curve span #${f.pts[bc].ptNum != null ? f.pts[bc].ptNum : bc}→#${f.pts[i].ptNum != null ? f.pts[i].ptNum : i}`;
                    if (cir && cir.r > 0 && cir.r < 1e7) {
                        const s = span[0], mid = span[Math.floor(span.length / 2)], e = span[span.length - 1];
                        const cross = (mid.e - s.e) * (e.n - mid.n) - (mid.n - s.n) * (e.e - mid.e);
                        // max deviation of a span point from the fitted circle
                        let dev = 0;
                        for (const p of span) dev = Math.max(dev, Math.abs(Math.hypot(p.e - cir.cx, p.n - cir.cy) - cir.r));
                        const rel = dev / cir.r;
                        if (dev <= ARC_FIT.absFt || rel <= ARC_FIT.relFrac) {
                            arcs.push({ startIdx: bc, endIdx: i, cx: cir.cx, cy: cir.cy, r: cir.r, ccw: cross > 0, dev, rel });
                        } else {
                            // The shots don't actually lie on a circle (e.g. a natural
                            // top-of-bank/toe-of-slope line, not an engineered curb
                            // return) — drawing one anyway would be visibly wrong, so
                            // the span is left to render as straight shot-to-shot
                            // chords instead (see figurePolyPoints), same as a BC with
                            // no matching EC.
                            f.geomWarn = (f.geomWarn || "") + ` ${label}: fit deviation ${dev.toFixed(2)}ft ` +
                                `(${(rel * 100).toFixed(0)}% of r=${cir.r.toFixed(1)}ft) exceeds tolerance — not a ` +
                                `constant-radius curve, drawn as straight chords.`;
                        }
                    } else {
                        f.geomWarn = (f.geomWarn || "") + ` ${label}: ` +
                            (span.length < 3 ? "need at least 3 shots (BC, on-curve, EC)." : "points are collinear — cannot fit an arc.");
                    }
                    bc = -1;
                }
            }
            if (bc >= 0) f.geomWarn = (f.geomWarn || "") + ` BC at #${f.pts[bc].ptNum != null ? f.pts[bc].ptNum : bc} has no matching EC.`;
            if (arcs.length) f.arcs = arcs;
        });
        return figs;
    }

    function buildFigures(points, mode) {
        const pt = p => ({ e: p.e, n: p.n, z: p.z, ptNum: p.ptNum, desc: p.desc });

        if (mode === "single") {
            const pts = points.slice().sort(byNum).map(pt);
            return pts.length >= 2 ? [{ id: "F1", name: "LINE-1", layer: defaultLayer("LINE"), closed: false, pts, segCodes: [] }] : [];
        }

        const ordered = points.slice().sort(byNum);
        const out = [];
        const current = {};   // key → figure currently open for that key
        let n = 0;

        /** Open/resume `key` (auto-begin if nothing's open for it yet, matching
         *  Civil 3D), push one copy of the shot onto it, honor end/close. Used
         *  for both a point's primary figure and any cross-referenced ones
         *  (see splitDesc's crossRefs — one shot can be a shared vertex of two
         *  different figures, e.g. a curb line ending and a swale beginning). */
        function apply(key, code, control, closeFlag, segCds, p) {
            if (control === "begin" || !current[key]) {
                current[key] = { id: "F" + (++n), name: key, code, layer: defaultLayer(code), closed: false, pts: [], segCodes: [] };
                out.push(current[key]);
            } else if (control === "continue" && !current[key]) {
                const prev = [...out].reverse().find(f => f.name === key);
                current[key] = prev || (current[key] = { id: "F" + (++n), name: key, code, layer: defaultLayer(code), closed: false, pts: [], segCodes: [] });
                if (!prev) out.push(current[key]);
            }
            const fig = current[key];
            const P = pt(p); P.codes = segCds.slice();
            fig.pts.push(P);
            segCds.forEach(c => { if (fig.segCodes.indexOf(c) === -1) fig.segCodes.push(c); });

            if (closeFlag) { fig.closed = true; current[key] = null; }
            else if (control === "end") { current[key] = null; }
        }

        const pointOnly = CODESET.pointOnly || [];
        ordered.forEach(p => {
            const d = splitDesc(p.desc);
            if (pointOnly.indexOf(d.code) === -1) {
                const key = mode === "byFigure" ? `${d.code} #${d.fig}` : d.code;
                apply(key, d.code, d.control, d.closeFlag, d.segCodes, p);
            }

            (d.crossRefs || []).forEach(cr => {
                if (pointOnly.indexOf(cr.code) !== -1) return;
                const crKey = mode === "byFigure" ? `${cr.code} #1` : cr.code;
                apply(crKey, cr.code, cr.control, cr.closeFlag, cr.segCodes, p);
            });
        });

        return resolveGeometry(out.filter(f => f.pts.length >= 2));
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
            if (f.isCircle && f.circle) {
                add("INFO", `${f.name}: circle from CIR code — center (${f.circle.cx.toFixed(2)}, ${f.circle.cy.toFixed(2)}), R ${f.circle.r.toFixed(2)} ft.`, f.id, null, null);
                return;
            }
            if (pts.length < 2) { add("WARNING", `${f.name}: only ${pts.length} point — nothing to draw.`, f.id, null, null); return; }

            if (f.arcs && f.arcs.length) {
                f.arcs.forEach(a => {
                    const msg = `${f.name}: circular arc fitted from BC..EC — R ${a.r.toFixed(2)} ft${a.ccw ? " (left)" : " (right)"}, ${a.endIdx - a.startIdx + 1} shots, fit residual ${a.dev.toFixed(3)} ft.`;
                    add(a.dev > 0.25 ? "WARNING" : "INFO", msg, f.id, a.startIdx, { type: "goto", figId: f.id, kind: "vert", idx: a.startIdx });
                });
            }
            if (f.geomWarn) add("WARNING", `${f.name}:${f.geomWarn}`, f.id, null, null);
            if (f.geomNote) add("INFO", `${f.name}: ${f.geomNote}`, f.id, null, null);

            const otherCodes = (f.segCodes || []).filter(c =>
                !CODESET.curveBegin.concat(CODESET.curveEnd, CODESET.curvePoint, CODESET.circleWhole, ["RECT"]).includes(c));
            if (otherCodes.length) {
                add("INFO", `${f.name}: field code(s) ${otherCodes.join(", ")} recognized but not built as geometry (RT right-turn, X extend, RPN/CPN recall/connect, H/V/SO offsets) — apply in CAD.`, f.id, null, null);
            }

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
        seq: [], playPos: -1, playTimer: null,   // shot-by-shot playback scrubber

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
            this._stopPlay(); this.playPos = -1;
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
        _commit() { this._stopPlay(); this._snapshot(); this._afterChange(); },

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

            // Playback progress: how far each figure has been "walked" by the scrubber.
            let prog = null;
            if (this.playPos >= 0 && this.seq.length) {
                prog = {};
                for (let k = 0; k <= this.playPos && k < this.seq.length; k++) {
                    const s = this.seq[k];
                    prog[s.figId] = Math.max(prog[s.figId] == null ? -1 : prog[s.figId], s.idx);
                }
            }

            this.model.figures.forEach(f => {
                if ((!f.pts || f.pts.length < 1) && !f.isCircle) return;
                const upto = prog ? (prog[f.id] == null ? -1 : prog[f.id]) : Infinity;
                const base = f.__bt ? "#f43f5e" : (this.sel && this.sel.figId === f.id ? "#7dd3fc" : "#38bdf8");
                const dim = "#334155";

                // Whole-figure circle (CIR code)
                if (f.isCircle && f.circle) {
                    this.svg.appendChild(this._mk("circle", {
                        cx: f.circle.cx, cy: -f.circle.cy, r: f.circle.r,
                        fill: "rgba(56,189,248,0.06)", stroke: base, "stroke-width": u * 1.6
                    }));
                    (f.pts || []).forEach((p, idx) => this.svg.appendChild(this._mk("circle", {
                        cx: p.e, cy: -p.n, r: u * 3, fill: "#ef4444", stroke: "#fff", "stroke-width": u,
                        "data-fig": f.id, "data-vert": idx, style: "cursor:pointer"
                    })));
                    return;
                }

                // arc spans: startIdx -> endIdx replaced by one circular arc
                const arcAt = i => (f.arcs || []).find(a => a.startIdx === i);
                const inArc = i => (f.arcs || []).some(a => i > a.startIdx && i < a.endIdx);

                if (f.closed && f.pts.length >= 3) {
                    this.svg.appendChild(this._mk("polygon", {
                        points: f.pts.map(p => `${p.e},${-p.n}`).join(" "),
                        fill: "rgba(56,189,248,0.06)", stroke: "none"
                    }));
                }
                if (f.pts.length >= 2) {
                    const segN = f.closed ? f.pts.length : f.pts.length - 1;
                    for (let i = 0; i < segN; i++) {
                        const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
                        const on = this.sel && this.sel.figId === f.id && this.sel.kind === "seg" && this.sel.idx === i;
                        const isClosing = i === f.pts.length - 1;
                        const reached = prog ? (isClosing ? upto >= f.pts.length - 1 : upto >= i + 1) : true;
                        const arc = arcAt(i);
                        if (arc) {
                            const e = f.pts[arc.endIdx];
                            // SVG sweep flag: our world Y is flipped, so CCW(world) -> sweep 0
                            let a0 = Math.atan2(a.n - arc.cy, a.e - arc.cx);
                            let a1 = Math.atan2(e.n - arc.cy, e.e - arc.cx);
                            let inc = a1 - a0;
                            if (arc.ccw) { while (inc <= 0) inc += 2 * Math.PI; } else { while (inc >= 0) inc -= 2 * Math.PI; }
                            const largeArc = Math.abs(inc) > Math.PI ? 1 : 0;
                            const sweep = arc.ccw ? 0 : 1;
                            this.svg.appendChild(this._mk("path", {
                                d: `M ${a.e},${-a.n} A ${arc.r} ${arc.r} 0 ${largeArc} ${sweep} ${e.e},${-e.n}`,
                                fill: "none", stroke: on ? "#facc15" : (reached ? base : dim),
                                "stroke-opacity": reached || on ? 1 : 0.55, "stroke-width": u * (on ? 3 : 1.8)
                            }));
                        } else if (!inArc(i)) {
                            this.svg.appendChild(this._mk("line", {
                                x1: a.e, y1: -a.n, x2: b.e, y2: -b.n,
                                stroke: on ? "#facc15" : (reached ? base : dim),
                                "stroke-opacity": reached || on ? 1 : 0.55,
                                "stroke-width": u * (on ? 3 : 1.6), "stroke-linecap": "round"
                            }));
                        }
                        // fat transparent hit line (chord approximation is fine for picking)
                        this.svg.appendChild(this._mk("line", {
                            x1: a.e, y1: -a.n, x2: b.e, y2: -b.n,
                            stroke: "#000", "stroke-opacity": 0.001, "stroke-width": u * 12,
                            "data-fig": f.id, "data-seg": i, style: "cursor:pointer"
                        }));
                    }
                }
                f.pts.forEach((p, idx) => {
                    const sel = this.sel && this.sel.figId === f.id && this.sel.kind === "vert" && this.sel.idx === idx;
                    const reached = prog ? idx <= upto : true;
                    const cur = prog && this.playPos >= 0 && this.seq[this.playPos] &&
                        this.seq[this.playPos].figId === f.id && this.seq[this.playPos].idx === idx;
                    this.svg.appendChild(this._mk("circle", {
                        cx: p.e, cy: -p.n,
                        r: u * (sel || cur ? 5 : (reached ? 3.4 : 2.4)),
                        fill: (sel || cur) ? "#facc15" : (reached ? "#ef4444" : "#475569"),
                        "fill-opacity": reached || sel || cur ? 1 : 0.7,
                        stroke: "#fff", "stroke-width": u * (reached ? 1 : 0.5),
                        "data-fig": f.id, "data-vert": idx, style: "cursor:pointer"
                    }));
                });
            });
        },

        // ── shot-by-shot playback ─────────────────────────────────
        _buildSeq() {
            this.seq = [];
            this.model.figures.forEach(f => f.pts.forEach((_, i) => this.seq.push({ figId: f.id, idx: i })));
            const sc = document.getElementById("lw-scrub");
            if (sc) {
                sc.max = Math.max(0, this.seq.length - 1);
                sc.disabled = this.seq.length < 2;
                if (this.playPos > this.seq.length - 1) this.playPos = this.seq.length ? this.seq.length - 1 : -1;
                sc.value = this.playPos < 0 ? 0 : this.playPos;
            }
            this._playRead();
        },
        _playRead() {
            const el = document.getElementById("lw-play-read");
            if (!el) return;
            if (!this.seq.length) { el.textContent = "—"; return; }
            if (this.playPos < 0) { el.textContent = `${this.seq.length} shots`; return; }
            const s = this.seq[this.playPos], f = this._fig(s.figId), p = f && f.pts[s.idx];
            el.textContent = p
                ? `${this.playPos + 1}/${this.seq.length} · ${f.name} #${p.ptNum != null ? p.ptNum : s.idx + 1} · E ${p.e.toFixed(2)} N ${p.n.toFixed(2)}`
                : `${this.playPos + 1}/${this.seq.length}`;
        },
        _ensureVisible(x, y, center) {
            const m = 0.14;
            const inX = x > this.view.x + this.view.w * m && x < this.view.x + this.view.w * (1 - m);
            const inY = y > this.view.y + this.view.h * m && y < this.view.y + this.view.h * (1 - m);
            if (center || !inX || !inY) {
                this.view.x = x - this.view.w / 2;
                this.view.y = y - this.view.h / 2;
                this._applyView();
            }
        },
        playSeek(i, center) {
            if (!this.seq.length) return;
            this.playPos = Math.max(0, Math.min(this.seq.length - 1, i | 0));
            const sc = document.getElementById("lw-scrub");
            if (sc && +sc.value !== this.playPos) sc.value = this.playPos;
            const s = this.seq[this.playPos];
            this.sel = { figId: s.figId, kind: "vert", idx: s.idx };
            const f = this._fig(s.figId), p = f && f.pts[s.idx];
            if (p) this._ensureVisible(p.e, -p.n, center);
            this._playRead();
            this.render();
            this._renderSelection();
        },
        playStep(d) { this.playSeek((this.playPos < 0 ? -1 : this.playPos) + d); },
        _playIcon(playing) {
            const b = document.getElementById("btn-lw-play");
            if (b) window.setSafeHTML(b, playing ? `<i class="fa-solid fa-pause"></i>` : `<i class="fa-solid fa-play"></i>`);
        },
        _stopPlay() {
            if (this.playTimer) { clearInterval(this.playTimer); this.playTimer = null; this._playIcon(false); }
        },
        playToggle() {
            if (this.playTimer) { this._stopPlay(); return; }
            if (!this.seq.length) return;
            if (this.playPos >= this.seq.length - 1) this.playPos = -1;
            this._playIcon(true);
            this.playTimer = setInterval(() => {
                const active = document.getElementById("tab-linework");
                if (active && !active.classList.contains("active")) { this._stopPlay(); return; }
                if (this.playPos >= this.seq.length - 1) { this._stopPlay(); return; }
                this.playSeek(this.playPos + 1);
            }, 280);
        },
        playSyncToSel() {
            if (!this.sel || this.sel.kind !== "vert") return;
            const k = this.seq.findIndex(s => s.figId === this.sel.figId && s.idx === this.sel.idx);
            if (k >= 0) { this.playPos = k; const sc = document.getElementById("lw-scrub"); if (sc) sc.value = k; this._playRead(); }
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
                    this.playSyncToSel();
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
        _afterChange() { resolveGeometry(this.model.figures); this._buildSeq(); this._renderChecks(); this._renderFigures(); this._renderSelection(); this._hud(); this.render(); },

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

    /** LWPOLYLINE vertex list for a figure, collapsing BC..EC spans into a single bulge segment. */
    function figurePolyPoints(f) {
        const arcs = (f.arcs || []).slice().sort((a, b) => a.startIdx - b.startIdx);
        const out = [];
        for (let i = 0; i < f.pts.length; i++) {
            const a = arcs.find(x => x.startIdx === i);
            if (a) {
                const s = f.pts[a.startIdx], e = f.pts[a.endIdx];
                let a0 = Math.atan2(s.n - a.cy, s.e - a.cx);
                let a1 = Math.atan2(e.n - a.cy, e.e - a.cx);
                let inc = a1 - a0;
                if (a.ccw) { while (inc <= 0) inc += 2 * Math.PI; } else { while (inc >= 0) inc -= 2 * Math.PI; }
                out.push({ e: s.e, n: s.n, bulge: window.COGO.bulge(inc) });
                i = a.endIdx - 1;                       // skip the intermediate span shots
            } else {
                out.push({ e: f.pts[i].e, n: f.pts[i].n });
            }
        }
        return out;
    }

    /**
     * Serialize a figures model (buildFigures' output, or Ed.model.figures)
     * back into a Civil 3D Survey Command Language script — the same command
     * forms documented in Autodesk's own reference (NEZ to plant a known 3D
     * coordinate; FIG BEGIN/PT/CLOSE/END to assemble a figure from points
     * already in the database — see Section 13, Example A there). This is
     * the reverse of parsePointFile+buildFigures: a readable, standards-
     * grounded script a person (or Civil 3D's Survey Command Window) can
     * read back, not a re-import format for THIS app — round-trip back into
     * this app still goes through a PNEZD point file (see exportPNEZD).
     *
     * A point shared between two figures (see splitDesc's crossRefs — a
     * curb line ending and a swale beginning at the same corner) is planted
     * ONCE via NEZ and referenced by FIG PT in both figures, not duplicated.
     * Curve spans (arcs) are marked with a "// BC"/"// EC" comment on their
     * FIG PT line — Autodesk's own FIG CRV command takes a radius/length
     * parameter whose exact pairing with FIG PT isn't nailed down by the
     * reference alone, so this sticks to the one thing verifiable from it: a
     * plain comment (Section 13's own examples use "//" comments) rather
     * than guessing at unconfirmed command syntax.
     */
    function buildLineworkScript(figures, opts) {
        opts = opts || {};
        const header = opts.header !== false;
        const lines = [];
        if (header) {
            lines.push("// Generated by the Linework Editor (plugins/linework/linework.js)");
            lines.push(`// ${new Date().toISOString()}`);
            lines.push("// Civil 3D Survey Command Language — see FIG BEGIN/PT/CLOSE/END, NEZ.");
            lines.push("");
        }
        const figs = (figures || []).filter(f => (f.pts && f.pts.length >= 2) || (f.isCircle && f.circle));
        if (!figs.length) return lines.join("\n") + (lines.length ? "\n" : "");

        const autoIds = new Map();
        let autoNum = 9000;
        const idFor = p => {
            if (p.ptNum != null && p.ptNum !== "") return String(p.ptNum);
            if (!autoIds.has(p)) autoIds.set(p, String(autoNum++));
            return autoIds.get(p);
        };
        const seen = new Set();
        const emitNez = p => {
            const id = idFor(p);
            if (!seen.has(id)) { seen.add(id); lines.push(`NEZ ${id} ${p.n.toFixed(4)} ${p.e.toFixed(4)} ${(p.z || 0).toFixed(4)}`); }
            return id;
        };
        const circleCenterPt = f => ({ n: f.circle.cy, e: f.circle.cx, z: 0, ptNum: null });

        // 1) plant every point once.
        figs.forEach(f => f.isCircle && f.circle ? emitNez(circleCenterPt(f)) : f.pts.forEach(emitNez));
        lines.push("");

        // 2) figure structure.
        figs.forEach(f => {
            if (f.isCircle && f.circle) {
                lines.push(`FIG CIR ${idFor(circleCenterPt(f))} ${f.circle.r.toFixed(4)}   // ${f.code}`);
                return;
            }
            const arcs = f.arcs || [];
            lines.push(`FIG BEGIN ${f.code}`);
            f.pts.forEach((p, i) => {
                const tag = arcs.some(a => a.startIdx === i) ? "   // BC (curve begins)"
                          : arcs.some(a => a.endIdx === i) ? "   // EC (curve ends)" : "";
                lines.push(`FIG PT ${idFor(p)}${tag}`);
            });
            if (f.closed) lines.push("FIG CLOSE");
            lines.push("FIG END");
            lines.push("");
        });

        return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    }

    function exportDXF() {
        const figs = Ed.model.figures.filter(f => (f.pts && f.pts.length >= 2) || f.isCircle);
        if (!figs.length) return null;
        const layers = [...new Set(figs.map(f => f.layer || "0"))].map(n => ({ name: n, color: 4 }));
        const polylines = figs.filter(f => !f.isCircle).map(f => ({ layer: f.layer || "0", closed: !!f.closed, points: figurePolyPoints(f) }));
        const circles = figs.filter(f => f.isCircle && f.circle).map(f => ({ layer: f.layer || "0", cx: f.circle.cx, cy: f.circle.cy, r: f.circle.r }));
        return window.COGO.buildDxf({ layers, polylines, circles, texts: [] });
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
    function exportLineworkScript() { return buildLineworkScript(Ed.model.figures); }
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
            document.getElementById("btn-lw-from-efbk")?.addEventListener("click", () => {
                if (!window.EFBK) { ctx.showToast("EFB plugin is not loaded.", true); return; }
                const model = (typeof window.EFBK.getLastModel === "function") ? window.EFBK.getLastModel() : null;
                if (model && model.figures && model.figures.length) {
                    Ed.setModel({ figures: model.figures });
                    ctx.showToast(`Loaded ${model.figures.length} figure(s) from EFB.`);
                } else {
                    ctx.showToast("No EFB figures built yet. Build figures in the EFB tab first.", true);
                }
            });
            ["lw-order", "lw-group"].forEach(id => document.getElementById(id)?.addEventListener("change", () => {
                const t = paste(); if (t.trim()) loadPoints(t, ctx);
            }));
            ["lw-closetol", "lw-snaptol"].forEach(id => document.getElementById(id)?.addEventListener("change", () => Ed._afterChange()));

            document.getElementById("btn-lw-fit")?.addEventListener("click", () => Ed.fit());
            document.getElementById("btn-lw-undo")?.addEventListener("click", () => Ed.undo());
            document.getElementById("btn-lw-redo")?.addEventListener("click", () => Ed.redo());
            document.getElementById("lw-traverse-mode")?.addEventListener("change", () => Ed._renderSelection());

            // Shot-by-shot playback scrubber
            document.getElementById("lw-scrub")?.addEventListener("input", e => Ed.playSeek(+e.target.value));
            document.getElementById("btn-lw-play-back")?.addEventListener("click", () => Ed.playStep(-1));
            document.getElementById("btn-lw-play-fwd")?.addEventListener("click", () => Ed.playStep(1));
            document.getElementById("btn-lw-play")?.addEventListener("click", () => Ed.playToggle());

            const dl = (name, txt, mime) => { if (!txt) { ctx.showToast("Nothing to export.", true); return; } window.COGO.downloadText(name, txt, mime); ctx.showToast("Exported " + name); };
            document.getElementById("btn-lw-exp-dxf")?.addEventListener("click", () => dl("linework.dxf", exportDXF(), "application/dxf"));
            document.getElementById("btn-lw-exp-pnezd")?.addEventListener("click", () => dl("linework_coordinates.txt", exportPNEZD(), "text/csv"));
            document.getElementById("btn-lw-exp-script")?.addEventListener("click", () => dl("linework_script.fbk", exportLineworkScript(), "text/plain"));
            document.getElementById("btn-lw-exp-calls")?.addEventListener("click", () => dl("linework_calls.txt", exportCalls()));
            document.getElementById("btn-lw-exp-report")?.addEventListener("click", () => {
                const rep = exportReport();
                if (window.Reports?.addReport) {
                    window.Reports.addReport({
                        title: "Linework Map Check Report",
                        type: "linework-mapcheck",
                        category: "cogo",
                        format: "log",
                        filename: "linework_mapcheck.log",
                        content: rep
                    });
                }
                dl("linework_mapcheck.log", rep);
            });

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

            // Keyboard: undo/redo, delete selected vertex, ← → to scrub shots, space to play
            window.addEventListener("keydown", e => {
                if (Ed.model.figures.length === 0) return;
                if (!document.getElementById("tab-linework")?.classList.contains("active")) return;
                const tag = (e.target.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" || tag === "select") return;
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); Ed.undo(); }
                else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); Ed.redo(); }
                else if (e.key === "ArrowRight") { e.preventDefault(); Ed.playStep(1); }
                else if (e.key === "ArrowLeft") { e.preventDefault(); Ed.playStep(-1); }
                else if (e.key === " ") { e.preventDefault(); Ed.playToggle(); }
                else if ((e.key === "Delete" || e.key === "Backspace") && Ed.sel && Ed.sel.kind === "vert") {
                    e.preventDefault(); Ed.deleteVertex(Ed.sel.figId, Ed.sel.idx);
                }
            });
        }
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
    window.Linework = { parsePointFile, buildFigures, parseCalls, checkModel, splitDesc, resolveGeometry, circumcircle, fitCircle, buildLineworkScript, CODESET, CODESET_PROFILES, applyCodesetProfile, ARC_FIT, _Ed: Ed };
})();
