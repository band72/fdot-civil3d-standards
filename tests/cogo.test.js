"use strict";
/* Functional tests for core/cogo.js */
module.exports = function (t, env) {
    const C = env.win.COGO;
    const norm180 = d => ((d % 360) + 540) % 360 - 180;

    // deterministic PRNG
    let s = 0x2545F491;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

    t.group("cogo/constants");
    t.close(C.D2R, Math.PI / 180, 1e-12, "D2R");
    t.close(C.R2D, 180 / Math.PI, 1e-12, "R2D");
    t.eq(C.SQFT_PER_ACRE, 43560, "acre sq ft");
    ["parseBearing", "azimuthToBearing", "advance", "distanceBetween", "azimuthDegBetween",
        "includedAngleDeg", "chordFromArc", "deltaDegFromArc", "shoelaceArea", "runTraverse",
        "pnezd", "selfIntersects", "buildDxf", "downloadText"].forEach(fn =>
        t.eq(typeof C[fn], "function", "COGO." + fn + " is a function"));

    t.group("cogo/parseBearing forms");
    const forms = [
        "N 45-12-30 E 150.00", "N45°12'30\"E", "N 45 12 30 E",
        "North 45 degrees 12 minutes 30 seconds East", "n45d12m30sE"
    ];
    forms.forEach(f => {
        const b = C.parseBearing(f);
        t.ok(b, "parses: " + f);
        if (b) {
            t.eq(b.quad, "NE", "quad NE for " + f);
            t.close(b.deg + b.min / 60 + b.sec / 3600, 45 + 12 / 60 + 30 / 3600, 1e-6, "dms " + f);
            t.close(b.azimuthDeg, 45.2083333, 1e-4, "azimuth " + f);
        }
    });
    t.eq(C.parseBearing("not a bearing"), null, "garbage -> null");
    t.eq(C.parseBearing(""), null, "empty -> null");

    t.group("cogo/quadrant math");
    [["N", "E", 30, 30], ["S", "E", 30, 150], ["S", "W", 30, 210], ["N", "W", 30, 330]].forEach(([ns, ew, ang, az]) => {
        const b = C.parseBearing(`${ns} ${ang} 0 0 ${ew}`);
        t.close(b.azimuthDeg, az, 1e-6, `${ns}${ang}${ew} -> az ${az}`);
    });

    t.group("cogo/azimuth<->bearing round-trip (0..359 step 1)");
    for (let az = 0; az < 360; az += 1) {
        const bs = C.azimuthToBearing(az);
        t.match(bs, /^[NS] \d{2}°\d{2}'\d{2}\.\d" [EW]$/, "format " + bs);
        const p = C.parseBearing(bs);
        t.ok(p, "reparse " + bs);
        if (p) t.close(norm180(p.azimuthDeg - az), 0, 0.03, `az ${az} -> ${bs} -> ${p.azimuthDeg}`);
    }

    t.group("cogo/advance + inverse (250 random)");
    for (let i = 0; i < 250; i++) {
        const az = rnd() * 360;
        const d = 0.5 + rnd() * 5000;
        const o = { e: 600000 + rnd() * 2000, n: 2000000 + rnd() * 2000 };
        const p = C.advance(o, az, d);
        t.close(C.distanceBetween(o, p), d, Math.max(1e-6, d * 1e-9), "distance recovered");
        t.close(norm180(C.azimuthDegBetween(o, p) - az), 0, 1e-6, "azimuth recovered");
        // advancing back along az+180 returns to origin
        const back = C.advance(p, (az + 180) % 360, d);
        t.close(C.distanceBetween(back, o), 0, 1e-6, "there-and-back");
    }

    t.group("cogo/includedAngleDeg");
    const O = { e: 0, n: 0 };
    t.close(C.includedAngleDeg({ e: 0, n: 10 }, O, { e: 10, n: 0 }), 90, 1e-6, "right angle");
    t.close(C.includedAngleDeg({ e: 0, n: 10 }, O, { e: 0, n: -10 }), 180, 1e-6, "straight");
    t.close(C.includedAngleDeg({ e: 0, n: 10 }, O, { e: 0.0001, n: 10 }), 0, 0.01, "spike ~0");

    t.group("cogo/chordFromArc identity (chord = 2R sin(delta/2))");
    for (let i = 0; i < 80; i++) {
        const R = 20 + rnd() * 2000;
        const arc = R * (0.01 + rnd() * 2.5);           // delta 0.01..2.5 rad
        const chord = C.chordFromArc(R, arc);
        const deltaRad = arc / R;
        t.close(chord, 2 * R * Math.sin(deltaRad / 2), 1e-6, "chord identity");
        t.close(C.deltaDegFromArc(R, arc), deltaRad * 180 / Math.PI, 1e-6, "delta deg");
        t.lt(chord, arc + 1e-9, "chord <= arc");
    }
    t.eq(C.chordFromArc(0, 10), 0, "R=0 -> 0");
    t.eq(C.chordFromArc(100, 0), 0, "arc=0 -> 0");

    t.group("cogo/shoelaceArea rectangles + triangles");
    for (let i = 0; i < 90; i++) {
        const w = 1 + rnd() * 900, h = 1 + rnd() * 900;
        const ox = rnd() * 1000, oy = rnd() * 1000;
        const rect = [{ e: ox, n: oy }, { e: ox + w, n: oy }, { e: ox + w, n: oy + h }, { e: ox, n: oy + h }];
        t.close(C.shoelaceArea(rect), w * h, Math.max(1e-6, w * h * 1e-9), "rect area w*h");
        t.close(C.shoelaceArea(rect.slice().reverse()), w * h, Math.max(1e-6, w * h * 1e-9), "orientation independent");
        const tri = [{ e: 0, n: 0 }, { e: w, n: 0 }, { e: 0, n: h }];
        t.close(C.shoelaceArea(tri), w * h / 2, Math.max(1e-6, w * h * 1e-9), "triangle w*h/2");
    }
    t.eq(C.shoelaceArea([{ e: 0, n: 0 }, { e: 1, n: 1 }]), 0, "<3 pts -> 0");

    t.group("cogo/selfIntersects");
    t.ok(C.selfIntersects([{ e: 0, n: 0 }, { e: 10, n: 10 }, { e: 10, n: 0 }, { e: 0, n: 10 }]), "classic bow-tie quad");
    t.eq(C.selfIntersects([{ e: 0, n: 0 }, { e: 10, n: 0 }, { e: 10, n: 10 }, { e: 0, n: 10 }]), null, "convex quad clean");
    for (let i = 0; i < 40; i++) {
        // random convex polygon = points sorted by angle around centroid
        const n = 4 + Math.floor(rnd() * 6);
        const pts = [];
        for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, rr = 50 + rnd() * 50; pts.push({ e: Math.cos(a) * rr, n: Math.sin(a) * rr, a }); }
        pts.sort((p, q) => p.a - q.a);
        t.eq(C.selfIntersects(pts), null, "convex hull polygon is simple #" + i);
    }

    t.group("cogo/runTraverse closure on generated closed polygons (60)");
    for (let i = 0; i < 60; i++) {
        const n = 3 + Math.floor(rnd() * 6);
        const verts = [];
        for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, rr = 100 + rnd() * 200; verts.push({ e: Math.cos(a) * rr, n: Math.sin(a) * rr }); }
        const legs = verts.map((v, k) => {
            const a = v, b = verts[(k + 1) % n];
            return { kind: "line", azimuthDeg: C.azimuthDegBetween(a, b), distance: C.distanceBetween(a, b) };
        });
        const tr = C.runTraverse(legs, verts[0]);
        t.close(tr.misclosure, 0, 1e-6, "closed traverse misclosure ~0 #" + i);
        t.eq(tr.precisionDenominator, Infinity, "exact precision #" + i);
        const per = legs.reduce((s2, l) => s2 + l.distance, 0);
        t.close(tr.perimeter, per, 1e-6, "perimeter sum #" + i);
        t.close(tr.areaAcres * C.SQFT_PER_ACRE, C.shoelaceArea(verts), Math.max(1e-4, per), "area matches shoelace #" + i);
        t.eq(tr.vertices.length, n + 1, "vertex count #" + i);
    }

    t.group("cogo/runTraverse open traverse misclosure");
    const openLegs = [{ kind: "line", azimuthDeg: 0, distance: 100 }, { kind: "line", azimuthDeg: 90, distance: 100 }];
    const ot = C.runTraverse(openLegs, { e: 0, n: 0 });
    t.close(ot.misclosure, Math.hypot(100, 100), 1e-6, "open misclosure = gap to start");
    t.close(ot.precisionDenominator, 200 / Math.hypot(100, 100), 1e-6, "precision = perimeter/misclosure");

    t.group("cogo/pnezd format");
    const pn = C.pnezd([{ e: 10, n: 20 }, { e: 30, n: 40 }, { e: 50, n: 60 }]);
    const lines = pn.trim().split(/\r?\n/);
    t.eq(lines[0], "P,N,E,Z,D", "header");
    t.match(lines[1], /^500,20\.000,10\.000,0\.000,COGO POB$/, "first point 500 POB");
    t.match(lines[2], /^501,40\.000,30\.000,0\.000,COGO P1$/, "P1");
    t.match(lines[3], /^502,60\.000,50\.000,0\.000,COGO P2$/, "P2");
    t.match(C.pnezd([{ e: 1, n: 2 }], 700).split(/\r?\n/)[1], /^700,/, "custom start number");

    t.group("cogo/buildDxf structure");
    const dxf = C.buildDxf({
        layers: [{ name: "AI-PROP-BNDY", color: 4 }, { name: "AI-NODE-TEXT", color: 2 }],
        polylines: [{ layer: "AI-PROP-BNDY", closed: true, points: [{ e: 0, n: 0 }, { e: 10, n: 0 }, { e: 10, n: 10 }] }],
        texts: [{ layer: "AI-NODE-TEXT", e: 5, n: 5, height: 4, value: "L1" }]
    });
    const flat = dxf.replace(/\r\n/g, " ");
    t.match(flat, /SECTION.*TABLES.*ENDTAB.*ENDSEC/, "TABLES section");
    t.match(flat, /SECTION.*ENTITIES.*LWPOLYLINE.*TEXT.*ENDSEC.*EOF/, "ENTITIES + EOF");
    t.match(flat, /AI-PROP-BNDY/, "layer name present");
    const pairs = dxf.split(/\r\n/);
    const lwIdx = pairs.indexOf("LWPOLYLINE");
    t.gt(lwIdx, 0, "has LWPOLYLINE");
    t.eq(pairs[lwIdx + 3], "90", "group 90 (vertex count)");
    t.eq(pairs[lwIdx + 4], "3", "3 vertices");
    t.eq(pairs[lwIdx + 5], "70", "group 70 (flags)");
    t.eq(pairs[lwIdx + 6], "1", "closed flag = 1");

    t.group("cogo/buildDxf round-trips through the site's own parser");
    const insp = new env.win.FDOTDXFInspector(env.win.FDOT_DATA);
    const parsed = insp.parseDXF(C.buildDxf({
        layers: [{ name: "SURV_BND_PR", color: 1 }],
        polylines: [{ layer: "SURV_BND_PR", closed: true, points: [{ e: 500000, n: 2000000 }, { e: 500100, n: 2000000 }, { e: 500100, n: 2000100 }, { e: 500000, n: 2000100 }] }],
        texts: []
    }));
    t.eq(parsed.layers.length, 1, "1 layer parsed back");
    t.eq(parsed.layers[0].name, "SURV_BND_PR", "layer name round-trips");
    t.eq(parsed.entities.length, 1, "1 entity");
    t.eq(parsed.entities[0].type, "LWPOLYLINE", "polyline round-trips");
    t.eq(parsed.entities[0].vertices.length, 4, "4 vertices round-trip");
    t.close(parsed.entities[0].vertices[1].x, 500100, 1e-6, "vertex x round-trips");
};
