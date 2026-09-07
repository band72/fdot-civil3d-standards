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
    const PRECISION_PASS_DENOMINATOR = 10000;
    let _lastTraverse = null; // stashed for the Map Check Report export

    /**
     * Convert a quadrant bearing (e.g. quad "NE", 45°12'30") to an azimuth in radians
     * measured clockwise from north.
     */
    function quadrantToAzimuthRad(quad, deg, min, sec) {
        const angle = deg + min / 60 + sec / 3600; // decimal degrees within the quadrant
        let azDeg;
        switch (quad) {
            case "NE": azDeg = angle; break;
            case "SE": azDeg = 180 - angle; break;
            case "SW": azDeg = 180 + angle; break;
            case "NW": azDeg = 360 - angle; break;
            default:   azDeg = angle;
        }
        return azDeg * Math.PI / 180;
    }

    /** True if segment p1->p2 properly crosses segment p3->p4 (shared endpoints do not count). */
    function segmentsCross(p1, p2, p3, p4) {
        const cross = (a, b, c) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
        const share = q => (q === p1 || q === p2 || q === p3 || q === p4);
        if (share(p1) && (p1 === p3 || p1 === p4)) return false;
        if (share(p2) && (p2 === p3 || p2 === p4)) return false;
        const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
        const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
        return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
               ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
    }

    /** Detect self-intersection on the closed polygon formed by the traverse vertices. */
    function polygonSelfIntersects(vertices) {
        const closed = vertices.concat([vertices[0]]);
        const n = closed.length - 1; // number of segments (last returns to start)
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue; // skip adjacent
                if (segmentsCross(closed[i], closed[i + 1], closed[j], closed[j + 1])) {
                    return { i: i + 1, j: j + 1 };
                }
            }
        }
        return null;
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

        const lines = input.split("\n").filter(l => l.trim().length > 0);
        const courses = [];

        lines.forEach((line, idx) => {
            const match = line.match(/([NSns])\s*(\d+)[\s°\-\.]+(\d+)?[\s'\-\.]*(\d+(?:\.\d+)?)?\s*([EWew])\s+(\d+\.?\d*)/);
            if (match) {
                const quad = `${match[1].toUpperCase()}${match[5].toUpperCase()}`;
                const deg  = parseInt(match[2], 10);
                const min  = parseInt(match[3] || 0, 10);
                const sec  = parseFloat(match[4] || 0);
                const dist = parseFloat(match[6]);
                const azRad = quadrantToAzimuthRad(quad, deg, min, sec);
                courses.push({
                    idx: idx + 1, quad, deg, min, sec, dist, azRad,
                    latitude: dist * Math.cos(azRad),   // +N / -S
                    departure: dist * Math.sin(azRad)    // +E / -W
                });
            }
        });

        if (courses.length < 3) {
            window.setSafeHTML(resultsBox, `
                <div style="color:var(--warning);">
                    <strong><i class="fa-solid fa-triangle-exclamation"></i> Need at least 3 parsable bearing/distance calls to close a polygon.</strong>
                    <p>Format example: <code>N 45-12-30 E 150.00</code></p>
                </div>`);
            return;
        }

        // Real closure: sum latitudes and departures; the misclosure is the vector back to POB.
        const sumLat = courses.reduce((s, c) => s + c.latitude, 0);
        const sumDep = courses.reduce((s, c) => s + c.departure, 0);
        const perimeter = courses.reduce((s, c) => s + c.dist, 0);
        const linearMisclosure = Math.hypot(sumLat, sumDep);

        const precisionDenominator = linearMisclosure > 1e-9
            ? perimeter / linearMisclosure
            : Infinity;
        const passes = precisionDenominator >= PRECISION_PASS_DENOMINATOR;

        // Bearing of the misclosure course (direction from the computed end back to the POB).
        let misclosureBearing = "—";
        if (linearMisclosure > 1e-9) {
            const ns = -sumLat >= 0 ? "N" : "S";
            const ew = -sumDep >= 0 ? "E" : "W";
            const a = Math.abs(Math.atan2(-sumDep, -sumLat) * 180 / Math.PI);
            const d = Math.floor(a);
            const m = Math.floor((a - d) * 60);
            const s = Math.round(((a - d) * 60 - m) * 60);
            misclosureBearing = `${ns} ${d}°${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}" ${ew}`;
        }

        // Walk the courses from an arbitrary origin to build polygon vertices, then test for a bow-tie.
        const verts = [{ x: 0, y: 0 }];
        courses.forEach(c => {
            const prev = verts[verts.length - 1];
            verts.push({ x: prev.x + c.departure, y: prev.y + c.latitude });
        });
        verts.pop(); // last computed point ≈ POB (within misclosure); polygon closes back to verts[0]
        const bowtie = polygonSelfIntersects(verts);

        // Shoelace area of the plotted polygon (informational — assumes the boundary closes).
        let areaSqFt = 0;
        for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
            areaSqFt += (verts[j].x + verts[i].x) * (verts[j].y - verts[i].y);
        }
        areaSqFt = Math.abs(areaSqFt / 2);
        const areaAcres = areaSqFt / 43560;

        _lastTraverse = { courses, sumLat, sumDep, perimeter, linearMisclosure, precisionDenominator, passes, misclosureBearing, verts, bowtie, areaSqFt, areaAcres };

        const ratioText = precisionDenominator === Infinity
            ? "exact (0.000 ft misclosure)"
            : `1 : ${Math.round(precisionDenominator).toLocaleString()}`;

        window.setSafeHTML(resultsBox, `
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                <h4 style="color:var(--text-primary); font-size:1rem; font-weight:700;">
                    <i class="fa-solid fa-square-check" style="color:var(--success);"></i> Polygon &amp; Traversal Verification Results
                </h4>
                <p style="font-size:0.85rem; color:var(--text-secondary);">Parsed ${courses.length} courses | Perimeter: <strong>${perimeter.toFixed(2)} ft</strong> | Shoelace area: <strong>${areaAcres.toFixed(3)} ac</strong> (${areaSqFt.toFixed(0)} sf)</p>
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
                ${passes ? '' : `<small style="color:var(--danger);">Misclosure exceeds 1:${PRECISION_PASS_DENOMINATOR.toLocaleString()} — review course bearings/distances before certifying.</small>`}
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
                    L.push(window.COGO.pnezd(t.verts.map(v => ({ e: v.x, n: v.y }))));
                }
                const report = L.join("\r\n");
                if (window.COGO) window.COGO.downloadText("traverse_mapcheck.log", report);
                showToast("Map Check Report exported.");
            });
        }
    };

    window.PluginRegistry.register(MANIFEST, Plugin);
})();
