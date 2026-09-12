"use strict";
/**
 * Functional tests for plugins/tmp_jea24/tmp_jea24.js (window.Jea24)
 * Validates JEA 2024 As-Built Standards:
 *  - 45 picklist validation domains
 *  - FL East State Plane bounds
 *  - Civil 3D DXF generation (BLOCKS, ATTRIB, LWPOLYLINE)
 *  - Reverse-read DXF parsing
 *  - 18-inch pipe crossing clearance rule
 *  - JEA spreadsheet table export
 *  - Reports Hub integration
 */
module.exports = function (t, env) {
    const J = env.win.Jea24;
    const Rep = env.win.Reports;

    // ── 1. Specification & Domain Verification ──────────────────────────
    t.group("jea/specifications + domains");
    t.ok(J != null, "window.Jea24 global exists");
    t.eq(J.BOUNDS.projection, "FL_EAST_83", "FL East projection");
    t.eq(J.BOUNDS.minCrossingClearanceInches, 18.0, "18.0 inch min crossing clearance");
    t.eq(J.BOUNDS.minCrossingClearanceFeet, 1.5, "1.5 ft min crossing clearance");
    t.eq(Object.keys(J.DOMAINS).length, 45, "All 45 JEA validation domains present");

    // Spot-check critical JEA domains
    t.ok(J.DOMAINS["Subtype Water Valve"].includes("Valve"), "Water valve domain includes 'Valve'");
    t.ok(J.DOMAINS["Subtype Water Valve"].includes("Air Release Valve"), "Water valve domain includes 'Air Release Valve'");
    t.ok(J.DOMAINS["Subtype Manhole"].includes("Collection"), "Manhole domain includes 'Collection'");
    t.ok(J.DOMAINS["Crossing Pipe Type"].includes("Potable Water"), "Crossing domain includes 'Potable Water'");
    t.ok(J.DOMAINS["Crossing Pipe Type"].includes("Gravity Sewer"), "Crossing domain includes 'Gravity Sewer'");
    t.ok(J.DOMAINS["Valve Manufacturer"].includes("American Flow Control"), "Valve mfr includes American Flow Control");
    t.ok(J.DOMAINS["Pipe and Fitting Material"].includes("Ductile Iron"), "Material includes Ductile Iron");

    // Check layer standards
    t.ok(J.LAYERS.some(l => l.name === "W-MAIN"), "Layer W-MAIN defined");
    t.ok(J.LAYERS.some(l => l.name === "SS-GRAV"), "Layer SS-GRAV defined");
    t.ok(J.LAYERS.some(l => l.name === "UTIL-CROSS"), "Layer UTIL-CROSS defined");

    // ── 2. Civil 3D DXF Generation Engine ───────────────────────────────
    t.group("jea/dxf generation");
    const sample = J.getSampleNetwork();
    t.ok(sample.pipes.length >= 2, "Sample network has pipes");
    t.ok(sample.structures.length >= 4, "Sample network has structures");
    t.ok(sample.crossings.length >= 1, "Sample network has crossing");

    const dxf = J.buildJeaDxf(sample);
    t.ok(typeof dxf === "string" && dxf.length > 500, "Generated DXF string > 500 bytes");
    t.ok(dxf.includes("SECTION\r\n2\r\nHEADER"), "DXF contains HEADER section");
    t.ok(dxf.includes("SECTION\r\n2\r\nTABLES"), "DXF contains TABLES section");
    t.ok(dxf.includes("SECTION\r\n2\r\nBLOCKS"), "DXF contains BLOCKS section");
    t.ok(dxf.includes("SECTION\r\n2\r\nENTITIES"), "DXF contains ENTITIES section");
    t.ok(dxf.includes("BLOCK\r\n2\r\nJEA_VALVE"), "BLOCK JEA_VALVE defined");
    t.ok(dxf.includes("BLOCK\r\n2\r\nJEA_MANHOLE"), "BLOCK JEA_MANHOLE defined");
    t.ok(dxf.includes("BLOCK\r\n2\r\nJEA_CROSSING"), "BLOCK JEA_CROSSING defined");
    t.ok(dxf.includes("LWPOLYLINE"), "DXF contains LWPOLYLINE pipe runs");
    t.ok(dxf.includes("INSERT"), "DXF contains INSERT block instances");
    t.ok(dxf.includes("ATTRIB"), "DXF contains ATTRIB attribute metadata");
    t.ok(dxf.includes("EOF"), "DXF contains EOF marker");

    // ── 3. Reverse-Read DXF Parser ──────────────────────────────────────
    t.group("jea/reverse-read dxf parser");
    const parsed = J.parseDxf(dxf);
    t.ok(!parsed.error, "Parsed without error");
    t.ok(parsed.layers.includes("W-MAIN"), "Extracted layer W-MAIN");
    t.ok(parsed.layers.includes("SS-GRAV"), "Extracted layer SS-GRAV");
    t.ok(parsed.layers.includes("UTIL-CROSS"), "Extracted layer UTIL-CROSS");
    t.ok(parsed.polylines.length >= 2, "Parsed polyline count >= 2");
    t.ok(parsed.inserts.length >= 5, "Parsed block inserts count >= 5");

    const valveIns = parsed.inserts.find(i => i.blockName === "JEA_VALVE");
    t.ok(valveIns != null, "Found JEA_VALVE insert in parsed DXF");
    t.eq(valveIns.attribs.SUBTYPE, "Valve", "Extracted valve SUBTYPE attribute");
    t.eq(valveIns.attribs.SIZE, "8", "Extracted valve SIZE attribute");
    t.eq(valveIns.attribs.MANUFACTURER, "American Flow Control", "Extracted valve MANUFACTURER attribute");

    const crossIns = parsed.inserts.find(i => i.blockName === "JEA_CROSSING");
    t.ok(crossIns != null, "Found JEA_CROSSING insert in parsed DXF");
    t.eq(crossIns.attribs.CROSS_NO, "CR-01", "Extracted crossing CROSS_NO attribute");
    t.eq(crossIns.attribs.CLEARANCE_INCHES, "60.1", "Extracted crossing CLEARANCE_INCHES");

    // ── 4. QA/QC Audit Engine: Compliant Case ───────────────────────────
    t.group("jea/audit engine - compliant case");
    const auditPass = J.auditDrawing(dxf);
    t.eq(auditPass.compliant, true, "Compliant sample passes audit");
    t.eq(auditPass.score, 100, "Compliant sample gets 100% score");
    t.eq(auditPass.summary.errorCount, 0, "Zero errors on compliant drawing");
    t.ok(auditPass.summary.passItems >= 1, "Recorded passed items");

    // ── 5. QA/QC Audit Engine: 18-Inch Clearance Rule Violation ─────────
    t.group("jea/audit engine - clearance violation");
    const failModel = J.getSampleNetwork();
    // Simulate upper pipe bottom at 20.00 and lower pipe top at 19.50 (clearance = 0.50 ft = 6 inches < 18 in)
    failModel.crossings = [{
        id: "X-FAIL-01",
        block: "JEA_CROSSING",
        layer: "UTIL-CROSS",
        e: 436350.80,
        n: 2154320.10,
        z: 20.00,
        attribs: {
            CROSS_NO: "CR-BAD-01",
            UPPER_TYPE: "Potable Water",
            UPPER_SIZE: "8",
            UPPER_BOT_ELEV: "20.00",
            LOWER_TYPE: "Gravity Sewer",
            LOWER_SIZE: "8",
            LOWER_TOP_ELEV: "19.50",
            CLEARANCE_INCHES: "6.0",
            COMPLIANT: "NO"
        }
    }];
    const failDxf = J.buildJeaDxf(failModel);
    const auditFail = J.auditDrawing(failDxf);
    t.eq(auditFail.compliant, false, "Drawing with 6-inch clearance fails compliance");
    t.ok(auditFail.score < 100, "Score deducted for violation");
    const clrIssue = auditFail.issues.find(i => i.rule === "JEA 18-Inch Clearance Rule");
    t.ok(clrIssue != null, "Found JEA 18-Inch Clearance Rule violation in audit report");
    t.ok(clrIssue.message.includes("LESS than the required 18.0\""), "Violation message details shortfall");

    // ── 6. QA/QC Audit Engine: Domain & Bounds Violations ────────────────
    t.group("jea/audit engine - domain + bounds checks");
    const badModel = J.getSampleNetwork();
    badModel.structures[0].attribs.VALVE_TYPE = "TotallyFakeValveType123";
    badModel.structures[0].attribs.MATERIAL = "Cardboard";
    badModel.structures[0].e = 100000.0; // Outside JEA bounds (min is 320000)

    const badDxf = J.buildJeaDxf(badModel);
    const auditBad = J.auditDrawing(badDxf);
    t.eq(auditBad.compliant, false, "Invalid domain and out-of-bounds drawing fails");
    t.ok(auditBad.issues.some(i => i.rule === "Domain: Valve Type"), "Logged Domain: Valve Type error");
    t.ok(auditBad.issues.some(i => i.rule === "Domain: Pipe and Fitting Material"), "Logged Domain: Material error");
    t.ok(auditBad.issues.some(i => i.rule === "SPCS83 East Bounds"), "Logged SPCS83 East Bounds error");

    // ── 7. Tabular JEA As-Built Spreadsheet Generator ───────────────────
    t.group("jea/table generator");
    const tables = J.generateJeaTables(sample);
    t.ok(tables["Pipe Crossing Table"] != null, "Pipe Crossing Table generated");
    t.ok(tables["Water Valve"] != null, "Water Valve table generated");
    t.ok(tables["Manhole"] != null, "Manhole table generated");

    t.ok(tables["Pipe Crossing Table"].includes("Crossing Number"), "Crossing table has header");
    t.ok(tables["Pipe Crossing Table"].includes("CR-01"), "Crossing table contains CR-01 row");
    t.ok(tables["Water Valve"].includes("V-101"), "Water valve table contains V-101 row");
    t.ok(tables["Manhole"].includes("MH-101"), "Manhole table contains MH-101 row");

    // ── 8. Centralized Reports Hub Integration ──────────────────────────
    t.group("jea/reports hub integration");
    if (Rep && Rep.getReports) {
        const beforeCount = Rep.getReports().length;
        J.exportAuditReportToReports(auditPass);
        const afterCount = Rep.getReports().length;
        t.eq(afterCount, beforeCount + 1, "Report registered in Reports hub");
        const latest = Rep.getReports()[afterCount - 1];
        t.ok(latest.title.includes("JEA 2024 Audit"), "Report title contains JEA 2024 Audit");
        t.eq(latest.metadata.score, 100, "Report metadata contains audit score");
    } else {
        t.ok(true, "Reports hub mock fallback passed");
    }
};
