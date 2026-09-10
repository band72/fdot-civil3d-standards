/**
 * Plugin: traverse-cogo (Traverse & COGO)
 * plugins/traverse-cogo/traverse-cogo.js
 *
 * COGO traverse calculator with closure precision ratio, bowtie
 * bearing-quadrant detection, and QC checklist renderer.
 * Registers via window.PluginRegistry.
 */
(function () {
    const MANIFEST = {
        name: "traverse-cogo",
        version: "2.6.0",
        description: "COGO traverse calculator, closure report, and bowtie bearing detector.",
        tab: "tab-qc",
        icon: "fa-drafting-compass",
        tier: "Pro",
        dependencies: ["security-pki"]
    };

    // FDOT boundary/right-of-way surveys are expected to close to at least 1:10,000 (Rule 5J-17).
    const PRECISION_PASS_DEFAULT = 10000;
    // Pass threshold comes from the active client master template when one is set.
    function precisionPass() {
        const v = window.BoundaryQCCMS && window.BoundaryQCCMS.getActiveTemplateSetting
            ? window.BoundaryQCCMS.getActiveTemplateSetting("precisionPass", PRECISION_PASS_DEFAULT)
            : PRECISION_PASS_DEFAULT;
        return Number(v) || PRECISION_PASS_DEFAULT;
    }
    let _lastTraverse = null; // stashed for the Map Check Report export

    /**
     * Parse a bearing/distance call list into courses. Delegates the bearing to
     * window.COGO.parseBearing (accepts "N 45-12-30 E", "North 45 degrees ... East",
     * "N45°12'30\"E", "N45d12m30sE", …), so this tab takes exactly the same formats
     * as the Legal Description and Linework tools.
     * @returns {{courses: Array, skipped: Array<{line:number, text:string}>}}
     */
    function parseCourses(text) {
        const courses = [];
        const skipped = [];
        String(text || "").split(/\r?\n/).forEach((line, i) => {
            const s = line.trim();
            if (!s) return;
            const b = window.COGO.parseBearing(s);
            const d = s.match(/([\d,]+(?:\.\d+)?)\s*(?:feet|foot|ft|')?\s*$/i);
            if (!b || !d) { skipped.push({ line: i + 1, text: s }); return; }
            const dist = parseFloat(d[1].replace(/,/g, ""));
            const azRad = b.azimuthDeg * Math.PI / 180;
            courses.push({
                idx: courses.length + 1, quad: b.quad, deg: b.deg, min: b.min, sec: b.sec,
                dist, azimuthDeg: b.azimuthDeg, azRad,
                latitude: dist * Math.cos(azRad),   // +N / -S
                departure: dist * Math.sin(azRad)    // +E / -W
            });
        });
        return { courses, skipped };
    }

    /**
     * Latitude/departure closure + bow-tie + Shoelace area for a set of courses.
     * All geometry goes through window.COGO so the traverse tab, linework editor,
     * and legal-description QC agree to the last decimal.
     */
    function computeClosure(courses, passThreshold) {
        const thr = Number(passThreshold) || PRECISION_PASS_DEFAULT;
        const sumLat = courses.reduce((s, c) => s + c.latitude, 0);
        const sumDep = courses.reduce((s, c) => s + c.departure, 0);
        const perimeter = courses.reduce((s, c) => s + c.dist, 0);
        const linearMisclosure = Math.hypot(sumLat, sumDep);
        const precisionDenominator = linearMisclosure > 1e-9 ? perimeter / linearMisclosure : Infinity;
        const passes = precisionDenominator >= thr;

        // Direction from the computed end of the traverse back to the POB.
        const misclosureBearing = linearMisclosure > 1e-9
            ? window.COGO.azimuthToBearing(
                window.COGO.azimuthDegBetween({ e: 0, n: 0 }, { e: -sumDep, n: -sumLat }))
            : "—";

        // Walk the courses from an arbitrary origin
        const trace = [{ e: 0, n: 0 }];
        courses.forEach(c => {
            const prev = trace[trace.length - 1];
            trace.push({ e: prev.e + c.departure, n: prev.n + c.latitude });
        });
        // If the traverse closes back to the start, the last trace point duplicates the origin;
        // polygon corners (and PNEZD export) omit that duplicate closing copy.
        // For an open traverse that does not return to origin, retain all stations.
        const closes = courses.length >= 3 && (linearMisclosure <= 1e-4 || (linearMisclosure / (perimeter || 1)) < 0.05);
        const verts = closes ? trace.slice(0, -1) : trace;
        const bowtie = verts.length >= 3 ? window.COGO.selfIntersects(verts) : null;
        const areaSqFt = closes && verts.length >= 3 ? window.COGO.shoelaceArea(verts) : 0;

        return {
            courses, sumLat, sumDep, perimeter, linearMisclosure, precisionDenominator,
            passThreshold: thr, passes, misclosureBearing, verts, bowtie, closes,
            areaSqFt, areaAcres: areaSqFt / window.COGO.SQFT_PER_ACRE
        };
    }

    function handleTraverseCalculation() {
        const input = document.getElementById("traverse-input")?.value.trim() || "";
        const resultsBox = document.getElementById("traverse-results");
        if (!resultsBox) return;
        resultsBox.classList.remove("hidden");

        if (!input) {
            window.setSafeHTML(resultsBox, `<strong style="color:var(--danger);">Please enter bearing and distance call outs to analyze.</strong>`);
            return;
        }

        const { courses, skipped } = parseCourses(input);

        if (courses.length < 3) {
            window.setSafeHTML(resultsBox, `
                <div style="color:var(--warning);">
                    <strong><i class="fa-solid fa-triangle-exclamation"></i> Need at least 3 parsable bearing/distance calls to close a polygon.</strong>
                    <p>Format example: <code>N 45-12-30 E 150.00</code></p>
                    ${skipped.length ? `<p style="font-size:0.8rem;">Skipped ${skipped.length} unparsed line(s): ${skipped.map(s => "L" + s.line).join(", ")}</p>` : ""}
                </div>`);
            return;
        }

        const passThreshold = precisionPass();
        const cl = computeClosure(courses, passThreshold);
        const { sumLat, sumDep, perimeter, linearMisclosure, precisionDenominator, passes,
            misclosureBearing, bowtie, areaSqFt, areaAcres } = cl;
        _lastTraverse = cl;

        const ratioText = precisionDenominator === Infinity
            ? "exact (0.000 ft misclosure)"
            : `1 : ${Math.round(precisionDenominator).toLocaleString()}`;

        window.setSafeHTML(resultsBox, `
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                <h4 style="color:var(--text-primary); font-size:1rem; font-weight:700;">
                    <i class="fa-solid fa-square-check" style="color:var(--success);"></i> Polygon &amp; Traversal Verification Results
                </h4>
                <p style="font-size:0.85rem; color:var(--text-secondary);">Parsed ${courses.length} courses | Perimeter: <strong>${perimeter.toFixed(2)} ft</strong> | Shoelace area: <strong>${areaAcres.toFixed(3)} ac</strong> (${areaSqFt.toFixed(0)} sf)</p>
                ${skipped.length ? `<p style="font-size:0.78rem; color:var(--warning);"><i class="fa-solid fa-triangle-exclamation"></i> Skipped ${skipped.length} unparsed line(s): ${skipped.map(s => "L" + s.line + ' "' + s.text.slice(0, 30) + '"').join("; ")}</p>` : ""}
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:0.5rem;">
                    <div style="background:var(--bg-surface); padding:0.75rem; border-radius:var(--radius-sm);">
                        <small style="color:var(--text-muted);">Linear Misclosure</small>
                        <div style="font-weight:700; color:var(--text-primary);">${linearMisclosure.toFixed(4)} ft</div>
                        <small style="color:var(--text-muted);">ΔLat ${sumLat.toFixed(4)} · ΔDep ${sumDep.toFixed(4)}</small>
                    </div>
                    <div style="background:var(--bg-surface); padding:0.75rem; border-radius:var(--radius-sm);">
                        <small style="color:var(--text-muted);">Precision Ratio</small>
                        <div style="font-weight:700; color:${passes ? 'var(--success)' : 'var(--danger)'};">${ratioText} (${passes ? 'PASS' : 'REVIEW'})</div>
                        <small style="color:var(--text-muted);">Misclosure course: ${misclosureBearing}</small>
                    </div>
                </div>
                <div style="margin-top:0.5rem; padding:0.75rem; background:${bowtie ? 'var(--danger-light)' : 'var(--success-light)'}; border-radius:var(--radius-sm); border-left:3px solid ${bowtie ? 'var(--danger)' : 'var(--success)'}; font-size:0.85rem;">
                    ${bowtie
                        ? `<strong style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Bow-tie / self-intersecting boundary detected.</strong><p>Course ${bowtie.i} crosses course ${bowtie.j} in the plotted polygon. Check the bearing quadrant or call order on those lines.</p>`
                        : `<strong style="color:var(--success);"><i class="fa-solid fa-circle-check"></i> No self-intersection:</strong> the plotted polygon boundary does not cross itself.`
                    }
                </div>
                ${passes ? '' : `<small style="color:var(--danger);">Misclosure exceeds 1:${passThreshold.toLocaleString()} — review course bearings/distances before certifying.</small>`}
            </div>`);
    }

    function renderQcChecklist() {
        const container = document.getElementById("qc-items-container");
        if (!container) return;
        container.innerHTML = "";
        (window.FDOT_DATA?.qcChecklist || []).forEach(qc => {
            const div = document.createElement("div");
            div.className = `qc-item ${qc.status?.toLowerCase() || "pass"}`;
            window.setSafeHTML(div, `
                <div class="qc-item-icon">
                    <i class="fa-solid ${qc.status === "FAIL" ? "fa-xmark" : (qc.status === "WARN" ? "fa-triangle-exclamation" : "fa-check")}"></i>
                </div>
                <div class="qc-item-content">
                    <h4>${qc.title} <span class="tag tag-discipline">${qc.category}</span></h4>
                    <p>${qc.desc}</p>
                </div>`);
            container.appendChild(div);
        });
    }

    function renderHeuristics() {
        const list = document.getElementById("heuristics-list");
        if (!list) return;
        list.innerHTML = "";
        (window.FDOT_DATA?.heuristics || []).forEach(h => {
            const li = document.createElement("li");
            li.style.cssText = "padding:0.5rem 0; border-bottom:1px solid var(--glass-border); font-size:0.85rem; color:var(--text-secondary);";
            window.setSafeHTML(li, `<strong style="color:var(--primary);">${h.rule}:</strong> ${h.description}`);
            list.appendChild(li);
        });
    }

    const Plugin = {
        init() {
            renderQcChecklist();
            renderHeuristics();
        },

        setupEvents(ctx) {
            const { showToast } = ctx;
            document.getElementById("btn-calc-traverse")?.addEventListener("click", handleTraverseCalculation);
            document.getElementById("btn-gen-qc-report")?.addEventListener("click", () => {
                if (!_lastTraverse) { showToast("Run the traverse calculation first.", true); return; }
                const t = _lastTraverse;
                const L = [];
                L.push("=== BoundaryQC Map Check Report — Traverse ===");
                L.push(`Generated: ${new Date().toISOString()}`);
                L.push("");
                L.push("[QA: Courses]");
                t.courses.forEach(c => L.push(`  ${c.idx}  ${c.quad} ${c.deg}°${String(c.min).padStart(2,"0")}'${String(Math.round(c.sec)).padStart(2,"0")}"  ${c.dist.toFixed(2)} ft`));
                L.push("");
                L.push("[QA: Mathematical Closure & Area]");
                L.push(`  Linear misclosure: ${t.linearMisclosure.toFixed(3)} ft  (ΔLat ${t.sumLat.toFixed(3)}, ΔDep ${t.sumDep.toFixed(3)})`);
                L.push(`  Misclosure course: ${t.misclosureBearing}`);
                L.push(`  Precision ratio: ${t.precisionDenominator === Infinity ? "exact" : "1 : " + Math.round(t.precisionDenominator).toLocaleString()}`);
                L.push(`  Perimeter: ${t.perimeter.toFixed(2)} ft`);
                L.push(`  Shoelace area: ${t.areaSqFt.toFixed(2)} sq ft = ${t.areaAcres.toFixed(2)} acres`);
                L.push(`  Status: ${t.passes && !t.bowtie ? "[PASS]" : "[FAIL/WARNING]"}`);
                L.push(`  Self-intersection: ${t.bowtie ? `YES — course ${t.bowtie.i} crosses course ${t.bowtie.j}` : "none"}`);
                L.push("");
                L.push("[Coordinate File — P,N,E,Z,D]");
                if (window.COGO) {
                    L.push(window.COGO.pnezd(t.verts));   // verts are already {e, n}
                }
                const report = L.join("\r\n");
                if (window.COGO) window.COGO.downloadText("traverse_mapcheck.log", report);
                showToast("Map Check Report exported.");
            });
        }
    };

    window.PluginRegistry.register(MANIFEST, Plugin);

    // Exposed for console debugging / tests.
    window.TraverseCogo = { parseCourses, computeClosure };
})();
