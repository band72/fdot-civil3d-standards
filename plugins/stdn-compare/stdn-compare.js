/**
 * Plugin: stdn-compare (Standards Compare — refined DXF comparer + self-heal)
 * plugins/stdn-compare/stdn-compare.js
 *
 * The tab UI over window.StdnEngine (see stdn-engine.js). Two modes:
 *
 *   Check     — validate a drawing against a JSON standard and/or a master
 *               template DXF (its LAYER/LTYPE/STYLE tables + BLOCKS become the
 *               rules), and/or geometry-diff it against a reference drawing.
 *               Renders a severity-filtered violations table, an added/removed/
 *               modified geometry breakdown, and an SVG diff overlay.
 *
 *   Self-heal — given a target + a master template, auto-correct the deficiencies
 *               that are safe to fix (layer colours/linetypes/lineweights,
 *               missing layers/linetypes/styles, stray colour overrides →
 *               ByLayer) and hand back a corrected .dxf, flagging renames /
 *               deletions / unit changes / (opt-in) blocks for manual review.
 *
 * Ported from the `standardcompare-plugin` React + Express project. The server
 * half (HTTP router, multer, CORS, rate limiter, filesystem standards dir) is
 * dropped — everything runs client-side. Registers via window.PluginRegistry.
 * Depends on stdn-engine.js and core/cogo.js (window.COGO.downloadText).
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "stdn-compare",
        version: "1.0.0",
        description: "Refined DXF standards comparer: JSON-standard + master-template checks, tolerance geometry diff with SVG overlay, and safe self-healing to a corrected .dxf.",
        tab: "tab-stdn-compare",
        icon: "fa-code-branch",
        tier: "Pro",
        dependencies: [],
    };

    const E = () => window.StdnEngine;
    const clean = s => window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(String(s ?? "")) : String(s ?? "");
    const MAX_DXF_CHARS = 8 * 1024 * 1024;

    // ── Bundled samples (the standardcompare-plugin test fixtures) ────────────
    const SAMPLES = {
        reference: `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n62\n7\n6\nCONTINUOUS\n70\n0\n0\nLAYER\n2\nWALLS\n62\n1\n6\nCONTINUOUS\n370\n25\n0\nLAYER\n2\nDIMS\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n0\nSTYLE\n2\nSTANDARD\n3\narial.ttf\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n0\nLINE\n8\nWALLS\n10\n100.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n50.0\n31\n0.0\n0\nCIRCLE\n8\n0\n10\n50.0\n20\n25.0\n30\n0.0\n40\n5.0\n0\nTEXT\n8\nDIMS\n10\n10.0\n20\n60.0\n30\n0.0\n40\n2.5\n1\nROOM A\n7\nSTANDARD\n0\nENDSEC\n0\nEOF\n`,
        target: `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n62\n7\n6\nCONTINUOUS\n70\n0\n0\nLAYER\n2\nWALLS\n62\n5\n6\nCONTINUOUS\n370\n25\n0\nLAYER\n2\nDIMS\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n0\nSTYLE\n2\nSTANDARD\n3\narial.ttf\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n0\nLINE\n8\nWALLS\n10\n100.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n60.0\n31\n0.0\n0\nCIRCLE\n8\n0\n10\n50.0\n20\n25.0\n30\n0.0\n40\n8.0\n0\nTEXT\n8\nDIMS\n10\n10.0\n20\n60.0\n30\n0.0\n40\n2.5\n1\nROOM A\n7\nSTANDARD\n0\nLINE\n8\ntemp_layer\n10\n20.0\n20\n20.0\n30\n0.0\n11\n40.0\n21\n40.0\n31\n0.0\n0\nENDSEC\n0\nEOF\n`,
        master: `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n62\n7\n6\nCONTINUOUS\n70\n0\n0\nLAYER\n2\nWALLS\n62\n1\n6\nCONTINUOUS\n370\n25\n0\nLAYER\n2\nDOORS\n62\n2\n6\nCONTINUOUS\n370\n18\n0\nLAYER\n2\nDIMS\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n0\nLTYPE\n2\nCONTINUOUS\n3\nSolid line\n0\nLTYPE\n2\nHIDDEN\n3\nHidden ____ ____ ____\n0\nENDTAB\n0\nTABLE\n2\nSTYLE\n0\nSTYLE\n2\nSTANDARD\n3\narial.ttf\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n8\n0\n2\nWINDOW-TAG\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n11\n5.0\n21\n0.0\n31\n0.0\n0\nENDBLK\n8\n0\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n0\nENDSEC\n0\nEOF\n`,
        messy: `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n62\n7\n6\nCONTINUOUS\n70\n0\n0\nLAYER\n2\nWALLS\n62\n5\n6\nCONTINUOUS\n370\n25\n0\nLAYER\n2\nDIMS\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nTABLE\n2\nLTYPE\n0\nLTYPE\n2\nCONTINUOUS\n3\nSolid line\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n62\n2\n10\n0.0\n20\n0.0\n30\n0.0\n11\n100.0\n21\n0.0\n31\n0.0\n0\nLINE\n8\nDIMS\n6\nHIDDEN\n10\n0.0\n20\n10.0\n30\n0.0\n11\n50.0\n21\n10.0\n31\n0.0\n0\nTEXT\n8\nDIMS\n10\n5.0\n20\n15.0\n30\n0.0\n40\n2.5\n1\nNOTE\n7\nSTANDARD\n0\nENDSEC\n0\nEOF\n`,
    };

    // ── State ───────────────────────────────────────────────────────────────
    const state = {
        mode: "check",              // "check" | "heal"
        files: { target: null, reference: null, master: null, standard: null }, // { name, text }
        standardId: "example-standard",
        useCustomStandard: false,
        healBlocks: false,
        lastReport: null,           // { source:"compare", data }
        lastHeal: null,             // { source:"heal", data, targetName }
    };

    const $ = id => document.getElementById(id);

    // ── File slots ──────────────────────────────────────────────────────────

    const SLOTS = {
        target:    { label: "Drawing to check", accept: ".dxf" },
        reference: { label: "Reference drawing (optional)", accept: ".dxf" },
        master:    { label: "Master template", accept: ".dxf" },
        standard:  { label: "Custom JSON standard", accept: ".json" },
    };

    function slotHtml(key) {
        const f = state.files[key];
        const s = SLOTS[key];
        return `
        <div class="glass-panel" style="padding:0.9rem 1rem; border:1px solid var(--border-subtle);">
          <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted);">${s.label}</div>
          <div id="stdn-slot-${key}" data-slot="${key}"
               style="margin-top:0.5rem; border:1.5px dashed var(--border-accent); border-radius:var(--radius-md); padding:0.9rem; text-align:center; cursor:pointer; background:var(--primary-light); transition:border-color var(--transition), background var(--transition);">
            ${f
                ? `<div style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><i class="fa-solid fa-file-lines" style="color:var(--success);"></i> ${clean(f.name)}</div>
                   <button class="btn btn-secondary btn-sm" data-slot-clear="${key}" style="margin-top:0.4rem; color:var(--danger); border-color:var(--danger-light);">Remove</button>`
                : `<i class="fa-solid fa-arrow-up-from-bracket" style="font-size:1.1rem; color:var(--primary);"></i>
                   <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.3rem;">Drop a <code>${s.accept}</code> or click to browse</div>`
            }
          </div>
          <input type="file" accept="${s.accept}" data-slot-input="${key}" style="display:none;">
        </div>`;
    }

    function renderControls() {
        const box = $("stdn-controls");
        if (!box) return;
        const heal = state.mode === "heal";

        const slots = ["target"]
            .concat(heal ? ["master"] : ["reference", "master", "standard"])
            .map(slotHtml).join("");

        const stdRow = heal ? "" : `
          <div class="form-group" style="margin-top:0.5rem;">
            <label>Built-in JSON standard <span style="color:var(--text-muted); font-weight:400;">(merged under a master template if one is supplied)</span></label>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
              <label style="font-size:0.78rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.3rem;">
                <input type="checkbox" id="stdn-use-custom" ${state.useCustomStandard ? "checked" : ""} style="width:auto;"> use uploaded JSON instead
              </label>
              <select id="stdn-std-select" style="min-width:260px;" ${state.useCustomStandard ? "disabled" : ""}>
                <option value="" ${state.standardId === "" ? "selected" : ""}>(none — geometry / master only)</option>
                ${Object.keys(E().BUILTIN_STANDARDS).map(id => `<option value="${id}" ${id === state.standardId ? "selected" : ""}>${clean(E().BUILTIN_STANDARDS[id].name)}</option>`).join("")}
              </select>
            </div>
          </div>`;

        const healRow = heal ? `
          <label style="font-size:0.8rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.4rem; margin-top:0.6rem;">
            <input type="checkbox" id="stdn-heal-blocks" ${state.healBlocks ? "checked" : ""} style="width:auto;">
            Also copy missing block definitions from the master
            <span style="color:var(--warning); font-size:0.72rem;">— verify BLOCK_RECORD refs in your CAD app afterward</span>
          </label>` : "";

        window.setSafeHTML(box, `
          <div style="display:inline-flex; border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; margin-bottom:0.9rem;">
            <button class="btn btn-sm ${heal ? "btn-secondary" : "btn-primary"}" id="stdn-mode-check" style="border-radius:0;">Check</button>
            <button class="btn btn-sm ${heal ? "btn-primary" : "btn-secondary"}" id="stdn-mode-heal" style="border-radius:0;">Self-heal</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:0.85rem;">${slots}</div>
          ${stdRow}
          ${healRow}
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center; margin-top:0.9rem;">
            <button class="btn btn-primary" id="stdn-run">${heal ? "Heal drawing" : "Run comparison"}</button>
            <button class="btn btn-secondary btn-sm" id="stdn-clear">Clear</button>
            <span style="width:1px; height:22px; background:var(--border-subtle); margin:0 0.25rem;"></span>
            <span style="font-size:0.75rem; color:var(--text-muted);">Samples:</span>
            <button class="btn btn-secondary btn-sm" id="stdn-sample-check">Load check sample</button>
            <button class="btn btn-secondary btn-sm" id="stdn-sample-heal">Load heal sample</button>
          </div>`);
    }

    // ── File I/O ────────────────────────────────────────────────────────────

    function acceptFile(key, file, ctx) {
        const rdr = new FileReader();
        rdr.onload = ev => {
            const text = String(ev.target.result || "");
            if (text.length > MAX_DXF_CHARS) { ctx.showToast(`${file.name} is larger than ${MAX_DXF_CHARS / 1048576} MB.`, true); return; }
            state.files[key] = { name: file.name, text };
            renderControls();
        };
        rdr.readAsText(file);
    }

    // ── Run: Check ──────────────────────────────────────────────────────────

    /** → { spec } (may be null for "no JSON standard") or { err }. */
    function resolveJsonStandard() {
        if (state.useCustomStandard) {
            const f = state.files.standard;
            if (!f) return { spec: null };                          // no file yet — rely on master/reference
            try { return { spec: JSON.parse(f.text) }; }
            catch (e) { return { err: `${f.name} is not valid JSON.` }; }
        }
        if (!state.standardId) return { spec: null };               // "(none)" picked
        try { return { spec: E().defaultResolveBuiltInStandard(state.standardId) }; }
        catch (e) { return { err: e.message }; }
    }

    function runCheck(ctx) {
        const { target, reference, master } = state.files;
        if (!target) { ctx.showToast("Add a drawing to check.", true); return; }

        const std = resolveJsonStandard();
        if (std.err) { ctx.showToast(std.err, true); return; }
        const jsonStandardSpec = std.spec;

        if (!reference && !master && !jsonStandardSpec) {
            ctx.showToast("Add a reference drawing, a master template, or pick a standard.", true); return;
        }

        let report;
        try {
            report = E().orchestrateCompare({
                targetText: target.text, targetFileName: target.name,
                referenceText: reference ? reference.text : null, referenceFileName: reference ? reference.name : null,
                masterText: master ? master.text : null, masterFileName: master ? master.name : null,
                jsonStandardSpec,
            });
        } catch (err) {
            ctx.showToast(err.message || "Comparison failed.", true);
            return;
        }
        state.lastReport = { source: "compare", data: report };
        state.lastHeal = null;
        renderResults(ctx);
        ctx.showToast(report.overall.passed ? "Passed — conforms to the standard." : "Comparison complete — see the results below.", !report.overall.passed);
    }

    // ── Run: Heal ───────────────────────────────────────────────────────────

    function runHeal(ctx) {
        const { target, master } = state.files;
        if (!target || !master) { ctx.showToast("Self-heal needs both a target drawing and a master template.", true); return; }
        let result;
        try {
            result = E().healDxf(master.text, target.text, { healBlocks: state.healBlocks });
        } catch (err) {
            ctx.showToast(err.message || "Healing failed.", true);
            return;
        }
        state.lastHeal = { source: "heal", data: result, targetName: target.name };
        state.lastReport = null;
        renderResults(ctx);
        ctx.showToast(result.summary.fullyHealed ? "Fully healed." : `${result.summary.actionsApplied} fix(es) applied, ${result.summary.unresolved} for manual review.`, !result.summary.fullyHealed);
    }

    // ── Results rendering ───────────────────────────────────────────────────

    const sevColor = s => s === "error" ? "var(--danger)" : (s === "warning" ? "var(--warning)" : "var(--accent)");

    function violationsTable(list, opts) {
        opts = opts || {};
        if (!list || !list.length) return `<div style="color:var(--success); font-size:0.85rem; padding:0.5rem 0;"><i class="fa-solid fa-circle-check"></i> None.</div>`;
        const order = { error: 0, warning: 1, info: 2 };
        const rows = [...list].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)).map(v => `
          <tr>
            <td><span class="badge" style="background:${sevColor(v.severity)}; font-size:0.62rem;">${clean(v.severity)}</span></td>
            <td style="font-family:var(--font-mono); font-size:0.72rem; color:var(--primary);">${clean(v.code)}</td>
            <td style="font-family:var(--font-mono); font-size:0.75rem;">${clean(v.layer || v.linetype || v.style || v.block || "—")}</td>
            <td style="font-size:0.8rem; color:var(--text-secondary);">${clean(v.message)}${opts.withReason && v.reason ? `<div style="color:var(--warning); font-size:0.72rem; margin-top:0.2rem;">${clean(v.reason)}</div>` : ""}</td>
          </tr>`).join("");
        return `<div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Sev</th><th>Code</th><th>Item</th><th>Description${opts.withReason ? " / why manual" : ""}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function statGrid(pairs) {
        return `<div style="display:grid; grid-template-columns:repeat(${pairs.length},1fr); gap:1px; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; margin:0.6rem 0;">
          ${pairs.map(([v, l, c]) => `<div style="background:var(--bg-surface); padding:0.85rem; text-align:center;">
            <div style="font-family:var(--font-mono); font-size:1.35rem; font-weight:800; color:${c || "var(--text-primary)"};">${v}</div>
            <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">${l}</div>
          </div>`).join("")}
        </div>`;
    }

    function geometrySection(gd) {
        if (!gd) return "";
        const s = gd.summary;
        const entRows = arr => arr.length
            ? arr.slice(0, 100).map(e => `<tr><td style="font-family:var(--font-mono); font-size:0.75rem;">${clean(e.type)}</td><td style="font-family:var(--font-mono); font-size:0.75rem;">${clean(e.layer)}</td></tr>`).join("")
              + (arr.length > 100 ? `<tr><td colspan="2" style="color:var(--text-muted);">… ${arr.length - 100} more</td></tr>` : "")
            : `<tr><td colspan="2" style="color:var(--text-muted);">none</td></tr>`;
        const modRows = gd.modified.length
            ? gd.modified.slice(0, 100).map(m => `<tr>
                <td style="font-family:var(--font-mono); font-size:0.75rem;">${clean(m.type)}</td>
                <td style="font-family:var(--font-mono); font-size:0.75rem;">${clean(m.layer)}</td>
                <td style="font-size:0.75rem;">${m.changes.map(c => `<div><strong>${clean(c.label)}:</strong> ${typeof c.from === "number" ? c.from.toFixed(3) : clean(c.from)} → ${typeof c.to === "number" ? c.to.toFixed(3) : clean(c.to)}${Number.isFinite(c.delta) ? ` <span style="color:var(--text-muted);">(Δ ${c.delta.toFixed(3)})</span>` : ""}</div>`).join("")}</td>
              </tr>`).join("")
            : `<tr><td colspan="3" style="color:var(--text-muted);">none</td></tr>`;
        return `
          <details open style="margin-top:0.75rem;"><summary style="cursor:pointer; font-weight:700;">Geometry differences</summary>
            ${statGrid([[s.unchanged, "Unchanged"], [s.added, "Added", "var(--primary)"], [s.removed, "Removed", "var(--danger)"], [s.modified, "Modified", "var(--warning)"]])}
            <div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Modified — type</th><th>Layer</th><th>Field changes</th></tr></thead><tbody>${modRows}</tbody></table></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:0.6rem;">
              <div><div style="font-size:0.72rem; font-weight:700; color:var(--primary); text-transform:uppercase;">Added (${s.added})</div><table class="data-table" style="width:100%; font-size:0.8rem;"><thead><tr><th>Type</th><th>Layer</th></tr></thead><tbody>${entRows(gd.added)}</tbody></table></div>
              <div><div style="font-size:0.72rem; font-weight:700; color:var(--danger); text-transform:uppercase;">Removed (${s.removed})</div><table class="data-table" style="width:100%; font-size:0.8rem;"><thead><tr><th>Type</th><th>Layer</th></tr></thead><tbody>${entRows(gd.removed)}</tbody></table></div>
            </div>
          </details>`;
    }

    function overlaySection(svgString, container) {
        if (!svgString || !container) return;
        try {
            const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
            const svg = doc.documentElement;
            if (svg && svg.nodeName.toLowerCase() === "svg") {
                svg.setAttribute("style", "width:100%; height:auto; max-height:440px; display:block;");
                container.replaceChildren(svg);
            }
        } catch (e) { /* overlay is optional */ }
    }

    function renderResults(ctx) {
        const box = $("stdn-results");
        if (!box) return;
        box.classList.remove("hidden");

        // ── Check result ────────────────────────────────────────────────────
        if (state.lastReport) {
            const r = state.lastReport.data;
            const passed = r.overall.passed;
            const legend = `
              <div style="display:flex; gap:1rem; flex-wrap:wrap; font-size:0.72rem; color:var(--text-muted); margin-bottom:0.4rem;">
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#9AA0A6;"></span> unchanged</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#2E7BE0;"></span> added</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#D0342C;"></span> removed</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#E08A00;"></span> modified</span>
              </div>`;

            window.setSafeHTML(box, `
              <div class="results-box" style="border-left-color:${passed ? "var(--success)" : "var(--warning)"};">
                <strong style="font-size:1rem; color:${passed ? "var(--success)" : "var(--warning)"};">${passed ? "Passed" : "Needs attention"}</strong>
                <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:0.2rem;">
                  ${r.standardsCheck ? (r.overall.standardsPassed ? "Conforms to the standard. " : `${r.standardsCheck.summary.errors} standards error(s). `) : ""}
                  ${r.geometryDiff ? (r.overall.geometryIdentical ? "Geometry matches the reference drawing." : `${r.geometryDiff.summary.added + r.geometryDiff.summary.removed + r.geometryDiff.summary.modified} geometry difference(s).`) : ""}
                </div>
              </div>
              ${r.overlaySvg ? `<div style="margin-top:0.75rem;">${legend}<div id="stdn-overlay" style="background:#0B1220; border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden;"></div></div>` : ""}
              ${r.standardsCheck ? `
                <details open style="margin-top:0.75rem;"><summary style="cursor:pointer; font-weight:700;">Standards violations (${r.standardsCheck.summary.total})</summary>
                  ${statGrid([[r.standardsCheck.summary.errors, "Errors", "var(--danger)"], [r.standardsCheck.summary.warnings, "Warnings", "var(--warning)"], [r.standardsCheck.summary.info, "Info", "var(--accent)"], [r.standardsCheck.summary.total, "Total"]])}
                  <div id="stdn-viol-filter" style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.5rem;">
                    ${["all", "error", "warning", "info"].map(s => `<button class="pill-btn ${s === "all" ? "active" : ""}" data-sev="${s}">${s === "all" ? `All (${r.standardsCheck.violations.length})` : `${s[0].toUpperCase()}${s.slice(1)} (${r.standardsCheck.violations.filter(v => v.severity === s).length})`}</button>`).join("")}
                  </div>
                  <div id="stdn-viol-body">${violationsTable(r.standardsCheck.violations)}</div>
                </details>` : ""}
              ${geometrySection(r.geometryDiff)}
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.85rem;">
                <button class="btn btn-secondary btn-sm" id="stdn-report-html"><i class="fa-solid fa-file-code"></i> Export HTML report</button>
                <button class="btn btn-secondary btn-sm" id="stdn-report-md"><i class="fa-solid fa-file-lines"></i> Export Markdown report</button>
                ${r.standardsCheck && !r.overall.standardsPassed ? `<span style="font-size:0.75rem; color:var(--text-muted); align-self:center;">Tip: switch to Self-heal with a master template to auto-correct these.</span>` : ""}
              </div>`);

            overlaySection(r.overlaySvg, $("stdn-overlay"));
            return;
        }

        // ── Heal result ────────────────────────────────────────────────────
        if (state.lastHeal) {
            const h = state.lastHeal.data;
            const s = h.summary;
            const actRows = h.actions.length
                ? h.actions.map(a => `<tr>
                    <td style="font-family:var(--font-mono); font-size:0.72rem; color:var(--primary);">${clean(a.code)}</td>
                    <td style="font-family:var(--font-mono); font-size:0.75rem;">${clean(a.layer || a.linetype || a.style || a.block || "—")}</td>
                    <td style="font-size:0.8rem;">${clean(a.action)}${a.to !== undefined ? ` → ${clean(a.to)}` : ""}${a.caveat ? `<div style="color:var(--warning); font-size:0.72rem; margin-top:0.2rem;">${clean(a.caveat)}</div>` : ""}</td>
                  </tr>`).join("")
                : `<tr><td colspan="3" style="color:var(--text-muted);">No automatic fixes were applied.</td></tr>`;

            window.setSafeHTML(box, `
              <div class="results-box" style="border-left-color:${s.fullyHealed ? "var(--success)" : "var(--warning)"};">
                <strong style="font-size:1rem; color:${s.fullyHealed ? "var(--success)" : "var(--warning)"};">${s.fullyHealed ? "Fully healed" : "Partially healed"}</strong>
                <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:0.2rem;">
                  ${s.actionsApplied} fix${s.actionsApplied === 1 ? "" : "es"} applied automatically.${s.unresolved > 0 ? ` ${s.unresolved} item${s.unresolved === 1 ? "" : "s"} need${s.unresolved === 1 ? "s" : ""} manual review.` : ""}
                </div>
              </div>
              ${statGrid([[s.violationsBefore, "Deficiencies", "var(--danger)"], [s.actionsApplied, "Auto-fixed", "var(--success)"], [s.unresolved, "Needs review", "var(--warning)"], [s.violationsAfter, "Remaining"]])}
              <button class="btn btn-primary" id="stdn-download-healed"><i class="fa-solid fa-download"></i> Download corrected DXF</button>
              <details open style="margin-top:0.75rem;"><summary style="cursor:pointer; font-weight:700;">Applied automatically (${h.actions.length})</summary>
                <div style="overflow-x:auto;"><table class="data-table" style="width:100%;"><thead><tr><th>Code</th><th>Item</th><th>Action taken</th></tr></thead><tbody>${actRows}</tbody></table></div>
              </details>
              <details ${h.unresolved.length ? "open" : ""} style="margin-top:0.5rem;"><summary style="cursor:pointer; font-weight:700; color:var(--warning);">Needs manual review (${h.unresolved.length})</summary>
                ${violationsTable(h.unresolved, { withReason: true })}
              </details>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.85rem;">
                <button class="btn btn-secondary btn-sm" id="stdn-report-html"><i class="fa-solid fa-file-code"></i> Export HTML report</button>
                <button class="btn btn-secondary btn-sm" id="stdn-report-md"><i class="fa-solid fa-file-lines"></i> Export Markdown report</button>
              </div>`);
            return;
        }

        box.classList.add("hidden");
    }

    // ── Exports ─────────────────────────────────────────────────────────────

    function exportReport(format, ctx) {
        const src = state.lastReport || state.lastHeal;
        if (!src) { ctx.showToast("Run a comparison or heal first.", true); return; }
        const meta = src.source === "heal"
            ? { targetFile: state.lastHeal.targetName, masterFile: state.files.master && state.files.master.name }
            : {};
        const model = E().buildReportModel({ source: src.source, data: src.data, meta });
        const content = format === "markdown" ? E().renderMarkdown(model) : E().renderHtml(model);
        const filename = E().suggestFilename(model, format);
        window.COGO.downloadText(filename, content, format === "markdown" ? "text/markdown" : "text/html");
        ctx.showToast(`Exported ${filename}.`);
    }

    // ── Plugin ──────────────────────────────────────────────────────────────

    const Plugin = {
        init() { renderControls(); },
        onTabActivate() { renderControls(); if (state.lastReport || state.lastHeal) renderResults({ showToast() {} }); },

        setupEvents(ctx) {
            const root = $("tab-stdn-compare");
            if (!root) return;

            // Delegated clicks for the dynamically-rendered controls + results.
            root.addEventListener("click", e => {
                const t = e.target.closest("button, [data-slot]");
                if (!t) return;
                const id = t.id;

                if (id === "stdn-mode-check" && state.mode !== "check") { state.mode = "check"; renderControls(); return; }
                if (id === "stdn-mode-heal" && state.mode !== "heal") { state.mode = "heal"; renderControls(); return; }
                if (id === "stdn-run") { state.mode === "heal" ? runHeal(ctx) : runCheck(ctx); return; }
                if (id === "stdn-clear") {
                    state.files = { target: null, reference: null, master: null, standard: null };
                    state.lastReport = state.lastHeal = null;
                    renderControls();
                    const rb = $("stdn-results"); if (rb) { rb.classList.add("hidden"); window.setSafeHTML(rb, ""); }
                    return;
                }
                if (id === "stdn-sample-check") {
                    state.mode = "check";
                    state.files.target = { name: "target.dxf", text: SAMPLES.target };
                    state.files.reference = { name: "reference.dxf", text: SAMPLES.reference };
                    state.files.master = { name: "master.dxf", text: SAMPLES.master };
                    state.files.standard = null; state.useCustomStandard = false;
                    renderControls(); ctx.showToast("Loaded the check sample (target + reference + master).");
                    return;
                }
                if (id === "stdn-sample-heal") {
                    state.mode = "heal";
                    state.files.target = { name: "messy.dxf", text: SAMPLES.messy };
                    state.files.master = { name: "master.dxf", text: SAMPLES.master };
                    renderControls(); ctx.showToast("Loaded the heal sample (messy target + master template).");
                    return;
                }
                if (id === "stdn-report-html") { exportReport("html", ctx); return; }
                if (id === "stdn-report-md") { exportReport("markdown", ctx); return; }
                if (id === "stdn-download-healed" && state.lastHeal) {
                    const out = (state.lastHeal.targetName || "drawing").replace(/\.dxf$/i, "") + ".healed.dxf";
                    window.COGO.downloadText(out, state.lastHeal.data.healedDxf, "application/dxf");
                    ctx.showToast(`Downloaded ${out}.`);
                    return;
                }

                const clearKey = t.getAttribute("data-slot-clear");
                if (clearKey) { state.files[clearKey] = null; renderControls(); return; }

                const slotDiv = t.matches("[data-slot]") ? t : t.closest("[data-slot]");
                if (slotDiv) {
                    const key = slotDiv.getAttribute("data-slot");
                    root.querySelector(`[data-slot-input="${key}"]`)?.click();
                    return;
                }

                const sev = t.getAttribute("data-sev");
                if (sev && state.lastReport && state.lastReport.data.standardsCheck) {
                    root.querySelectorAll("#stdn-viol-filter .pill-btn").forEach(b => b.classList.toggle("active", b === t));
                    const all = state.lastReport.data.standardsCheck.violations;
                    const list = sev === "all" ? all : all.filter(v => v.severity === sev);
                    window.setSafeHTML($("stdn-viol-body"), violationsTable(list));
                    return;
                }
            });

            root.addEventListener("change", e => {
                const fi = e.target.closest("[data-slot-input]");
                if (fi) {
                    const key = fi.getAttribute("data-slot-input");
                    const f = fi.files && fi.files[0];
                    if (f) acceptFile(key, f, ctx);
                    fi.value = "";
                    return;
                }
                if (e.target.id === "stdn-use-custom") { state.useCustomStandard = e.target.checked; renderControls(); return; }
                if (e.target.id === "stdn-std-select") { state.standardId = e.target.value; return; }
                if (e.target.id === "stdn-heal-blocks") { state.healBlocks = e.target.checked; return; }
            });

            // Drag & drop onto a slot.
            root.addEventListener("dragover", e => { const s = e.target.closest("[data-slot]"); if (s) { e.preventDefault(); s.style.borderColor = "var(--primary)"; } });
            root.addEventListener("dragleave", e => { const s = e.target.closest("[data-slot]"); if (s) s.style.borderColor = "var(--border-accent)"; });
            root.addEventListener("drop", e => {
                const s = e.target.closest("[data-slot]");
                if (!s) return;
                e.preventDefault();
                s.style.borderColor = "var(--border-accent)";
                const f = e.dataTransfer.files && e.dataTransfer.files[0];
                if (f) acceptFile(s.getAttribute("data-slot"), f, ctx);
            });
        },
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);

    // Exposed for console debugging / tests.
    window.StdnCompare = { state, SAMPLES, runCheck, runHeal };
})();
