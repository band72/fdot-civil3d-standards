"use strict";
/**
 * Test suite: Centralized Reports Hub & Submittal Standards Unification
 */
module.exports = async function (t, { win }) {
    const Reports = win.Reports;

    t.group("reports/api presence");
    t.ok(!!Reports, "Reports module exists on window");
    t.eq(typeof Reports.addReport, "function", "addReport is a function");
    t.eq(typeof Reports.getReports, "function", "getReports is a function");
    t.eq(typeof Reports.getReport, "function", "getReport is a function");
    t.eq(typeof Reports.deleteReport, "function", "deleteReport is a function");
    t.eq(typeof Reports.clearAll, "function", "clearAll is a function");
    t.eq(typeof Reports.exportReport, "function", "exportReport is a function");
    t.eq(typeof Reports.downloadBundle, "function", "downloadBundle is a function");
    t.eq(typeof Reports.formatUnifiedHeader, "function", "formatUnifiedHeader is a function");

    t.group("reports/formatUnifiedHeader");
    const header = Reports.formatUnifiedHeader({
        title: "SR-50 R-O-W Survey Verification",
        project: "State Road 50 Widening",
        fpid: "432101-1-52-01",
        district: "District 5",
        county: "Orange",
        surveyor: "John Doe, PSM #1234"
    });
    t.ok(header.includes("STATE OF FLORIDA DEPARTMENT OF TRANSPORTATION"), "header includes state agency");
    t.ok(header.includes("432101-1-52-01"), "header includes FPID");
    t.ok(header.includes("District 5"), "header includes District");
    t.ok(header.includes("Rule 5J-17"), "header includes Florida PSM certification rule");
    t.ok(header.includes("John Doe, PSM #1234"), "header includes evaluator name");

    t.group("reports/add & query");
    Reports.clearAll();
    t.eq(Reports.getReports().length, 0, "store cleared initially");

    const r1 = Reports.addReport({
        id: "rep_traverse_01",
        title: "Traverse Closure Map Check Report",
        type: "traverse-mapcheck",
        category: "cogo",
        format: "log",
        filename: "traverse_mapcheck.log",
        content: "Linear misclosure: 0.012 ft. Precision: 1:125,000",
        metadata: { project: "SR50" }
    });
    t.eq(r1.id, "rep_traverse_01", "report added with id");
    t.eq(Reports.getReports().length, 1, "1 report in store");

    const r2 = Reports.addReport({
        id: "rep_dxf_01",
        title: "DXF Drawing Audit - Roadway Plan",
        type: "dxf-audit",
        category: "dxf",
        format: "log",
        filename: "roadway_audit.log",
        content: "Compliance score: 95%. Layers: 18. Entities: 142.",
        metadata: { project: "SR50" }
    });

    const r3 = Reports.addReport({
        id: "rep_batch_01",
        title: "Master Submittal QA/QC Scorecard",
        type: "batch-submittal",
        category: "dxf",
        format: "html",
        filename: "fdot_master_submittal_report.html",
        content: "<html><body>Scorecard: 4 sheets</body></html>",
        metadata: { project: "Corridor Project" }
    });

    t.eq(Reports.getReports().length, 3, "3 total reports in store");

    t.group("reports/filtering");
    const cogoReps = Reports.getReports({ category: "cogo" });
    t.eq(cogoReps.length, 1, "1 cogo report filtered");
    t.eq(cogoReps[0].id, "rep_traverse_01", "cogo report id matches");

    const dxfReps = Reports.getReports({ category: "dxf" });
    t.eq(dxfReps.length, 2, "2 dxf reports filtered");

    const searched = Reports.getReports({ query: "scorecard" });
    t.eq(searched.length, 1, "search query matched 1 report");
    t.eq(searched[0].id, "rep_batch_01", "search returned correct scorecard");

    t.group("reports/retrieval & deletion");
    const retrieved = Reports.getReport("rep_dxf_01");
    t.ok(!!retrieved, "report retrieved by id");
    t.eq(retrieved.format, "log", "retrieved format is log");
    t.ok(retrieved.content.includes("95%"), "retrieved content matches");

    const deleted = Reports.deleteReport("rep_traverse_01");
    t.eq(deleted, true, "report deleted successfully");
    t.eq(Reports.getReports().length, 2, "2 reports remain after deletion");
    t.eq(Reports.getReport("rep_traverse_01"), null, "deleted report returns null");

    t.group("reports/clearAll");
    Reports.clearAll();
    t.eq(Reports.getReports().length, 0, "all reports cleared");
};
