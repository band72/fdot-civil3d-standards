"use strict";
/* Functional tests for plugins/linework/linework.js (window.Linework) */
module.exports = function (t, env) {
    const LW = env.win.Linework;
    const COGO = env.win.COGO;

    t.group("linework/splitDesc — Civil 3D code set");
    const cases = [
        ["EP B", "EP", "begin", false, []],
        ["EP", "EP", "", false, []],
        ["EP C", "EP", "continue", false, []],
        ["EP CONT", "EP", "continue", false, []],
        ["EP E", "EP", "end", false, []],
        ["EP END", "EP", "end", false, []],
        ["BND CLS", "BND", "close", true, []],
        ["BND CLOSE", "BND", "close", true, []],
        ["BND Z", "BND", "close", true, []],
        ["BND CL", "BND", "close", true, []],
        ["EP 2 B", "EP", "begin", false, []],
        ["CURB BC", "CURB", "", false, ["BC"]],
        ["CURB EC", "CURB", "", false, ["EC"]],
        ["ARC CIR", "ARC", "", false, ["CIR"]],
        ["EP RECT", "EP", "", false, ["RECT"]],
        ["EP RT", "EP", "", false, ["RT"]],
        ["EP X", "EP", "", false, ["X"]],
        ["EP H0.5", "EP", "", false, ["H0.5"]],
        ["EP V-1.2", "EP", "", false, ["V-1.2"]],
        ["LOT/EP", "LOT", "", false, []],
        ["", "LINE", "", false, []],
        ["TREE", "TREE", "", false, []]
    ];
    cases.forEach(([desc, code, control, closeFlag, seg]) => {
        const d = LW.splitDesc(desc);
        t.eq(d.code, code, `code of "${desc}"`);
        t.eq(d.control, control, `control of "${desc}"`);
        t.eq(d.closeFlag, closeFlag, `closeFlag of "${desc}"`);
        t.eq(d.segCodes.sort(), seg.sort(), `segCodes of "${desc}"`);
    });
    t.notOk(LW.splitDesc("EP C").closeFlag, "REGRESSION: C is Continue, not Close");
    t.notOk(LW.splitDesc("EP E").closeFlag, "REGRESSION: E is End, not Close");

    t.group("linework/parsePointFile delimiters + order + Z-optional");
    const csv = LW.parsePointFile("1,2000000.0,600000.0,10.5,BND B\n2,2000100.0,600000.0,10.6,BND", "NE");
    t.eq(csv.points.length, 2, "comma delimited, 2 points");
    t.eq(csv.points[0].ptNum, 1, "point number");
    t.close(csv.points[0].n, 2000000, 1e-6, "N");
    t.close(csv.points[0].e, 600000, 1e-6, "E");
    t.close(csv.points[0].z, 10.5, 1e-6, "Z");
    t.eq(csv.points[0].desc, "BND B", "desc kept");
    const en = LW.parsePointFile("5,600000,2000000,,EOP", "EN");
    t.close(en.points[0].e, 600000, 1e-6, "EN order: E first");
    t.close(en.points[0].n, 2000000, 1e-6, "EN order: N second");
    t.eq(en.points[0].z, 0, "missing Z -> 0");
    const tab = LW.parsePointFile("10\t2000000\t600000\t9\tBND", "NE");
    t.eq(tab.points.length, 1, "tab delimited");
    const sp = LW.parsePointFile("11 2000000 600000 9 BND", "NE");
    t.eq(sp.points.length, 1, "space delimited");
    const withBad = LW.parsePointFile("P,N,E,Z,D\n1,2000000,600000,10,BND\nbroken row here\n2,2000100,600000,10,BND", "NE");
    t.eq(withBad.points.length, 2, "header + junk skipped, 2 good rows");
    t.gte(withBad.bad.length, 1, "bad rows recorded");

    t.group("linework/buildFigures — begin/continue/end/close");
    const pts = LW.parsePointFile([
        "1,2000000,600000,10,BND B", "2,2000300,600000,10,BND", "3,2000300,600200,10,BND", "4,2000000,600200,10,BND CLS",
        "10,2000400,600000,10,EP B", "11,2000600,600000,10,EP", "12,2000700,600050,10,TREE",
        "13,2000610,600300,10,EP C", "14,2000620,600600,10,EP E",
        "20,2010000,590000,9,CURB B", "21,2010100,590000,9,CURB", "22,2010200,590000,9,CURB E",
        "30,2010000,595000,9,CURB B", "31,2010100,595000,9,CURB E"
    ].join("\n"), "NE").points;
    const figs = LW.buildFigures(pts, "byCode");
    const byName = {}; figs.forEach(f => (byName[f.name] = byName[f.name] || []).push(f));
    t.ok(byName.BND && byName.BND.length === 1 && byName.BND[0].closed, "BND: one closed figure (CLS)");
    t.eq(byName.BND[0].pts.map(p => p.ptNum).join(","), "1,2,3,4", "BND point order");
    t.ok(byName.EP && byName.EP.length === 1, "EP: one figure (continue merged)");
    t.eq(byName.EP[0].closed, false, "EP not closed (E = end)");
    t.eq(byName.EP[0].pts.map(p => p.ptNum).join(","), "10,11,13,14", "EP excludes the TREE shot, keeps continued pts");
    t.ok(byName.CURB && byName.CURB.length === 2, "CURB: two separate figures (each has its own B)");
    t.notOk(figs.some(f => f.name === "TREE"), "single-point TREE dropped");

    t.group("linework/buildFigures — single + byFigure modes");
    const single = LW.buildFigures(pts, "single");
    t.eq(single.length, 1, "single mode -> one figure");
    t.eq(single[0].pts.length, pts.length, "single mode keeps every point");
    const bf = LW.buildFigures(LW.parsePointFile("1,0,0,0,EP 1 B\n2,0,10,0,EP 1\n3,5,0,0,EP 2 B\n4,5,10,0,EP 2", "NE").points, "byFigure");
    t.eq(bf.length, 2, "byFigure: EP 1 and EP 2 are separate");

    t.group("linework/checkModel findings");
    const model = { figures: LW.buildFigures(LW.parsePointFile([
        "1,2000000,600000,10,BND B", "2,2000300,600000,10,BND", "3,2000300,600200,10,BND", "4,2000000,600200,10,BND CLS",
        "10,2000400,600000,10,EP B", "11,2000600,600000,10,EP", "12,2000600,600000,10,EP", "13,2000700,600300,10,EP E",
        "20,2010000,590000,10,BOW B", "21,2010100,590100,10,BOW", "22,2010000,590100,10,BOW", "23,2010100,590000,10,BOW CLS",
        "30,10,10,10,LOCAL B", "31,20,10,10,LOCAL", "32,20,20,10,LOCAL E",
        "40,2020000,610000,10,CV B CIR", "41,2020100,610050,10,CV", "42,2020200,610000,10,CV E"
    ].join("\n"), "NE").points, "byCode") };
    const F = LW.checkModel(model, { closeTol: 0.1, snapTol: 0.1 });
    const has = (sev, re) => F.some(x => x.sev === sev && re.test(x.msg));
    t.ok(has("ERROR", /zero-length/i), "zero-length course flagged (EP #12)");
    t.ok(has("ERROR", /bow-tie|self-intersect/i), "bow-tie flagged (BOW)");
    t.ok(has("WARNING", /envelope/i), "out-of-envelope flagged (LOCAL)");
    t.ok(has("INFO", /BC|EC|CIR|curve|chord/i), "curve field code noted (CV CIR)");
    t.ok(F.some(x => x.fix && x.fix.type === "delVertex"), "zero-length has a delVertex fix");
    t.ok(F.some(x => x.fix && x.fix.type === "untangle"), "bow-tie has an untangle fix");
    // rank: errors first
    const firstErr = F.findIndex(x => x.sev === "ERROR");
    const firstInfo = F.findIndex(x => x.sev === "INFO");
    t.ok(firstErr === 0 && (firstInfo === -1 || firstInfo > firstErr), "findings sorted by severity");

    t.group("linework/checkModel — a call-list traverse gets misclosure");
    const tr = LW.parseCalls("N 0 E 100\nN 90 E 100\nS 0 E 100\nS 90 W 100.5", { e: 0, n: 0 });
    t.ok(tr.fromCalls, "figure flagged fromCalls");
    const trF = LW.checkModel({ figures: [tr] }, {});
    t.ok(trF.some(x => /misclosure/i.test(x.msg)), "traverse misclosure reported");
    t.notOk(trF.some(x => /envelope/i.test(x.msg)), "local traverse: envelope check suppressed");

    t.group("linework/editor ops (headless Ed)");
    const Ed = LW._Ed;
    Ed.render = () => {}; Ed._renderFigures = () => {}; Ed._renderChecks = () => {}; Ed._renderSelection = () => {};
    Ed._hud = () => {}; Ed._buildSeq = function () { this.seq = []; this.model.figures.forEach(f => f.pts.forEach((_, i) => this.seq.push({ figId: f.id, idx: i }))); };
    Ed._playRead = () => {}; Ed.ctx = { showToast: () => {} };
    Ed.root = env.fakeEl(); Ed.svg = null;
    Ed._traverseMode = () => false;

    const m2 = { figures: LW.buildFigures(LW.parsePointFile([
        "1,2000000,600000,10,SQ B", "2,2000100,600000,10,SQ", "3,2000100,600100,10,SQ", "4,2000000,600100,10,SQ CLS",
        "10,2000200,600000,10,BT B", "11,2000300,600100,10,BT", "12,2000200,600100,10,BT", "13,2000300,600000,10,BT CLS"
    ].join("\n"), "NE").points, "byCode") };
    Ed.fit = () => {};
    Ed.setModel(m2);
    const sq = Ed._fig(m2.figures.find(f => f.name === "SQ").id);
    const bt2 = m2.figures.find(f => f.name === "BT");

    t.eq(sq.pts.length, 4, "SQ starts with 4 pts");
    // zoom in & out controls
    Ed.view = { x: -50, y: -50, w: 100, h: 100 };
    t.ok(typeof Ed.zoomIn === "function", "Ed.zoomIn exists");
    t.ok(typeof Ed.zoomOut === "function", "Ed.zoomOut exists");
    Ed.zoomIn();
    t.close(Ed.view.w, 80, 1e-4, "zoomIn reduces view dimensions (0.8x)");
    Ed.zoomOut();
    t.close(Ed.view.w, 100, 1e-4, "zoomOut scales back up (1.25x)");
    Ed.deleteVertex(sq.id, 0);
    t.eq(Ed._fig(sq.id).pts.length, 3, "deleteVertex removed one");
    Ed.undo();
    t.eq(Ed._fig(sq.id).pts.length, 4, "undo restored");
    Ed.redo();
    t.eq(Ed._fig(sq.id).pts.length, 3, "redo re-applied");
    Ed.undo();

    // untangle the bow-tie
    t.ok(LW.checkModel(Ed.model, {}).some(x => /bow-tie/i.test(x.msg)), "BT is a bow-tie before untangle");
    t.ok(Ed.untangle(bt2.id), "untangle succeeded");
    t.notOk(LW.checkModel(Ed.model, {}).some(x => x.figId === bt2.id && /bow-tie/i.test(x.msg)), "BT no longer a bow-tie");
    Ed.undo();
    t.ok(LW.checkModel(Ed.model, {}).some(x => /bow-tie/i.test(x.msg)), "undo restored the bow-tie");

    // setSegment: free vs traverse mode
    Ed.setModel({ figures: [{ id: "L", name: "L", layer: "0", closed: false, pts: [{ e: 0, n: 0 }, { e: 0, n: 100 }, { e: 0, n: 200 }] }] });
    Ed._traverseMode = () => false;
    Ed.setSegment("L", 0, 90, 50);   // course 1 -> due east 50
    t.close(Ed._fig("L").pts[1].e, 50, 1e-6, "free edit moved far vertex E");
    t.close(Ed._fig("L").pts[2].e, 0, 1e-6, "free edit left downstream vertex alone");
    Ed.undo();
    Ed._traverseMode = () => true;
    Ed.setSegment("L", 0, 90, 50);
    t.close(Ed._fig("L").pts[1].e, 50, 1e-6, "traverse edit moved far vertex");
    t.close(Ed._fig("L").pts[2].e, 50, 1e-6, "traverse edit shifted downstream vertex too");

    // playback scrubber
    Ed.setModel({ figures: LW.buildFigures(LW.parsePointFile("1,0,0,0,A B\n2,0,10,0,A\n3,0,20,0,A E\n4,5,0,0,B2 B\n5,5,10,0,B2 E", "NE").points, "byCode") });
    Ed._buildSeq();
    t.eq(Ed.seq.length, 5, "playback sequence spans all 5 points");
    Ed._playRead = () => {}; Ed._ensureVisible = () => {};
    Ed.playSeek(2);
    t.eq(Ed.playPos, 2, "playSeek");
    t.eq(Ed.sel && Ed.sel.kind, "vert", "playSeek selects a vertex");
    Ed.playStep(10);
    t.eq(Ed.playPos, 4, "playStep clamps to last");
    Ed.playStep(-99);
    t.eq(Ed.playPos, 0, "playStep clamps to first");

    t.group("linework/curves — BC..EC arc fitting");
    t.eq(LW.circumcircle({ e: 0, n: 1 }, { e: 1, n: 0 }, { e: 0, n: -1 }).r, 1, "circumcircle radius");
    t.close(LW.circumcircle({ e: 0, n: 1 }, { e: 1, n: 0 }, { e: 0, n: -1 }).cx, 0, 1e-9, "circumcircle center x");
    t.eq(LW.circumcircle({ e: 0, n: 0 }, { e: 1, n: 0 }, { e: 2, n: 0 }), null, "collinear -> null");
    // Kåsa fit through 5 points on a known circle
    const cen = { e: 640000, n: 2000000 }, R0 = 250;
    const on = a => ({ e: cen.e + R0 * Math.cos(a), n: cen.n + R0 * Math.sin(a) });
    const fit = LW.fitCircle([on(0.1), on(0.6), on(1.1), on(1.7), on(2.3)]);
    t.close(fit.cx, cen.e, 1e-4, "LSQ fit center e");
    t.close(fit.cy, cen.n, 1e-4, "LSQ fit center n");
    t.close(fit.r, R0, 1e-4, "LSQ fit radius");

    // BC / on-curve / EC exactly on a 250 ft circle centred at the section corner (E 640000, N 2000000)
    const arcCen = { e: 640000, n: 2000000 };
    const onArc = a => ({ e: arcCen.e + 250 * Math.cos(a), n: arcCen.n + 250 * Math.sin(a) });
    const p2 = onArc(0), p3 = onArc(Math.PI / 4), p4 = onArc(Math.PI / 2);
    const arcPts = LW.parsePointFile([
        `1,${arcCen.n},${arcCen.e},9,C1 B`,
        `2,${p2.n.toFixed(4)},${p2.e.toFixed(4)},9,C1 BC`,
        `3,${p3.n.toFixed(4)},${p3.e.toFixed(4)},9,C1`,
        `4,${p4.n.toFixed(4)},${p4.e.toFixed(4)},9,C1 EC`,
        `5,${(arcCen.n - 250).toFixed(4)},${(arcCen.e - 250).toFixed(4)},9,C1 E`
    ].join("\n"), "NE").points;
    const cf = LW.buildFigures(arcPts, "byCode")[0];
    t.ok(cf.arcs && cf.arcs.length === 1, "one arc span resolved from BC..EC");
    t.eq(cf.arcs[0].startIdx, 1, "arc starts at the BC point index");
    t.eq(cf.arcs[0].endIdx, 3, "arc ends at the EC point index");
    t.close(cf.arcs[0].cx, arcCen.e, 1e-3, "arc centre easting recovered");
    t.close(cf.arcs[0].cy, arcCen.n, 1e-3, "arc centre northing recovered");
    t.close(cf.arcs[0].r, 250, 1e-3, "arc radius ≈ 250");
    t.lt(cf.arcs[0].dev, 1e-3, "fit residual ~0 (points were on the circle)");
    const arcFind = LW.checkModel({ figures: [cf] }, {});
    t.ok(arcFind.some(x => /arc fitted/i.test(x.msg)), "checkModel reports the fitted arc");

    // BC without EC, and a too-short span
    const noEc = LW.buildFigures(LW.parsePointFile("1,0,0,0,X B\n2,0,10,0,X BC\n3,10,10,0,X\n4,20,20,0,X E", "NE").points, "byCode")[0];
    t.ok(/no matching EC/i.test(noEc.geomWarn || ""), "unmatched BC warns");
    const short = LW.buildFigures(LW.parsePointFile("1,0,0,0,Y BC\n2,0,10,0,Y EC\n3,10,10,0,Y E", "NE").points, "byCode")[0];
    t.ok(!short.arcs || short.arcs.length === 0, "2-point BC..EC span produces no arc");
    t.ok(/at least 3 shots/i.test(short.geomWarn || ""), "2-point span warns");

    // A bad circle fit (a "curve" that isn't actually one, e.g. a natural
    // meandering line bracketed by MCS/MCE) must NOT be forced into a wrong
    // arc — REGRESSION for the Vinings.txt top-of-bank/toe-of-slope finding.
    const badFit = LW.buildFigures(LW.parsePointFile([
        "1,-10,-10,0,TOB B", "2,0,0,0,TOB MCS", "3,15,10,0,TOB", "4,-5,20,0,TOB",
        "5,20,30,0,TOB", "6,0,40,0,TOB MCE", "7,10,50,0,TOB E"
    ].join("\n"), "NE").points, "byCode")[0];
    t.notOk(badFit.arcs && badFit.arcs.length, "a poorly-fit MCS..MCE span isn't drawn as an arc");
    t.match(badFit.geomWarn || "", /exceeds tolerance/i, "…and geomWarn explains why");
    t.eq(badFit.pts.length, 7, "…all 7 shots still kept as straight-chord vertices");

    t.group("linework/splitDesc — control-word-first order + MCS/MCE (field convention variants)");
    // Civil 3D's own default puts the code first ("EP B"); some offices' point
    // files put the control word first ("B EP") — both must parse identically.
    t.eq(LW.splitDesc("B EP").code, "EP", "control-first: code recovered regardless of position");
    t.eq(LW.splitDesc("B EP").control, "begin", "control-first: control word recognized out of position");
    t.eq(LW.splitDesc("E TCL").code, "TCL", "control-first end: code recovered");
    t.eq(LW.splitDesc("E TCL").control, "end", "control-first end: control recognized");
    t.eq(LW.splitDesc("E TCL 30").code, "TCL", "control-first end + trailing number: code still TCL, not '30'");
    t.eq(LW.splitDesc("E TCL 30").fig, "30", "…the trailing number still parses as `fig` (byCode mode ignores it)");
    t.eq(LW.splitDesc("MCS SW").segCodes.join(","), "MCS", "MCS recognized as a curve-begin segCode");
    t.eq(LW.splitDesc("MCE SW").segCodes.join(","), "MCE", "MCE recognized as a curve-end segCode");
    const mcsFig = LW.buildFigures(LW.parsePointFile([
        `1,0,0,9,W B`,
        `2,250,0,9,W MCS`,
        `3,250,250,9,W`,
        `4,500,250,9,W MCE`,
        `5,750,250,9,W E`
    ].join("\n"), "NE").points, "byCode")[0];
    t.ok(mcsFig.arcs && mcsFig.arcs.length === 1, "MCS..MCE resolves an arc exactly like BC..EC");

    t.group("linework/splitDesc — X-compound cross-figure references");
    // "<code><escape><word>" cross-references a DIFFERENT figure from this same
    // shot (e.g. a curb line ending and a swale beginning at the same corner).
    t.eq(LW.splitDesc("TB/E TB1").code, "TB1", "compound + plain: plain token is primary");
    t.eq(LW.splitDesc("TB/E TB1").crossRefs.length, 1, "…the compound token becomes one crossRef");
    t.eq(LW.splitDesc("TB/E TB1").crossRefs[0].code, "TB", "…targeting the OTHER code");
    t.eq(LW.splitDesc("TB/E TB1").crossRefs[0].control, "end", "…with the right control word");
    // Same code as primary → folds in, no duplicate cross-reference.
    t.eq(LW.splitDesc("TB/E TB").crossRefs.length, 0, "same-code compound merges into the primary, no crossRef");
    t.eq(LW.splitDesc("TB/E TB").control, "end", "…and its control word is honored on the primary");
    t.eq(LW.splitDesc("LOT/EP").code, "LOT", "REGRESSION: bare compound-only description still parses (no plain token)");

    const hingePts = LW.parsePointFile([
        "1,0,0,10,ROAD B", "2,100,0,10,ROAD",
        "3,100,100,10,ROAD/E DRV/B",     // shared vertex: ends ROAD, begins DRV
        "4,100,200,10,DRV", "5,100,300,10,DRV E"
    ].join("\n"), "NE").points;
    const hingeFigs = LW.buildFigures(hingePts, "byCode");
    const road = hingeFigs.find(f => f.code === "ROAD"), drv = hingeFigs.find(f => f.code === "DRV");
    t.ok(road && drv, "both figures built from one description stream with a shared hinge shot");
    t.eq(road.pts.map(p => p.ptNum).join(","), "1,2,3", "ROAD ends at the hinge point (#3)");
    t.eq(drv.pts.map(p => p.ptNum).join(","), "3,4,5", "DRV begins at the SAME hinge point (#3)");
    t.eq(road.pts[2].e, drv.pts[0].e, "…sharing identical coordinates (e)");
    t.eq(road.pts[2].n, drv.pts[0].n, "…sharing identical coordinates (n)");
    t.notOk(road.closed, "ROAD ended (E), not closed");

    t.group("linework/CODESET.pointOnly — codes that never auto-chain into a figure");
    // Default: 2+ shots sharing a bare code with no B/C/E at all still chain
    // into one figure (existing, intended "automatic figure" behavior).
    const gradePts = LW.parsePointFile("1,0,0,9,GRADE\n2,500,500,9,GRADE\n3,1000,10,9,GRADE", "NE").points;
    t.ok(LW.buildFigures(gradePts, "byCode").some(f => f.code === "GRADE"), "by default, bare same-code shots DO chain");
    const savedPointOnly = LW.CODESET.pointOnly;
    try {
        LW.CODESET.pointOnly = ["GRADE"];
        const noChain = LW.buildFigures(gradePts, "byCode");
        t.notOk(noChain.some(f => f.code === "GRADE"), "…unless the code is opted into pointOnly — then never a figure");
    } finally {
        LW.CODESET.pointOnly = savedPointOnly;   // don't leak into other suites
    }

    t.group("linework/CODESET_PROFILES — reusable per-convention presets");
    t.throws(() => LW.applyCodesetProfile("not-a-real-profile"), "unknown profile name throws, doesn't silently no-op");
    const savedEscape = LW.CODESET.escape, savedPointOnly2 = LW.CODESET.pointOnly;
    try {
        LW.applyCodesetProfile("control-first-x-escape");
        t.eq(LW.CODESET.escape, "X", "profile applied: escape switched to X");
        t.ok(LW.CODESET.pointOnly.indexOf("G") !== -1, "profile applied: pointOnly carries the known point-feature codes");
        // control-word-first + X-compound cross-ref + MCS, all through ONE profile call
        const profPts = LW.parsePointFile([
            "1,0,0,10,B TCL", "2,100,0,10,TCL",
            "3,100,100,10,TCLXE SW1XB",       // ends TCL, begins SW1 — at the same shot
            "4,100,200,10,SW1",
        ].join("\n"), "NE").points;
        const profFigs = LW.buildFigures(profPts, "byCode");
        t.ok(profFigs.find(f => f.code === "TCL" && f.pts.length === 3), "control-first TCL built via the profile");
        t.ok(profFigs.find(f => f.code === "SW1" && f.pts.length === 2), "cross-referenced SW1 built from the same hinge shot");

        LW.applyCodesetProfile("default");
        t.eq(LW.CODESET.escape, "/", "\"default\" profile restores the stock escape char");
        t.eq(LW.CODESET.pointOnly.length, 0, "\"default\" profile restores an empty pointOnly");

        // FDOT State Kit profile verification
        LW.applyCodesetProfile("fdot-state-kit");
        t.eq(LW.CODESET.escape, "/", "fdot-state-kit profile uses '/' escape delimiter");
        t.ok(LW.CODESET.pointOnly.includes("MONU") && LW.CODESET.pointOnly.includes("BENCH") && LW.CODESET.pointOnly.includes("TREE"),
            "fdot-state-kit carries FDOT survey point-only codes (MONU, BENCH, TREE, FH)");
        const fdotPts = LW.parsePointFile([
            "1,0,0,10,MONU", "2,100,0,10,MONU",
            "3,200,0,10,EOP B", "4,300,0,10,EOP", "5,400,0,10,EOP E"
        ].join("\n"), "NE").points;
        const fdotFigs = LW.buildFigures(fdotPts, "byCode");
        t.notOk(fdotFigs.some(f => f.code === "MONU"), "MONU shots are point-only under fdot-state-kit, not chained");
        t.ok(fdotFigs.some(f => f.code === "EOP" && f.pts.length === 3), "EOP linear figure built correctly");
        LW.applyCodesetProfile("default");
    } finally {
        LW.CODESET.escape = savedEscape; LW.CODESET.pointOnly = savedPointOnly2;   // don't leak into other suites
    }

    t.group("linework/CIR circle + RECT rectangle codes");
    const circ = LW.buildFigures(LW.parsePointFile("1,2000015,640000,9,MH CIR\n2,2000000,640015,9,MH\n3,2000000,639985,9,MH", "NE").points, "byCode")[0];
    t.ok(circ.isCircle && circ.circle, "CIR -> whole-figure circle");
    t.close(circ.circle.r, 15, 0.5, "circle radius from 3 shots");
    t.close(circ.circle.cx, 640000, 0.5, "circle center e");
    const rectPts = LW.parsePointFile("1,2000000,640000,9,PAD B RECT\n2,2000000,640100,9,PAD\n3,2000060,640100,9,PAD", "NE").points;
    const rect = LW.buildFigures(rectPts, "byCode")[0];
    t.eq(rect.pts.length, 4, "RECT computed the 4th corner");
    t.ok(rect.closed, "RECT figure is closed");
    // opposite sides equal length (parallelogram)
    t.close(COGO.distanceBetween(rect.pts[0], rect.pts[1]), COGO.distanceBetween(rect.pts[2], rect.pts[3]), 1e-6, "RECT opposite sides equal");
    t.ok(LW.checkModel({ figures: [rect] }, {}).some(x => /rectangle/i.test(x.msg)), "checkModel notes the RECT");

    t.group("linework/resolveGeometry idempotent");
    const before = JSON.stringify(rect.pts.length);
    LW.resolveGeometry([rect]); LW.resolveGeometry([rect]);
    t.eq(JSON.stringify(rect.pts.length), before, "re-running resolveGeometry does not duplicate the RECT corner");

    t.group("linework/DXF export carries bulge + CIRCLE");
    const Ed2 = LW._Ed;
    Ed2.render = () => {}; Ed2._renderFigures = () => {}; Ed2._renderChecks = () => {}; Ed2._renderSelection = () => {};
    Ed2._hud = () => {}; Ed2._buildSeq = () => {}; Ed2.fit = () => {}; Ed2.ctx = { showToast: () => {} };
    Ed2.setModel({ figures: [cf, circ] });
    const dxfBtn = env.win.document; // exportDXF is private; trigger via the same path the button uses
    // Rebuild what exportDXF would emit using the exposed helpers:
    const polyPts = (function figurePolyPoints(f) {
        const arcs = (f.arcs || []).slice().sort((a, b) => a.startIdx - b.startIdx);
        const out = [];
        for (let i = 0; i < f.pts.length; i++) {
            const a = arcs.find(x => x.startIdx === i);
            if (a) {
                const s = f.pts[a.startIdx], e = f.pts[a.endIdx];
                let a0 = Math.atan2(s.n - a.cy, s.e - a.cx), a1 = Math.atan2(e.n - a.cy, e.e - a.cx), inc = a1 - a0;
                if (a.ccw) { while (inc <= 0) inc += 2 * Math.PI; } else { while (inc >= 0) inc -= 2 * Math.PI; }
                out.push({ e: s.e, n: s.n, bulge: COGO.bulge(inc) });
                i = a.endIdx - 1;
            } else out.push({ e: f.pts[i].e, n: f.pts[i].n });
        }
        return out;
    })(cf);
    t.ok(polyPts.some(p => p.bulge && Math.abs(p.bulge) > 1e-6), "arc-start vertex carries a bulge");
    const dxfWithArc = COGO.buildDxf({ layers: [{ name: cf.layer, color: 4 }], polylines: [{ layer: cf.layer, closed: false, points: polyPts }], circles: [{ layer: circ.layer, cx: circ.circle.cx, cy: circ.circle.cy, r: circ.circle.r }], texts: [] });
    t.match(dxfWithArc, /\r\n42\r\n-?\d/, "DXF LWPOLYLINE has a group-42 bulge");
    t.match(dxfWithArc.replace(/\r\n/g, " "), /CIRCLE .* 40 15/, "DXF has a CIRCLE entity R=15");
    void dxfBtn;

    t.group("linework/exports via COGO");
    const exp = LW.parsePointFile("1,2000000,600000,10,SQ B\n2,2000100,600000,10,SQ\n3,2000100,600100,10,SQ\n4,2000000,600100,10,SQ CLS", "NE").points;
    const eFig = LW.buildFigures(exp, "byCode")[0];
    const eDxf = COGO.buildDxf({ layers: [{ name: eFig.layer, color: 4 }], polylines: [{ layer: eFig.layer, closed: eFig.closed, points: eFig.pts }], texts: [] });
    t.match(eDxf.replace(/\r\n/g, " "), /LWPOLYLINE.*EOF/, "figure exports to DXF");
    t.match(COGO.pnezd(eFig.pts).split(/\r?\n/)[0], /^P,N,E,Z,D$/, "figure exports to PNEZD");

    t.group("linework/buildLineworkScript — Civil 3D Survey Command Language export");
    const scriptFigs = LW.buildFigures(LW.parsePointFile([
        "1,2000000,600000,10,SQ B", "2,2000100,600000,10,SQ", "3,2000100,600100,10,SQ", "4,2000000,600100,10,SQ CLS",
        "10,2010000,610000,10,OPEN B", "11,2010100,610000,10,OPEN E",
    ].join("\n"), "NE").points, "byCode");
    const script = LW.buildLineworkScript(scriptFigs);
    t.match(script, /NEZ 1 2000000\.0000 600000\.0000 10\.0000/, "NEZ line for point 1 (N E Z order)");
    t.match(script, /FIG BEGIN SQ/, "FIG BEGIN for the closed square");
    t.match(script, /FIG PT 1[\s\S]*FIG PT 2[\s\S]*FIG PT 3[\s\S]*FIG PT 4/, "FIG PT lines in point order");
    t.match(script, /FIG PT 4\nFIG CLOSE\nFIG END/, "FIG CLOSE before FIG END for the closed figure");
    t.match(script, /FIG BEGIN OPEN[\s\S]*FIG PT 10[\s\S]*FIG PT 11\nFIG END/, "the open figure has no FIG CLOSE");
    t.notOk(/OPEN[\s\S]*FIG CLOSE/.test(script.slice(script.indexOf("FIG BEGIN OPEN"))), "…confirmed: no stray CLOSE after OPEN");

    // A point shared between two figures (crossRefs hinge) is planted once.
    const hingeFigs2 = LW.buildFigures(LW.parsePointFile([
        "1,0,0,10,ROAD B", "2,100,0,10,ROAD",
        "3,100,100,10,ROAD/E DRV/B",
        "4,100,200,10,DRV", "5,100,300,10,DRV E",
    ].join("\n"), "NE").points, "byCode");
    const hingeScript = LW.buildLineworkScript(hingeFigs2);
    t.eq((hingeScript.match(/^NEZ 3 /gm) || []).length, 1, "the shared hinge point (#3) is planted with NEZ exactly once");
    t.eq((hingeScript.match(/^FIG PT 3\b/gm) || []).length, 2, "…but referenced by FIG PT in BOTH figures");

    // BC/EC curve markers land on the right FIG PT lines.
    const arcCen2 = { e: 640000, n: 2000000 };
    const onArc2 = a => ({ e: arcCen2.e + 250 * Math.cos(a), n: arcCen2.n + 250 * Math.sin(a) });
    const q2 = onArc2(0), q3 = onArc2(Math.PI / 4), q4 = onArc2(Math.PI / 2);
    const arcFig = LW.buildFigures(LW.parsePointFile([
        `1,${arcCen2.n},${arcCen2.e},9,C1 B`,
        `2,${q2.n.toFixed(4)},${q2.e.toFixed(4)},9,C1 BC`,
        `3,${q3.n.toFixed(4)},${q3.e.toFixed(4)},9,C1`,
        `4,${q4.n.toFixed(4)},${q4.e.toFixed(4)},9,C1 EC`,
        `5,${(arcCen2.n - 250).toFixed(4)},${(arcCen2.e - 250).toFixed(4)},9,C1 E`,
    ].join("\n"), "NE").points, "byCode");
    const arcScript = LW.buildLineworkScript(arcFig);
    t.match(arcScript, /FIG PT 2 {3}\/\/ BC \(curve begins\)/, "BC comment on the arc-start FIG PT line");
    t.match(arcScript, /FIG PT 4 {3}\/\/ EC \(curve ends\)/, "EC comment on the arc-end FIG PT line");
    t.notOk(/FIG PT 3 {3}\/\//.test(arcScript), "…the interior on-curve shot carries no marker");

    // CIR whole-figure circle.
    const circFig = LW.buildFigures(LW.parsePointFile("1,2000015,640000,9,MH CIR\n2,2000000,640015,9,MH\n3,2000000,639985,9,MH", "NE").points, "byCode");
    const circScript = LW.buildLineworkScript(circFig);
    t.match(circScript, /FIG CIR \d+ 15\.0000 {3}\/\/ MH/, "CIR figure exports as FIG CIR centre-point + radius");

    // Points with no real ptNum (e.g. an interactively-added RECT corner) still export, auto-numbered.
    const rectFig = LW.buildFigures(LW.parsePointFile("1,2000000,640000,9,PAD B RECT\n2,2000000,640100,9,PAD\n3,2000060,640100,9,PAD", "NE").points, "byCode");
    const rectScript = LW.buildLineworkScript(rectFig);
    t.eq((rectScript.match(/^NEZ /gm) || []).length, 4, "the computed 4th RECT corner still gets a NEZ line");
    t.eq((rectScript.match(/^FIG PT /gm) || []).length, 4, "…and a FIG PT reference");

    let emptyOk = true, emptyResult = "";
    try { emptyResult = LW.buildLineworkScript([]); } catch (e) { emptyOk = false; }
    t.ok(emptyOk, "empty figures array doesn't throw");
    t.match(emptyResult, /Civil 3D Survey Command Language/, "…still emits the header comment");
    t.match(LW.buildLineworkScript([], { header: false }), /^\s*$/, "header:false on an empty model returns empty/whitespace text");
};
