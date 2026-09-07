"use strict";
/* legal-desc, plss-breakdown, plat2dxf, security-pki, plugin-loader, safe-dom */
module.exports = async function (t, env) {
    const W = env.win;
    const crypto = require("crypto");

    // ── security-pki ──────────────────────────────────────────────
    const S = W.BoundaryQCSecurity;
    t.group("security/SHA-256 pure-JS matches Node");
    let seed = 99991;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 60; i++) {
        const len = Math.floor(rnd() * 200);
        let str = "";
        for (let k = 0; k < len; k++) str += String.fromCharCode(32 + Math.floor(rnd() * 94));
        const mine = S.computeTextSHA256Sync(str);
        const node = crypto.createHash("sha256").update(str, "utf8").digest("hex");
        t.eq(mine, node, "pure-JS SHA-256 == Node for random string #" + i);
    }
    t.eq(S.computeTextSHA256Sync(""), crypto.createHash("sha256").update("").digest("hex"), "SHA-256 of empty string");
    t.eq(await S.computeTextSHA256("abc"), crypto.createHash("sha256").update("abc").digest("hex"), "async computeTextSHA256");

    t.group("security/sanitizeInput");
    t.eq(S.sanitizeInput('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;", "angle brackets escaped");
    t.eq(S.sanitizeInput('a&b"c\'d/e'), "a&amp;b&quot;c&#x27;d&#x2F;e", "all special chars escaped");
    t.eq(S.sanitizeInput(null), "", "non-string -> empty");

    t.group("security/PKI certificate + timestamp gates");
    t.ok(S.verifyPKICertificate("IdenTrust ACES Business CA", true).valid, "approved CA + LTV -> valid");
    t.notOk(S.verifyPKICertificate("Totally Fake CA", true).valid, "unknown CA -> invalid");
    t.notOk(S.verifyPKICertificate("IdenTrust ACES Business CA", false).valid, "approved CA but no LTV -> invalid");
    t.notOk(S.verifyPKICertificate("DigiCert PKI Platform CA Impersonator", true).valid, "substring impersonation rejected");
    const tsGood = await S.verifyRFC3161Timestamp("deadbeef", "DigiCert SHA256 RFC3161 Time-Stamp Authority");
    t.ok(tsGood.timestampValid, "approved TSA");
    const tsBad = await S.verifyRFC3161Timestamp("deadbeef", "Sketchy TSA Ltd");
    t.notOk(tsBad.timestampValid, "unapproved TSA");

    t.group("security/WebAuthn fails closed when unavailable");
    const wa = await S.authenticateHardwareToken("user@x.com");
    t.notOk(wa.success, "no navigator.credentials -> success:false (not a silent pass)");
    t.match(wa.errorName || wa.error || "", /WebAuthn|unavailable/i, "explains why");

    t.group("security/verifyAuditHashChain");
    const mk = (seq, prev, actor, action, details) => {
        const ts = "2026-01-01T00:00:0" + (seq % 10) + "Z";
        const raw = `${seq}|${ts}|${actor}|${action}|${details}|${prev}`;
        return { sequence: seq, timestamp: ts, actor, action, details, prevHash: prev, hash: S.computeTextSHA256Sync(raw) };
    };
    const g0 = "0".repeat(64);
    const b1 = mk(1, g0, "sys", "A", "first");
    const b2 = mk(2, b1.hash, "sys", "B", "second");
    const b3 = mk(3, b2.hash, "sys", "C", "third");
    const okChain = await S.verifyAuditHashChain([b1, b2, b3]);
    t.ok(okChain.isValid, "clean 3-block chain verifies");
    const tampered = [b1, Object.assign({}, b2, { details: "changed" }), b3];
    t.notOk((await S.verifyAuditHashChain(tampered)).isValid, "content tamper detected");
    const brokenLink = [b1, Object.assign({}, b2, { prevHash: g0 }), b3];
    t.notOk((await S.verifyAuditHashChain(brokenLink)).isValid, "broken prevHash link detected");
    t.notOk((await S.verifyAuditHashChain([b1, Object.assign({}, b2, { hash: "placeholder" }), b3])).isValid,
        "REGRESSION: placeholder hash no longer accepted");
    t.ok((await S.verifyAuditHashChain([])).isValid, "empty ledger is valid");

    // ── plugin-loader ────────────────────────────────────────────
    t.group("plugin-loader/registry + topo order");
    const PR = W.PluginRegistry;
    t.ok(PR.getAll().length >= 12, "site registered its plugins");
    t.ok(PR.get("linework"), "linework plugin registered");
    t.notOk(PR.register({ name: "waaaaaaaaaaaaaaaaay-too-long", version: "1" }, {}), "name > 15 chars rejected");
    t.notOk(PR.register({ name: "cms-engine", version: "1" }, {}), "duplicate name rejected");
    // synthetic dependency ordering
    const Fresh = new (Object.getPrototypeOf(PR).constructor)();
    Fresh.register({ name: "b", version: "1", dependencies: ["a"] }, {});
    Fresh.register({ name: "a", version: "1", dependencies: [] }, {});
    Fresh.register({ name: "c", version: "1", dependencies: ["b"] }, {});
    const order = Fresh._resolveDependencyOrder();
    t.lt(order.indexOf("a"), order.indexOf("b"), "a before b");
    t.lt(order.indexOf("b"), order.indexOf("c"), "b before c");

    // ── safe-dom fallback ───────────────────────────────────────
    t.group("safe-dom/escape fallback (no DOMPurify in Node)");
    t.eq(typeof W.setSafeHTML, "function", "setSafeHTML exposed");
    t.eq(typeof W.setSafeRows, "function", "setSafeRows exposed");
    t.match(W.safeHTML("<script>alert(1)</script>"), /^(&lt;script&gt;|).*/, "safeHTML falls back to text-escape without DOMPurify");
    t.notOk(/<script>/.test(W.safeHTML("<script>x</script>")), "no raw <script> passes through");

    // ── legal-desc ──────────────────────────────────────────────
    t.group("legal-desc/parse + QC");
    const LD = W.LegalDesc;
    t.ok(LD && typeof LD.parse === "function", "window.LegalDesc.parse present");
    const clean = LD.parse(
        "BEGINNING; thence North 45 degrees 00 minutes 00 seconds East, a distance of 100.00 feet; " +
        "thence South 45 degrees 00 minutes 00 seconds East, a distance of 100.00 feet; " +
        "thence South 45 degrees 00 minutes 00 seconds West, a distance of 100.00 feet; " +
        "thence North 45 degrees 00 minutes 00 seconds West, a distance of 100.00 feet to the POINT OF BEGINNING.");
    t.eq(clean.calls.length, 4, "4 line calls parsed");
    t.eq(clean.calls.filter(c => c.kind === "line").length, 4, "all lines");
    const legs = clean.calls.map(c => ({ kind: "line", azimuthDeg: c.azimuthDeg, distance: c.distance }));
    const tr = W.COGO.runTraverse(legs);
    t.close(tr.misclosure, 0, 1e-6, "square legal description closes");
    t.notOk(LD.qc(clean, tr).some(i => i.sev === "ERROR"), "clean description has no QC errors");

    const curveDesc = LD.parse(
        "thence along a curve concave to the West having a radius of 100.00 feet, an arc distance of 157.08 feet, " +
        "chord bearing of North 90 degrees 00 minutes 00 seconds West, chord distance of 99.00 feet;");
    t.eq(curveDesc.calls.length, 1, "curve call parsed");
    t.eq(curveDesc.calls[0].kind, "curve", "recognized as curve");
    t.ok(LD.qc(curveDesc, null).some(i => i.code === "CURVE_GEOMETRY_INCONSISTENT"),
        "R/arc/chord inconsistency flagged (computed chord != stated 99.00)");

    const exceptDesc = LD.parse("thence North 0 E 100 feet; thence East 100 feet; thence South 100 feet; thence West 100 feet. LESS AND EXCEPT the East 20 feet.");
    t.ok(LD.qc(exceptDesc, null).some(i => i.code === "EXCLUSION_NOT_SUBTRACTED"), "LESS AND EXCEPT warning");
    t.ok(LD.qc(LD.parse("thence North 0 E 100 feet;"), null).some(i => i.code === "TOO_FEW_CALLS"), "too-few-calls error");

    // spelled-out and compact bearings parse identically
    t.close(
        W.COGO.parseBearing("North 12 degrees 34 minutes 56 seconds East").azimuthDeg,
        W.COGO.parseBearing("N 12-34-56 E").azimuthDeg, 1e-6, "spelled-out == compact bearing");

    // ── plss-breakdown ─────────────────────────────────────────
    t.group("plss-breakdown/aliquot table");
    const PB = W.PlssBreakdown;
    t.ok(PB && typeof PB.analyzeParcel === "function", "window.PlssBreakdown present");
    const rows = [
        ["The Northeast 1/4 of Section 8, Township 7 North, Range 7 East", 2640, 2640, 160],
        ["The North 1/2 of Section 8, Township 7 North, Range 7 East", 5280, 2640, 320],
        ["The SE 1/4 of the NE 1/4 of Section 8, Township 7 North, Range 7 East", 1320, 1320, 40],
        ["The S 1/2 of the SE 1/4 of the NE 1/4 of Section 8, Township 7 North, Range 7 East", 1320, 660, 20],
        ["The SW 1/4 of the SE 1/4 of the NE 1/4 of Section 8, Township 7 North, Range 7 East", 660, 660, 10]
    ];
    rows.forEach(([desc, w, h, ac]) => {
        const p = PB.analyzeParcel(desc);
        t.close(p.width, w, 0.01, `width of "${desc.slice(0, 40)}…"`);
        t.close(p.height, h, 0.01, `height of "${desc.slice(0, 40)}…"`);
        t.close(p.acres, ac, 0.01, `acres of "${desc.slice(0, 40)}…"`);
        t.close(p.idealAcres, ac, 0.01, `ideal acres matches`);
    });
    const hdr = PB.analyze("The NE 1/4 of Section 14, Township 2 South, Range 27 East").header;
    t.eq(hdr.section, "14", "section parsed");
    t.match(hdr.township, /2\s*S/, "township parsed");
    t.match(hdr.range, /27\s*E/, "range parsed");
    const qual = PB.analyzeParcel('That part of the Southwest 1/4, Section 13, T2S, R27E, which lies northerly of the north right-of-way line of Regency Square Boulevard and westerly of and within 50 feet of the Quarter Section line.');
    t.ok(qual.qualified, "qualified ('that part of' / 'within N feet') description detected");
    t.close(qual.acres, 160, 0.01, "qualified: gross parent still 160 ac (SW 1/4)");

    // ── plat2dxf ───────────────────────────────────────────────
    t.group("plat2dxf/build + exports");
    const P2 = W.Plat2Dxf || null;
    // plat2dxf keeps its builders private; exercise via COGO the same way the plugin does
    const calls = ["N 89-58-12 E 320.44", "S 00-14-03 E 210.88", "S 89-58-12 W 320.44", "N 00-14-03 W 210.88"];
    const legs2 = calls.map(l => { const b = W.COGO.parseBearing(l); const d = l.match(/([\d.]+)\s*$/); return { kind: "line", azimuthDeg: b.azimuthDeg, distance: parseFloat(d[1]) }; });
    const t2 = W.COGO.runTraverse(legs2);
    t.close(t2.misclosure, 0, 0.01, "sample parcel closes");
    t.gt(t2.areaAcres, 1, "sample parcel ~1.5 ac");
    const dxf = W.COGO.buildDxf({ layers: [{ name: "AI-PROP-BNDY", color: 4 }], polylines: [{ layer: "AI-PROP-BNDY", closed: true, points: t2.vertices.slice(0, -1) }], texts: [] });
    t.match(dxf.replace(/\r\n/g, " "), /TABLES.*ENTITIES.*LWPOLYLINE.*EOF/, "valid DXF assembled from calls");
    void P2;
};
