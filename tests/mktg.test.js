"use strict";
/* Functional tests for: honest privacy diagnostics, the CADD self-check summary
   (NOT an official F.A.C. certificate), and the bundled demo samples. */
module.exports = async function (t, env) {
    const W = env.win;
    const SEC = W.BoundaryQCSecurity;
    const INSPECTOR = W.FDOTDXFInspector;
    const SAMPLES = W.__dxfSamples;

    t.group("marketing/privacyDiagnostics — accurate, not marketed");
    t.ok(SEC && typeof SEC.getPrivacyDiagnostics === "function", "getPrivacyDiagnostics exists");
    const diag = SEC.getPrivacyDiagnostics();
    t.ok(diag.clientSideExecution, "clientSideExecution is true");
    t.ok(diag.cspActive, "cspActive is true");
    t.ok(diag.cryptoEngine && diag.cryptoEngine.length > 0, "crypto engine reported");
    t.match(diag.drawingProcessing, /in-page|browser tab/i, "says drawings are processed in-page, not uploaded");
    t.match(diag.appNetworkAccess, /connect-src 'self'|cross-origin/i, "credits the real control (CSP connect-src 'self')");
    // The key fix: it must NOT claim to be air-gapped / zero external requests,
    // because the page loads DOMPurify / Font Awesome / fonts from CDNs.
    t.ok(Array.isArray(diag.staticAssetHosts) && diag.staticAssetHosts.length >= 2, "discloses the CDN static-asset hosts");
    t.match(diag.staticAssetHosts.join(" "), /cdnjs\.cloudflare\.com/, "…including cdnjs");
    t.match(diag.staticAssetHosts.join(" "), /fonts\.(googleapis|gstatic)\.com/, "…and Google Fonts");
    const blob = JSON.stringify(diag);
    t.notOk(/air-?gapped/i.test(blob), "REGRESSION: no 'air-gapped' claim");
    t.notOk(/0 packets|zero external|zero analytics|no external requests/i.test(blob), "REGRESSION: no 'zero external requests' claim");
    t.match(diag.analytics, /none/i, "no analytics/tracking (this part is true and stays)");

    t.group("marketing/self-check summary — unofficial, no invented licensee");
    t.ok(typeof SEC.generateSubmittalCertificate === "function", "generator exists");

    const sumA = await SEC.generateSubmittalCertificate({
        filename: "FDOT_SR50_Corridor.dxf",
        content: "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF",
        score: 98, violationsCount: 0, layersCount: 16, entitiesCount: 142,
        standardName: "FDOT 2026 CADD State Kit Standard"
    }, { name: "Jane Doe, PE", license: "PE 12345", firm: "Kimley-Horn & Associates, Inc." });

    t.eq(sumA.grade, "A+", "98% → A+");
    t.eq(sumA.statusText, "PASSES ALL CHECKS", "status is a plain check verdict, not 'FULLY COMPLIANT'");
    t.ok(sumA.sha256 && sumA.sha256.length === 64, "64-char SHA-256 of the drawing text");
    t.match(sumA.summaryId, /^SELFCHK-/, "id is SELFCHK-, not FDOT-QC-");
    t.eq(sumA.violationsCount, 0, "0 issues recorded");
    t.match(sumA.disclaimer, /not an FDOT submittal/i, "carries an explicit 'not an FDOT submittal' disclaimer");
    t.match(sumA.disclaimer, /unverified|demo rules/i, "…and names the unverified demo ruleset");
    // caller-supplied signatory is passed through verbatim
    t.eq(sumA.signerName, "Jane Doe, PE", "caller's signatory name passed through");

    const sumBlob = JSON.stringify(sumA);
    t.notOk(/statutory seal|61G15-23\.004|5J-17\.062|STATE OF FLORIDA/i.test(sumBlob),
        "REGRESSION: no statutory-seal notice / F.A.C. rule / DOT letterhead in the payload");

    // no signatory supplied → fields blank, nothing invented
    const sumBlank = await SEC.generateSubmittalCertificate({ filename: "x.dxf", content: "sample", score: 72 });
    t.eq(sumBlank.grade, "C", "72% → C");
    t.eq(sumBlank.signerName, "", "REGRESSION: no default 'Jane Doe, PE' when no signatory is given");
    t.eq(sumBlank.signerFirm, "", "REGRESSION: no default firm invented");

    t.group("marketing/demo samples");
    t.ok(SAMPLES, "__dxfSamples exposed globally");
    t.ok(SAMPLES.SR50_DXF && SAMPLES.SR50_DXF.length > 50, "SR-50 sample present");
    t.ok(SAMPLES.NONCOMPLIANT_DXF && SAMPLES.NONCOMPLIANT_DXF.length > 50, "non-compliant drainage sample present");
    if (INSPECTOR && typeof INSPECTOR.parseDXF === "function") {
        const parsed = INSPECTOR.parseDXF(SAMPLES.SR50_DXF);
        t.ok(parsed.entities && parsed.entities.length > 0, "SR-50 sample parses with entities");
    }
};
