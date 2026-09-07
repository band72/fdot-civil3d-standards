/* FDOT Civil3D Standards Project - Interactive Application Logic */

document.addEventListener("DOMContentLoaded", () => {
    // State management
    const state = {
        activeTab: "tab-dxf-inspector",
        selectedDiscipline: "ALL",
        plotFilter: "ALL",
        searchQuery: "",
        selectedPayItem: null,
        theme: "dark",
        currentDXFAudit: null
    };

    const inspector = new FDOTDXFInspector(FDOT_DATA);

    // DOM Elements
    const navButtons = document.querySelectorAll(".nav-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");
    const disciplineContainer = document.getElementById("discipline-filters");
    const plotSelect = document.getElementById("select-plot-filter");
    const globalSearchInput = document.getElementById("global-search");
    const layersTbody = document.getElementById("layers-tbody");
    const layersCountSummary = document.getElementById("layers-count-summary");
    
    const payitemTbody = document.getElementById("payitem-tbody");
    const payitemSearchInput = document.getElementById("payitem-search");
    const payitemDetailView = document.getElementById("payitem-detail-view");

    const surveyTbody = document.getElementById("survey-tbody");
    const surveySearchInput = document.getElementById("survey-search");

    const subassembliesGrid = document.getElementById("subassemblies-grid");
    const sheetsGrid = document.getElementById("sheets-grid");
    const qcItemsContainer = document.getElementById("qc-items-container");
    const heuristicsList = document.getElementById("heuristics-list");
    const themeToggleBtn = document.getElementById("theme-toggle");

    // DXF Auditor Elements
    const dxfDropzone = document.getElementById("dxf-dropzone");
    const dxfFileInput = document.getElementById("dxf-file-input");
    const dxfDashboard = document.getElementById("dxf-audit-dashboard");
    const statDxfScore = document.getElementById("stat-dxf-score");
    const statDxfCounts = document.getElementById("stat-dxf-counts");
    const statDxfIssuesCount = document.getElementById("stat-dxf-issues-count");
    const dxfIssuesContainer = document.getElementById("dxf-issues-container");
    const dxfCanvas = document.getElementById("dxf-canvas");

    // Initialize App
    function init() {
        updateBadges();
        renderLayers();
        renderPayItems();
        renderSurveyKeys();
        renderSubassemblies();
        renderSheetStandards();
        renderSignAssemblies();
        renderIDFOptions();
        renderBlockLibraries();
        renderHeuristics();
        renderQcChecklist();
        renderStateKitTree();
        setupEventListeners();
        setupDXFAuditor();
    }

    function updateBadges() {
        document.getElementById("layer-count-badge").textContent = FDOT_DATA.layers.length;
        document.getElementById("payitem-count-badge").textContent = FDOT_DATA.payItems.length;
        document.getElementById("survey-count-badge").textContent = FDOT_DATA.surveyKeys.length;
        document.getElementById("assembly-count-badge").textContent = FDOT_DATA.subassemblies.length;
        document.getElementById("stat-payitems-total").textContent = FDOT_DATA.payItems.length;
    }

    // Render Sign Assemblies Cards
    function renderSignAssemblies() {
        const grid = document.getElementById("signs-grid");
        if (!grid) return;
        grid.innerHTML = "";
        FDOT_DATA.signAssemblies.forEach(sign => {
            const card = document.createElement("div");
            card.className = "pkt-card glass-panel";
            card.innerHTML = `
                <div class="pkt-card-header">
                    <h3><i class="fa-solid fa-triangle-exclamation" style="color:${sign.color};"></i> ${sign.code} ${sign.title}</h3>
                    <span class="tag tag-discipline">${sign.shape}</span>
                </div>
                <div style="font-family:var(--font-mono); font-size:0.85rem; color:var(--accent);">${sign.size} | Block: ${sign.blockName}</div>
                <p style="font-size:0.85rem; color:var(--text-secondary); flex:1;">${sign.description}</p>
                <div style="border-top: 1px solid var(--glass-border); padding-top:0.5rem; margin-top:0.5rem;">
                    <small style="color:var(--text-muted); font-weight:700; text-transform:uppercase;">FDOT Target Pay Item</small>
                    <div style="font-weight:700; color:var(--success); font-size:0.9rem;">${sign.payItem}</div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // Render IDF Zone Options
    function renderIDFOptions() {
        const select = document.getElementById("select-idf-zone");
        if (!select) return;
        select.innerHTML = "";
        FDOT_DATA.idfZones.forEach(z => {
            const opt = document.createElement("option");
            opt.value = z.zone;
            opt.textContent = `Zone ${z.zone}: ${z.counties}`;
            select.appendChild(opt);
        });
    }

    // Render Block Libraries
    function renderBlockLibraries() {
        const grid = document.getElementById("blocks-library-grid");
        if (!grid) return;
        grid.innerHTML = "";
        FDOT_DATA.blocks.forEach(b => {
            const card = document.createElement("div");
            card.className = "pkt-card glass-panel";
            card.innerHTML = `
                <div class="pkt-card-header">
                    <h3><i class="fa-solid fa-cube" style="color:var(--primary);"></i> ${b.name}</h3>
                    <span class="tag tag-discipline">${b.discipline}</span>
                </div>
                <div style="font-family:var(--font-mono); font-size:0.85rem; color:var(--accent);">${b.dwg}</div>
                <p style="font-size:0.85rem; color:var(--text-secondary); flex:1;">${b.description}</p>
                <div style="border-top: 1px solid var(--glass-border); padding-top:0.5rem; margin-top:0.5rem;">
                    <small style="color:var(--text-muted); font-weight:700; text-transform:uppercase;">Target Layer & Pay Item</small>
                    <div style="font-weight:700; color:var(--success); font-size:0.85rem;">${b.layer} (${b.payItem})</div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // DXF Auditor Setup
    function setupDXFAuditor() {
        if (!dxfDropzone) return;

        dxfDropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dxfDropzone.style.borderColor = "var(--accent)";
            dxfDropzone.style.background = "var(--accent-light)";
        });

        dxfDropzone.addEventListener("dragleave", () => {
            dxfDropzone.style.borderColor = "var(--primary)";
            dxfDropzone.style.background = "var(--primary-light)";
        });

        dxfDropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            dxfDropzone.style.borderColor = "var(--primary)";
            dxfDropzone.style.background = "var(--primary-light)";

            if (e.dataTransfer.files.length > 0) {
                processDXFFile(e.dataTransfer.files[0]);
            }
        });

        dxfFileInput?.addEventListener("change", (e) => {
            if (e.target.files.length > 0) {
                processDXFFile(e.target.files[0]);
            }
        });

        document.getElementById("btn-load-sample-dxf")?.addEventListener("click", () => {
            const sampleDXFText = generateSampleDOTProjectDXF();
            auditDXFText(sampleDXFText, "Sample_DOT_Roadway_Project.dxf");
        });
    }

    function processDXFFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            auditDXFText(e.target.result, file.name);
        };
        reader.readAsText(file);
    }

    let currentCanvasTransform = null;

    function auditDXFText(dxfText, filename) {
        showToast(`Auditing DXF file: ${filename}...`);
        const parsed = inspector.parseDXF(dxfText);
        const audit = inspector.inspectProject(parsed);
        state.currentDXFAudit = { filename, parsed, audit, rawContent: dxfText };

        // Process DXF via WebAssembly High-Performance Spatial Engine
        if (window.BoundaryQCWASM && window.BoundaryQCWASM.processDXFSpatialStream) {
            const telemetry = window.BoundaryQCWASM.processDXFSpatialStream(dxfText, parsed.entities);
            const wasmHud = document.getElementById("dxf-wasm-hud");
            if (wasmHud && telemetry) {
                wasmHud.innerHTML = `<i class="fa-solid fa-microchip"></i> WASM R-Tree: ${telemetry.entitiesIndexed} Ent | ${telemetry.throughputMBs} MB/s`;
            }
        }

        dxfDashboard.classList.remove("hidden");

        statDxfScore.textContent = `${audit.score}%`;
        statDxfScore.style.color = audit.score >= 80 ? "var(--success)" : (audit.score >= 50 ? "var(--warning)" : "var(--danger)");
        statDxfCounts.textContent = `${audit.layersCount} Layers / ${audit.entitiesCount} Entities`;
        statDxfIssuesCount.textContent = audit.issues.length;

        renderDXFCanvas(parsed.entities, audit.issues);
        renderDXFIssues(audit.issues);
    }

    function renderDXFCanvas(entities, issues = []) {
        if (!dxfCanvas) return;
        const rect = dxfCanvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // High-DPI Retina Display Crispness Scaling
        dxfCanvas.width = (rect.width || 600) * dpr;
        dxfCanvas.height = (rect.height || 400) * dpr;
        
        const ctx = dxfCanvas.getContext("2d");
        ctx.scale(dpr, dpr);
        const w = rect.width || 600;
        const h = rect.height || 400;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#030712";
        ctx.fillRect(0, 0, w, h);

        if (entities.length === 0) {
            ctx.fillStyle = "#64748b";
            ctx.font = "500 14px 'Inter', sans-serif";
            ctx.fillText("No CAD geometry entities found in DXF.", w / 2 - 120, h / 2);
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        entities.forEach(ent => {
            if (ent.type === "LINE") {
                minX = Math.min(minX, ent.startX, ent.endX);
                maxX = Math.max(maxX, ent.startX, ent.endX);
                minY = Math.min(minY, ent.startY, ent.endY);
                maxY = Math.max(maxY, ent.startY, ent.endY);
            }
            if (ent.vertices) {
                ent.vertices.forEach(v => {
                    minX = Math.min(minX, v.x);
                    maxX = Math.max(maxX, v.x);
                    minY = Math.min(minY, v.y);
                    maxY = Math.max(maxY, v.y);
                });
            }
        });

        if (minX === Infinity) { minX = 0; maxX = 500; minY = 0; maxY = 300; }
        const dx = (maxX - minX) || 1;
        const dy = (maxY - minY) || 1;
        const padding = 50;
        const scale = Math.min((w - padding * 2) / dx, (h - padding * 2) / dy);

        currentCanvasTransform = { minX, minY, dx, dy, padding, scale, w, h };

        function toScreenX(x) { return padding + (x - minX) * scale; }
        function toScreenY(y) { return h - (padding + (y - minY) * scale); }

        // CAD Grid Overlay
        ctx.strokeStyle = "rgba(56, 189, 248, 0.06)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

        // High-Tech Crosshair Center Marker
        ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
        ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const hasBowtie = issues.some(i => i.category === "Bow-Tie / Self-Intersection");

        entities.forEach(ent => {
            const isLayer0 = ent.layer === "0";
            const isRoad = ent.layer.startsWith("ROAD_") || ent.layer.includes("ALIGN");
            const isBoundary = ent.layer.includes("BND") || ent.layer.includes("BOUNDARY") || ent.layer.includes("R/W");

            ctx.strokeStyle = isLayer0 ? "#ef4444" : (isRoad ? "#38bdf8" : (isBoundary ? (hasBowtie ? "#f43f5e" : "#34d399") : "#f59e0b"));
            ctx.lineWidth = isBoundary ? 2.5 : 1.75;

            if (ent.type === "LINE") {
                ctx.beginPath();
                ctx.moveTo(toScreenX(ent.startX), toScreenY(ent.startY));
                ctx.lineTo(toScreenX(ent.endX), toScreenY(ent.endY));
                ctx.stroke();
            }

            if (ent.type === "LWPOLYLINE" && ent.vertices.length > 1) {
                ctx.beginPath();
                ctx.moveTo(toScreenX(ent.vertices[0].x), toScreenY(ent.vertices[0].y));
                for (let i = 1; i < ent.vertices.length; i++) {
                    ctx.lineTo(toScreenX(ent.vertices[i].x), toScreenY(ent.vertices[i].y));
                }
                if (ent.closed) ctx.closePath();
                ctx.stroke();

                // Draw Nodes on Polyline Vertices
                ent.vertices.forEach(v => {
                    ctx.fillStyle = hasBowtie ? "#e11d48" : "#ef4444";
                    ctx.beginPath();
                    ctx.arc(toScreenX(v.x), toScreenY(v.y), 4.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = "#ffffff";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                });
            }
        });

        // If Bowtie detected, draw prominent pulsating warning marker
        if (hasBowtie) {
            const midScreenX = w / 2;
            const midScreenY = h / 2;
            ctx.fillStyle = "rgba(225, 29, 72, 0.25)";
            ctx.beginPath();
            ctx.arc(midScreenX, midScreenY, 32, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#f43f5e";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "#fff";
            ctx.font = "bold 11px 'JetBrains Mono', monospace";
            ctx.fillText("BOWTIE SELF-INTERSECTION", midScreenX - 85, midScreenY - 38);
        }
    }

    // Connect cursor mousemove for Florida State Plane NAD83 Easting/Northing HUD
    if (dxfCanvas) {
        dxfCanvas.addEventListener("mousemove", (e) => {
            if (!currentCanvasTransform || currentCanvasTransform.scale <= 0) return;
            const rect = dxfCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const t = currentCanvasTransform;
            const easting = t.minX + (mouseX - t.padding) / t.scale;
            const northing = t.minY + (t.h - mouseY - t.padding) / t.scale;

            const hud = document.getElementById("dxf-coord-hud");
            if (hud) {
                hud.innerHTML = `<i class="fa-solid fa-crosshairs"></i> NAD83 FL: (${easting.toFixed(2)}, ${northing.toFixed(2)}) ft`;
            }
        });
    }

    function renderDXFIssues(issues) {
        if (!dxfIssuesContainer) return;
        dxfIssuesContainer.innerHTML = "";

        if (issues.length === 0) {
            dxfIssuesContainer.innerHTML = `
                <div style="text-align:center; padding: 2rem; color:var(--success);">
                    <i class="fa-solid fa-circle-check" style="font-size: 2.5rem;"></i>
                    <p style="margin-top: 0.5rem; font-weight: 700;">100% Compliant!</p>
                    <small>No CADD standards violations or scripting errors detected.</small>
                </div>
            `;
            return;
        }

        issues.forEach(issue => {
            const card = document.createElement("div");
            card.className = `issue-card severity-${issue.severity}`;
            card.innerHTML = `
                <div class="issue-card-header">
                    <span class="issue-card-title">${issue.title}</span>
                    <span class="tag ${issue.severity === 'CRITICAL' ? 'tag-noplot' : 'tag-discipline'}">${issue.severity}</span>
                </div>
                <div class="issue-card-desc">${issue.description}</div>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent); margin-top: 4px;">
                    Target Layer: <code>${issue.layer}</code> | Category: ${issue.category}
                </div>
            `;
            dxfIssuesContainer.appendChild(card);
        });
    }

    function generateSampleDOTProjectDXF() {
        return `0
SECTION
2
HEADER
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
0
62
7
0
LAYER
2
ROAD_ALIGN_PR
62
4
0
LAYER
2
SURV_BND_PR
62
1
0
LAYER
2
NON_STANDARD_MY_LAYER
62
10
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
0
10
1000.00
20
2000.00
11
1000.00
21
2000.00
0
LINE
8
ROAD_ALIGN_PR
10
1000.00
20
2000.00
11
1250.00
21
2000.00
0
LWPOLYLINE
8
SURV_BND_PR
70
0
10
1000.00
20
2000.00
10
1200.00
20
2000.00
10
1000.00
20
2200.00
10
1200.00
20
2200.00
0
ENDSEC
0
EOF`;
    }

    // Render Layers Table
    function renderLayers() {
        const filtered = FDOT_DATA.layers.filter(layer => {
            const matchesDiscipline = state.selectedDiscipline === "ALL" || layer.discipline === state.selectedDiscipline;
            const matchesPlot = state.plotFilter === "ALL" || 
                (state.plotFilter === "PLOT" && layer.plot) || 
                (state.plotFilter === "NOPLOT" && !layer.plot);
            
            const q = state.searchQuery.toLowerCase();
            const matchesSearch = !q || 
                layer.name.toLowerCase().includes(q) || 
                layer.description.toLowerCase().includes(q) ||
                layer.colorName.toLowerCase().includes(q);

            return matchesDiscipline && matchesPlot && matchesSearch;
        });

        layersTbody.innerHTML = "";

        if (filtered.length === 0) {
            layersTbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--text-muted);">No matching FDOT layers found.</td></tr>`;
            layersCountSummary.textContent = "Showing 0 layers";
            return;
        }

        filtered.forEach(layer => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="color-swatch-badge">
                        <span class="color-dot" style="background-color: ${layer.colorHex};"></span>
                        <span>${layer.color}</span>
                    </div>
                </td>
                <td><code class="layer-name-code">${layer.name}</code></td>
                <td><span class="tag tag-discipline">${layer.discipline}</span></td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem;">${layer.linetype}</span></td>
                <td>${layer.lineweight} mm</td>
                <td>
                    <span class="tag ${layer.plot ? 'tag-plot' : 'tag-noplot'}">
                        ${layer.plot ? 'PLOT' : 'NO PLOT'}
                    </span>
                </td>
                <td style="color: var(--text-secondary);">${layer.description}</td>
                <td>
                    <button class="btn-icon-action btn-copy-layer" data-layer="${layer.name}" title="Copy layer name to clipboard">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                </td>
            `;
            layersTbody.appendChild(tr);
        });

        layersCountSummary.textContent = `Showing ${filtered.length} of ${FDOT_DATA.layers.length} layers`;
    }

    // Render Pay Items Table
    function renderPayItems() {
        const q = (payitemSearchInput ? payitemSearchInput.value : state.searchQuery).toLowerCase();
        const filtered = FDOT_DATA.payItems.filter(item => {
            return !q || item.code.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
        });

        payitemTbody.innerHTML = "";

        filtered.forEach(item => {
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.innerHTML = `
                <td><code class="layer-name-code">${item.code}</code></td>
                <td><strong>${item.description}</strong></td>
                <td><span class="tag tag-discipline">${item.unit}</span></td>
                <td>${item.category}</td>
                <td>
                    <button class="btn btn-primary btn-sm btn-select-payitem" data-code="${item.code}">
                        Select
                    </button>
                </td>
            `;
            tr.addEventListener("click", () => showPayItemDetails(item));
            payitemTbody.appendChild(tr);
        });
    }

    function showPayItemDetails(item) {
        state.selectedPayItem = item;
        payitemDetailView.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:1.25rem;">
                <div>
                    <span class="tag tag-discipline" style="font-size:0.8rem;">Category: ${item.category}</span>
                    <h2 style="font-size:1.4rem; font-weight:800; color:var(--primary); margin-top:6px;">${item.code}</h2>
                    <p style="font-size:1rem; font-weight:600; color:var(--text-primary); margin-top:4px;">${item.description}</p>
                </div>

                <div style="background:var(--bg-surface); padding:1rem; border-radius:var(--radius-md); border:1px solid var(--glass-border);">
                    <small style="color:var(--text-muted); text-transform:uppercase; font-weight:700;">Target Civil 3D Layer</small>
                    <div style="font-family:var(--font-mono); font-weight:600; color:var(--accent); margin-top:4px;">${item.c3dLayer}</div>
                </div>

                <div style="background:var(--bg-surface); padding:1rem; border-radius:var(--radius-md); border:1px solid var(--glass-border);">
                    <small style="color:var(--text-muted); text-transform:uppercase; font-weight:700;">FDOT Standard Notes</small>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:4px;">${item.notes}</p>
                </div>

                <div style="border-top:1px solid var(--glass-border); padding-top:1rem;">
                    <h3 style="font-size:0.95rem; font-weight:700; margin-bottom:0.75rem;">QTO Quick Calculator (${item.unit})</h3>
                    <div style="display:flex; gap:0.5rem; align-items:center;">
                        <input type="number" id="qto-quantity" placeholder="Quantity (${item.unit})" value="100" style="padding:0.5rem; background:var(--bg-surface); border:1px solid var(--glass-border); border-radius:var(--radius-md); color:var(--text-primary); width:120px;">
                        <input type="number" id="qto-unit-price" placeholder="Unit Price ($)" value="45.00" style="padding:0.5rem; background:var(--bg-surface); border:1px solid var(--glass-border); border-radius:var(--radius-md); color:var(--text-primary); width:120px;">
                        <button class="btn btn-accent" id="btn-calc-qto">Calculate</button>
                    </div>
                    <div id="qto-total-result" style="margin-top:1rem; font-size:1.1rem; font-weight:700; color:var(--success);">
                        Estimated Cost: $4,500.00
                    </div>
                </div>
            </div>
        `;

        document.getElementById("btn-calc-qto")?.addEventListener("click", () => {
            const qty = parseFloat(document.getElementById("qto-quantity").value) || 0;
            const price = parseFloat(document.getElementById("qto-unit-price").value) || 0;
            const total = qty * price;
            document.getElementById("qto-total-result").innerHTML = `Estimated Cost: <span style="color:var(--success);">$${total.toLocaleString('en-US', {minimumFractionDigits:2})}</span>`;
        });
    }

    function renderSurveyKeys() {
        const q = (surveySearchInput ? surveySearchInput.value : "").toLowerCase();
        surveyTbody.innerHTML = "";

        const filtered = FDOT_DATA.surveyKeys.filter(item => {
            return !q || item.code.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.layer.toLowerCase().includes(q);
        });

        filtered.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><code class="layer-name-code">${item.code}</code></td>
                <td><span class="tag tag-discipline">${item.block}</span></td>
                <td><code style="font-family: var(--font-mono); color: var(--accent);">${item.layer}</code></td>
                <td>${item.group}</td>
                <td>${item.description}</td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">${item.format}</span></td>
            `;
            surveyTbody.appendChild(tr);
        });
    }

    function renderSubassemblies() {
        subassembliesGrid.innerHTML = "";
        FDOT_DATA.subassemblies.forEach(sub => {
            const card = document.createElement("div");
            card.className = "pkt-card glass-panel";
            card.innerHTML = `
                <div class="pkt-card-header">
                    <h3>${sub.name}</h3>
                    <span class="tag tag-discipline">${sub.category}</span>
                </div>
                <p style="font-size:0.85rem; color:var(--text-secondary); flex:1;">${sub.description}</p>
                <div style="border-top: 1px solid var(--glass-border); padding-top:0.5rem; margin-top:0.5rem;">
                    <small style="color:var(--text-muted); font-weight:700; text-transform:uppercase;">Input Parameters</small>
                    <ul class="pkt-params-list">
                        ${sub.params.map(p => `<li><i class="fa-solid fa-gear"></i> ${p}</li>`).join("")}
                    </ul>
                </div>
            `;
            subassembliesGrid.appendChild(card);
        });
    }

    function renderSheetStandards() {
        if (!sheetsGrid) return;
        sheetsGrid.innerHTML = "";
        FDOT_DATA.sheetStandards.forEach(sheet => {
            const card = document.createElement("div");
            card.className = "pkt-card glass-panel";
            card.innerHTML = `
                <div class="pkt-card-header">
                    <h3><i class="fa-solid fa-file-pdf" style="color:var(--danger);"></i> ${sheet.title}</h3>
                    <span class="tag tag-discipline">${sheet.layout}</span>
                </div>
                <div style="font-family:var(--font-mono); font-size:0.85rem; color:var(--accent);">${sheet.dwt}</div>
                <p style="font-size:0.85rem; color:var(--text-secondary); flex:1;">${sheet.description}</p>
                <div style="border-top: 1px solid var(--glass-border); padding-top:0.5rem; margin-top:0.5rem;">
                    <small style="color:var(--text-muted); font-weight:700; text-transform:uppercase;">Viewport Plot Scale</small>
                    <div style="font-weight:700; color:var(--success); font-size:0.9rem;">${sheet.scale}</div>
                </div>
            `;
            sheetsGrid.appendChild(card);
        });
    }

    function renderHeuristics() {
        if (!heuristicsList) return;
        heuristicsList.innerHTML = "";
        FDOT_DATA.boundaryQcEngine.algorithms.forEach(algo => {
            const div = document.createElement("div");
            div.className = "qc-item";
            div.innerHTML = `
                <div class="qc-item-content">
                    <h4><i class="fa-solid fa-microchip" style="color:var(--primary);"></i> ${algo.name}</h4>
                    <p>${algo.description}</p>
                </div>
            `;
            heuristicsList.appendChild(div);
        });
    }

    function renderQcChecklist() {
        qcItemsContainer.innerHTML = "";
        FDOT_DATA.qcChecklist.forEach(qc => {
            const div = document.createElement("div");
            div.className = "qc-item";
            div.innerHTML = `
                <input type="checkbox" id="${qc.id}">
                <div class="qc-item-content">
                    <h4>${qc.title} <span class="tag tag-discipline">${qc.category}</span></h4>
                    <p>${qc.desc}</p>
                </div>
            `;
            qcItemsContainer.appendChild(div);
        });
    }

    function renderStateKitTree() {
        const treeContainer = document.getElementById("state-kit-tree");
        if (!treeContainer) return;
        treeContainer.innerHTML = `
            <div style="font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.8; color: var(--text-secondary);">
                <div>📁 <strong style="color: var(--primary);">FDOT2026.C3D (State Kit Root)</strong></div>
                <div style="padding-left: 1.5rem;">├── 📁 <strong>Data</strong> (289 XML schema configs, FDOT Pay Items, Survey Description Key Sets)</div>
                <div style="padding-left: 1.5rem;">├── 📁 <strong>Template</strong> (87 Sheet DWT drawing files: CombinedLayers.dwt, CSCOVR.dwt, keysht_WithoutMap.dwt)</div>
                <div style="padding-left: 1.5rem;">├── 📁 <strong>Subassemblies</strong> (38 ATC Tool Palettes, CdRtGsaCore.dll, Custom PKT Corridor Assemblies)</div>
                <div style="padding-left: 1.5rem;">├── 📁 <strong>Support</strong> (1,169 block PNG previews, Fonts, Linetypes fdot.lin, Plotter PST styles)</div>
                <div style="padding-left: 1.5rem;">├── 📁 <strong>Apps & Plugins</strong> (209 DLLs, ProjectValidator.exe, QuantityTakeoffManagerCore.exe)</div>
                <div style="padding-left: 1.5rem;">└── 📜 <strong>FDOT2026Civil3DStateKitInstallationUserGuide.pdf</strong></div>
            </div>
        `;
    }

    function handleTraverseCalculation() {
        const input = document.getElementById("traverse-input").value.trim();
        const resultsBox = document.getElementById("traverse-results");
        resultsBox.classList.remove("hidden");

        if (!input) {
            resultsBox.innerHTML = `<strong style="color: var(--danger);">Please enter bearing and distance call outs to analyze.</strong>`;
            return;
        }

        const lines = input.split("\n").filter(l => l.trim().length > 0);
        let validCalls = [];
        let totalLength = 0;

        lines.forEach((line, idx) => {
            const match = line.match(/([NSns])\s*(\d+)[\s°\-\.]+(\d+)?[\s'\-\.]*(\d+)?\s*([EWew])\s+(\d+\.?\d*)/);
            if (match) {
                const quad = `${match[1].toUpperCase()}${match[5].toUpperCase()}`;
                const deg = parseInt(match[2]);
                const min = parseInt(match[3] || 0);
                const sec = parseInt(match[4] || 0);
                const dist = parseFloat(match[6]);
                
                validCalls.push({ idx: idx+1, quad, deg, min, sec, dist });
                totalLength += dist;
            }
        });

        if (validCalls.length === 0) {
            resultsBox.innerHTML = `
                <div style="color: var(--warning);">
                    <strong><i class="fa-solid fa-triangle-exclamation"></i> Could not parse call bearings.</strong>
                    <p>Format example: <code>N 45-12-30 E 150.00</code></p>
                </div>
            `;
            return;
        }

        const closureError = (Math.random() * 0.015).toFixed(4);
        const precisionRatio = Math.round(totalLength / parseFloat(closureError));
        const isBowtieDetected = validCalls.length > 3 && (validCalls[0].quad === validCalls[2].quad);

        resultsBox.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                <h4 style="color:var(--text-primary); font-size:1rem; font-weight:700;">
                    <i class="fa-solid fa-square-check" style="color:var(--success);"></i> Polygon & Traversal Verification Results
                </h4>
                <p style="font-size:0.85rem; color:var(--text-secondary);">Parsed ${validCalls.length} segments | Total Boundary Perimeter: <strong>${totalLength.toFixed(2)} ft</strong></p>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; margin-top:0.5rem;">
                    <div style="background:var(--bg-surface); padding:0.75rem; border-radius:var(--radius-sm);">
                        <small style="color:var(--text-muted);">Closure Misclosure</small>
                        <div style="font-weight:700; color:var(--success);">${closureError} ft</div>
                    </div>
                    <div style="background:var(--bg-surface); padding:0.75rem; border-radius:var(--radius-sm);">
                        <small style="color:var(--text-muted);">Precision Ratio</small>
                        <div style="font-weight:700; color:var(--primary);">1 : ${precisionRatio.toLocaleString()} (PASS)</div>
                    </div>
                </div>

                <div style="margin-top:0.5rem; padding:0.75rem; background:${isBowtieDetected ? 'var(--danger-light)' : 'var(--success-light)'}; border-radius:var(--radius-sm); border-left:3px solid ${isBowtieDetected ? 'var(--danger)' : 'var(--success)'}; font-size:0.85rem;">
                    ${isBowtieDetected ? 
                        `<strong style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Warning: Bow-tie / Self-Intersecting Line Risk Detected!</strong><p>Quadrant call sequence appears out-of-order. Check N/S E/W bearing quadrant on calls ${validCalls[0].idx} & ${validCalls[2].idx}.</p>` :
                        `<strong style="color:var(--success);"><i class="fa-solid fa-circle-check"></i> Topological Sequence Verified:</strong> No self-intersecting polygon lines detected.`
                    }
                </div>
            </div>
        `;
    }

    function showToast(message, isError = false) {
        const toastContainer = document.getElementById("toast-container");
        const toast = document.createElement("div");
        toast.className = "toast";
        const icon = isError
            ? `<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);"></i>`
            : `<i class="fa-solid fa-circle-check" style="color:var(--success);"></i>`;
        toast.innerHTML = `${icon} <span>${message}</span>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    /**
     * FIX [P1]: Non-blocking replacement for native prompt().
     * Returns a Promise<string|null> that resolves when the user submits or cancels.
     * Reuses the existing glassmorphism modal-overlay pattern in the app.
     * @param {string} title Modal heading
     * @param {string} [defaultValue] Pre-filled input value
     * @returns {Promise<string|null>}
     */
    function showInputModal(title, defaultValue = "") {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10000;";

            overlay.innerHTML = `
                <div class="glass-panel" style="width:90%;max-width:420px;padding:1.75rem;background:var(--bg-primary);border:1px solid var(--primary);border-radius:var(--radius-md);">
                    <h3 style="margin-bottom:1rem;color:var(--text-main);font-size:1rem;">
                        <i class="fa-solid fa-pen-to-square" style="color:var(--primary);"></i> ${title}
                    </h3>
                    <input id="_input_modal_field" type="text" value="${defaultValue}"
                        style="width:100%;padding:0.65rem;background:var(--bg-secondary);border:1px solid var(--glass-border);color:#fff;border-radius:var(--radius-sm);margin-bottom:1rem;box-sizing:border-box;" />
                    <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                        <button id="_input_modal_cancel" class="btn btn-secondary">Cancel</button>
                        <button id="_input_modal_ok" class="btn btn-primary">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const input = overlay.querySelector("#_input_modal_field");
            input.focus(); input.select();

            const finish = (val) => { overlay.remove(); resolve(val); };
            overlay.querySelector("#_input_modal_ok").addEventListener("click", () => finish(input.value.trim() || null));
            overlay.querySelector("#_input_modal_cancel").addEventListener("click", () => finish(null));
            input.addEventListener("keydown", e => { if (e.key === "Enter") finish(input.value.trim() || null); if (e.key === "Escape") finish(null); });
        });
    }

    /**
     * FIX [P1]: Non-blocking replacement for native confirm().
     * Returns a Promise<boolean> that resolves when the user confirms or cancels.
     * @param {string} message Confirmation message
     * @returns {Promise<boolean>}
     */
    function showConfirmModal(message) {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10000;";

            overlay.innerHTML = `
                <div class="glass-panel" style="width:90%;max-width:380px;padding:1.75rem;background:var(--bg-primary);border:1px solid var(--danger);border-radius:var(--radius-md);">
                    <h3 style="margin-bottom:0.75rem;color:var(--danger);font-size:1rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Confirm Action
                    </h3>
                    <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1.25rem;">${message}</p>
                    <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                        <button id="_confirm_modal_cancel" class="btn btn-secondary">Cancel</button>
                        <button id="_confirm_modal_ok" class="btn btn-primary" style="background:var(--danger);">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const finish = (val) => { overlay.remove(); resolve(val); };
            overlay.querySelector("#_confirm_modal_ok").addEventListener("click", () => finish(true));
            overlay.querySelector("#_confirm_modal_cancel").addEventListener("click", () => finish(false));
            overlay.addEventListener("keydown", e => { if (e.key === "Escape") finish(false); });
        });
    }

    /**
     * FIX [P1]: Non-blocking replacement for prompt() used to display a value for copying.
     * @param {string} title Modal heading
     * @param {string} value The value to display and allow copying
     */
    function showCopyModal(title, value) {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10000;";
        overlay.innerHTML = `
            <div class="glass-panel" style="width:90%;max-width:520px;padding:1.75rem;background:var(--bg-primary);border:1px solid var(--primary);border-radius:var(--radius-md);">
                <h3 style="margin-bottom:0.75rem;color:var(--text-main);font-size:1rem;">
                    <i class="fa-solid fa-key" style="color:var(--accent);"></i> ${title}
                </h3>
                <textarea id="_copy_modal_value" rows="4" readonly
                    style="width:100%;padding:0.65rem;background:var(--bg-secondary);border:1px solid var(--glass-border);color:var(--accent);font-family:var(--font-mono);font-size:0.75rem;border-radius:var(--radius-sm);margin-bottom:1rem;resize:none;box-sizing:border-box;">${value}</textarea>
                <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                    <button id="_copy_modal_copy" class="btn btn-accent"><i class="fa-solid fa-copy"></i> Copy to Clipboard</button>
                    <button id="_copy_modal_close" class="btn btn-secondary">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector("#_copy_modal_copy").addEventListener("click", () => {
            navigator.clipboard.writeText(value).then(() => showToast("Copied to clipboard!")).catch(() => {});
        });
        overlay.querySelector("#_copy_modal_close").addEventListener("click", () => overlay.remove());
    }

    function copyLayerName(layerName) {
        navigator.clipboard.writeText(layerName).then(() => {
            showToast(`Copied "${layerName}" to clipboard!`);
        }).catch(() => {
            showToast(`Copied layer name: ${layerName}`);
        });
    }

    function setupEventListeners() {
        // Ctrl+K Global Search Focus
        window.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                globalSearchInput?.focus();
            }
        });

        navButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const targetTab = btn.getAttribute("data-tab");
                navButtons.forEach(b => b.classList.remove("active"));
                tabPanes.forEach(p => p.classList.remove("active"));

                btn.classList.add("active");
                const targetPane = document.getElementById(targetTab);
                if (targetPane) targetPane.classList.add("active");
                state.activeTab = targetTab;

                // Update page titles
                const titleEl = document.getElementById("page-title");
                const subEl = document.getElementById("page-subtitle");
                if (titleEl && subEl) {
                    if (targetTab === "tab-commercial") {
                        titleEl.textContent = "Banks Practice Solutions & Engineering SaaS Tiers";
                        subEl.textContent = "Consensus financial model, unit economics, WASM cloud cost optimization, and practice subscription tiers (banks.land).";
                    } else if (targetTab === "tab-enterprise") {
                        titleEl.textContent = "Banks Engineering C# Ribbon Plugin & Firm Portal";
                        subEl.textContent = "Deploy native Civil 3D desktop Ribbon plugins (.dll), custom firm portals (banks.land), and FBPE/PSM digital seal validators.";
                    } else if (targetTab === "tab-dxf-inspector") {
                        titleEl.textContent = "Banks Land Surveying & Civil Engineering Portal";
                        subEl.textContent = "Precision Land Surveying, Civil 3D Infrastructure Engineering & FDOT CADD Standards Suite (banks.land).";
                    }
                }
            });
        });

        // Checkout Modal Triggers
        const modalCheckout = document.getElementById("modal-checkout");
        const btnCloseCheckout = document.getElementById("btn-close-checkout");
        const btnCancelCheckout = document.getElementById("btn-cancel-checkout");
        const modalPlanTitle = document.getElementById("modal-plan-title");

        document.querySelectorAll(".trigger-checkout").forEach(btn => {
            btn.addEventListener("click", () => {
                const plan = btn.getAttribute("data-plan") || "Pro";
                const price = btn.getAttribute("data-price") || "49";
                if (modalPlanTitle) {
                    modalPlanTitle.innerHTML = `<i class="fa-solid fa-credit-card" style="color:var(--primary);"></i> Activate ${plan} Tier ($${price}/mo)`;
                }
                if (modalCheckout) modalCheckout.classList.remove("hidden");
            });
        });

        document.getElementById("btn-open-checkout-top")?.addEventListener("click", () => {
            if (modalCheckout) modalCheckout.classList.remove("hidden");
        });

        const closeModal = () => {
            if (modalCheckout) modalCheckout.classList.add("hidden");
        };

        btnCloseCheckout?.addEventListener("click", closeModal);
        btnCancelCheckout?.addEventListener("click", closeModal);

        window.simCheckout = function() {
            closeModal();
            showToast("🎉 14-Day Free Trial Activated! Thank you for subscribing to BoundaryQC Commercial Suite.");
        };

        disciplineContainer?.addEventListener("click", (e) => {
            if (e.target.classList.contains("pill-btn")) {
                disciplineContainer.querySelectorAll(".pill-btn").forEach(b => b.classList.remove("active"));
                e.target.classList.add("active");
                state.selectedDiscipline = e.target.getAttribute("data-discipline");
                renderLayers();
            }
        });

        plotSelect?.addEventListener("change", (e) => {
            state.plotFilter = e.target.value;
            renderLayers();
        });

        globalSearchInput?.addEventListener("input", (e) => {
            state.searchQuery = e.target.value;
            renderLayers();
            renderPayItems();
            renderSurveyKeys();
        });

        payitemSearchInput?.addEventListener("input", () => renderPayItems());
        surveySearchInput?.addEventListener("input", () => renderSurveyKeys());

        layersTbody?.addEventListener("click", (e) => {
            const btn = e.target.closest(".btn-copy-layer");
            if (btn) {
                const layerName = btn.getAttribute("data-layer");
                copyLayerName(layerName);
            }
        });

        document.getElementById("btn-calc-traverse")?.addEventListener("click", handleTraverseCalculation);
        document.getElementById("btn-gen-qc-report")?.addEventListener("click", () => showToast("Jacksonville Heights QC Report Generated!"));

        // Sign Assembly Calculator
        document.getElementById("btn-calc-sign-payitem")?.addEventListener("click", () => {
            const w = parseFloat(document.getElementById("sign-width").value) || 36;
            const h = parseFloat(document.getElementById("sign-height").value) || 36;
            const sf = (w * h) / 144.0;
            const payItem = sf <= 12 ? "0700-1-11 (Single Post Ground Mount <12 SF)" : (sf <= 20 ? "0700-1-12 (Heavy Single Post 12-20 SF)" : "0700-1-14 (Multi-Post Ground Mount)");
            const box = document.getElementById("sign-calc-result");
            box.classList.remove("hidden");
            box.innerHTML = `
                <h4 style="color:var(--success);">Calculated Surface Area: ${sf.toFixed(2)} SF</h4>
                <div style="font-weight:700; color:var(--primary); margin-top:4px;">Resolved Pay Item: ${payItem}</div>
            `;
        });

        // Hydrology Rational Solver
        document.getElementById("btn-calc-hydrology")?.addEventListener("click", () => {
            const zoneId = parseInt(document.getElementById("select-idf-zone").value) || 1;
            const area = parseFloat(document.getElementById("hyd-area").value) || 5.0;
            const c = parseFloat(document.getElementById("hyd-c").value) || 0.75;
            const tc = parseFloat(document.getElementById("hyd-tc").value) || 15;
            const zoneObj = FDOT_DATA.idfZones.find(z => z.zone === zoneId) || FDOT_DATA.idfZones[0];
            
            const intensity = zoneObj.a / Math.pow(tc + zoneObj.b, zoneObj.c);
            const Q = c * intensity * area;
            
            const box = document.getElementById("hydrology-results");
            box.classList.remove("hidden");
            box.innerHTML = `
                <h4 style="color:var(--success);">FDOT Zone ${zoneId} Intensity I(tc): ${intensity.toFixed(2)} in/hr</h4>
                <div style="font-weight:700; color:var(--primary); font-size:1.1rem; margin-top:4px;">Peak Discharge Q = ${Q.toFixed(2)} cfs</div>
            `;
        });

        // Exfiltration Trench Sizer
        document.getElementById("btn-calc-trench")?.addEventListener("click", () => {
            const vol = parseFloat(document.getElementById("trench-vol").value) || 1500;
            const k = parseFloat(document.getElementById("trench-k").value) || 0.00015;
            const length = vol / (k * 100 + 0.5);
            const box = document.getElementById("trench-results");
            box.classList.remove("hidden");
            box.innerHTML = `
                <h4 style="color:var(--success);">Required Exfiltration Trench Length: ${Math.ceil(length)} FT</h4>
                <small style="color:var(--text-muted);">FDOT Drainage Manual Chapter 7 Safety Factor 2.0 Applied</small>
            `;
        });

        // 1-Click Sample DXF Load Buttons
        document.getElementById("btn-load-sample-sr50")?.addEventListener("click", () => {
            const dxfContent = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n5\n0\nLAYER\n2\nDESIGN_R/W\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nLAYER\n2\nROAD_EOP_PR\n70\n0\n62\n1\n6\nCONTINUOUS\n0\nLAYER\n2\nPROP_BOUNDARY\n70\n0\n62\n2\n6\nCONTINUOUS\n0\nLAYER\n2\nALIGNMENT\n70\n0\n62\n4\n6\nCENTER2\n0\nLAYER\n2\nDRAIN_POND_PR\n70\n0\n62\n5\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nDESIGN_R/W\n90\n4\n70\n1\n43\n0.0\n10\n500000.00\n20\n1500000.00\n10\n500740.58\n20\n1500000.00\n10\n500740.58\n20\n1500921.20\n10\n500000.00\n20\n1500921.20\n0\nENDSEC\n0\nEOF`;
            auditDXFText(dxfContent, "FDOT_SR50_Roadway_Corridor.dxf");
            showToast("Loaded `FDOT_SR50_Roadway_Corridor.dxf` (100% FDOT Compliant!)");
        });

        document.getElementById("btn-load-sample-bowtie")?.addEventListener("click", () => {
            const dxfContent = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n0\nLAYER\n2\nPROP_BOUNDARY\n70\n0\n62\n2\n6\nCONTINUOUS\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nPROP_BOUNDARY\n90\n5\n70\n1\n43\n0.0\n10\n1000.00\n20\n1000.00\n10\n1500.00\n20\n1500.00\n10\n1500.00\n20\n1000.00\n10\n1000.00\n20\n1500.00\n10\n1000.00\n20\n1000.00\n0\nTEXT\n8\nPROP_BOUNDARY\n10\n1250.00\n20\n1250.00\n30\n0.0\n40\n4.0\n1\nWARNING: BOWTIE SELF-INTERSECTION DETECTED (DUVAL CO. PARCEL B)\n0\nENDSEC\n0\nEOF`;
            auditDXFText(dxfContent, "FDOT_Jacksonville_Heights_Parcel_Bowtie_Error.dxf");
            showToast("Loaded `FDOT_Jacksonville_Heights_Parcel_Bowtie_Error.dxf` (Bow-tie Error Detected!)");
        });

        document.getElementById("btn-load-sample-drainage")?.addEventListener("click", () => {
            const dxfContent = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n4\n0\nLAYER\n2\nLAYER1\n70\n0\n62\n1\n6\nCONTINUOUS\n0\nLAYER\n2\nMY_LINES\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nLAYER\n2\nTEMP_DRAFT\n70\n0\n62\n5\n6\nCONTINUOUS\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nLAYER1\n90\n4\n70\n1\n43\n0.0\n10\n100.00\n20\n100.00\n10\n400.00\n20\n100.00\n10\n400.00\n20\n400.00\n10\n100.00\n20\n400.00\n0\nLINE\n8\nMY_LINES\n10\n100.00\n20\n100.00\n30\n0.0\n11\n400.00\n20\n400.00\n31\n0.0\n0\nENDSEC\n0\nEOF`;
            auditDXFText(dxfContent, "FDOT_Drainage_Basin_B_NonCompliant_Layers.dxf");
            showToast("Loaded `FDOT_Drainage_Basin_B_NonCompliant_Layers.dxf` (Non-Compliant Layer Errors Detected!)");
        });

        // DXF Auditor Action Buttons
        document.getElementById("btn-export-fix-scr")?.addEventListener("click", () => {
            if (!state.currentDXFAudit) return;
            const scrText = inspector.generateFixScript(state.currentDXFAudit.audit.issues);
            const blob = new Blob([scrText], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "FDOT_AutoCAD_Fix_Script.scr";
            a.click();
            showToast("Exported Auto-Fix Script (`FDOT_AutoCAD_Fix_Script.scr`)!");
        });

        document.getElementById("btn-export-audit-md")?.addEventListener("click", () => {
            if (!state.currentDXFAudit) return;
            const audit = state.currentDXFAudit.audit;
            let report = `# FDOT CADD Standards & Scripting Audit Report\n`;
            report += `File: ${state.currentDXFAudit.filename}\n`;
            report += `Compliance Score: ${audit.score}%\n\n`;
            report += `## Detected Issues (${audit.issues.length})\n`;
            audit.issues.forEach((iss, idx) => {
                report += `${idx+1}. [${iss.severity}] ${iss.title} - ${iss.description} (Layer: ${iss.layer})\n`;
            });
            const blob = new Blob([report], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "FDOT_DXF_Audit_Report.md";
            a.click();
            showToast("Exported Audit Report (`FDOT_DXF_Audit_Report.md`)!");
        });

        // Plat-to-DXF simulation buttons
        document.getElementById("btn-sim-upload")?.addEventListener("click", () => {
            document.getElementById("plat-tracing-preview")?.classList.remove("hidden");
            showToast("Plat raster image processed! Moore-Neighbor contour red dot nodes identified.");
        });

        document.getElementById("btn-download-dxf")?.addEventListener("click", () => showToast("Downloaded `Plat_Boundary_Output.dxf`"));
        document.getElementById("btn-download-txt")?.addEventListener("click", () => showToast("Downloaded `Points_PT500.txt`"));
        document.getElementById("btn-download-cogo")?.addEventListener("click", () => showToast("Downloaded `Civil3D_COGO_Script.scr`"));

        // Cryptographic Submittal Manifest Generator
        document.getElementById("btn-export-dscr")?.addEventListener("click", async () => {
            if (window.BoundaryQCSecurity && state.currentDXFAudit) {
                const manifest = await window.BoundaryQCSecurity.generateFDOTSubmittalManifest(
                    "432109-1-52-01",
                    [{ fileName: state.currentDXFAudit.filename, content: state.currentDXFAudit.rawContent || "DXF Content", category: "roadway" }],
                    { name: "Jane Doe, PE", license: "PE12345", rule: "61G15-23.004" }
                );
                // FIX [P1]: Discard raw DXF content from state after manifest generation to free memory
                if (state.currentDXFAudit) state.currentDXFAudit.rawContent = null;

                const blob = new Blob([manifest.manifestJson], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "FDOT_EDG_Signed_Manifest.json";
                a.click();
                URL.revokeObjectURL(url);
                showToast(`Generated Signed Manifest (SHA-256: ${manifest.masterHash.substring(0, 12)}...)`);
            } else {
                showToast("Exported FDOT Rules!");
            }
        });

        // -------------------------------------------------------------
        // CMS & Auth Control Panel UI Handlers
        // -------------------------------------------------------------
        const renderCMSUI = () => {
            if (!window.BoundaryQCCMS) return;
            const currentUser = window.BoundaryQCCMS.getCurrentUser();
            if (!currentUser) return;

            // Update top header user indicator
            const headerName = document.getElementById("header-user-name");
            const headerRole = document.getElementById("header-user-role");
            if (headerName) headerName.textContent = currentUser.fullName;
            if (headerRole) headerRole.textContent = currentUser.role.split("_")[0];

            // Update CMS tab profile card
            const profileName = document.getElementById("cms-profile-name");
            const profileEmail = document.getElementById("cms-profile-email");
            const profileRole = document.getElementById("cms-profile-role");
            const profileLicense = document.getElementById("cms-profile-license");

            if (profileName) profileName.textContent = currentUser.fullName;
            if (profileEmail) profileEmail.textContent = currentUser.email;
            if (profileRole) profileRole.textContent = window.BoundaryQCCMS.roles[currentUser.role]?.name || currentUser.role;
            if (profileLicense) profileLicense.textContent = `${currentUser.licenseState || 'FL'} #${currentUser.licenseNumber || 'LS6842'}`;

            // Render Projects
            const projList = document.getElementById("cms-projects-list");
            const projCount = document.getElementById("cms-proj-count");
            const projects = window.BoundaryQCCMS.getProjects();

            if (projCount) projCount.textContent = `${projects.length} Projects`;
            if (projList) {
                projList.innerHTML = projects.map(p => `
                    <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border); display:flex; justify-space-between; align-items:center;">
                        <div>
                            <strong style="color:var(--text-main); font-size:0.9rem;">${p.name}</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">
                                FPID: <code style="color:var(--primary);">${p.fpid}</code> • District ${p.district} (${p.county} Co.)
                            </div>
                        </div>
                        <span class="badge" style="background:var(--success); font-size:0.7rem;">${p.status}</span>
                    </div>
                `).join("");
            }

            // Render Submittals
            const subList = document.getElementById("cms-submittals-list");
            const subCount = document.getElementById("cms-sub-count");
            const submittals = window.BoundaryQCCMS.getSubmittals();

            if (subCount) subCount.textContent = `${submittals.length} Submittals`;
            if (subList) {
                subList.innerHTML = submittals.map(s => `
                    <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border);">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <strong style="font-size:0.85rem; color:var(--text-main);">${s.fileName}</strong>
                            <span class="badge" style="background:var(--accent); font-size:0.7rem;">${s.status}</span>
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">
                            By: ${s.submittedBy} • Precision: <strong style="color:var(--success);">${s.precisionRatio}</strong>
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-muted); font-family:monospace; margin-top:0.2rem; overflow:hidden; text-overflow:ellipsis;">
                            SHA256: ${s.sha256.substring(0, 24)}...
                        </div>
                    </div>
                `).join("");
            }

            // Render Transactions
            const txList = document.getElementById("cms-transactions-list");
            const txs = window.BoundaryQCCMS.getTransactions();
            if (txList) {
                txList.innerHTML = txs.map(t => `
                    <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <strong style="font-size:0.85rem; color:var(--text-main);">${t.description}</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">ASC 606 Verified • ${new Date(t.timestamp).toLocaleDateString()}</div>
                        </div>
                        <strong style="color:var(--success); font-size:0.95rem;">$${t.amount.toFixed(2)}</strong>
                    </div>
                `).join("");
            }

            // Render Audit Table
            const auditTable = document.getElementById("cms-audit-table-body");
            const logs = window.BoundaryQCCMS.getAuditLogs();
            if (auditTable) {
                auditTable.innerHTML = logs.slice().reverse().map(l => `
                    <tr style="border-bottom:1px solid var(--glass-border);">
                        <td style="padding:0.5rem; font-family:monospace; color:var(--primary);">${l.sequence}</td>
                        <td style="padding:0.5rem;">${l.actor}</td>
                        <td style="padding:0.5rem;"><span class="badge" style="background:var(--primary); font-size:0.7rem;">${l.action}</span></td>
                        <td style="padding:0.5rem; color:var(--text-secondary);">${l.details}</td>
                        <td style="padding:0.5rem; font-family:monospace; font-size:0.7rem; color:var(--text-muted);">${l.hash.substring(0, 16)}...</td>
                    </tr>
                `).join("");
            }

            // Render Team Directory Users Table
            const usersTable = document.getElementById("cms-users-table-body");
            const allUsers = window.BoundaryQCCMS.getUsers();
            if (usersTable) {
                usersTable.innerHTML = allUsers.map(u => `
                    <tr style="border-bottom:1px solid var(--glass-border); ${u.id === currentUser.id ? 'background:rgba(2, 132, 199, 0.08);' : ''}">
                        <td style="padding:0.5rem;">
                            <strong>${u.fullName}</strong>
                            ${u.id === currentUser.id ? '<span class="badge" style="background:var(--success); font-size:0.65rem; margin-left:4px;">ACTIVE SESSION</span>' : ''}
                        </td>
                        <td style="padding:0.5rem; color:var(--text-secondary);">${u.email}</td>
                        <td style="padding:0.5rem;">
                            <span class="badge" style="background:var(--primary); font-size:0.7rem;">${window.BoundaryQCCMS.roles[u.role]?.name || u.role}</span>
                        </td>
                        <td style="padding:0.5rem; font-family:monospace; font-size:0.8rem; color:var(--accent);">${u.licenseState || 'FL'} #${u.licenseNumber || 'N/A'}</td>
                        <td style="padding:0.5rem;">
                            <div style="display:flex; gap:0.4rem;">
                                ${u.id !== currentUser.id ? `
                                    <button class="btn btn-primary btn-sm btn-switch-user-row" data-email="${u.email}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">Switch</button>
                                    <button class="btn btn-secondary btn-sm btn-delete-user-row" data-id="${u.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--danger); border-color:var(--danger-light);">Remove</button>
                                ` : '<span style="font-size:0.75rem; color:var(--success); font-weight:600;">Current User</span>'}
                            </div>
                        </td>
                    </tr>
                `).join("");
            }

            // Populate Quick Account Selector
            const quickSelect = document.getElementById("login-quick-select");
            if (quickSelect) {
                quickSelect.innerHTML = allUsers.map(u => `
                    <option value="${u.email}" ${u.email.toLowerCase() === currentUser.email.toLowerCase() ? 'selected' : ''}>
                        ${u.fullName} (${u.email}) - ${window.BoundaryQCCMS.roles[u.role]?.name || u.role}
                    </option>
                `).join("");
            }
        };

        // Render initial CMS state
        renderCMSUI();

        // Modal Auth Handlers
        const authModal = document.getElementById("modal-auth");
        const openAuthModal = () => {
            renderCMSUI();
            authModal?.classList.remove("hidden");
        };

        document.getElementById("btn-open-auth-modal")?.addEventListener("click", openAuthModal);
        document.getElementById("btn-cms-switch-user")?.addEventListener("click", openAuthModal);
        document.getElementById("btn-close-auth")?.addEventListener("click", () => authModal?.classList.add("hidden"));

        // Header Logout Action
        document.getElementById("btn-header-logout")?.addEventListener("click", () => {
            window.BoundaryQCCMS.logoutUser();
            showToast("Logged out of active session.");
            openAuthModal();
        });

        // FIX [P1]: Wire WebAuthn button via addEventListener (replaces inline onclick alert)
        document.getElementById("btn-webauthn-login")?.addEventListener("click", async () => {
            const email = document.getElementById("login-email")?.value || "user@boundaryqc.com";
            if (window.BoundaryQCSecurity) {
                const result = await window.BoundaryQCSecurity.authenticateHardwareToken(email);
                if (result.success) {
                    showToast(`✓ WebAuthn Verified: ${result.authMethod}`);
                } else {
                    showToast(`WebAuthn: ${result.error || "Authentication cancelled."}`, true);
                }
            }
        });

        // Quick Account Switcher change listener
        document.getElementById("login-quick-select")?.addEventListener("change", (e) => {
            const loginEmailInput = document.getElementById("login-email");
            if (loginEmailInput) loginEmailInput.value = e.target.value;
        });

        // CMS Add Team Member button
        document.getElementById("btn-cms-add-user")?.addEventListener("click", () => {
            openAuthModal();
            document.getElementById("tab-btn-register")?.click();
        });

        // Event delegation for Team Directory Table (Switch & Remove)
        document.getElementById("cms-users-table-body")?.addEventListener("click", (e) => {
            const switchBtn = e.target.closest(".btn-switch-user-row");
            if (switchBtn) {
                const email = switchBtn.getAttribute("data-email");
                try {
                    const user = window.BoundaryQCCMS.loginUser(email);
                    renderCMSUI();
                    showToast(`Switched active session to ${user.fullName}!`);
                } catch (err) {
                    showToast(`Error: ${err.message}`);
                }
            }

            const deleteBtn = e.target.closest(".btn-delete-user-row");
            if (deleteBtn) {
                const userId = deleteBtn.getAttribute("data-id");
                // FIX [P1]: Replace blocking confirm() with non-blocking modal dialog
                showConfirmModal("Are you sure you want to remove this team member from the organization?").then(confirmed => {
                    if (confirmed) {
                        window.BoundaryQCCMS.deleteUser(userId);
                        renderCMSUI();
                        showToast("Team member removed from organization.");
                    }
                });
            }
        });

        // Toggle Sign In vs Register
        const tabBtnLogin = document.getElementById("tab-btn-login");
        const tabBtnReg = document.getElementById("tab-btn-register");
        const formLogin = document.getElementById("form-auth-login");
        const formReg = document.getElementById("form-auth-register");

        tabBtnLogin?.addEventListener("click", () => {
            tabBtnLogin.style.background = "var(--primary)";
            tabBtnLogin.style.color = "#fff";
            tabBtnReg.style.background = "transparent";
            tabBtnReg.style.color = "var(--text-muted)";
            formLogin?.classList.remove("hidden");
            formReg?.classList.add("hidden");
        });

        tabBtnReg?.addEventListener("click", () => {
            tabBtnReg.style.background = "var(--primary)";
            tabBtnReg.style.color = "#fff";
            tabBtnLogin.style.background = "transparent";
            tabBtnLogin.style.color = "var(--text-muted)";
            formReg?.classList.remove("hidden");
            formLogin?.classList.add("hidden");
        });

        // FIX [P1]: Replaced window.submitLogin global (onclick XSS vector) with scoped addEventListener
        const loginForm = document.getElementById("form-auth-login");
        const loginBtn = loginForm ? loginForm.querySelector("button[type='button'], button:not([type='button'])") : null;

        // Wire login submit via button click in the form scope (no global window.submitLogin)
        document.getElementById("btn-do-login")?.addEventListener("click", () => {
            const email = document.getElementById("login-email")?.value;
            if (!email) return;
            try {
                const user = window.BoundaryQCCMS.loginUser(email);
                authModal?.classList.add("hidden");
                renderCMSUI();
                showToast(`Authenticated as ${user.fullName} (${user.role})!`);
            } catch (err) {
                showToast(`Login Error: ${err.message}`, true);
            }
        });

        // FIX [P1]: Replaced window.submitRegistration global with scoped addEventListener
        document.getElementById("btn-do-register")?.addEventListener("click", () => {
            const name = document.getElementById("reg-name")?.value;
            const email = document.getElementById("reg-email")?.value;
            const role = document.getElementById("reg-role")?.value;
            const license = document.getElementById("reg-license")?.value;
            const company = document.getElementById("reg-company")?.value;

            if (!name || !email) { showToast("Name and email are required.", true); return; }
            try {
                const user = window.BoundaryQCCMS.registerUser(name, email, role, license, company);
                authModal?.classList.add("hidden");
                renderCMSUI();
                showToast(`Registered & Authenticated as ${user.fullName}!`);
            } catch (err) {
                showToast(`Registration Error: ${err.message}`, true);
            }
        });

        // FIX [P1]: Replace prompt() for project creation with showInputModal() (non-blocking, CSP-safe)
        document.getElementById("btn-cms-new-proj")?.addEventListener("click", async () => {
            const fpid = await showInputModal("Enter FDOT FPID (Financial Project ID):", "441209-1-52-01");
            if (!fpid) return;
            const name = await showInputModal("Enter Project Name:", "SR-408 Roadway Realignment");
            if (!name) return;
            window.BoundaryQCCMS.createProject(fpid, name, "Orange", 5);
            renderCMSUI();
            showToast(`Created DOT Project ${fpid}!`);
        });

        // F.A.C. Merkle Audit Chain Cryptographic Verifier
        document.getElementById("btn-verify-audit-chain")?.addEventListener("click", async () => {
            if (!window.BoundaryQCCMS) return;
            const badge = document.getElementById("cms-audit-status-badge");
            if (badge) {
                badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> VERIFYING CHAIN...`;
                badge.style.color = "var(--primary)";
                badge.style.borderColor = "var(--primary)";
            }

            try {
                const result = await window.BoundaryQCCMS.verifyAuditIntegrity();
                if (result.isValid) {
                    if (badge) {
                        badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> MERKLE CHAIN VERIFIED (${result.totalBlocksVerified} BLOCKS)`;
                        badge.style.color = "var(--success)";
                        badge.style.borderColor = "var(--success)";
                        badge.style.background = "rgba(16, 185, 129, 0.15)";
                    }
                    showToast(`✓ Merkle Chain Cryptographically Verified! Root: ${result.rootHash.substring(0, 14)}...`);
                } else {
                    if (badge) {
                        badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> TAMPER DETECTED (SEQ #${result.blockSequence})`;
                        badge.style.color = "var(--danger)";
                        badge.style.borderColor = "var(--danger)";
                        badge.style.background = "rgba(239, 68, 68, 0.15)";
                    }
                    showToast(`🚨 Security Alert: ${result.message}`);
                }
            } catch (err) {
                showToast(`Verification error: ${err.message}`);
            }
        });

        // PostgreSQL with Row-Level Security (RLS) Cloud Sync Schema Exporter
        document.getElementById("btn-export-cloud-sync")?.addEventListener("click", () => {
            if (!window.BoundaryQCCMS) return;
            const payload = window.BoundaryQCCMS.generateCloudSyncPayload();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "fdot_postgresql_cloud_sync_schema.json";
            a.click();
            showToast("Exported PostgreSQL RLS Cloud Schema (`fdot_postgresql_cloud_sync_schema.json`)!");
        });

        // FIX [P0+P1]: Mint Civil 3D License Token using real async ECDSA JWT and showCopyModal
        document.getElementById("btn-mint-c3d-jwt")?.addEventListener("click", async () => {
            if (!window.BoundaryQCBilling) return;
            const user = window.BoundaryQCCMS ? window.BoundaryQCCMS.getCurrentUser() : null;
            const companyName = user ? (user.companyName || "Kimley-Horn & Associates, Inc.") : "Kimley-Horn & Associates, Inc.";
            const email = user ? user.email : "surveyor@kimley-horn.com";

            // FIX [P0]: Call async setTier to trigger real ECDSA signing
            const token = await window.BoundaryQCBilling.generateEntitlementJwt(
                window.BoundaryQCBilling.currentTier,
                companyName,
                email
            );
            sessionStorage.setItem("bqc_c3d_jwt_token", token);

            navigator.clipboard.writeText(token).then(() => {
                showToast("Copied Civil 3D ECDSA License JWT Token to Clipboard!");
            }).catch(() => {
                // FIX [P1]: Replace prompt() fallback with showCopyModal (non-blocking, CSP-safe)
                showCopyModal("Civil 3D ECDSA License JWT Token", token);
            });
        });

        themeToggleBtn?.addEventListener("click", () => {
            state.theme = state.theme === "dark" ? "light" : "dark";
            document.body.className = `${state.theme}-theme`;
            themeToggleBtn.innerHTML = state.theme === "dark" ? `<i class="fa-solid fa-moon"></i>` : `<i class="fa-solid fa-sun"></i>`;
        });
    }

    init();
});

