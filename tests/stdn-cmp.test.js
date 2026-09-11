"use strict";
/* Functional tests for plugins/stdn-compare/* (window.StdnEngine) — ported
 * from the standardcompare-plugin project's server/test/run.js, minus the
 * Express / multer / rate-limiter assertions which don't apply client-side. */
module.exports = async function (t, env) {
    const E = env.win.StdnEngine;
    const S = env.win.StdnCompare.SAMPLES;   // the same fixtures, bundled in the plugin
    const crypto = require("crypto");

    const refModel = E.parseDxf(S.reference);
    const tgtModel = E.parseDxf(S.target);
    const masterModel = E.parseDxf(S.master);
    const standard = E.BUILTIN_STANDARDS["example-standard"];

    // ── dxfLoader ────────────────────────────────────────────────
    t.group("stdn/dxfLoader");
    t.eq(refModel.entities.length, 4, "reference.dxf → 4 entities");
    t.eq(refModel.entityCounts.LINE, 2, "2 LINEs");
    t.eq(refModel.entityCounts.CIRCLE, 1, "1 CIRCLE");
    t.eq(refModel.entityCounts.TEXT, 1, "1 TEXT");
    t.ok(refModel.layers.WALLS, "WALLS layer parsed");
    t.eq(refModel.layers.WALLS.color, 1, "WALLS color 1");
    t.eq(refModel.layers.WALLS.linetype, "CONTINUOUS", "WALLS linetype");
    t.eq(refModel.layers.WALLS.lineweight, 25, "WALLS lineweight 25");
    t.eq(refModel.units, "millimeters", "$INSUNITS 4 → millimeters");
    const rline = refModel.entities.find(e => e.type === "LINE");
    t.eq(rline.x1, 0, "LINE x1"); t.eq(rline.y1, 0, "LINE y1");
    t.eq(rline.x2, 100, "LINE x2"); t.eq(rline.y2, 0, "LINE y2");
    const rcirc = refModel.entities.find(e => e.type === "CIRCLE");
    t.eq(rcirc.cx, 50, "CIRCLE cx"); t.eq(rcirc.cy, 25, "CIRCLE cy"); t.eq(rcirc.radius, 5, "CIRCLE r");
    const rtext = refModel.entities.find(e => e.type === "TEXT");
    t.eq(rtext.text, "ROOM A", "TEXT content"); t.eq(rtext.style, "STANDARD", "TEXT style");
    t.eq(masterModel.blocks["WINDOW-TAG"] ? "y" : "n", "y", "master BLOCKS: WINDOW-TAG parsed");

    // resilient tokenizer (deviation from source): blank lines / CRLF / stray line
    const messyText = S.reference
        .replace("0\nSECTION", "\r\n  0 \r\nSECTION")   // pad + CRLF the first code
        .replace("0\nENDSEC", "not-a-code\n0\nENDSEC");  // stray line before a record
    const messyModel = E.parseDxf(messyText);
    t.eq(messyModel.entities.length, 4, "tokenizer survives blank/CRLF/stray lines");
    t.eq(messyModel.layers.WALLS.color, 1, "layer table still intact after messy input");

    // ── standardsCheck ──────────────────────────────────────────
    t.group("stdn/standardsCheck");
    const tgtChk = E.checkStandards(tgtModel, standard);
    t.ok(tgtChk.violations.find(v => v.code === "LAYER_COLOR_MISMATCH" && v.layer === "WALLS"), "WALLS color 5≠1 flagged");
    t.ok(tgtChk.violations.find(v => v.code === "LAYER_NAME_CONVENTION" && v.layer === "temp_layer"), "temp_layer naming flagged");
    t.eq(tgtChk.summary.passed, false, "summary.passed false with errors");
    t.gte(tgtChk.summary.errors, 1, "≥1 error");
    const refChk = E.checkStandards(refModel, standard);
    t.notOk(refChk.violations.find(v => v.code === "LAYER_COLOR_MISMATCH" && v.layer === "WALLS"), "clean reference conforms on WALLS colour");

    // fdot-2026 built-in (derived from window.FDOT_DATA) — reproduces the retired
    // Template Compare tab's FDOT layer-table diff
    const fdotStd = E.defaultResolveBuiltInStandard("fdot-2026");
    t.gt(fdotStd.layers.length, 30, "fdot-2026 standard carries the full FDOT layer set");
    t.ok(fdotStd.layers.every(l => l.required), "…every FDOT layer is required");
    t.eq(fdotStd.colorPolicy, "byLayer", "…ByLayer colour policy");
    const fdotDrawing = E.parseDxf(
        "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n" +
        "0\nLAYER\n2\nROAD_EOP_PR\n62\n3\n6\nCONTINUOUS\n" +   // present but wrong colour (std says 7)
        "0\nLAYER\n2\nmy_scratch\n62\n1\n6\nCONTINUOUS\n" +      // not an FDOT layer
        "0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF");
    const fdotV = E.checkStandards(fdotDrawing, fdotStd).violations.map(v => v.code);
    t.ok(fdotV.includes("MISSING_REQUIRED_LAYER"), "fdot-2026: flags FDOT layers the drawing lacks");
    t.ok(fdotV.includes("LAYER_COLOR_MISMATCH"), "fdot-2026: flags a wrong ACI on ROAD_EOP_PR");

    // a rule with both `lineweight` (exact) and `lineweightMax` (ceiling) must
    // not double-report one bad value — the exact rule wins, the ceiling is skipped
    const lwStd = { layers: [{ name: "X", lineweight: 25, lineweightMax: 10 }] };
    const lwOk = { layers: { X: { color: 1, linetype: "CONTINUOUS", lineweight: 25 } }, linetypes: {}, styles: {}, blocks: {}, entities: [], units: "mm", header: {} };
    t.eq(E.checkStandards(lwOk, lwStd).violations.length, 0, "lineweight matches the exact rule → no violation (ceiling not double-checked)");
    const lwBad = { ...lwOk, layers: { X: { color: 1, linetype: "CONTINUOUS", lineweight: 30 } } };
    const lwBadV = E.checkStandards(lwBad, lwStd).violations.map(v => v.code);
    t.eq(lwBadV.join(","), "LAYER_LINEWEIGHT_MISMATCH", "wrong lineweight → exactly one violation (mismatch, not also exceeds-max)");

    // ByBlock (colour 0) must NOT be flagged as a not-ByLayer violation
    const byBlockModel = { ...tgtModel, entities: [{ type: "LINE", layer: "WALLS", color: 0, linetype: "BYLAYER", lineweight: null, handle: "x1", x1: 0, y1: 0, x2: 1, y2: 1 }] };
    t.notOk(E.checkStandards(byBlockModel, { ...standard, colorPolicy: "byLayer" }).violations.find(v => v.code === "ENTITY_COLOR_NOT_BYLAYER"),
        "ByBlock (0) exempt from the ByLayer policy");

    // ── geometryDiff ────────────────────────────────────────────
    t.group("stdn/geometryDiff");
    const diff = E.diffGeometry(refModel, tgtModel);
    t.eq(diff.summary.added, 1, "one added entity");
    t.eq(diff.added[0].layer, "temp_layer", "…on temp_layer");
    t.eq(diff.modified.map(m => m.type).sort().join(","), "CIRCLE,LINE", "CIRCLE + LINE modified");
    const circMod = diff.modified.find(m => m.type === "CIRCLE").changes.find(c => c.field === "radius");
    t.eq(circMod.from, 5, "radius from 5"); t.eq(circMod.to, 8, "radius to 8");
    t.ok(diff.unchanged.map(u => u.type).includes("TEXT"), "TEXT unchanged");
    const selfDiff = E.diffGeometry(refModel, refModel);
    t.eq(selfDiff.summary.identical, true, "model vs itself is identical");
    const wide = E.diffGeometry(refModel, tgtModel, { position: 100 });
    t.notOk(wide.modified.find(m => m.type === "LINE"), "widened position tolerance drops the small LINE move");
    // stable tie-break → identical result on repeated runs
    const d1 = E.diffGeometry(E.parseDxf(S.reference), E.parseDxf(S.target));
    const d2 = E.diffGeometry(E.parseDxf(S.reference), E.parseDxf(S.target));
    t.eq(JSON.stringify(d1.modified.map(m => [m.type, m.layer, m.changes.length])),
         JSON.stringify(d2.modified.map(m => [m.type, m.layer, m.changes.length])), "matching is deterministic across runs");

    // grid-indexed matcher scales (regression for the O(n·m) blowup)
    const makeModel = (seed) => {
        const entities = [];
        for (let i = 0; i < 3000; i++) {
            const x = (i * 37 + seed) % 5000, y = (i * 53 + seed) % 5000;
            entities.push({ type: "LINE", layer: "WALLS", color: null, linetype: "BYLAYER", lineweight: null, handle: String(i), x1: x, y1: y, x2: x + 10, y2: y });
        }
        return { entities, entityCounts: { LINE: 3000 }, layers: {}, linetypes: {}, styles: {}, blocks: {}, units: "millimeters", header: {} };
    };
    const gref = makeModel(0), gtgt = makeModel(0);
    for (let i = 0; i < 15; i++) gtgt.entities[i * 200].x1 += 3;
    const t0 = Date.now();
    const gres = E.diffGeometry(gref, gtgt);
    t.lt(Date.now() - t0, 5000, "3000-entity diff finishes fast (no cross-product blowup)");
    t.eq(gres.summary.modified, 15, "exactly 15 nudged entities modified");
    t.eq(gres.summary.unchanged, 2985, "the rest unchanged");
    t.eq(gres.summary.added + gres.summary.removed, 0, "nothing added/removed");

    // POLYLINE entity diff
    const polyRef = {
        entities: [{ type: "POLYLINE", layer: "WALLS", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false, handle: "p1" }],
        entityCounts: { POLYLINE: 1 }, layers: {}, linetypes: {}, styles: {}, blocks: {}, units: "mm", header: {}
    };
    const polyTgt = {
        entities: [{ type: "POLYLINE", layer: "WALLS", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 15 }], closed: false, handle: "p1" }],
        entityCounts: { POLYLINE: 1 }, layers: {}, linetypes: {}, styles: {}, blocks: {}, units: "mm", header: {}
    };
    const polyDiff = E.diffGeometry(polyRef, polyTgt);
    t.eq(polyDiff.summary.modified, 1, "POLYLINE vertex change detected as modified");
    t.eq(polyDiff.modified[0].changes[0].field, "points[2].y", "detected changed vertex coordinate");

    // ── svgOverlay ──────────────────────────────────────────────
    t.group("stdn/svgOverlay");
    const svg = E.buildSvgOverlay(refModel, tgtModel, diff);
    t.match(svg, /^<svg/, "starts with <svg");
    t.match(svg, /class="added"/, "has an added-status element");
    t.match(svg, /<\/svg>\s*$/, "closes </svg>");
    // ARC renders as a real arc sweep (<path ... A r r 0 f f x y>), not a full circle
    const arcRef = { entities: [], layers: {}, linetypes: {}, styles: {}, blocks: {}, units: "mm", header: {} };
    const arcTgt = { entities: [{ type: "ARC", layer: "L", cx: 5, cy: 5, radius: 10, startAngle: 0, endAngle: 90, handle: "a1" }], layers: {}, linetypes: {}, styles: {}, blocks: {}, units: "mm", header: {} };
    const arcSvg = E.buildSvgOverlay(arcRef, arcTgt, E.diffGeometry(arcRef, arcTgt));
    t.match(arcSvg, /<path class="added" d="M [\d.eE+-]+ [\d.eE+-]+ A 10 10 0 [01] 0 /, "ARC drawn as a real sweep path");
    t.notOk(/<circle[^>]*stroke-dasharray="1,1"/.test(arcSvg), "no dashed full-circle ARC fallback");
    // a 0°→90° arc at (5,5) r10 spans x∈[5,15], y∈[5,15] — not the full cx±r circle bbox
    const vb = arcSvg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
    t.lt(parseFloat(vb[3]), 14, "ARC viewBox width ≈ tight arc extent (10 + pad), not the ~22 full-circle bbox");
    t.lt(parseFloat(vb[4]), 14, "ARC viewBox height ≈ tight arc extent");
    // POLYLINE renders into SVG overlay
    const polySvg = E.buildSvgOverlay(polyRef, polyTgt, polyDiff);
    t.match(polySvg, /<polyline class="modified" points="0,0 10,0 10,-15"/, "POLYLINE renders points into svg overlay");

    // ── standardFromDxf + dxfMender (auto-correct) ───────────────
    t.group("stdn/auto-correct");
    const derived = E.standardFromMasterDxf(masterModel);
    t.eq(derived.units, "millimeters", "derived units");
    t.eq(derived.layers.find(l => l.name === "WALLS").color, 1, "derived WALLS colour");
    t.eq(derived.requiredLinetypes.slice().sort().join(","), "CONTINUOUS,HIDDEN", "derived required linetypes");
    t.eq(derived.requiredBlocks.join(","), "WINDOW-TAG", "derived required blocks");
    t.eq(derived.requiredTextStyles.join(","), "STANDARD", "derived required styles");

    // mergeStandards merges layer FIELDS on a name collision (doesn't wipe the
    // master's required/color/linetype when a JSON standard adds a rule)
    const mergedStd = E.mergeStandards(derived, { layers: [{ name: "WALLS", namingPattern: "^X$", lineweightMax: 40 }] });
    const mergedWalls = mergedStd.layers.find(l => l.name === "WALLS");
    t.eq(mergedWalls.required, true, "merge keeps master's WALLS.required");
    t.eq(mergedWalls.color, 1, "merge keeps master's WALLS.color");
    t.eq(mergedWalls.linetype, "CONTINUOUS", "merge keeps master's WALLS.linetype");
    t.eq(mergedWalls.namingPattern, "^X$", "merge adds the JSON standard's namingPattern");
    t.eq(mergedWalls.lineweightMax, 40, "merge adds the JSON standard's lineweightMax");
    t.eq(mergedStd.layers.find(l => l.name === "DOORS").required, true, "a master layer the JSON standard doesn't mention stays required");

    const heal = E.healDxf(S.master, S.messy);
    const hcodes = heal.violationsBefore.map(v => v.code);
    t.ok(hcodes.includes("LAYER_COLOR_MISMATCH"), "before: WALLS colour mismatch");
    t.ok(hcodes.includes("MISSING_REQUIRED_LAYER"), "before: missing DOORS layer");
    t.ok(hcodes.includes("MISSING_REQUIRED_LINETYPE") || hcodes.includes("UNDEFINED_LINETYPE_REFERENCE"), "before: HIDDEN linetype issue");
    t.ok(hcodes.includes("MISSING_REQUIRED_STYLE"), "before: missing STANDARD style");
    t.ok(hcodes.includes("MISSING_REQUIRED_BLOCK"), "before: missing WINDOW-TAG block");

    const healedModel = E.parseDxf(heal.healedDxf);
    t.eq(healedModel.layers.WALLS.color, 1, "healed: WALLS colour corrected to 1");
    t.ok(healedModel.layers.DOORS, "healed: DOORS layer added");
    t.eq(healedModel.layers.DOORS.color, 2, "healed: DOORS carries the master's colour");
    t.ok(healedModel.linetypes.HIDDEN, "healed: HIDDEN linetype added");
    t.eq(healedModel.entities.find(e => e.type === "LINE" && e.layer === "WALLS").color, null, "healed: WALLS line colour override → ByLayer");

    const blockUnresolved = heal.unresolved.find(v => v.code === "MISSING_REQUIRED_BLOCK");
    t.ok(blockUnresolved && /off by default/i.test(blockUnresolved.reason), "block not healed by default, reason given");
    t.ok(heal.unresolved.find(v => v.code === "MISSING_REQUIRED_STYLE"), "STYLE unresolved — messy.dxf has no STYLE table to insert into");

    const healBlocks = E.healDxf(S.master, S.messy, { healBlocks: true });
    t.ok(E.parseDxf(healBlocks.healedDxf).blocks["WINDOW-TAG"], "healBlocks:true copies WINDOW-TAG in");
    t.ok(healBlocks.actions.find(a => a.code === "MISSING_REQUIRED_BLOCK" && a.caveat), "block-copy action carries a verification caveat");
    t.lt(healBlocks.violationsAfter.length, healBlocks.violationsBefore.length, "fewer violations after healing");
    t.ok(healBlocks.violationsAfter.map(v => v.code).includes("MISSING_REQUIRED_STYLE"), "only the no-STYLE-table case remains");

    const noop = E.healDxf(S.master, S.master);
    t.eq(noop.actions.length, 0, "master vs itself → zero actions");
    t.eq(noop.healedDxf, E.normalizeDxfLines(S.master.split(/\r\n|\r|\n/)).join("\n"), "master vs itself → text unchanged (bar newline/blank-line normalisation)");

    const messyByBlock = S.messy.replace("62\n2\n", "62\n0\n");   // WALLS line override → ByBlock
    const healByBlock = E.healDxf(S.master, messyByBlock, { healBlocks: true });
    t.eq(E.parseDxf(healByBlock.healedDxf).entities.find(e => e.type === "LINE" && e.layer === "WALLS").color, 0, "ByBlock override survives healing untouched");

    // ── regexSafety ─────────────────────────────────────────────
    t.group("stdn/regexSafety");
    t.throws(() => E.assertStandardPatternsAreSafe({ namingConvention: { pattern: "^(a+)+$", appliesTo: ["layers"] } }), "nested-quantifier namingConvention rejected");
    t.throws(() => E.assertStandardPatternsAreSafe({ layers: [{ name: "WALLS", namingPattern: "(a*)*" }] }), "nested-quantifier per-layer pattern rejected");
    let benignOk = true;
    try { E.assertStandardPatternsAreSafe({ namingConvention: { pattern: "^[A-Z][A-Z0-9_-]{1,30}$", appliesTo: ["layers"] }, layers: [{ name: "WALLS", namingPattern: "^[A-Z0-9_-]+$" }] }); }
    catch (e) { benignOk = false; }
    t.ok(benignOk, "realistic patterns pass without false positives");
    t.eq(E.checkPatternSafety("a".repeat(300)).safe, false, "oversized pattern rejected by the length backstop");

    // ── compareOrchestrator (the pure /compare decision logic) ──
    t.group("stdn/orchestrateCompare");
    const is400 = (fn) => { try { fn(); return false; } catch (e) { return e instanceof E.CompareError && e.statusCode === 400; } };
    t.ok(is400(() => E.orchestrateCompare({ referenceText: S.reference })), "missing target → CompareError 400");
    t.ok(is400(() => E.orchestrateCompare({ targetText: S.target })), "no reference/master/standard → 400");
    t.ok(is400(() => E.orchestrateCompare({ targetText: S.target, standardId: "does-not-exist" })), "unknown standardId → 400");
    const orch = E.orchestrateCompare({ targetText: S.target, targetFileName: "target.dxf", standardId: "example-standard" });
    t.ok(orch.standardsCheck && orch.standardsCheck.violations.some(v => v.code === "LAYER_COLOR_MISMATCH"), "resolves a built-in standardId end to end");
    t.eq(orch.meta.standardName, "Example Company Drafting Standard", "report carries the standard name");
    const masterOnly = E.orchestrateCompare({ targetText: S.messy, masterText: S.master });
    t.ok(masterOnly.standardsCheck.violations.some(v => v.code === "MISSING_REQUIRED_LAYER"), "derives a standard purely from a master template");
    const merged = E.orchestrateCompare({ targetText: S.messy.replace("8\nWALLS\n", "8\ntemp_layer\n"), masterText: S.master, jsonStandardSpec: { name: "Extra", prohibitedLayers: ["temp_layer"] } });
    t.ok(merged.standardsCheck.violations.some(v => v.code === "PROHIBITED_LAYER_PRESENT"), "merges a JSON standard's prohibitedLayers");
    t.ok(merged.standardsCheck.violations.some(v => v.code === "MISSING_REQUIRED_LAYER"), "…while master-derived rules still apply");
    const geomOnly = E.orchestrateCompare({ targetText: S.target, referenceText: S.reference });
    t.ok(geomOnly.geometryDiff, "reference-only → geometry diff runs");
    t.eq(geomOnly.standardsCheck, undefined, "reference-only → no standards check");
    t.ok(is400(() => E.orchestrateCompare({ targetText: S.target, jsonStandardSpec: { namingConvention: { pattern: "^(a+)+$", appliesTo: ["layers"] } } })), "unsafe regex in a JSON standard → 400 before the check runs");
    t.eq(JSON.stringify(E.parseTolerancesField('{"position":5}')), '{"position":5}', "parseTolerancesField parses valid JSON");
    t.eq(E.parseTolerancesField(undefined), undefined, "parseTolerancesField passes through undefined");
    t.ok(is400(() => E.parseTolerancesField("{not json")), "parseTolerancesField rejects invalid JSON as 400");

    // ── dxfDocument (raw-text editor) ───────────────────────────
    t.group("stdn/dxfDocument");
    let doc = new E.DxfDocument(S.reference);
    const wallsLines = doc.getTableEntryLines("LAYER", "WALLS");
    t.ok(wallsLines && wallsLines.includes("WALLS") && wallsLines.includes("62"), "indexes a LAYER entry and reads it back");
    const before = doc.lines.length;
    t.eq(doc.setTableEntryField("LAYER", "WALLS", 62, 9), true, "setTableEntryField edits an existing value");
    t.eq(doc.lines.length, before, "…without changing the line count");
    t.eq(E.parseDxf(doc.toText()).layers.WALLS.color, 9, "…and the edit round-trips through the parser");
    doc = new E.DxfDocument(S.reference);
    t.eq(doc.setTableEntryField("LAYER", "WALLS", 62, 1), false, "no-op when the value already matches");
    t.eq(doc.setTableEntryField("LAYER", "0", 370, 13), true, "inserts a group code the entry lacked");
    t.eq(E.parseDxf(doc.toText()).layers["0"].lineweight, 13, "…and it parses back");
    doc = new E.DxfDocument(S.reference);
    doc.setTableEntryField("LAYER", "WALLS", 62, 8);
    doc.insertTableEntry("LAYER", ["0", "LAYER", "2", "A", "62", "1"]);
    doc.insertTableEntry("LAYER", ["0", "LAYER", "2", "B", "62", "2"]);
    doc.setTableEntryField("LAYER", "DIMS", 62, 5);
    const multi = E.parseDxf(doc.toText());
    t.eq(multi.layers.WALLS.color, 8, "multi-edit: WALLS colour");
    t.eq(multi.layers.DIMS.color, 5, "multi-edit: DIMS colour");
    t.ok(multi.layers.A && multi.layers.B && multi.layers.A.color === 1 && multi.layers.B.color === 2, "multi-edit: two inserted layers parse correctly");
    const mdoc = new E.DxfDocument(S.master);
    const blk = mdoc.getBlockLines("WINDOW-TAG");
    const tdoc = new E.DxfDocument(S.messy);
    t.eq(tdoc.getBlockLines("WINDOW-TAG"), null, "messy.dxf has no WINDOW-TAG block");
    t.eq(tdoc.insertBlockSegment(blk), true, "insertBlockSegment succeeds");
    t.ok(E.parseDxf(tdoc.toText()).blocks["WINDOW-TAG"], "…and the block parses in the result");
    const cdoc = new E.DxfDocument(S.messy);
    t.eq(cdoc.removeExplicitEntityColors(({ layer, color }) => layer === "WALLS" && color !== 256 && color !== 0), 1, "removeExplicitEntityColors strips the one matching override");
    t.eq(E.parseDxf(cdoc.toText()).entities.find(e => e.type === "LINE" && e.layer === "WALLS").color, null, "…reverting it to ByLayer");
    const sdoc = new E.DxfDocument(S.messy);
    t.eq(sdoc.hasTable("STYLE"), false, "missing STYLE table detected");
    t.eq(sdoc.setTableEntryField("STYLE", "STANDARD", 3, "arial.ttf"), false, "edit on a missing table → false, not a throw");
    t.eq(sdoc.getTableEntryLines("LAYER", "NOPE"), null, "unknown entry → null");

    // the raw-text editor tolerates stray blank lines but rejects genuine garbage
    const guardThrows = (txt) => { try { new E.DxfDocument(txt); return false; } catch (e) { return e instanceof E.CompareError && e.statusCode === 400; } };
    t.ok(guardThrows("hello\nworld\nnot a dxf"), "genuine garbage → CompareError 400");
    t.notOk(guardThrows(S.reference), "a well-formed DXF passes the guard");
    t.notOk(guardThrows(S.master.replace(/\n$/, "")), "…with or without a file-final newline");
    let healGuard = false;
    try { E.healDxf(S.master, "not\na\nvalid\ndxf\nfile"); } catch (e) { healGuard = e instanceof E.CompareError; }
    t.ok(healGuard, "healDxf surfaces the guard error for a malformed target");

    // stray blank lines (in group-code position) are normalised away — a
    // hand-edited / concatenated DXF still heals
    const blanked = S.messy.replace("0\nSECTION\n2\nENTITIES", "\n\n0\nSECTION\n\n2\nENTITIES\n");
    const healBlanked = E.healDxf(S.master, blanked);
    t.gt(healBlanked.actions.length, 0, "auto-correct runs on a blank-line-riddled target");
    t.ok(E.parseDxf(healBlanked.healedDxf).layers.WALLS.color === 1, "…and still corrects the WALLS colour");
    // an empty group-1 value (empty TEXT string) is a value, not a stray blank — kept
    const emptyText = "0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\nDIMS\n1\n\n10\n5\n20\n6\n0\nENDSEC\n0\nEOF";
    t.eq(E.normalizeDxfLines(emptyText.split("\n")).join("\n"), emptyText, "empty TEXT value is preserved by normalisation");

    // ── reportRenderer ─────────────────────────────────────────
    t.group("stdn/reportRenderer");
    const cmpReport = E.buildReport({ meta: { targetFile: "target.dxf", referenceFile: "reference.dxf", standardName: standard.name }, standardsResult: tgtChk, geometryResult: diff });
    const cmpModel = E.buildReportModel({ source: "compare", data: cmpReport });
    const html = E.renderHtml(cmpModel);
    t.match(html, /^<!DOCTYPE html>/, "compare HTML report is a full document");
    t.match(html, /Standards violations/, "…with a violations section");
    t.match(html, /WALLS/, "…listing the WALLS violation");
    t.match(html, /target\.dxf/, "…and the drawing name");
    const md = E.renderMarkdown(cmpModel);
    t.match(md, /^# DXF Standards Compliance Report/, "compare Markdown report header");
    t.match(md, /LAYER_COLOR_MISMATCH/, "…includes the violation code");
    const healModel = E.buildReportModel({ source: "heal", data: { ...healBlocks, meta: { targetFile: "messy.dxf", masterFile: "master.dxf" } } });
    const healHtml = E.renderHtml(healModel);
    t.match(healHtml, /DXF Auto-Correct Report/, "heal HTML report title");
    t.match(healHtml, /Applied automatically/, "…fixed section");
    t.match(healHtml, /Needs manual review/, "…unresolved section");
    t.match(healHtml, /MISSING_REQUIRED_STYLE/, "…the still-unresolved STYLE issue");
    const cleanHeal = E.buildReportModel({ source: "heal", data: { ...noop, meta: {} } });
    t.eq(cleanHeal.overallPassed, true, "master-vs-self heal model → passed");
    t.eq(cleanHeal.statusLabel, "Fully corrected", "…labelled Fully corrected");
    t.match(E.renderHtml(cleanHeal), /status-pass/, "…renders the pass banner");

    // ── stdn-compare UI render path (self-contained DOM shim) ───
    t.group("stdn/render (UI)");
    const SC = env.win.StdnCompare;
    const P = env.win.PluginRegistry.get("stdn-compare");
    t.ok(P && P.module && typeof P.module.init === "function", "plugin registered with an init()");

    // Swap in a Map-backed getElementById + a pass-through DOMPurify so the
    // render functions (which read/write real elements via setSafeHTML) can be
    // observed. Restored at the end of the group — zero effect on other suites.
    const realGEBI = env.win.document.getElementById;
    const realPurify = env.win.DOMPurify;
    const reg = new Map();
    env.win.document.getElementById = (id) => {
        if (!reg.has(id)) { const el = env.fakeEl(); el.id = id; reg.set(id, el); }
        return reg.get(id);
    };
    env.win.DOMPurify = { sanitize: (s) => String(s) };   // pass-through: setSafeHTML writes verbatim
    const H = (id) => reg.get(id) ? reg.get(id).innerHTML : "";
    const noToast = { showToast() {} };

    try {
        P.module.init(noToast);
        const controls = H("stdn-controls");
        t.match(controls, /Run comparison/, "renderControls: Check-mode run button");
        t.match(controls, /Drawing to check/, "renderControls: target file slot");
        t.match(controls, /FDOT 2026 Layer Standard/, "renderControls: FDOT 2026 built-in option");
        t.match(controls, /Example Company Drafting Standard/, "renderControls: example built-in option");

        // Check run — the bundled samples are architectural, so pin the example standard
        SC.state.mode = "check";
        SC.state.standardId = "example-standard";
        SC.state.files = {
            target: { name: "target.dxf", text: S.target },
            reference: { name: "reference.dxf", text: S.reference },
            master: { name: "master.dxf", text: S.master },
            standard: null,
        };
        const CMS = env.win.BoundaryQCCMS;
        const subsBefore = CMS && CMS.isAuthenticated() ? CMS.getSubmittals().length : null;

        await SC.runCheck(noToast);
        const res = H("stdn-results");
        t.match(res, /Needs attention/, "runCheck → verdict banner");
        t.match(res, /Standards violations \(\d+\)/, "runCheck → violations section");
        t.match(res, /LAYER_COLOR_MISMATCH/, "runCheck → the WALLS colour violation");
        t.match(res, /MISSING_REQUIRED_LAYER/, "runCheck → master-derived DOORS requirement (field-merge fix)");
        t.match(res, /Geometry differences/, "runCheck → geometry section");
        t.match(res, /id="stdn-overlay"/, "runCheck → overlay mount point");
        t.match(res, /Export HTML report/, "runCheck → report export buttons");
        t.ok(SC.state.lastReport && SC.state.lastReport.source === "compare", "runCheck stashes the report for export");

        // The run also records itself into the CMS Submittal Vault (live-upload /
        // demo-sample results integrated with the seeded demo project data).
        if (subsBefore !== null) {
            const subs = CMS.getSubmittals();
            t.eq(subs.length, subsBefore + 1, "runCheck adds one CMS submittal record");
            const rec = subs[0];
            t.eq(rec.fileName, "target.dxf", "…for the checked file");
            t.eq(rec.status, "NEEDS REVIEW", "…status reflects the failed check, not a fake APPROVED default");
            t.lt(rec.score, 100, "…score reflects the real violations, not a fake 95/100 default");
            t.match(rec.sha256, /^[0-9a-f]{64}$/, "…a real 64-hex SHA-256 of the checked drawing, not the empty-string placeholder");
            t.ne(rec.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "…specifically not the hardcoded placeholder hash");
            t.ok(CMS.getProjects().some(p => p.id === rec.projectId), "…auto-assigned to a real project (no projectId required from the caller)");
        }

        // Heal run
        SC.state.mode = "heal";
        SC.state.files = { target: { name: "messy.dxf", text: S.messy }, master: { name: "master.dxf", text: S.master }, reference: null, standard: null };
        SC.state.healBlocks = true;
        await SC.runHeal(noToast);
        const hres = H("stdn-results");
        t.match(hres, /Partially corrected/, "runHeal → verdict");
        t.match(hres, /Applied automatically \(\d+\)/, "runHeal → actions section");
        t.match(hres, /Download corrected DXF/, "runHeal → download button");
        t.match(hres, /MISSING_REQUIRED_STYLE/, "runHeal → the item left for manual review");
        t.ok(SC.state.lastHeal && SC.state.lastHeal.source === "heal", "runHeal stashes the result for export");
        if (subsBefore !== null) {
            const rec = CMS.getSubmittals()[0];
            t.eq(rec.fileName, "messy.dxf", "runHeal also records a CMS submittal, for the healed file");
            t.eq(rec.status, "PARTIALLY CORRECTED", "…status reflects the auto-correct outcome");
        }

        // ── Home Page Target & Template Upload + Execute Grid tests ─
        t.group("stdn/grid-compare (Target & Template)");
        t.ok(typeof SC.executeGridComparison === "function", "SC.executeGridComparison exposed");
        t.ok(typeof SC.loadDemoPair === "function", "SC.loadDemoPair exposed");
        t.ok(typeof SC.resetGridUI === "function", "SC.resetGridUI exposed");

        // Load demo pair
        SC.loadDemoPair(noToast);
        t.ok(SC.gridState.targetFile && SC.gridState.targetFile.name, "demo loaded target file");
        t.ok(SC.gridState.templateFile && SC.gridState.templateFile.name, "demo loaded template file");

        // Execute grid comparison
        SC.executeGridComparison(noToast);
        t.gt(SC.gridState.results.length, 0, "executeGridComparison evaluated items");
        const matchItem = SC.gridState.results.find(r => r.status === "MATCH");
        t.ok(matchItem, "grid has MATCH items");
        const mismatchItem = SC.gridState.results.find(r => r.status === "MISMATCH");
        t.ok(mismatchItem, "grid has MISMATCH items");
        const missingItem = SC.gridState.results.find(r => r.status === "MISSING");
        t.ok(missingItem, "grid has MISSING items");

        // Check grid HTML rendering
        const gridBody = H("compare-results-tbody");
        t.match(gridBody, /MATCH/, "grid table renders MATCH badge");
        t.match(gridBody, /MISMATCH/, "grid table renders MISMATCH badge");
        t.match(gridBody, /MISSING/, "grid table renders MISSING badge");
        t.match(gridBody, /WALLS/, "grid table includes WALLS layer");

        // Filter testing
        SC.gridState.activeFilter = "mismatch";
        SC.renderResultsGrid();
        const mismOnly = H("compare-results-tbody");
        t.match(mismOnly, /MISMATCH/, "mismatch filter displays MISMATCH rows");

        // Search testing
        SC.gridState.activeFilter = "all";
        SC.gridState.searchTerm = "WALLS";
        SC.renderResultsGrid();
        const wallsOnly = H("compare-results-tbody");
        t.match(wallsOnly, /WALLS/, "search filter displays matching items");

        // Reset
        SC.resetGridUI(noToast);
        t.eq(SC.gridState.results.length, 0, "resetGridUI clears results");
        t.eq(SC.gridState.targetFile, null, "resetGridUI clears targetFile");
        t.eq(SC.gridState.templateFile, null, "resetGridUI clears templateFile");

        // guardrails
        SC.state.files = { target: null, reference: null, master: null, standard: null };
        let toasted = "";
        await SC.runCheck({ showToast: (m) => { toasted = m; } });
        t.match(toasted, /Add a drawing/, "runCheck with no target → friendly toast, no throw");
    } finally {
        env.win.document.getElementById = realGEBI;
        env.win.DOMPurify = realPurify;
    }
};
