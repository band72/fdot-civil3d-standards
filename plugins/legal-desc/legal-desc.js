/**
 * Plugin: legal-desc (Legal Description QC)
 * plugins/legal-desc/legal-desc.js
 *
 * Ported from the BoundaryQC desktop app (Services/Writer/CallExtractor.cs +
 * LegalDescriptionQc.cs + TraverseGeometryEngine.cs). Parses a narrative
 * metes-and-bounds legal description into line/curve calls, runs a chord-trace
 * closure, computes Shoelace area, applies QC rules, and exports a P,N,E,Z,D
 * coordinate file plus a Map Check Report.
 *
 * Registers via window.PluginRegistry. Depends on core/cogo.js (window.COGO).
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "legal-desc",
        version: "1.0.0",
        description: "Narrative metes-and-bounds legal description parser, closure + Shoelace area, QC rules, and PNEZD / Map Check export.",
        tab: "tab-legal-desc",
        icon: "fa-file-lines",
        tier: "Pro",
        dependencies: ["security-pki"]
    };

    const PRECISION_PASS_DEFAULT = 10000; // 1:10,000 survey-grade closure (FL Rule 5J-17)
    // Threshold comes from the active client master template when one is set.
    function PRECISION_PASS_() {
        const v = window.BoundaryQCCMS && window.BoundaryQCCMS.getActiveTemplateSetting
            ? window.BoundaryQCCMS.getActiveTemplateSetting("precisionPass", PRECISION_PASS_DEFAULT)
            : PRECISION_PASS_DEFAULT;
        return Number(v) || PRECISION_PASS_DEFAULT;
    }
    let _last = null;             // last parse result, for the export buttons

    // ── Parsing ──────────────────────────────────────────────────────────────

    const SEGMENT_SPLIT = /(?=\b(?:THENCE|COMMENC(?:E|ING)|BEGINNING\s+AT|POINT\s+OF\s+BEGINNING)\b)/i;
    const DIST_RX = /(?:distance\s+of\s+|run\s+|for\s+)?([\d,]+(?:\.\d+)?)\s*(?:feet|foot|ft\b|')/i;
    const RADIUS_RX = /radius\s+of\s+([\d,]+(?:\.\d+)?)\s*(?:feet|foot|ft\b|')/i;
    const ARC_RX = /arc\s+(?:length\s+|distance\s+)?(?:of\s+)?([\d,]+(?:\.\d+)?)\s*(?:feet|foot|ft\b|')/i;
    const CHORD_DIST_RX = /chord\s+(?:distance|length)\s+(?:of\s+)?([\d,]+(?:\.\d+)?)\s*(?:feet|foot|ft\b|')/i;
    // Grab the whole chord-bearing phrase up to a delimiter; parseBearing pulls the DMS out.
    const CHORD_BRG_RX = /chord\s+bearing\s+(?:of\s+)?([^,;\n]+?)(?=,|;|\n|\bchord\s+(?:distance|length)\b|$)/i;
    const CONCAVE_RX = /concave\s+(?:to\s+the\s+)?([A-Za-z]+(?:erly)?)/i;
    const DELTA_RX = /(?:central\s+angle|delta)\s+(?:of\s+)?(\d{1,3})\s*[^\d\s]?\s*(\d{1,2})?\s*['’′]?\s*(\d{1,2}(?:\.\d+)?)?/i;
    const NUM = s => parseFloat(String(s).replace(/,/g, ""));

    function classify(text) {
        const t = text.toUpperCase();
        if (/SECTION\s+\d+.*TOWNSHIP|T\.?\s*\d+\s*[NS].*R\.?\s*\d+\s*[EW]/.test(t) &&
            !/\d+\s*°|\d+\s+DEGREES/.test(t)) {
            return "SECTION_BREAKDOWN";
        }
        return "METES_AND_BOUNDS";
    }

    function parse(text) {
        const calls = [];
        const issues = [];
        const cls = classify(text);
        if (cls === "SECTION_BREAKDOWN") {
            issues.push({ sev: "WARNING", code: "LOOKS_LIKE_PLSS",
                msg: "This reads like a PLSS section-breakdown (aliquot parts), not metes-and-bounds. Use the PLSS Section Breakdown tab." });
        }

        const segs = text.split(SEGMENT_SPLIT).map(s => s.trim()).filter(s => s.length > 4);
        let li = 0, ci = 0;

        for (const seg of segs) {
            const hasCurve = RADIUS_RX.test(seg) || /\barc\b/i.test(seg) || /\bchord\b/i.test(seg);
            if (hasCurve) {
                const radius = RADIUS_RX.test(seg) ? NUM(seg.match(RADIUS_RX)[1]) : 0;
                const arc = ARC_RX.test(seg) ? NUM(seg.match(ARC_RX)[1]) : 0;
                let chordDist = CHORD_DIST_RX.test(seg) ? NUM(seg.match(CHORD_DIST_RX)[1]) : 0;
                const chordBrgTxt = CHORD_BRG_RX.test(seg) ? seg.match(CHORD_BRG_RX)[1].trim() : "";
                const concavity = CONCAVE_RX.test(seg) ? seg.match(CONCAVE_RX)[1] : "";
                let deltaDeg = 0;
                const dm = seg.match(DELTA_RX);
                if (dm) deltaDeg = (+dm[1]) + (+(dm[2] || 0)) / 60 + (+(dm[3] || 0)) / 3600;

                let backSolved = false;
                if (chordDist <= 0 && radius > 0 && arc > 0) {
                    chordDist = window.COGO.chordFromArc(radius, arc);
                    backSolved = true;
                }
                if (deltaDeg <= 0 && radius > 0 && arc > 0) deltaDeg = window.COGO.deltaDegFromArc(radius, arc);

                const brg = window.COGO.parseBearing(chordBrgTxt);
                ci++;
                calls.push({
                    kind: "curve", label: `C${ci}`,
                    radius, arc, chordDist, deltaDeg, concavity,
                    chordAzimuthDeg: brg ? brg.azimuthDeg : null,
                    chordBearingText: brg ? window.COGO.azimuthToBearing(brg.azimuthDeg) : (chordBrgTxt || "(missing)"),
                    backSolved, raw: seg
                });
                continue;
            }

            const brg = window.COGO.parseBearing(seg);
            const dm = seg.match(DIST_RX);
            if (brg && dm) {
                li++;
                calls.push({
                    kind: "line", label: `L${li}`,
                    bearingText: window.COGO.azimuthToBearing(brg.azimuthDeg),
                    azimuthDeg: brg.azimuthDeg,
                    distance: NUM(dm[1]),
                    raw: seg
                });
            }
        }
        return { calls, issues, classification: cls, rawText: text };
    }

    // ── QC (ported from LegalDescriptionQc.Check) ────────────────────────────

    function qc(parsed, traverse) {
        const issues = [...parsed.issues];
        const geomCalls = parsed.calls.length;

        if (geomCalls < 3) {
            issues.push({ sev: "ERROR", code: "TOO_FEW_CALLS",
                msg: "A closed parcel generally requires at least three boundary calls." });
        }

        parsed.calls.forEach(c => {
            if (c.kind === "line" && !(c.distance > 0)) {
                issues.push({ sev: "ERROR", code: "BAD_LINE_DISTANCE", msg: `${c.label}: line distance must be greater than zero.` });
            }
            if (c.kind === "curve") {
                if (!(c.radius > 0)) issues.push({ sev: "ERROR", code: "BAD_CURVE_RADIUS", msg: `${c.label}: curve radius must be greater than zero.` });
                if (!(c.arc > 0)) issues.push({ sev: "ERROR", code: "BAD_CURVE_ARC", msg: `${c.label}: curve arc length must be greater than zero.` });
                if (!(c.chordDist > 0)) issues.push({ sev: "ERROR", code: "UNRESOLVED_CURVE", msg: `${c.label}: missing chord distance and could not be back-solved.` });
                if (c.chordAzimuthDeg == null) issues.push({ sev: "WARNING", code: "MISSING_CHORD_BEARING", msg: `${c.label}: chord bearing could not be parsed.` });
                if (c.radius > 0 && c.arc > 0 && c.chordDist > 0) {
                    const expected = window.COGO.chordFromArc(c.radius, c.arc);
                    const diff = Math.abs(expected - c.chordDist);
                    if (diff > 0.1) {
                        issues.push({ sev: "ERROR", code: "CURVE_GEOMETRY_INCONSISTENT",
                            msg: `${c.label}: R/Arc/Chord inconsistent — computed chord ≈ ${expected.toFixed(3)} ft vs stated ${c.chordDist.toFixed(3)} ft (Δ ${diff.toFixed(3)} ft). Check for swapped Radius/Arc or wrong Delta units.` });
                    }
                }
            }
        });

        if (/\b(LESS|SAVE)\s+AND\s+EXCEPT\b/i.test(parsed.rawText)) {
            issues.push({ sev: "WARNING", code: "EXCLUSION_NOT_SUBTRACTED",
                msg: "Description contains an exception (LESS AND EXCEPT). Computed acreage is the GROSS area and does not subtract the excepted tract." });
        }
        if (/encroachment/i.test(parsed.rawText)) {
            issues.push({ sev: "WARNING", code: "LEGAL_CONCLUSION_LANGUAGE",
                msg: "Avoid legal-conclusion language such as 'encroachment'; use observed-condition wording." });
        }

        if (traverse && geomCalls >= 3) {
            if (traverse.misclosure > 0.02) {
                issues.push({ sev: "ERROR", code: "CLOSURE_FAIL",
                    msg: `Boundary does not close: misclosure ${traverse.misclosure.toFixed(3)} ft.` });
            } else if (traverse.precisionDenominator !== Infinity && traverse.precisionDenominator < PRECISION_PASS_()) {
                issues.push({ sev: "WARNING", code: "PRECISION_WARNING",
                    msg: `Closure precision below survey grade: 1:${Math.round(traverse.precisionDenominator).toLocaleString()} (need ≥ 1:${PRECISION_PASS_().toLocaleString()}).` });
            }
            const bt = window.COGO.selfIntersects(traverse.vertices.slice(0, -1));
            if (bt) issues.push({ sev: "ERROR", code: "SELF_INTERSECTION",
                msg: `Plotted boundary self-intersects: call ${bt.i} crosses call ${bt.j}.` });
        }
        return issues;
    }

    // ── Report ──────────────────────────────────────────────────────────────

    function mapCheckReport(parsed, traverse, issues) {
        const L = [];
        L.push("=== BoundaryQC Map Check Report — Legal Description ===");
        L.push(`Generated: ${new Date().toISOString()}`);
        L.push(`Classification: ${parsed.classification}`);
        L.push("");
        L.push("[QA: Parsed Calls]");
        parsed.calls.forEach(c => {
            if (c.kind === "line") L.push(`  ${c.label}  ${c.bearingText}  ${c.distance.toFixed(2)} ft`);
            else L.push(`  ${c.label}  R=${c.radius.toFixed(2)}  Arc=${c.arc.toFixed(2)}  Chord=${c.chordDist.toFixed(2)} ${c.chordBearingText}  Δ=${c.deltaDeg.toFixed(4)}°${c.backSolved ? "  [chord back-solved]" : ""}`);
        });
        L.push("");
        L.push("[QA: Mathematical Closure & Area]");
        if (traverse) {
            L.push(`  Raw linear misclosure: ${traverse.misclosure.toFixed(3)} ft  (ΔE ${(traverse.vertices[0].e - traverse.vertices[traverse.vertices.length-1].e).toFixed(3)}, ΔN ${(traverse.vertices[0].n - traverse.vertices[traverse.vertices.length-1].n).toFixed(3)})`);
            L.push(`  Precision ratio: ${traverse.precisionDenominator === Infinity ? "exact" : "1 : " + Math.round(traverse.precisionDenominator).toLocaleString()}`);
            L.push(`  Perimeter: ${traverse.perimeter.toFixed(2)} ft`);
            L.push(`  Computed area (Shoelace): ${traverse.areaSqFt.toFixed(2)} sq ft = ${traverse.areaAcres.toFixed(2)} acres`);
            L.push(`  Status: ${traverse.misclosure <= 0.02 && (traverse.precisionDenominator === Infinity || traverse.precisionDenominator >= PRECISION_PASS_()) ? "[PASS]" : "[FAIL/WARNING]"}`);
        } else {
            L.push("  Not enough parsable geometry to compute closure.");
        }
        L.push("");
        L.push("[QA: Issues]");
        if (!issues.length) L.push("  (none)");
        issues.forEach(i => L.push(`  [${i.sev}] ${i.code}: ${i.msg}`));
        L.push("");
        L.push("[Coordinate File — P,N,E,Z,D]");
        if (traverse) L.push(window.COGO.pnezd(traverse.vertices.slice(0, -1)));
        return L.join("\r\n");
    }

    // ── Render ──────────────────────────────────────────────────────────────

    function run(ctx) {
        const input = document.getElementById("legal-desc-input")?.value.trim() || "";
        const box = document.getElementById("legal-desc-results");
        if (!box) return;
        box.classList.remove("hidden");

        if (!input) {
            window.setSafeHTML(box, `<strong style="color:var(--danger);">Paste a legal description to analyze.</strong>`);
            return;
        }

        const parsed = parse(input);
        let traverse = null;
        if (parsed.calls.length >= 2 && parsed.calls.every(c => c.kind === "line" ? c.azimuthDeg != null : c.chordAzimuthDeg != null)) {
            const legs = parsed.calls.map(c => c.kind === "curve"
                ? { kind: "curve", chordAzimuthDeg: c.chordAzimuthDeg, chordDistance: c.chordDist, arcLength: c.arc }
                : { kind: "line", azimuthDeg: c.azimuthDeg, distance: c.distance });
            traverse = window.COGO.runTraverse(legs);
        }
        const issues = qc(parsed, traverse);
        _last = { parsed, traverse, issues };

        const errN = issues.filter(i => i.sev === "ERROR").length;
        const rows = parsed.calls.map(c => c.kind === "line"
            ? `<tr><td>${c.label}</td><td>Line</td><td style="font-family:var(--font-mono);">${c.bearingText}</td><td style="font-family:var(--font-mono);">${c.distance.toFixed(2)} ft</td></tr>`
            : `<tr><td>${c.label}</td><td>Curve</td><td style="font-family:var(--font-mono);">${c.chordBearingText}${c.backSolved ? ' <span style="color:var(--warning);">(chord back-solved)</span>' : ''}</td><td style="font-family:var(--font-mono);">R ${c.radius.toFixed(2)} · Arc ${c.arc.toFixed(2)} · Chord ${c.chordDist.toFixed(2)}</td></tr>`
        ).join("");

        const closureHtml = traverse
            ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:0.75rem;">
                 <div style="background:var(--bg-surface); padding:0.75rem; border-radius:var(--radius-sm);">
                   <small style="color:var(--text-muted);">Linear misclosure</small>
                   <div style="font-weight:700;">${traverse.misclosure.toFixed(3)} ft</div>
                   <small style="color:var(--text-muted);">Perimeter ${traverse.perimeter.toFixed(2)} ft</small>
                 </div>
                 <div style="background:var(--bg-surface); padding:0.75rem; border-radius:var(--radius-sm);">
                   <small style="color:var(--text-muted);">Precision</small>
                   <div style="font-weight:700; color:${traverse.precisionDenominator === Infinity || traverse.precisionDenominator >= PRECISION_PASS_() ? 'var(--success)' : 'var(--danger)'};">
                     ${traverse.precisionDenominator === Infinity ? 'exact' : '1 : ' + Math.round(traverse.precisionDenominator).toLocaleString()}</div>
                   <small style="color:var(--text-muted);">Area ${traverse.areaAcres.toFixed(2)} ac (${traverse.areaSqFt.toFixed(0)} sf)</small>
                 </div>
               </div>`
            : `<p style="color:var(--warning); margin-top:0.5rem;">Not enough resolved geometry for a closure — check bearings/distances above.</p>`;

        const issueHtml = issues.length
            ? issues.map(i => `<div class="qc-item ${i.sev.toLowerCase()}" style="margin-top:0.4rem;"><div class="qc-item-content"><h4>${i.code} <span class="tag tag-discipline">${i.sev}</span></h4><p>${i.msg}</p></div></div>`).join("")
            : `<div style="color:var(--success); padding:0.5rem 0;"><i class="fa-solid fa-circle-check"></i> No QC issues.</div>`;

        window.setSafeHTML(box, `
            <h4 style="font-size:1rem; font-weight:700;"><i class="fa-solid fa-list-check" style="color:var(--success);"></i> Parsed ${parsed.calls.length} calls · ${errN} error(s)</h4>
            <div style="overflow-x:auto; margin-top:0.5rem;">
              <table class="data-table" style="width:100%; font-size:0.8rem;">
                <thead><tr><th>#</th><th>Type</th><th>Bearing</th><th>Geometry</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4">No line/curve calls recognized.</td></tr>'}</tbody>
              </table>
            </div>
            ${closureHtml}
            <div style="margin-top:0.75rem;">${issueHtml}</div>
        `);

        if (ctx) ctx.showToast(`Legal description: ${parsed.calls.length} calls, ${errN} error(s).`, errN > 0);
    }

    const Plugin = {
        init() {
            const ta = document.getElementById("legal-desc-input");
            if (ta && !ta.value) {
                ta.value =
                    "BEGINNING at the POINT OF BEGINNING; thence North 45 degrees 12 minutes 30 seconds East, a distance of 150.00 feet; " +
                    "thence South 44 degrees 47 minutes 30 seconds East, a distance of 200.00 feet; " +
                    "thence South 45 degrees 12 minutes 30 seconds West, a distance of 150.00 feet; " +
                    "thence North 44 degrees 47 minutes 30 seconds West, a distance of 200.00 feet to the POINT OF BEGINNING.";
            }
        },
        setupEvents(ctx) {
            document.getElementById("btn-parse-legal-desc")?.addEventListener("click", () => run(ctx));
            document.getElementById("btn-legal-desc-pnezd")?.addEventListener("click", () => {
                if (!_last || !_last.traverse) { ctx.showToast("Run a parse with resolved geometry first.", true); return; }
                window.COGO.downloadText("legal_description_coordinates.txt", window.COGO.pnezd(_last.traverse.vertices.slice(0, -1)), "text/csv");
                ctx.showToast("Exported P,N,E,Z,D coordinate file.");
            });
            document.getElementById("btn-legal-desc-report")?.addEventListener("click", () => {
                if (!_last) { ctx.showToast("Run a parse first.", true); return; }
                window.COGO.downloadText("legal_description_mapcheck.log", mapCheckReport(_last.parsed, _last.traverse, _last.issues));
                ctx.showToast("Exported Map Check Report.");
            });
        },
        onTabActivate(ctx) { if (_last) run(ctx); }
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);

    // Exposed for console debugging / tests.
    window.LegalDesc = { parse, qc, mapCheckReport };
})();
