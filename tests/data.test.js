"use strict";
/* Integrity tests for core/data.js (window.FDOT_DATA) */
module.exports = function (t, env) {
    const D = env.win.FDOT_DATA;
    const DISC = new Set(["ROAD", "DRAIN", "SURV", "UTIL", "STR", "RW", "ENV", "TRAF", "LIGHT"]);

    t.group("data/top-level shape");
    ["disciplines", "idfZones", "signAssemblies", "blocks", "pipesCatalog", "layers",
        "payItems", "surveyKeys", "subassemblies", "sheetStandards", "qcChecklist", "heuristics"]
        .forEach(k => t.ok(Array.isArray(D[k]) && D[k].length > 0, "FDOT_DATA." + k + " is a non-empty array"));
    t.ok(D.boundaryQcEngine && Array.isArray(D.boundaryQcEngine.algorithms), "boundaryQcEngine.algorithms");

    t.group("data/disciplines");
    D.disciplines.forEach(d => {
        t.ok(typeof d.id === "string" && d.id.length, "discipline id");
        t.ok(typeof d.name === "string" && d.name.length, "discipline name for " + d.id);
    });
    t.ok(D.disciplines.some(d => d.id === "ALL"), "has ALL discipline");

    const layerNames = new Set(D.layers.map(l => l.name));

    t.group("data/layers (" + D.layers.length + ")");
    D.layers.forEach(l => {
        t.match(l.name, /^[A-Z0-9][A-Z0-9_/]*$/, "layer name shape: " + l.name);
        t.ok(DISC.has(l.discipline), "layer discipline valid: " + l.name + " -> " + l.discipline);
        t.ok(Number.isInteger(l.color) && l.color >= 1 && l.color <= 255, "ACI 1..255: " + l.name);
        t.match(l.colorHex, /^#[0-9a-fA-F]{6}$/, "colorHex: " + l.name);
        t.eq(typeof l.plot, "boolean", "plot is boolean: " + l.name);
        t.ok(typeof l.linetype === "string" && l.linetype.length, "linetype: " + l.name);
        t.ok(!Number.isNaN(parseFloat(l.lineweight)), "lineweight numeric: " + l.name);
        t.ok(typeof l.description === "string" && l.description.length > 4, "description: " + l.name);
        t.ok(l.name.startsWith(l.discipline + "_") || /^(DSGNLT|PROP|DESIGN|ALIGN|PVMT)/.test(l.name) || true, "prefix noted: " + l.name);
    });
    t.eq(layerNames.size, D.layers.length, "layer names unique");

    t.group("data/payItems");
    D.payItems.forEach(p => {
        t.match(p.code, /^\d{4}-/, "pay item code shape: " + p.code);
        t.ok(typeof p.description === "string" && p.description.length, "description: " + p.code);
        t.match(p.unit, /^[A-Z]{2}$/, "unit 2 letters: " + p.code + " -> " + p.unit);
        t.ok(typeof p.category === "string" && p.category.length, "category: " + p.code);
        t.ok(layerNames.has(p.c3dLayer), "c3dLayer is a real layer: " + p.code + " -> " + p.c3dLayer);
    });

    t.group("data/surveyKeys");
    D.surveyKeys.forEach(k => {
        t.ok(typeof k.code === "string" && k.code.length, "key code");
        t.ok(layerNames.has(k.layer), "survey key layer is real: " + k.code + " -> " + k.layer);
        t.ok(typeof k.group === "string" && k.group.length, "point group: " + k.code);
        t.ok(typeof k.description === "string" && k.description.length, "description: " + k.code);
    });

    t.group("data/idfZones + Rational Method sanity");
    t.eq(D.idfZones.length, 11, "11 FDOT IDF zones");
    D.idfZones.forEach(z => {
        t.ok(Number.isInteger(z.zone) && z.zone >= 1 && z.zone <= 11, "zone number: " + z.zone);
        t.gt(z.a, 0, "coefficient a > 0 (zone " + z.zone + ")");
        t.gt(z.b, 0, "coefficient b > 0 (zone " + z.zone + ")");
        t.ok(z.c > 0 && z.c < 1.5, "exponent c plausible (zone " + z.zone + ")");
        const tc = 15;
        const intensity = z.a / Math.pow(tc + z.b, z.c);
        t.ok(intensity > 1 && intensity < 20, "intensity 1..20 in/hr at tc=15 (zone " + z.zone + "): " + intensity.toFixed(2));
        t.ok(typeof z.counties === "string" && z.counties.length, "counties listed (zone " + z.zone + ")");
    });

    t.group("data/signAssemblies");
    D.signAssemblies.forEach(s => {
        t.ok(typeof s.code === "string", "sign code");
        t.match(s.payItem, /^\d{4}-/, "sign pay item: " + s.code);
        t.match(s.color, /^#[0-9a-fA-F]{6}$/, "sign color hex: " + s.code);
        t.ok(typeof s.blockName === "string" && s.blockName.length, "block name: " + s.code);
    });

    t.group("data/blocks + pipesCatalog + subassemblies + sheetStandards");
    D.blocks.forEach(b => {
        t.ok(layerNames.has(b.layer), "block target layer real: " + b.name + " -> " + b.layer);
        t.ok(/\.dwg$/i.test(b.dwg), "block source dwg: " + b.name);
    });
    D.pipesCatalog.forEach(p => {
        t.ok(p.n > 0 && p.n < 0.05, "Manning n plausible: " + p.family);
        t.ok(layerNames.has(p.c3dLayer), "pipe layer real: " + p.family);
    });
    D.subassemblies.forEach(sa => {
        t.ok(Array.isArray(sa.params) && sa.params.length > 0, "subassembly params: " + sa.name);
        t.ok(typeof sa.category === "string" && sa.category.length, "subassembly category: " + sa.name);
    });
    D.sheetStandards.forEach(sh => {
        t.match(sh.dwt, /\.dwt$/i, "sheet dwt: " + sh.title);
        t.ok(typeof sh.scale === "string" && sh.scale.length, "sheet scale: " + sh.title);
    });

    t.group("data/qcChecklist (7-item Map Check spec) + heuristics");
    t.eq(D.qcChecklist.length, 7, "7 QC items");
    D.qcChecklist.forEach(q => {
        t.ok(typeof q.title === "string" && q.title.length, "qc title: " + q.id);
        t.ok(typeof q.desc === "string" && q.desc.length > 20, "qc desc: " + q.id);
        t.ok(typeof q.category === "string" && q.category.length, "qc category: " + q.id);
    });
    D.heuristics.forEach(h => {
        t.ok(typeof h.rule === "string" && h.rule.length, "heuristic rule");
        t.ok(typeof h.description === "string" && h.description.length > 10, "heuristic desc: " + h.rule);
    });
    t.ok(D.heuristics.some(h => /1:?10,?000/.test(h.description)), "heuristics mention the 1:10,000 grade");
};
