"use strict";
/* Functional tests for marketing refinements: privacy diagnostics, submittal certificate, and live demo samples */
module.exports = async function (t, env) {
    const W = env.win;
    const SEC = W.BoundaryQCSecurity;
    const INSPECTOR = W.FDOTDXFInspector;
    const SAMPLES = W.__dxfSamples;

    t.group("marketing/privacyDiagnostics");
    t.ok(SEC && typeof SEC.getPrivacyDiagnostics === "function", "getPrivacyDiagnostics function exists");
    const diag = SEC.getPrivacyDiagnostics();
    t.ok(diag.clientSideExecution, "clientSideExecution is true");
    t.match(diag.networkEgress, /0 packets/i, "network egress is 0 packets in-memory");
    t.ok(diag.cspActive, "cspActive is true");
    t.ok(diag.cryptoEngine.length > 0, "crypto engine reported");

    t.group("marketing/submittalCertificate");
    t.ok(typeof SEC.generateSubmittalCertificate === "function", "generateSubmittalCertificate function exists");
    
    // Test 1: Full compliance certificate (PE)
    const certA = await SEC.generateSubmittalCertificate({
        filename: "FDOT_SR50_Corridor.dxf",
        content: "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF",
        score: 98,
        violationsCount: 0,
        layersCount: 16,
        entitiesCount: 142,
        standardName: "FDOT 2026 CADD State Kit Standard"
    }, {
        name: "Jane Doe, PE",
        license: "PE 12345",
        firm: "Kimley-Horn & Associates, Inc.",
        district: "District 7 (Tampa Bay)"
    });

    t.eq(certA.grade, "A+", "grade 98% is A+");
    t.eq(certA.statusText, "FULLY COMPLIANT", "status text is FULLY COMPLIANT");
    t.ok(certA.sha256 && certA.sha256.length === 64, "computed 64-char SHA-256 hash");
    t.match(certA.certId, /^FDOT-QC-/, "certId starts with FDOT-QC- prefix");
    t.match(certA.statNotice, /61G15-23\.004/, "PE statutory notice references 61G15-23.004");
    t.eq(certA.violationsCount, 0, "0 violations recorded");

    // Test 2: PSM Surveyor certificate
    const certPSM = await SEC.generateSubmittalCertificate({
        filename: "Boundary_Survey_Section12.dxf",
        content: "sample survey content",
        score: 75,
        violationsCount: 3
    }, {
        name: "John Surveyor, PSM",
        license: "LS 9999",
        role: "PSM_SURVEYOR"
    });

    t.eq(certPSM.grade, "C", "score 75% is grade C");
    t.match(certPSM.statNotice, /5J-17\.062/, "PSM statutory notice references 5J-17.062");

    t.group("marketing/liveDemoSamples");
    t.ok(SAMPLES, "__dxfSamples exposed globally");
    t.ok(SAMPLES.SR50_DXF && SAMPLES.SR50_DXF.length > 50, "SR-50 Roadway Corridor DXF sample present");
    t.ok(SAMPLES.NONCOMPLIANT_DXF && SAMPLES.NONCOMPLIANT_DXF.length > 50, "Non-compliant drainage DXF sample present");
    
    // Parse sample with inspector
    if (INSPECTOR && typeof INSPECTOR.parseDXF === "function") {
        const parsed = INSPECTOR.parseDXF(SAMPLES.SR50_DXF);
        t.ok(parsed.entities && parsed.entities.length > 0, "SR-50 sample parsed successfully with entities");
    }
};
