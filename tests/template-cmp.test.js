"use strict";
/* Functional tests for plugins/template-cmp/template-cmp.js (window.TemplateCmp) */
module.exports = function (t, env) {
    const W = env.win;
    const TC = W.TemplateCmp;
    const insp = new W.FDOTDXFInspector(W.FDOT_DATA);

    const HEAD = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1032", "0", "ENDSEC"];
    const tbl = layers => ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layers.length)]
        .concat(layers.flatMap(l => {
            const r = ["0", "LAYER", "2", l.name, "70", "0", "62", String(l.color != null ? l.color : 7), "6", l.lt || "CONTINUOUS"];
            if (l.lw != null) r.push("370", String(l.lw));
            return r;
        }))
        .concat(["0", "ENDTAB", "0", "ENDSEC"]);
    const ent = pairs => ["0", "SECTION", "2", "ENTITIES"].concat(pairs).concat(["0", "ENDSEC"]);
    const dxf = (layers, entPairs) => HEAD.concat(tbl(layers), ent(entPairs || []), ["0", "EOF"]).join("\n");

    const TEMPLATE = dxf([
        { name: "SURV_BND_PR", color: 1, lt: "PHANTOM", lw: 70 },
        { name: "ROAD_EOP_PR", color: 7, lt: "CONTINUOUS", lw: 35 },
        { name: "ROAD_ALIGN_PR", color: 4, lt: "CENTER", lw: 50 },
        { name: "DRAIN_PIPE_PR", color: 5, lt: "CONTINUOUS", lw: 70 }
    ]);
    const tmplLayers = insp.parseDXF(TEMPLATE).layers;

    t.group("template-cmp/builtin + store");
    const bi = TC.builtinTemplate();
    t.eq(bi.id, "__fdot2026", "built-in has a stable id");
    t.gt(bi.layers.length, 30, "built-in FDOT standard has the full layer set");
    t.ok(bi.layers.every(l => l.name && Number.isFinite(l.color)), "built-in layers are well-formed");
    t.throws(() => TC.saveUploadedTemplate("empty", ""), "empty template rejected");
    t.throws(() => TC.saveUploadedTemplate("no-table", "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"), "template with no LAYER table rejected");
    const saved = TC.saveUploadedTemplate("Firm Standard", TEMPLATE);
    t.eq(saved.layerCount, 4, "uploaded template layer count");
    t.ok(TC.getTemplates().some(x => x.id === saved.id), "uploaded template is in the list");
    t.eq(TC.templateLayers(saved).length, 4, "templateLayers() re-parses the stored DXF");
    TC.deleteTemplate(saved.id);
    t.notOk(TC.getTemplates().some(x => x.id === saved.id), "deleteTemplate removes it");

    t.group("template-cmp/compareStandards — layer diff");
    const project = insp.parseDXF(dxf([
        { name: "SURV_BND_PR", color: 1, lt: "PHANTOM", lw: 70 },      // conforms
        { name: "ROAD_EOP_PR", color: 3, lt: "CONTINUOUS", lw: 35 },   // colour mismatch (3 vs 7)
        { name: "ROAD_ALIGN_PR", color: 4, lt: "HIDDEN", lw: 50 },     // linetype mismatch
        { name: "MY_SCRATCH", color: 7, lt: "CONTINUOUS" }             // not in the standard
        // DRAIN_PIPE_PR is absent -> missing
    ], [
        "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "5", "21", "5",             // on Layer 0
        "0", "LWPOLYLINE", "8", "MY_SCRATCH", "90", "2", "70", "0", "10", "0", "20", "0", "10", "9", "20", "9"  // non-standard layer
    ]));

    const r = TC.compareStandards(tmplLayers, project, { checkPlot: false });
    t.eq(r.templateCount, 4, "template layer count");
    t.eq(r.projectCount, 4, "project layer count");
    t.eq(r.missing.map(l => l.name).join(","), "DRAIN_PIPE_PR", "DRAIN_PIPE_PR flagged missing");
    t.eq(r.extra.map(l => l.name).join(","), "MY_SCRATCH", "MY_SCRATCH flagged non-standard");
    t.ok(r.okLayers.includes("SURV_BND_PR"), "conforming layer listed as ok");
    const mmNames = r.mismatch.map(m => m.name).sort().join(",");
    t.eq(mmNames, "ROAD_ALIGN_PR,ROAD_EOP_PR", "two layers have property mismatches");
    const eopMm = r.mismatch.find(m => m.name === "ROAD_EOP_PR");
    t.ok(eopMm.diffs.some(d => /Colour/.test(d.prop) && d.template === "7" && d.project === "3"), "EOP colour diff 7 -> 3");
    const alignMm = r.mismatch.find(m => m.name === "ROAD_ALIGN_PR");
    t.ok(alignMm.diffs.some(d => d.prop === "Linetype" && /HIDDEN/i.test(d.project)), "ALIGN linetype diff -> HIDDEN");

    t.group("template-cmp/compareStandards — entity placement + score");
    t.ok(r.entIssues.some(e => e.sev === "CRITICAL" && /Layer 0/.test(e.msg)), "entity on Layer 0 -> CRITICAL");
    t.ok(r.entIssues.some(e => e.sev === "HIGH" && /MY_SCRATCH/.test(e.msg)), "entity on non-standard layer -> HIGH");
    t.gte(r.score, 0, "score >= 0");
    t.lte(r.score, 100, "score <= 100");
    t.lt(r.score, 100, "score docked for the issues");
    const clean = TC.compareStandards(tmplLayers, insp.parseDXF(TEMPLATE), {});
    t.eq(clean.score, 100, "identical drawing scores 100");
    t.eq(clean.missing.length + clean.extra.length + clean.mismatch.length, 0, "identical drawing has no diffs");

    t.group("template-cmp/lineweight comparison (string vs 1/100mm int)");
    const lwProj = insp.parseDXF(dxf([{ name: "ROAD_EOP_PR", color: 7, lt: "CONTINUOUS", lw: 50 }]));  // 0.50 vs template 0.35
    const lwR = TC.compareStandards([{ name: "ROAD_EOP_PR", color: 7, linetype: "CONTINUOUS", lineweight: "0.35" }], lwProj, {});
    t.ok(lwR.mismatch.some(m => m.diffs.some(d => d.prop === "Lineweight" && d.template === "0.35" && d.project === "0.50")),
        "lineweight 0.35 (string) vs 0.50 (int 50) flagged");

    t.group("template-cmp/plot flag only when opted in");
    const plotProj = insp.parseDXF([
        ...HEAD, "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "1",
        "0", "LAYER", "2", "ROAD_NOPLOT_WORK", "70", "0", "62", "211", "6", "CONTINUOUS", "290", "1",
        "0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"
    ].join("\n"));
    const tplNoPlot = [{ name: "ROAD_NOPLOT_WORK", color: 211, linetype: "CONTINUOUS", plot: false }];
    t.eq(TC.compareStandards(tplNoPlot, plotProj, { checkPlot: false }).mismatch.length, 0, "plot diff ignored by default");
    t.ok(TC.compareStandards(tplNoPlot, plotProj, { checkPlot: true }).mismatch.some(m => m.diffs.some(d => d.prop === "Plot")),
        "plot diff reported when checkPlot=true");

    t.group("template-cmp/exports");
    const report = TC.diffReport("Firm Standard", "job123.dxf", r);
    t.match(report, /Standards Comparison Report/, "report header");
    t.match(report, /MISSING from the drawing.*\(1\)/s, "report: missing section with count");
    t.match(report, /NOT in the standard.*\(1\)/s, "report: extra section");
    t.match(report, /MISMATCHED properties.*\(2\)/s, "report: mismatch section");
    const scr = TC.fixScript("Firm Standard", tmplLayers, r);
    t.match(scr, /_\.AUDIT _Yes/, ".scr runs AUDIT");
    t.match(scr, /_\.-LAYER _Make "DRAIN_PIPE_PR" _Color 5/, ".scr creates the missing layer with its ACI");
    t.match(scr, /_\.-LAYER _Color 7 "ROAD_EOP_PR"/, ".scr recolours the mismatched layer to the standard");
    t.match(scr, /;\s+MY_SCRATCH/, ".scr lists (does not delete) the non-standard layer");
    t.match(scr, /_\.QSAVE/, ".scr saves");

    t.group("template-cmp/parser now reads lineweight (group 370)");
    const lwParsed = insp.parseDXF(dxf([{ name: "X", color: 1, lt: "CONTINUOUS", lw: 35 }]));
    t.eq(lwParsed.layers[0].lineweight, 35, "group 370 captured on the layer record");
};
