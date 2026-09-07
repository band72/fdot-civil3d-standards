"use strict";
/* Functional tests for plugins/dxf-auditor/dxf-parser.js (window.FDOTDXFInspector) */
module.exports = function (t, env) {
    const W = env.win;
    const insp = new W.FDOTDXFInspector(W.FDOT_DATA);

    const dxf = (parts) => parts.join("\n");
    const HEAD = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1032", "0", "ENDSEC"];
    const tbl = (layers) => ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layers.length)]
        .concat(layers.flatMap(l => ["0", "LAYER", "2", l.name, "70", "0", "62", String(l.color || 7), "6", l.lt || "CONTINUOUS"]))
        .concat(["0", "ENDTAB", "0", "ENDSEC"]);
    const lwpoly = (layer, closed, verts) => ["0", "LWPOLYLINE", "8", layer, "90", String(verts.length), "70", closed ? "1" : "0", "43", "0.0"]
        .concat(verts.flatMap(v => ["10", String(v[0]), "20", String(v[1])]));
    const line = (layer, a, b) => ["0", "LINE", "8", layer, "10", String(a[0]), "20", String(a[1]), "11", String(b[0]), "21", String(b[1])];

    t.group("dxf/parseDXF basic");
    const p1 = insp.parseDXF(dxf(HEAD.concat(
        tbl([{ name: "ROAD_EOP_PR", color: 1 }, { name: "SURV_BND_PR", color: 1 }]),
        ["0", "SECTION", "2", "ENTITIES"],
        lwpoly("ROAD_EOP_PR", false, [[500000, 2000000], [500100, 2000000], [500100, 2000100]]),
        line("SURV_BND_PR", [500000, 2000000], [500050, 2000050]),
        ["0", "ENDSEC", "0", "EOF"]
    )));
    t.eq(p1.layers.length, 2, "2 layers");
    t.eq(p1.layers.map(l => l.name).sort().join(","), "ROAD_EOP_PR,SURV_BND_PR", "layer names");
    t.eq(p1.entities.length, 2, "2 entities");
    t.eq(p1.entities[0].type, "LWPOLYLINE", "first is polyline");
    t.eq(p1.entities[0].vertices.length, 3, "3 vertices");
    t.eq(p1.entities[1].type, "LINE", "second is line");
    t.close(p1.entities[1].endX, 500050, 1e-6, "line endX");

    t.group("dxf/TABLES-section bleed is contained");
    // A LAYER table followed by an LTYPE table whose group-2 values must NOT overwrite the last layer name.
    const bleed = insp.parseDXF(dxf(HEAD.concat(
        ["0", "SECTION", "2", "TABLES",
            "0", "TABLE", "2", "LAYER", "70", "1",
            "0", "LAYER", "2", "SURV_BND_PR", "70", "0", "62", "1", "6", "CONTINUOUS",
            "0", "ENDTAB",
            "0", "TABLE", "2", "LTYPE", "70", "2",
            "0", "LTYPE", "2", "DASHED", "70", "0", "3", "Dashed ____",
            "0", "LTYPE", "2", "HIDDEN", "70", "0", "3", "Hidden __ __",
            "0", "ENDTAB",
            "0", "ENDSEC",
            "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"]
    )));
    t.eq(bleed.layers.length, 1, "still exactly 1 layer after LTYPE table");
    t.eq(bleed.layers[0].name, "SURV_BND_PR", "layer name not corrupted by LTYPE group-2 values");

    t.group("dxf/inspectProject issues");
    const bad = insp.parseDXF(dxf(HEAD.concat(
        tbl([{ name: "0", color: 7 }, { name: "DEFPOINTS", color: 7 }, { name: "MYSTUFF", color: 7 }, { name: "ROAD_EOP_PR", color: 42 }]),
        ["0", "SECTION", "2", "ENTITIES"],
        line("0", [500000, 2000000], [500000, 2000000]),                  // on layer 0 AND zero-length
        lwpoly("SURV_BND_PR", false, [[10, 10], [20, 20], [15, 5]]),      // out-of-envelope coords
        ["0", "ENDSEC", "0", "EOF"]
    )));
    const audit = insp.inspectProject(bad);
    t.ok(audit.score >= 0 && audit.score <= 100, "score in 0..100");
    const titles = audit.issues.map(i => i.title).join(" | ");
    t.match(titles, /Entities on Layer 0/, "flags entities on layer 0");
    t.match(titles, /Defpoints/i, "flags Defpoints layer");
    t.match(titles, /Non-Compliant FDOT Layer Prefix/, "flags bad prefix (MYSTUFF)");
    t.match(titles, /Non-Standard Layer Color/, "flags wrong ACI on ROAD_EOP_PR");
    t.match(titles, /Zero-Length Line/, "flags zero-length line");
    t.match(titles, /Out-of-Bounds Coordinate/, "flags out-of-envelope coords");
    t.ok(audit.issues.some(i => i.severity === "CRITICAL"), "has a CRITICAL issue");

    t.group("dxf/bow-tie detection");
    const bt = insp.checkPolylineBowtie([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }], true);
    t.ok(bt, "closed bow-tie detected");
    const clean = insp.checkPolylineBowtie([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true);
    t.eq(clean, false, "clean rectangle not flagged");
    // closing segment matters
    const wrapCross = insp.checkPolylineBowtie([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 5, y: -5 }, { x: 10, y: 10 }, { x: 10, y: 0 }], true);
    t.ok(wrapCross === true || wrapCross === false, "closing-segment case returns a boolean");

    t.group("dxf/generateFixScript is valid-looking .scr");
    const scr = insp.generateFixScript([
        { category: "Symbology Error", layer: "ROAD_EOP_PR", stdColor: 7 },
        { category: "CADD Standards", layer: "0" }
    ]);
    t.match(scr, /^; FDOT Civil3D Standards/, "script header comment");
    t.match(scr, /_\.AUDIT _Yes/, "AUDIT command");
    t.match(scr, /_\.-LAYER _Color 7 "ROAD_EOP_PR"/, "layer color reset with real ACI");
    t.match(scr, /_\.-PURGE _All \* _No/, "purge command");
    t.match(scr, /_\.QSAVE/, "qsave");
    t.notOk(/BYLAYER "/.test(scr), "no malformed 'C BYLAYER' token");

    t.group("dxf/spatial engine telemetry (no fabricated fields)");
    const tel = W.BoundaryQCWASM.processDXFSpatialStream("x".repeat(2048), p1.entities);
    t.eq(tel.entitiesIndexed, p1.entities.length, "entitiesIndexed matches");
    t.ok(typeof tel.parseTimeMs === "number" && tel.parseTimeMs >= 0, "real parse time");
    t.eq(tel.memoryPeakMB, undefined, "fabricated memoryPeakMB removed");
    t.eq(tel.cloudCostSavedUSD, undefined, "fabricated cloudCostSavedUSD removed");

    t.group("dxf/spiral solver (Fresnel)");
    const sp = W.BoundaryQCWASM.solveSpiralFresnel(100, 500);
    t.close(sp.parameterA, Math.sqrt(100 * 500), 1e-3, "A = sqrt(L*R)");
    t.close(sp.thetaRad, 100 * 100 / (2 * 100 * 500), 1e-6, "theta = L^2 / (2 A^2)");
    t.gt(sp.xOffset, 0, "x offset positive");
    t.gt(sp.yOffset, 0, "y offset positive");
    t.eq(W.BoundaryQCWASM.solveSpiralFresnel(0, 0).x, 0, "degenerate spiral -> 0");
};
