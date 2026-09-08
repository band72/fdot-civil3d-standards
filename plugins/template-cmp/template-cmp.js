/**
 * Plugin: template-cmp (Start — Template Compare)
 * plugins/template-cmp/template-cmp.js
 *
 * The app's start page. Pick a STANDARDS TEMPLATE — a DXF whose layer table
 * defines the standard (uploaded, or one of the saved / built-in ones) — then
 * drop a project DXF and diff its layer table against the template:
 *   - layers in the standard that the drawing is missing
 *   - layers in the drawing that are not in the standard
 *   - layers in both whose colour / linetype / lineweight / plot flag differ
 *   - entities on Layer 0 / DEFPOINTS / a non-standard layer
 * Exports a diff report and an AutoCAD .scr that conforms the drawing.
 *
 * Depends on window.FDOTDXFInspector (dxf-parser.js) and window.FDOT_DATA.
 * Registers via window.PluginRegistry. Exposes window.TemplateCmp.
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "template-cmp",
        version: "1.0.0",
        description: "Start page: pick or upload a standards-template DXF, then diff a drawing's layer table against it (missing / extra / mismatched layers + entity placement).",
        tab: "tab-start",
        icon: "fa-code-compare",
        tier: "Free",
        dependencies: []
    };

    const K_TEMPLATES = "bqc_std_templates";
    const K_ACTIVE = "bqc_std_active_template";
    const BUILTIN_ID = "__fdot2026";
    const MAX_DXF_CHARS = 4 * 1024 * 1024;

    const readJSON = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const clean = s => window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(String(s ?? "")) : String(s ?? "");
    const uid = p => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // ── Template store ───────────────────────────────────────────────────────

    function builtinTemplate() {
        return {
            id: BUILTIN_ID, name: "FDOT 2026 Standard (built-in)", builtin: true,
            layers: ((window.FDOT_DATA && window.FDOT_DATA.layers) || []).map(l => ({
                name: l.name, color: l.color, linetype: l.linetype, lineweight: l.lineweight, plot: l.plot
            }))
        };
    }
    function getTemplates() { return [builtinTemplate(), ...readJSON(K_TEMPLATES, [])]; }
    function getActiveId() { return localStorage.getItem(K_ACTIVE) || BUILTIN_ID; }
    function setActive(id) { localStorage.setItem(K_ACTIVE, id || BUILTIN_ID); }
    function getActive() { return getTemplates().find(t => t.id === getActiveId()) || builtinTemplate(); }

    function saveUploadedTemplate(name, dxfText) {
        if (typeof dxfText !== "string" || !dxfText.trim()) throw new Error("Empty file.");
        if (dxfText.length > MAX_DXF_CHARS) throw new Error("Template DXF is larger than 4 MB — trim it to the layer table (a .dwt exported as DXF) and retry.");
        const parsed = new window.FDOTDXFInspector(window.FDOT_DATA).parseDXF(dxfText);
        if (!parsed.layers.length) throw new Error("No LAYER table found in that DXF — is it an ASCII DXF with a layer table?");
        const store = readJSON(K_TEMPLATES, []);
        const tpl = { id: uid("tpl"), name: clean(name || "Uploaded template").slice(0, 80), createdAt: new Date().toISOString(), layerCount: parsed.layers.length, dxfText };
        store.push(tpl);
        if (!writeJSON(K_TEMPLATES, store)) throw new Error("Could not save — browser storage is full. Delete an old template and retry.");
        setActive(tpl.id);
        return tpl;
    }
    function deleteTemplate(id) {
        if (id === BUILTIN_ID) return;
        writeJSON(K_TEMPLATES, readJSON(K_TEMPLATES, []).filter(t => t.id !== id));
        if (getActiveId() === id) setActive(BUILTIN_ID);
    }
    function templateLayers(tpl) {
        if (!tpl) return [];
        if (tpl.builtin || tpl.layers) return tpl.layers || builtinTemplate().layers;
        try { return new window.FDOTDXFInspector(window.FDOT_DATA).parseDXF(tpl.dxfText).layers; }
        catch (e) { return []; }
    }

    // ── Comparison ──────────────────────────────────────────────────────────

    const normLt = v => String(v || "").trim().toUpperCase();
    function normLw(v) {
        if (v == null || v === "" || v === -1 || v === -2 || v === -3) return null;   // BYLAYER / BYBLOCK / DEFAULT
        if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) : null; }
        return Math.round(v);
    }

    /**
     * @param {Array} tmplLayers  standard layer records { name, color, linetype, lineweight, plot }
     * @param {Object} project    result of FDOTDXFInspector.parseDXF()
     * @param {Object} opts        { checkPlot }
     */
    function compareStandards(tmplLayers, project, opts) {
        opts = opts || {};
        const T = new Map((tmplLayers || []).filter(l => l && l.name).map(l => [l.name.toUpperCase(), l]));
        const P = new Map((project.layers || []).filter(l => l && l.name).map(l => [l.name.toUpperCase(), l]));

        const missing = [], extra = [], mismatch = [], okLayers = [];

        T.forEach((tl, key) => {
            const pl = P.get(key);
            if (!pl) { missing.push(tl); return; }
            const diffs = [];
            if (Number.isFinite(tl.color) && Number.isFinite(pl.color) && tl.color !== 256 && pl.color !== 256 && tl.color !== pl.color)
                diffs.push({ prop: "Colour (ACI)", template: String(tl.color), project: String(pl.color) });
            const tlt = normLt(tl.linetype), plt = normLt(pl.linetype);
            if (tlt && plt && tlt !== "BYLAYER" && plt !== "BYLAYER" && tlt !== plt)
                diffs.push({ prop: "Linetype", template: tl.linetype, project: pl.linetype });
            const tlw = normLw(tl.lineweight), plw = normLw(pl.lineweight);
            if (tlw != null && plw != null && tlw !== plw)
                diffs.push({ prop: "Lineweight", template: (tlw / 100).toFixed(2), project: (plw / 100).toFixed(2) });
            if (opts.checkPlot && typeof tl.plot === "boolean" && typeof pl.plot === "boolean" && tl.plot !== pl.plot)
                diffs.push({ prop: "Plot", template: tl.plot ? "Plot" : "No-Plot", project: pl.plot ? "Plot" : "No-Plot" });
            if (diffs.length) mismatch.push({ name: pl.name, diffs }); else okLayers.push(pl.name);
        });
        P.forEach((pl, key) => { if (!T.has(key)) extra.push(pl); });

        const valid = new Set(T.keys());
        const entIssues = [];
        (project.entities || []).forEach((e, i) => {
            const ln = String(e.layer || "0").toUpperCase();
            if (ln === "0") entIssues.push({ sev: "CRITICAL", layer: e.layer, msg: `${e.type} #${i + 1} is on Layer 0.` });
            else if (ln === "DEFPOINTS") entIssues.push({ sev: "WARNING", layer: e.layer, msg: `${e.type} #${i + 1} is on DEFPOINTS.` });
            else if (!valid.has(ln)) entIssues.push({ sev: "HIGH", layer: e.layer, msg: `${e.type} #${i + 1} is on non-standard layer \`${e.layer}\`.` });
        });

        let score = 100
            - missing.length * 3
            - extra.length * 6
            - mismatch.reduce((s, m) => s + m.diffs.length * 4, 0)
            - entIssues.filter(x => x.sev === "CRITICAL").length * 4
            - entIssues.filter(x => x.sev === "HIGH").length * 3
            - entIssues.filter(x => x.sev === "WARNING").length * 1;
        score = Math.max(0, Math.min(100, Math.round(score)));

        return { missing, extra, mismatch, okLayers, entIssues, score, templateCount: T.size, projectCount: P.size };
    }

    function diffReport(templateName, projectName, r) {
        const L = [];
        L.push("=== Standards Comparison Report ===");
        L.push(`Generated:  ${new Date().toISOString()}`);
        L.push(`Template:   ${templateName}  (${r.templateCount} layers)`);
        L.push(`Drawing:    ${projectName}  (${r.projectCount} layers)`);
        L.push(`Score:      ${r.score} / 100    (${r.okLayers.length} layers conform)`);
        L.push("");
        L.push(`[Layers in the standard but MISSING from the drawing]  (${r.missing.length})`);
        r.missing.forEach(l => L.push(`  - ${l.name}   ACI ${l.color}  ${l.linetype}`));
        L.push("");
        L.push(`[Layers in the drawing that are NOT in the standard]  (${r.extra.length})`);
        r.extra.forEach(l => L.push(`  + ${l.name}   ACI ${l.color}  ${l.linetype}`));
        L.push("");
        L.push(`[Layers present in both with MISMATCHED properties]  (${r.mismatch.length})`);
        r.mismatch.forEach(m => {
            L.push(`  ~ ${m.name}`);
            m.diffs.forEach(d => L.push(`      ${d.prop}:  standard = ${d.template}   drawing = ${d.project}`));
        });
        L.push("");
        L.push(`[Entity placement]  (${r.entIssues.length})`);
        r.entIssues.slice(0, 200).forEach(e => L.push(`  [${e.sev}] ${e.msg}`));
        return L.join("\r\n");
    }

    function fixScript(templateName, tmplLayers, r) {
        const q = s => `"${String(s).replace(/"/g, "")}"`;
        const byName = new Map((tmplLayers || []).map(l => [l.name.toUpperCase(), l]));
        const L = [];
        L.push(`; Conform drawing to standard: ${templateName}`);
        L.push(`; Generated by FDOT Civil3D Standards — review in a scratch copy first.`);
        L.push(`_.AUDIT _Yes`);
        r.missing.forEach(l => {
            L.push(`_.-LAYER _Make ${q(l.name)} _Color ${l.color || 7} ${q(l.name)} _LType ${l.linetype || "CONTINUOUS"} ${q(l.name)}  _Exit`);
        });
        r.mismatch.forEach(m => {
            const tl = byName.get(m.name.toUpperCase());
            if (!tl) return;
            if (m.diffs.some(d => d.prop.startsWith("Colour"))) L.push(`_.-LAYER _Color ${tl.color} ${q(m.name)}  _Exit`);
            if (m.diffs.some(d => d.prop === "Linetype") && tl.linetype) L.push(`_.-LAYER _LType ${tl.linetype} ${q(m.name)}  _Exit`);
        });
        if (r.extra.length) {
            L.push(`; Non-standard layers (not deleted automatically — move entities then PURGE):`);
            r.extra.forEach(l => L.push(`;   ${l.name}`));
        }
        L.push(`_.QSAVE`);
        return L.join("\r\n");
    }

    // ── UI ──────────────────────────────────────────────────────────────────

    let _last = null;   // { templateName, projectName, result, tmplLayers }

    function renderPicker() {
        const sel = document.getElementById("tc-tpl-select");
        const activeId = getActiveId();
        if (sel) {
            window.setSafeHTML(sel, getTemplates().map(t =>
                `<option value="${t.id}" ${t.id === activeId ? "selected" : ""}>${clean(t.name)}${t.builtin ? "" : ` · ${t.layerCount} layers`}</option>`).join(""));
        }
        const del = document.getElementById("tc-tpl-delete");
        if (del) del.disabled = activeId === BUILTIN_ID;
        const info = document.getElementById("tc-tpl-active");
        const t = getActive();
        const layers = templateLayers(t);
        if (info) window.setSafeHTML(info,
            `<i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Active standard: <strong>${clean(t.name)}</strong> — ${layers.length} layers. Now drop a drawing below to compare.`);
    }

    function runCompare(dxfText, projectName, ctx) {
        const box = document.getElementById("tc-results");
        const actions = document.getElementById("tc-results-actions");
        if (!box) return;
        box.classList.remove("hidden");
        let parsed;
        try { parsed = new window.FDOTDXFInspector(window.FDOT_DATA).parseDXF(dxfText); }
        catch (e) { window.setSafeHTML(box, `<strong style="color:var(--danger);">Could not parse that DXF.</strong>`); return; }

        const t = getActive();
        const tl = templateLayers(t);
        const checkPlot = !!(document.getElementById("tc-check-plot") && document.getElementById("tc-check-plot").checked);
        const r = compareStandards(tl, parsed, { checkPlot });
        _last = { templateName: t.name, projectName, result: r, tmplLayers: tl, __text: dxfText };
        if (actions) actions.style.display = "flex";

        const scoreColor = r.score >= 85 ? "var(--success)" : (r.score >= 60 ? "var(--warning)" : "var(--danger)");
        const rows = arr => arr.length ? arr.map(l => `<tr><td style="font-family:var(--font-mono);">${l.name}</td><td>${l.color}</td><td>${clean(l.linetype || "")}</td></tr>`).join("")
            : `<tr><td colspan="3" style="color:var(--text-muted);">none</td></tr>`;
        const mmRows = r.mismatch.length ? r.mismatch.map(m => `
            <tr><td style="font-family:var(--font-mono);" rowspan="${m.diffs.length}">${m.name}</td>
                <td>${m.diffs[0].prop}</td><td>${clean(m.diffs[0].template)}</td><td>${clean(m.diffs[0].project)}</td></tr>
            ${m.diffs.slice(1).map(d => `<tr><td>${d.prop}</td><td>${clean(d.template)}</td><td>${clean(d.project)}</td></tr>`).join("")}
        `).join("") : `<tr><td colspan="4" style="color:var(--text-muted);">none</td></tr>`;
        const entRows = r.entIssues.length ? r.entIssues.slice(0, 60).map(e =>
            `<div class="qc-item ${e.sev.toLowerCase()}" style="margin-top:0.3rem;"><div class="qc-item-content"><p><span class="tag tag-discipline">${e.sev}</span> ${clean(e.msg)}</p></div></div>`).join("")
            + (r.entIssues.length > 60 ? `<div style="color:var(--text-muted); font-size:0.75rem;">… ${r.entIssues.length - 60} more</div>` : "")
            : `<div style="color:var(--success); font-size:0.8rem;"><i class="fa-solid fa-circle-check"></i> Every entity is on a standard layer.</div>`;

        window.setSafeHTML(box, `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
              <div><strong style="font-size:1rem;">${clean(projectName)}</strong> vs <strong>${clean(t.name)}</strong></div>
              <div style="font-size:1.4rem; font-weight:800; color:${scoreColor};">${r.score}<span style="font-size:0.9rem; color:var(--text-muted); font-weight:400;"> / 100</span></div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin:0.35rem 0 0.75rem;">
              ${r.okLayers.length} conform · ${r.missing.length} missing · ${r.extra.length} non-standard · ${r.mismatch.length} mismatched · ${r.entIssues.length} entity issue(s)
            </div>
            <details open style="margin-top:0.5rem;"><summary style="cursor:pointer; font-weight:700; color:var(--warning);">Missing from the drawing (${r.missing.length})</summary>
              <div style="overflow-x:auto;"><table class="data-table" style="width:100%; font-size:0.8rem;"><thead><tr><th>Layer</th><th>ACI</th><th>Linetype</th></tr></thead><tbody>${rows(r.missing)}</tbody></table></div>
            </details>
            <details style="margin-top:0.5rem;"><summary style="cursor:pointer; font-weight:700; color:var(--danger);">Not in the standard (${r.extra.length})</summary>
              <div style="overflow-x:auto;"><table class="data-table" style="width:100%; font-size:0.8rem;"><thead><tr><th>Layer</th><th>ACI</th><th>Linetype</th></tr></thead><tbody>${rows(r.extra)}</tbody></table></div>
            </details>
            <details ${r.mismatch.length ? "open" : ""} style="margin-top:0.5rem;"><summary style="cursor:pointer; font-weight:700; color:var(--primary);">Property mismatches (${r.mismatch.length})</summary>
              <div style="overflow-x:auto;"><table class="data-table" style="width:100%; font-size:0.8rem;"><thead><tr><th>Layer</th><th>Property</th><th>Standard</th><th>Drawing</th></tr></thead><tbody>${mmRows}</tbody></table></div>
            </details>
            <details style="margin-top:0.5rem;"><summary style="cursor:pointer; font-weight:700; color:var(--accent);">Entity placement (${r.entIssues.length})</summary>
              <div style="margin-top:0.4rem;">${entRows}</div>
            </details>
        `);
        if (ctx) ctx.showToast(`${projectName}: score ${r.score}/100 vs ${t.name}.`, r.score < 60);
    }

    // ── Plugin ──────────────────────────────────────────────────────────────

    const Plugin = {
        init() { renderPicker(); },
        onTabActivate() { renderPicker(); },

        setupEvents(ctx) {
            const tplFile = document.getElementById("tc-tpl-file");
            document.getElementById("tc-tpl-upload-btn")?.addEventListener("click", () => tplFile && tplFile.click());
            tplFile?.addEventListener("change", e => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = ev => {
                    try {
                        const tpl = saveUploadedTemplate(f.name.replace(/\.dxf$/i, ""), String(ev.target.result || ""));
                        renderPicker();
                        ctx.showToast(`Template "${tpl.name}" saved (${tpl.layerCount} layers) and set active.`);
                    } catch (err) { ctx.showToast(err.message, true); }
                    e.target.value = "";
                };
                r.readAsText(f);
            });

            document.getElementById("tc-tpl-select")?.addEventListener("change", e => {
                setActive(e.target.value);
                renderPicker();
                if (_last && _last.__text) runCompare(_last.__text, _last.projectName, ctx);   // re-diff same drawing
                ctx.showToast(`Active standard: ${getActive().name}.`);
            });
            document.getElementById("tc-tpl-delete")?.addEventListener("click", () => {
                const id = getActiveId();
                if (id === BUILTIN_ID) return;
                ctx.showConfirmModal("Delete this saved template?").then(ok => {
                    if (!ok) return;
                    deleteTemplate(id);
                    renderPicker();
                    ctx.showToast("Template deleted.");
                });
            });

            const prjFile = document.getElementById("tc-prj-file");
            const dz = document.getElementById("tc-dropzone");
            const openPrj = () => prjFile && prjFile.click();
            document.getElementById("tc-prj-btn")?.addEventListener("click", openPrj);
            dz?.addEventListener("click", e => { if (!e.target.closest("button")) openPrj(); });
            dz?.addEventListener("dragover", e => { e.preventDefault(); dz.style.borderColor = "var(--accent)"; });
            dz?.addEventListener("dragleave", () => { dz.style.borderColor = "var(--primary)"; });
            dz?.addEventListener("drop", e => {
                e.preventDefault(); dz.style.borderColor = "var(--primary)";
                const f = e.dataTransfer.files && e.dataTransfer.files[0];
                if (f) readAndCompare(f, ctx);
            });
            prjFile?.addEventListener("change", e => {
                const f = e.target.files && e.target.files[0];
                if (f) readAndCompare(f, ctx);
                e.target.value = "";
            });
            function readAndCompare(file, c) {
                const r = new FileReader();
                r.onload = ev => runCompare(String(ev.target.result || ""), file.name, c);
                r.readAsText(file);
            }

            const S = window.__dxfSamples || {};
            document.getElementById("tc-sample-sr50")?.addEventListener("click", () => S.SR50_DXF && runCompare(S.SR50_DXF, "FDOT_SR50_Roadway_Corridor.dxf", ctx));
            document.getElementById("tc-sample-bowtie")?.addEventListener("click", () => S.BOWTIE_DXF && runCompare(S.BOWTIE_DXF, "Jacksonville_Bowtie.dxf", ctx));
            document.getElementById("tc-sample-drainage")?.addEventListener("click", () => S.NONCOMPLIANT_DXF && runCompare(S.NONCOMPLIANT_DXF, "NonCompliant_Drainage.dxf", ctx));
            document.getElementById("tc-check-plot")?.addEventListener("change", () => {
                if (_last) runCompare(_last.__text || "", _last.projectName, ctx);
            });

            document.getElementById("tc-export-report")?.addEventListener("click", () => {
                if (!_last) { ctx.showToast("Run a comparison first.", true); return; }
                window.COGO.downloadText("standards_comparison.log", diffReport(_last.templateName, _last.projectName, _last.result));
                ctx.showToast("Exported diff report.");
            });
            document.getElementById("tc-export-scr")?.addEventListener("click", () => {
                if (!_last) { ctx.showToast("Run a comparison first.", true); return; }
                window.COGO.downloadText("conform_to_standard.scr", fixScript(_last.templateName, _last.tmplLayers, _last.result));
                ctx.showToast("Exported conform .scr.");
            });
        }
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
    window.TemplateCmp = { compareStandards, builtinTemplate, getTemplates, saveUploadedTemplate, deleteTemplate, templateLayers, diffReport, fixScript };
})();
