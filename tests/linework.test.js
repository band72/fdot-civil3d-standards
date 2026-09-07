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

    t.group("linework/exports via COGO");
    const exp = LW.parsePointFile("1,2000000,600000,10,SQ B\n2,2000100,600000,10,SQ\n3,2000100,600100,10,SQ\n4,2000000,600100,10,SQ CLS", "NE").points;
    const eFig = LW.buildFigures(exp, "byCode")[0];
    const eDxf = COGO.buildDxf({ layers: [{ name: eFig.layer, color: 4 }], polylines: [{ layer: eFig.layer, closed: eFig.closed, points: eFig.pts }], texts: [] });
    t.match(eDxf.replace(/\r\n/g, " "), /LWPOLYLINE.*EOF/, "figure exports to DXF");
    t.match(COGO.pnezd(eFig.pts).split(/\r?\n/)[0], /^P,N,E,Z,D$/, "figure exports to PNEZD");
};
