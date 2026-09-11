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
    t.ok(PR.get("help"), "help plugin registered");
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

    t.group("legal-desc/buildSurveyScript — Civil 3D batch & FBK script export");
    t.ok(typeof LD.buildSurveyScript === "function", "buildSurveyScript function exposed");
    const scriptText = LD.buildSurveyScript(clean, tr);
    t.match(scriptText, /^START_BATCH/m, "contains START_BATCH directive");
    t.match(scriptText, /^UNIT FOOT DMS/m, "contains UNIT FOOT DMS directive");
    t.match(scriptText, /^NEZ 1000 /m, "contains NEZ line for POB coordinate");
    t.match(scriptText, /^FIG BEGIN LEGAL_BOUNDARY/m, "contains FIG BEGIN");
    t.match(scriptText, /^FIG CLOSE/m, "contains FIG CLOSE");
    t.match(scriptText, /^FIG END/m, "contains FIG END");
    t.match(scriptText, /^STN 1000 /m, "contains STN setup for observation traverse");
    t.match(scriptText, /^BD 1001 1 45\.0000 100\.00/m, "contains BD course 1");
    t.match(scriptText, /^END_BATCH/m, "contains END_BATCH directive");
    t.eq((scriptText.match(/^NEZ /gm) || []).length, 4, "closed 4-corner square plants all 4 real corners");
    t.eq((scriptText.match(/^FIG PT /gm) || []).length, 4, "…and references all 4 in FIG PT");

    // REGRESSION: an open (non-closing) description must keep its real final
    // corner (not drop it as a duplicate of the POB) and must NOT emit
    // FIG CLOSE — COGO.runTraverse always returns a final vertex, and
    // buildSurveyScript used to assume it was always a duplicate of the POB.
    const openDesc = LD.parse(
        "BEGINNING; thence North 45 degrees 00 minutes 00 seconds East, a distance of 100.00 feet; " +
        "thence South 45 degrees 00 minutes 00 seconds East, a distance of 100.00 feet; " +
        "thence South 45 degrees 00 minutes 00 seconds West, a distance of 50.00 feet;");
    const openLegs = openDesc.calls.map(c => ({ kind: "line", azimuthDeg: c.azimuthDeg, distance: c.distance }));
    const openTr = W.COGO.runTraverse(openLegs);
    t.notOk(openTr.closes, "sanity: this description genuinely does not close");
    const openScript = LD.buildSurveyScript(openDesc, openTr);
    t.eq((openScript.match(/^NEZ /gm) || []).length, 4, "open description: all 4 real stations planted (POB + 3 courses), none dropped");
    t.eq((openScript.match(/^FIG PT /gm) || []).length, 4, "…and all 4 referenced in FIG PT");
    t.notOk(/^FIG CLOSE/m.test(openScript), "open description does NOT emit FIG CLOSE");
    t.match(openScript, /^FIG END/m, "…but still emits FIG END");

    // REGRESSION: a bearing whose seconds round to 60 must carry into
    // minutes in the generated DD.MMSS code, never print as an invalid ":60".
    const rolloverDesc = LD.parse(
        "thence North 45 degrees 12 minutes 59.6 seconds East, a distance of 150.00 feet; " +
        "thence South 44 degrees 47 minutes 30 seconds East, a distance of 200.00 feet; " +
        "thence South 45 degrees 12 minutes 30 seconds West, a distance of 150.00 feet; " +
        "thence North 44 degrees 47 minutes 30 seconds West, a distance of 200.00 feet;");
    const rolloverScript = LD.buildSurveyScript(rolloverDesc, null);
    t.notOk(/\.\d{2}60\b/.test(rolloverScript), "no invalid :60 seconds in the DD.MMSS code");
    t.match(rolloverScript, /BD 1001 1 45\.1300 150\.00/m, "59.6\" correctly carries to 13 minutes, 0 seconds");

    t.group("traverse-cogo/buildTraverseScript — Civil 3D batch & FBK script export");
    const TC = W.TraverseCogo;
    t.ok(TC && typeof TC.buildTraverseScript === "function", "TraverseCogo.buildTraverseScript exposed");
    const travInput = "N 45-00-00 E 100.00\nS 45-00-00 E 100.00\nS 45-00-00 W 100.00\nN 45-00-00 W 100.00";
    const travParsed = TC.parseCourses(travInput);
    const travClosure = TC.computeClosure(travParsed.courses, 10000);
    const travScript = TC.buildTraverseScript(travClosure);
    t.match(travScript, /^START_BATCH/m, "traverse script has START_BATCH");
    t.match(travScript, /^NEZ 500 /m, "traverse script has NEZ 500 POB");
    t.match(travScript, /^FIG BEGIN TRAVERSE_BOUNDARY/m, "traverse script has FIG BEGIN");
    t.match(travScript, /^BD 501 1 45\.0000 100\.00/m, "traverse script has BD course 1");
    // REGRESSION: INV must reference the point reached AFTER the last course
    // (500 + courses.length = 504 for 4 courses) — 503 is the second-to-last
    // corner, which isn't near the POB even for a perfectly closing square,
    // so "INV 500 503" would misreport an ordinary course length as the
    // misclosure. Also verify the actual closed square exports its true
    // 4-corner vertex list, not 3 (a duplicate-trim bug — computeClosure
    // already trims the duplicate-of-POB point; the script builder was
    // trimming it a second time and dropping a real corner).
    t.match(travScript, /^INV 500 504/m, "traverse script's INV line references the point AFTER all 4 courses, not the 3rd corner");
    t.eq((travScript.match(/^NEZ /gm) || []).length, 4, "closed 4-corner square plants all 4 real corners (not 3)");
    t.eq((travScript.match(/^FIG PT /gm) || []).length, 4, "…and references all 4 in FIG PT, not 3");
    t.match(travScript, /^FIG CLOSE/m, "…closed traverse still emits FIG CLOSE");
    t.match(travScript, /^END_BATCH/m, "traverse script has END_BATCH");

    // REGRESSION: an OPEN (non-closing) traverse must keep its real final
    // station (not drop it as if it were a duplicate of the POB) and must
    // NOT emit FIG CLOSE (that would draw a segment back to the POB that
    // was never actually surveyed).
    const openTravInput = "N 45-00-00 E 100.00\nS 45-00-00 E 100.00\nS 45-00-00 W 50.00";
    const openTravParsed = TC.parseCourses(openTravInput);
    const openTravClosure = TC.computeClosure(openTravParsed.courses, 10000);
    t.notOk(openTravClosure.closes, "sanity: this traverse genuinely does not close");
    const openTravScript = TC.buildTraverseScript(openTravClosure);
    t.eq((openTravScript.match(/^NEZ /gm) || []).length, 4, "open traverse: all 4 real stations planted (POB + 3 courses), none dropped");
    t.eq((openTravScript.match(/^FIG PT /gm) || []).length, 4, "…and all 4 referenced in FIG PT");
    t.notOk(/^FIG CLOSE/m.test(openTravScript), "open traverse does NOT emit FIG CLOSE");
    t.match(openTravScript, /^INV 500 503/m, "open traverse's INV still points at the true final station (500 + 3 courses)");

    // REGRESSION: same :60 rollover check, via a course whose seconds round to 60.
    const rolloverTravInput = "N 45-12-59.6 E 100.00\nS 45-00-00 E 100.00\nS 45-00-00 W 100.00\nN 45-00-00 W 100.00";
    const rolloverTravParsed = TC.parseCourses(rolloverTravInput);
    const rolloverTravClosure = TC.computeClosure(rolloverTravParsed.courses, 10000);
    const rolloverTravScript = TC.buildTraverseScript(rolloverTravClosure);
    t.notOk(/\.\d{2}60\b/.test(rolloverTravScript), "traverse script: no invalid :60 seconds in the DD.MMSS code");
    t.match(rolloverTravScript, /BD 501 1 45\.1300 100\.00/m, "…59.6\" correctly carries to 13 minutes, 0 seconds");

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

    // ── traverse-cogo (now delegates geometry to window.COGO) ───
    t.group("traverse-cogo/closure + bow-tie via COGO");
    const TCG = W.TraverseCogo;
    t.ok(TCG && typeof TCG.parseCourses === "function" && typeof TCG.computeClosure === "function",
        "window.TraverseCogo exposed");

    const sqIn = "N 00-00-00 E 100\nS 90-00-00 E 100\nS 00-00-00 E 100\nN 90-00-00 W 100";
    const sq = TCG.parseCourses(sqIn);
    t.eq(sq.courses.length, 4, "4 courses parsed");
    t.eq(sq.skipped.length, 0, "nothing skipped");
    const sqC = TCG.computeClosure(sq.courses, 10000);
    t.close(sqC.linearMisclosure, 0, 1e-6, "unit square closes");
    t.eq(sqC.precisionDenominator, Infinity, "exact precision");
    t.ok(sqC.passes, "closure passes the 1:10,000 gate");
    t.close(sqC.areaAcres * W.COGO.SQFT_PER_ACRE, 10000, 1e-3, "Shoelace area = 100 x 100");
    t.notOk(sqC.bowtie, "square is not self-intersecting");
    t.eq(sqC.verts.length, 4, "walked to 4 polygon corners");
    t.ok("e" in sqC.verts[0] && "n" in sqC.verts[0], "verts are {e,n} (COGO convention)");

    // spelled-out bearings + a junk line the old regex would have silently dropped
    const mix = TCG.parseCourses(
        "North 45 degrees East 141.42\n-- not a course --\nSouth 45 degrees East 141.42\n" +
        "South 45 degrees West 141.42\nNorth 45 degrees West 141.42");
    t.eq(mix.courses.length, 4, "spelled-out bearings parse via COGO.parseBearing");
    t.eq(mix.skipped.length, 1, "the junk line is reported, not swallowed");
    t.eq(mix.skipped[0].line, 2, "skipped line number recorded");

    // mis-ordered square -> bow-tie: corners (0,0)->(10,10)->(10,0)->(0,10)
    const bt = TCG.parseCourses("N 45-00-00 E 14.1421\nS 00-00-00 E 10\nN 45-00-00 W 14.1421\nS 00-00-00 E 10");
    const btC = TCG.computeClosure(bt.courses, 10000);
    t.ok(btC.bowtie, "mis-ordered square is flagged as a bow-tie");
    t.ok(btC.bowtie.i && btC.bowtie.j, "bow-tie names the two crossing courses");

    // matches a hand-computed lat/dep closure and the pass gate is configurable
    const openTrav = TCG.parseCourses("N 00-00-00 E 100\nN 90-00-00 E 100");
    const openC = TCG.computeClosure(openTrav.courses, 10000);
    t.close(openC.linearMisclosure, Math.hypot(100, 100), 1e-6, "open traverse misclosure = gap to POB");
    t.notOk(openC.passes, "open traverse fails the closure gate");
    t.eq(TCG.computeClosure(openTrav.courses, 1).passes, true, "a looser threshold lets it pass");
    t.eq(openC.verts.length, 3, "open traverse retains all 3 stations without truncation");
    t.eq(openC.areaSqFt, 0, "open traverse area is 0 (not a closed polygon)");
};
