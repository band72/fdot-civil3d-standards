"use strict";
/* Functional tests for plugins/efbk/efbk.js (window.EFBK) — checked wherever
 * possible against the FDOT EFB User's Handbook's own worked examples. */
module.exports = function (t, env) {
    const E = env.win.EFBK;
    const LW = env.win.Linework;

    // ── Point / reference naming ────────────────────────────────────────
    t.group("efbk/point + reference naming");
    t.eq(JSON.stringify(E.splitPointName("TAN19")), JSON.stringify({ prefix: "TAN", suffix: "19", suffixNum: 19 }), "prefix + trailing digit run");
    t.eq(JSON.stringify(E.splitPointName("PAVT5")), JSON.stringify({ prefix: "PAVT", suffix: "5", suffixNum: 5 }), "PAVT5 (handbook example)");
    t.eq(JSON.stringify(E.splitPointName("AAAAAAA9")), JSON.stringify({ prefix: "AAAAAAA", suffix: "9", suffixNum: 9 }), "7-char prefix, handbook capacity example");
    t.eq(E.splitPointName("NOPREFIXATALL").suffix, null, "no trailing digits -> bare prefix, suffix null");
    t.eq(E.formatPointName("TAN", "19"), "TAN19", "formatPointName round-trips");

    t.eq(E.parseStationValue("10+00"), 1000, "station 10+00");
    t.close(E.parseStationValue("13+66.273"), 1366.273, 1e-9, "station 13+66.273");
    t.close(E.parseStationValue("1366.273"), 1366.273, 1e-9, "plain-number station form");
    t.eq(E.parseStationValue(""), null, "empty station -> null");

    const ref1 = E.parseReferenceName(".060-92-A05");
    t.eq(ref1.isNewControl, true, "leading '.' marks new control");
    t.eq(ref1.name, "060-92-A05", "…dot stripped from the name");
    const ref2 = E.parseReferenceName("LOGAN TOWER 1934");
    t.eq(ref2.name, "LOGAN_TOWER_1934", "spaces print as underbars (handbook example)");
    t.eq(ref2.isNewControl, false, "no leading dot -> existing control, not new");
    t.ok(E.parseReferenceName("A".repeat(20)).tooLong, "over 16 chars flagged tooLong");

    // ── Feature codes ────────────────────────────────────────────────────
    t.group("efbk/feature codes");
    t.eq(JSON.stringify(E.parseFeatureCode('TREE-48" WHITE OAK')), JSON.stringify({ code: "TREE", description: '48" WHITE OAK' }), "dash-separated description (handbook example)");
    t.eq(E.parseFeatureCode("99-PLACE TEXT HERE").textOnly, true, "special code 99 is text-only");
    t.eq(E.parseFeatureCode("99-PLACE TEXT HERE").description, "PLACE TEXT HERE", "…description after 99-");
    t.eq(JSON.stringify(E.parseFeatureCode("MH")), JSON.stringify({ code: "MH", description: "" }), "bare feature code, no description");

    const hvd = E.parseHVDFeatureCode("CLINE3,11+00,B");
    t.eq(hvd.alignment, "CLINE3", "HVD feature code: alignment");
    t.eq(hvd.station, 1100, "…station");
    t.eq(hvd.orientation, "B", "…orientation");
    t.eq(E.parseHVDFeatureCode("CLINE3,14+00,L").orientation, "L", "orientation L recognized");
    t.eq(E.parseHVDFeatureCode("CLINE3,16+00,X"), null, "bad orientation letter rejected");
    t.eq(E.parseHVDFeatureCode("notenoughparts"), null, "malformed HVD code rejected");

    // ── Point rows / database ────────────────────────────────────────────
    t.group("efbk/parseEfbPoints");
    const pdb = E.parseEfbPoints([
        "TAN19,2015000.00,642000.00,10.0,P,,,",
        "TAN20,2015010.00,642010.00,10.0,P,,,",
        "MARK3,2015020.00,642005.00,9.5,C,,,",
        "# a comment line, skipped",
        "",
        "BAD1,notanumber,642000,10",
        "TAN19,2016000.00,643000.00,11.0,P,,,",
    ].join("\n"));
    t.eq(pdb.order.length, 3, "3 good points parsed (comment/blank/bad/dup skipped)");
    t.ok(pdb.points.has("TAN19") && pdb.points.has("TAN20") && pdb.points.has("MARK3"), "all 3 present by name");
    t.eq(pdb.points.get("MARK3").geom, "C", "geometry type C parsed");
    t.eq(pdb.points.get("TAN19").geom, "P", "geometry type defaults to P");
    t.match(pdb.errors.join("\n"), /bad NAME\/N\/E/i, "malformed row reported");
    t.match(pdb.errors.join("\n"), /duplicate point name/i, "duplicate point name reported");
    t.eq(pdb.points.get("TAN19").n, 2015000, "first TAN19 kept, not overwritten by the duplicate");

    const attrRow = E.parseEfbRow("G1,2015000,642000,10,P,G,3,", 1);
    t.eq(attrRow.attr, "G", "Ground-point attribute parsed");
    t.eq(attrRow.zone, 3, "zone parsed");
    t.ok(E.parseEfbRow("Z1,2015000,642000,10,P,Q,,", 1).error, "unknown attribute letter rejected");
    t.ok(E.parseEfbRow("Z1,2015000,642000,10,P,G,11,", 1).error, "zone out of 1-9 range rejected");
    const xRow = E.parseEfbRow("X1,2015000,642000,10,P,X,,,CLINE3,11+00,B", 1);
    t.ok(xRow.hvd && xRow.hvd.alignment === "CLINE3", "attribute X row: HVD feature code parsed intact despite embedded commas");
    t.ok(E.parseEfbRow("X2,2015000,642000,10,P,X,,,not,an,hvd,code", 1).error, "attribute X with a bad feature code is rejected");
    t.ok(E.parseEfbRow("NOSUFFIX,2015000,642000,10", 1).error, "a name with no numeric suffix is rejected");

    // ── Chain-list mini-language — verified against the handbook's own
    // worked "Lot 1 / Lot 2 / Lot 3" examples (page 11-12) ───────────────
    t.group("efbk/chain lists — handbook worked examples");
    const lots = E.parseEfbPoints([
        "A1,0,0,10,P", "A2,0,4,10,P", "A3,4,4,10,P", "A4,4,0,10,P",
        "B1,10,0,10,P", "B2,10,4,10,P", "B3,14,4,10,P", "B4,14,0,10,P",
    ].join("\n")).points;
    const namesOf = (chainListStr) => E.resolveChainList(chainListStr, lots).segments.map(seg => seg.join(","));

    // LOT1 equivalent forms all resolve to the same connectivity
    t.eq(namesOf("A1,A2,A3,A4,A1")[0], "A1,A2,A3,A4,A1", "explicit LOT1 listing");
    t.eq(namesOf("A1-4,A1")[0], "A1,A2,A3,A4,A1", "A1-4,A1  == explicit listing");
    t.eq(namesOf("A1-4,1")[0], "A1,A2,A3,A4,A1", "A1-4,1   == explicit listing (carried prefix, single suffix)");
    t.eq(namesOf("-A,4")[0], "A4,A3,A2,A1,A4", "-A,4     == descending global + carried-prefix close");
    t.eq(namesOf("A4-1,4")[0], "A4,A3,A2,A1,A4", "A4-1,4   == descending range + carried-prefix close");

    // LOT1 + LOT3 (two disconnected squares, "gap" between them)
    const withGap = E.resolveChainList("A1-4,1,,B1-4,1", lots).segments;
    t.eq(withGap.length, 2, "double comma breaks the chain into two disconnected runs");
    t.eq(withGap[0].join(","), "A1,A2,A3,A4,A1", "…first run: closed LOT1 square");
    t.eq(withGap[1].join(","), "B1,B2,B3,B4,B1", "…second run: closed LOT3 square (carried prefix reset to B)");
    t.eq(E.resolveChainList("A,1,,B,1", lots).segments.map(s => s.join(",")).join("|"),
         "A1,A2,A3,A4,A1|B1,B2,B3,B4,B1", "the shorthand 'A,1,,B,1' form gives the identical result");
    t.eq(E.resolveChainList("-B,4,,A,1", lots).segments.map(s => s.join(",")).join("|"),
         "B4,B3,B2,B1,B4|A1,A2,A3,A4,A1", "descending-first variant '-B,4,,A,1' also matches (reordered)");

    // Prefix-implied-through-range example (page 11): "RD,PAVT1-44,DWY6-14,,15-22,..."
    // — reduced scale, same shape: prefix carries across a numeric-only range,
    // and again across a gap, without needing to be re-stated.
    const carry = E.parseEfbPoints([
        "RD1,0,0,0,P",
        "PAVT1,1,0,0,P", "PAVT2,1,1,0,P", "PAVT3,1,2,0,P", "PAVT4,1,3,0,P",
        "DWY6,2,0,0,P", "DWY7,2,1,0,P", "DWY8,2,2,0,P",
        "DWY15,3,0,0,P", "DWY16,3,1,0,P",
    ].join("\n")).points;
    const carryResolved = E.resolveChainList("RD,PAVT1-4,DWY6-8,,15-16", carry);
    t.eq(carryResolved.segments.length, 2, "gap still splits the run even with an implied prefix");
    t.eq(carryResolved.segments[0].join(","), "RD1,PAVT1,PAVT2,PAVT3,PAVT4,DWY6,DWY7,DWY8", "prefix carries from PAVT to the bare DWY6-8 range");
    t.eq(carryResolved.segments[1].join(","), "DWY15,DWY16", "…and DWY is STILL the carried prefix after the gap (bare '15-16')");

    // Cross-section double-comma gap example (page 13)
    const xsect = E.parseEfbPoints(Array.from({ length: 22 }, (_, i) => `XSECT${i + 1},0,${i},0,P`).join("\n")).points;
    const xg = E.resolveChainList("XSECT1-15,,18-22", xsect).segments;
    t.eq(xg.length, 2, "XSECT1-15,,18-22 -> two runs");
    t.eq(xg[0].length, 15, "…first run has 15 points");
    t.eq(xg[1].join(","), "XSECT18,XSECT19,XSECT20,XSECT21,XSECT22", "…second run XSECT18-22, no connection to XSECT15");

    t.ok(E.resolveChainList("5-10", new Map()).errors.length > 0, "a bare numeric token with no carried prefix yet reports an error, not a silent empty result");
    t.ok(E.resolveChainList("NOPREFIX", new Map()).errors.length > 0, "a prefix matching zero points is also flagged, not silently returned empty");

    // ── P/C curve geometry — verified against the handbook's own examples ──
    t.group("efbk/P-C curve resolution — handbook examples 1 and 2");

    // Example 1: P,P,C,C,C,P,C,C,C,P -> two independent 3-point circular arcs
    const ex1raw = [
        { name: "p1", e: 0, n: 0, z: 0, geom: "P" },
        { name: "p2", e: 10, n: 0, z: 0, geom: "P" },
        { name: "c1", e: 20, n: 0, z: 0, geom: "C" },
        { name: "c2", e: 25, n: 5, z: 0, geom: "C" },
        { name: "c3", e: 20, n: 10, z: 0, geom: "C" },
        { name: "p3", e: 10, n: 10, z: 0, geom: "P" },
        { name: "c4", e: 0, n: 10, z: 0, geom: "C" },
        { name: "c5", e: -5, n: 15, z: 0, geom: "C" },
        { name: "c6", e: 0, n: 20, z: 0, geom: "C" },
        { name: "p4", e: 10, n: 20, z: 0, geom: "P" },
    ];
    const ex1 = E.resolveChainCurves(ex1raw);
    t.eq(ex1.arcs.length, 2, "example 1: two 3-point circular arcs resolved");
    t.eq(ex1.warnings.length, 0, "…no warnings (well-formed input)");
    t.eq(ex1.pts.length, ex1raw.length, "…point count unchanged (3-point arcs don't insert anything)");

    // Example 2: P,P,C×6,P,P -> one smooth curve run (4+ C's)
    const ex2raw = [
        { name: "p1", e: 0, n: 0, z: 0, geom: "P" },
        { name: "p2", e: 10, n: 0, z: 0, geom: "P" },
        ...[0, 1, 2, 3, 4, 5].map(i => ({ name: "c" + i, e: 20 + i * 5, n: 5 + i, z: 0, geom: "C" })),
        { name: "p3", e: 60, n: 20, z: 0, geom: "P" },
        { name: "p4", e: 70, n: 20, z: 0, geom: "P" },
    ];
    const ex2 = E.resolveChainCurves(ex2raw);
    t.eq(ex2.arcs.length, 0, "example 2: no circular arcs (run of 6 C's, not 3)");
    t.eq(ex2.smoothRuns.length, 1, "…exactly one smooth-curve run");
    t.eq(ex2.smoothRuns[0].endIdx - ex2.smoothRuns[0].startIdx, 5, "…spanning all 6 C points");

    // "Note: if two type C points are encountered in sequence, they are
    // treated as type P points" — no arc, no smooth run, just passed through.
    const twoC = E.resolveChainCurves([
        { name: "p1", e: 0, n: 0, z: 0, geom: "P" },
        { name: "c1", e: 10, n: 0, z: 0, geom: "C" },
        { name: "c2", e: 20, n: 5, z: 0, geom: "C" },
        { name: "p2", e: 30, n: 5, z: 0, geom: "P" },
    ]);
    t.eq(twoC.arcs.length, 0, "REGRESSION: two consecutive C's produce no arc");
    t.eq(twoC.smoothRuns.length, 0, "…and no smooth run either");
    t.eq(twoC.pts.length, 4, "…all 4 points kept as straight vertices");

    t.group("efbk/P-C curve resolution — the tangent-constrained single-C arc");
    // Independently constructed: a real circle, with PC/POC/PT placed exactly
    // on it and the tangent LINES extended from the correct tangent directions
    // — then verify the solver recovers the same circle, not the other way
    // around (this is the "1-POINT ARC" figure in the handbook: two P's define
    // the back tangent, two P's define the ahead tangent, one C is the POC).
    function onCircle(cx, cy, r, angle, ccw) {
        const p = { e: cx + r * Math.cos(angle), n: cy + r * Math.sin(angle) };
        const tan = ccw ? { e: -Math.sin(angle), n: Math.cos(angle) } : { e: Math.sin(angle), n: -Math.cos(angle) };
        return { p, tan };
    }
    const CX = 1000, CY = 2000, R = 250;
    const aPC = 0.2, aPT = 1.1;
    const pcOn = onCircle(CX, CY, R, aPC, true);
    const ptOn = onCircle(CX, CY, R, aPT, true);
    const pocOn = onCircle(CX, CY, R, (aPC + aPT) / 2, true);
    const back1 = { e: pcOn.p.e - pcOn.tan.e * 50, n: pcOn.p.n - pcOn.tan.n * 50 };
    const back2 = { e: pcOn.p.e - pcOn.tan.e * 10, n: pcOn.p.n - pcOn.tan.n * 10 };
    const ahead1 = { e: ptOn.p.e + ptOn.tan.e * 10, n: ptOn.p.n + ptOn.tan.n * 10 };
    const ahead2 = { e: ptOn.p.e + ptOn.tan.e * 50, n: ptOn.p.n + ptOn.tan.n * 50 };
    const sol = E.circleTangentThroughPoint(back1, back2, ahead1, ahead2, pocOn.p);
    t.ok(sol, "tangent-through-point solve succeeds on a well-conditioned case");
    t.close(sol.cx, CX, 1e-2, "…recovers the true centre easting");
    t.close(sol.cy, CY, 1e-2, "…recovers the true centre northing");
    t.close(sol.r, R, 1e-2, "…recovers the true radius");
    t.close(sol.pc.e, pcOn.p.e, 1e-2, "…recovers the true PC (e)");
    t.close(sol.pc.n, pcOn.p.n, 1e-2, "…recovers the true PC (n)");
    t.close(sol.pt.e, ptOn.p.e, 1e-2, "…recovers the true PT (e)");
    t.close(sol.pt.n, ptOn.p.n, 1e-2, "…recovers the true PT (n)");

    // Full pipeline via resolveChainCurves: MARK1,MARK2 (back), MARK3 (POC),
    // MARK4,MARK5 (ahead) — same shape as the handbook's "1-POINT ARC" figure.
    const markRun = [
        { name: "MARK1", e: back1.e, n: back1.n, z: 0, geom: "P" },
        { name: "MARK2", e: back2.e, n: back2.n, z: 0, geom: "P" },
        { name: "MARK3", e: pocOn.p.e, n: pocOn.p.n, z: 0, geom: "C" },
        { name: "MARK4", e: ahead1.e, n: ahead1.n, z: 0, geom: "P" },
        { name: "MARK5", e: ahead2.e, n: ahead2.n, z: 0, geom: "P" },
    ];
    const markRes = E.resolveChainCurves(markRun);
    t.eq(markRes.arcs.length, 1, "1-point-arc figure resolves to one arc");
    t.eq(markRes.pts.length, 7, "…PC and PT computed/inserted (5 shots, the POC replaced by [PC,POC,PT] -> 7 output vertices)");
    t.eq(markRes.pts[markRes.arcs[0].startIdx].name, "MARK3_PC", "…inserted PC named off the POC shot");
    t.eq(markRes.pts[markRes.arcs[0].endIdx].name, "MARK3_PT", "…inserted PT named off the POC shot");
    t.close(markRes.arcs[0].r, R, 1e-2, "…full-pipeline radius matches the standalone solve");

    // An isolated C with no 2+2 P bounding has no rule in the handbook —
    // kept straight, flagged, never silently guessed.
    const unbounded = E.resolveChainCurves([
        { name: "p1", e: 0, n: 0, z: 0, geom: "P" },
        { name: "c1", e: 10, n: 5, z: 0, geom: "C" },
        { name: "p2", e: 20, n: 0, z: 0, geom: "P" },
    ]);
    t.eq(unbounded.arcs.length, 0, "an under-bounded lone C produces no arc");
    t.match(unbounded.warnings.join(" "), /isolated C point/i, "…and is flagged with a clear warning");

    // Two arcs sharing one tangent line (a compound/reverse-curve shape,
    // handbook Examples 3 & 4: P,P,C,P,P,C,P,P) — verifies the shared P,P
    // pair correctly serves as BOTH arc1's ahead tangent and arc2's back
    // tangent, using two independently-known circles.
    t.group("efbk/P-C curve resolution — two arcs sharing one tangent (compound curve)");
    const C1 = { cx: 0, cy: 0, r: 100 }, a1a = 0.3, a1b = 1.0;
    const pc1On = onCircle(C1.cx, C1.cy, C1.r, a1a, true);
    const pt1On = onCircle(C1.cx, C1.cy, C1.r, a1b, true);
    const poc1On = onCircle(C1.cx, C1.cy, C1.r, (a1a + a1b) / 2, true);
    const b1 = { e: pc1On.p.e - pc1On.tan.e * 40, n: pc1On.p.n - pc1On.tan.n * 40 };
    const b2 = { e: pc1On.p.e - pc1On.tan.e * 10, n: pc1On.p.n - pc1On.tan.n * 10 };
    // shared middle tangent line: through PT1, direction = tangent at PT1
    const mid1 = { e: pt1On.p.e, n: pt1On.p.n };
    const mid2 = { e: pt1On.p.e + pt1On.tan.e * 10, n: pt1On.p.n + pt1On.tan.n * 10 };
    // circle2: PC2 = PT1 exactly (a true compound curve, continuous tangent),
    // continuing CCW with a different radius.
    const theta2 = Math.atan2(-pt1On.tan.e, pt1On.tan.n);
    const C2 = { cx: mid1.e - 70 * Math.cos(theta2), cy: mid1.n - 70 * Math.sin(theta2), r: 70 };
    const a2b = theta2 + 0.8;
    const pt2On = onCircle(C2.cx, C2.cy, C2.r, a2b, true);
    const poc2On = onCircle(C2.cx, C2.cy, C2.r, (theta2 + a2b) / 2, true);
    const a1 = { e: pt2On.p.e + pt2On.tan.e * 10, n: pt2On.p.n + pt2On.tan.n * 10 };
    const a2 = { e: pt2On.p.e + pt2On.tan.e * 40, n: pt2On.p.n + pt2On.tan.n * 40 };

    const compoundRun = [
        { name: "b1", e: b1.e, n: b1.n, z: 0, geom: "P" },
        { name: "b2", e: b2.e, n: b2.n, z: 0, geom: "P" },
        { name: "poc1", e: poc1On.p.e, n: poc1On.p.n, z: 0, geom: "C" },
        { name: "mid1", e: mid1.e, n: mid1.n, z: 0, geom: "P" },
        { name: "mid2", e: mid2.e, n: mid2.n, z: 0, geom: "P" },
        { name: "poc2", e: poc2On.p.e, n: poc2On.p.n, z: 0, geom: "C" },
        { name: "a1", e: a1.e, n: a1.n, z: 0, geom: "P" },
        { name: "a2", e: a2.e, n: a2.n, z: 0, geom: "P" },
    ];
    const compoundRes = E.resolveChainCurves(compoundRun);
    t.eq(compoundRes.arcs.length, 2, "compound curve: two tangent-arcs resolved from a shared middle P,P pair");
    t.eq(compoundRes.warnings.length, 0, "…no warnings");
    t.close(compoundRes.arcs[0].r, C1.r, 1e-1, "…first arc radius recovered");
    t.close(compoundRes.arcs[0].cx, C1.cx, 1e-1, "…first arc centre e recovered");
    t.close(compoundRes.arcs[0].cy, C1.cy, 1e-1, "…first arc centre n recovered");
    t.close(compoundRes.arcs[1].r, C2.r, 1e-1, "…second arc radius recovered");
    t.close(compoundRes.arcs[1].cx, C2.cx, 1e-1, "…second arc centre e recovered");
    t.close(compoundRes.arcs[1].cy, C2.cy, 1e-1, "…second arc centre n recovered");

    // ── Bridge to the linework figures model ────────────────────────────
    t.group("efbk/buildFiguresFromChains + flattenForExport");
    const lotChains = [{ name: "LOT1", featureCode: "BND", chainList: "A1-4,A1" }];
    const built = E.buildFiguresFromChains(lotChains, lots);
    t.eq(built.figures.length, 1, "one figure built from the LOT1 chain");
    t.eq(built.figures[0].code, "BND", "…feature code carried as the figure code");
    t.eq(built.figures[0].closed, true, "…closed (first == last point name)");
    t.eq(built.figures[0].pts.length, 5, "…5 vertices (A1,A2,A3,A4,A1)");

    const smoothChains = [{ name: "STRM", featureCode: "STREAM", chainList: "S1-6" }];
    const smoothPts = E.parseEfbPoints(
        [0, 1, 2, 3, 4, 5].map(i => `S${i + 1},${5 + i},${20 + i * 5},0,C`).join("\n")
    ).points;
    const smoothBuilt = E.buildFiguresFromChains(smoothChains, smoothPts);
    t.eq(smoothBuilt.figures[0].smoothRuns.length, 1, "a 6-C chain builds a figure with one smooth run");
    const flat = E.flattenForExport(smoothBuilt.figures);
    t.notOk(flat[0].smoothRuns, "flattenForExport strips the smoothRuns field");
    t.gt(flat[0].pts.length, smoothBuilt.figures[0].pts.length, "…and densifies it into many more straight-chord vertices");

    // ── window.Linework interoperability — the actual "support the
    // linework plugin" integration point ────────────────────────────────
    t.group("efbk/linework interop");
    t.ok(LW && typeof LW.buildLineworkScript === "function", "window.Linework.buildLineworkScript is reachable");
    const script = LW.buildLineworkScript(built.figures);
    t.match(script, /FIG BEGIN BND/, "efbk figures serialize through the SAME linework script builder");
    t.match(script, /FIG CLOSE/, "…closed LOT1 figure emits FIG CLOSE");

    // ── Presets & bridge methods ────────────────────────────────────────
    t.group("efbk/presets and model bridge");
    t.ok(E.PRESETS && E.PRESETS.lot && E.PRESETS.curve && E.PRESETS.spline, "presets lot, curve, spline exposed");
    t.ok(typeof E.loadPreset === "function", "loadPreset is function");
    t.ok(typeof E.getLastModel === "function", "getLastModel is function");
    const curvePreset = E.PRESETS.curve;
    const curvePdb = E.parseEfbPoints(curvePreset.points);
    t.eq(curvePdb.order.length, 5, "curve preset has 5 points (P,P,C,P,P)");
    const curveFigs = E.buildFiguresFromChains([{ name: "CURVE1", featureCode: "EP", chainList: "T1-5" }], curvePdb.points);
    t.eq(curveFigs.figures.length, 1, "curve preset builds 1 figure");
    t.eq(curveFigs.figures[0].arcs.length, 1, "curve preset produces 1 tangent arc");
};
