"use strict";
/**
 * Test suite: BatchProcess Multi-Sheet Project Auditor
 */
module.exports = async function (t, { win }) {
    const BatchProcess = win.BatchProcess;

    t.group("batchprocess/api presence");
    t.ok(!!BatchProcess, "BatchProcess module exists on window");
    t.eq(typeof BatchProcess.auditSingleFile, "function", "auditSingleFile is a function");
    t.eq(typeof BatchProcess.auditBatch, "function", "auditBatch is a function");
    t.eq(typeof BatchProcess.generateBatchFixScript, "function", "generateBatchFixScript is a function");
    t.eq(typeof BatchProcess.generateMasterReport, "function", "generateMasterReport is a function");
    t.eq(typeof BatchProcess.getDemoProjectBatch, "function", "getDemoProjectBatch is a function");

    t.group("batchprocess/auditSingleFile DXF");
    const cleanDxf = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nROAD_PAVE_ASPH\n62\n7\n70\n0\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nROAD_PAVE_ASPH\n10\n100000.0\n20\n500000.0\n11\n100500.0\n21\n500000.0\n0\nENDSEC\n0\nEOF\n`;
    const resClean = BatchProcess.auditSingleFile("Roadway_Sheet1.dxf", cleanDxf);
    t.eq(resClean.status, "PASS", "clean DXF passes audit");
    t.ok(resClean.score >= 85, "clean DXF score >= 85");
    t.eq(resClean.type, "DXF", "type is DXF");

    const bowtieDxf = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nSURV_BND_PROP\n62\n1\n70\n0\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nSURV_BND_PROP\n90\n4\n70\n1\n10\n100000.0\n20\n500000.0\n10\n100400.0\n20\n500400.0\n10\n100000.0\n20\n500400.0\n10\n100400.0\n20\n500000.0\n0\nENDSEC\n0\nEOF\n`;
    const resBowtie = BatchProcess.auditSingleFile("Survey_Bowtie.dxf", bowtieDxf);
    t.eq(resBowtie.status, "FAIL", "bowtie DXF fails audit");
    t.ok(resBowtie.counts.critical >= 1, "bowtie DXF has critical issue");

    t.group("batchprocess/auditBatch project suite");
    const demoBatch = BatchProcess.getDemoProjectBatch();
    t.eq(demoBatch.length, 4, "demo batch has 4 sheets");

    const batchRes = BatchProcess.auditBatch(demoBatch);
    t.eq(batchRes.summary.totalFiles, 4, "batch processed 4 files");
    t.ok(batchRes.summary.passed >= 1, "at least 1 sheet passed");
    t.ok(batchRes.summary.failed >= 1, "at least 1 sheet failed");
    t.ok(batchRes.summary.criticalIssues >= 1, "critical issues detected in project");
    t.eq(batchRes.summary.verdict, "SUBMITTAL_BLOCKED", "overall submittal verdict blocked by critical failure");

    t.group("batchprocess/generateBatchFixScript");
    const scr = BatchProcess.generateBatchFixScript(batchRes);
    t.ok(scr.includes("FILEDIA 0"), "script disables file dialogs");
    t.ok(scr.includes("_AUDIT _Y"), "script runs AUDIT");
    t.ok(scr.includes("-PURGE _A * _N"), "script purges all");
    t.ok(scr.includes("_OVERKILL"), "script runs OVERKILL");
    t.ok(scr.includes("_QSAVE"), "script saves drawing");

    t.group("batchprocess/generateMasterReport");
    const md = BatchProcess.generateMasterReport(batchRes, "markdown");
    t.ok(md.includes("Master Submittal QA/QC Scorecard"), "markdown contains scorecard header");
    t.ok(md.includes("SR50_Sheet01_Roadway_Plan.dxf"), "markdown lists sheet 1");
    t.ok(md.includes("Critical Blockers"), "markdown reports critical blockers");

    const html = BatchProcess.generateMasterReport(batchRes, "html");
    t.ok(html.includes("<!DOCTYPE html>"), "html report has valid DOCTYPE");
    t.ok(html.includes("SR50_Sheet01_Roadway_Plan.dxf"), "html report lists sheet 1");
    t.ok(html.includes("kpi-card"), "html report includes KPI summary cards");
};
