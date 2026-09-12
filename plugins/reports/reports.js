/**
 * Plugin: reports (Centralized Reports & Submittal QA/QC Documentation Hub)
 * plugins/reports/reports.js
 *
 * Provides a unified repository, standardized headers, interactive previews,
 * and export management for all QA/QC reports, map check logs, compliance
 * scorecards, and audit manifests across the FDOT Civil3D Standards Suite.
 *
 * Registers via window.PluginRegistry.
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "reports",
        version: "1.0.0",
        description: "Centralized Reports & Submittal QA/QC Documentation Hub. Unifies, stores, previews, and exports all reports.",
        tab: "tab-reports",
        icon: "fa-clipboard-list",
        tier: "Free",
        dependencies: []
    };

    const STORAGE_KEY = "fdot_reports_hub_v1";
    const clean = window.cleanText; // core/safe-dom.js — shared across every plugin that sanitizes text before interpolation

    // ── In-Memory Store & Persistence ───────────────────────────────────────

    let _reports = [];

    function loadReports() {
        try {
            if (typeof localStorage !== "undefined") {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    _reports = JSON.parse(raw) || [];
                }
            }
        } catch (e) {
            _reports = [];
        }
        return _reports;
    }

    function saveReports() {
        try {
            if (typeof localStorage !== "undefined") {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(_reports));
            }
        } catch (e) {
            console.warn("[Reports] Could not persist to localStorage:", e);
        }
        updateBadge();
    }

    function updateBadge() {
        const badge = document.getElementById("reports-count-badge");
        if (badge) {
            badge.textContent = _reports.length;
            badge.style.display = _reports.length > 0 ? "inline-block" : "none";
        }
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Standard FDOT QA/QC Header Formatter for unified compliance documentation.
     */
    function formatUnifiedHeader(meta = {}) {
        const now = new Date();
        const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const fpid = meta.fpid || "FDOT-FPID-PENDING";
        const district = meta.district || "District 5";
        const county = meta.county || "Orange";
        const surveyor = meta.surveyor || "Professional Surveyor & Mapper (FL PSM)";
        const certRule = meta.rule || "F.A.C. Rule 5J-17 (PSM) / 61G15-23 (PE)";

        return [
            `================================================================================`,
            `  STATE OF FLORIDA DEPARTMENT OF TRANSPORTATION (FDOT)`,
            `  CADD STANDARDS & GEOMETRIC QA/QC SUBMITTAL REPORT`,
            `================================================================================`,
            `  Title:       ${meta.title || "Quality Control Verification"}`,
            `  Project:     ${meta.project || "Corridor Standards Compliance"}`,
            `  FPID Prefix: ${fpid}  |  District: ${district}  |  County: ${county}`,
            `  Evaluator:   ${surveyor}`,
            `  Standards:   FDOT 2026 CADD Manual (Topic 625-050-001) & ${certRule}`,
            `  Generated:   ${dateStr} ${timeStr}`,
            `================================================================================\n`
        ].join("\n");
    }

    /**
     * Adds or updates a report in the central store.
     */
    function addReport(rep) {
        if (!rep || !rep.title) throw new Error("Report must have a title");

        const id = rep.id || `rep_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const timestamp = rep.timestamp || new Date().toISOString();
        const category = rep.category || "general";
        const format = rep.format || "log"; // 'log', 'markdown', 'html', 'json'
        const filename = rep.filename || `${id}.${format === "markdown" ? "md" : (format === "html" ? "html" : (format === "json" ? "json" : "log"))}`;

        const reportObj = {
            id,
            title: rep.title,
            type: rep.type || "general",
            category,
            format,
            filename,
            content: String(rep.content || ""),
            metadata: rep.metadata || {},
            timestamp
        };

        const existingIdx = _reports.findIndex(r => r.id === id);
        if (existingIdx >= 0) {
            _reports[existingIdx] = reportObj;
        } else {
            _reports.unshift(reportObj);
        }

        saveReports();
        if (document.getElementById("tab-reports")?.classList.contains("active")) {
            renderList();
        }

        return reportObj;
    }

    function getReports(filter = {}) {
        let list = [..._reports];

        if (filter.category && filter.category !== "all") {
            list = list.filter(r => r.category === filter.category);
        }
        if (filter.type) {
            list = list.filter(r => r.type === filter.type);
        }
        if (filter.query) {
            const q = filter.query.toLowerCase();
            list = list.filter(r => r.title.toLowerCase().includes(q) || r.filename.toLowerCase().includes(q) || (r.metadata?.project && r.metadata.project.toLowerCase().includes(q)));
        }

        return list;
    }

    function getReport(id) {
        return _reports.find(r => r.id === id) || null;
    }

    function deleteReport(id) {
        const idx = _reports.findIndex(r => r.id === id);
        if (idx >= 0) {
            _reports.splice(idx, 1);
            saveReports();
            renderList();
            return true;
        }
        return false;
    }

    function clearAll() {
        _reports = [];
        saveReports();
        renderList();
    }

    function exportReport(id) {
        const rep = getReport(id);
        if (!rep) return;

        let mime = "text/plain";
        if (rep.format === "html") mime = "text/html";
        else if (rep.format === "markdown") mime = "text/markdown";
        else if (rep.format === "json") mime = "application/json";

        if (window.COGO?.downloadText) {
            window.COGO.downloadText(rep.filename, rep.content, mime);
        }
    }

    function downloadBundle() {
        if (!_reports.length) return;

        let bundle = `# FDOT Civil3D Standards Suite - Master QA/QC Report Bundle\n`;
        bundle += `Generated: ${new Date().toISOString()}\n`;
        bundle += `Total Documents: ${_reports.length}\n\n`;
        bundle += `================================================================================\n\n`;

        _reports.forEach((r, i) => {
            bundle += `### Document ${i + 1}: ${r.title} (${r.filename})\n`;
            bundle += `Date: ${r.timestamp} | Type: ${r.type} | Category: ${r.category}\n\n`;
            bundle += `\`\`\`\n${r.content}\n\`\`\`\n\n`;
            bundle += `--------------------------------------------------------------------------------\n\n`;
        });

        if (window.COGO?.downloadText) {
            window.COGO.downloadText("fdot_master_reports_bundle.txt", bundle, "text/plain");
        }
    }

    // window.App is never defined anywhere in this app — ctx.showToast (always real,
    // threaded through from PluginRegistry.initAll()) is the only path that ever fires.
    function notify(ctx, msg, isWarn = false) {
        if (ctx && typeof ctx.showToast === "function") ctx.showToast(msg, isWarn);
    }

    // ── UI Controller & Views ───────────────────────────────────────────────

    let _currentFilter = "all";
    let _searchQuery = "";

    function renderUI(ctx) {
        const root = document.getElementById("reports-root");
        if (!root) return;

        window.setSafeHTML(root, `
            <div class="glass-panel" style="padding:1.5rem; margin-bottom:1.5rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h2><i class="fa-solid fa-clipboard-list" style="color:var(--primary);"></i> Centralized Reports Hub</h2>
                        <p class="subtitle">Unified repository for all FDOT submittal compliance reports, map check logs, and audit scorecards generated across the suite.</p>
                    </div>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <button class="btn btn-secondary" id="btn-reports-bundle"><i class="fa-solid fa-file-zipper"></i> Export Master Bundle</button>
                        <button class="btn btn-secondary" id="btn-reports-clear" style="color:var(--danger);"><i class="fa-solid fa-trash-can"></i> Clear All</button>
                    </div>
                </div>

                <!-- Category Filters & Search -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem; flex-wrap:wrap; gap:0.75rem;">
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;" id="reports-category-pills">
                        <button class="btn btn-sm btn-primary filter-pill" data-cat="all">All Reports</button>
                        <button class="btn btn-sm btn-secondary filter-pill" data-cat="standards">Standards Compare</button>
                        <button class="btn btn-sm btn-secondary filter-pill" data-cat="dxf">DXF &amp; Batch Audits</button>
                        <button class="btn btn-sm btn-secondary filter-pill" data-cat="cogo">Traverse &amp; Map Check</button>
                        <button class="btn btn-sm btn-secondary filter-pill" data-cat="legal">Legal Desc</button>
                        <button class="btn btn-sm btn-secondary filter-pill" data-cat="plss">PLSS</button>
                    </div>

                    <div style="position:relative; min-width:240px;">
                        <input type="text" id="reports-search-input" placeholder="Search reports..." style="width:100%; padding:0.4rem 0.6rem 0.4rem 2rem; background:var(--bg-secondary); border:1px solid var(--glass-border); border-radius:var(--radius-sm); color:#fff; font-size:0.8rem;">
                        <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:0.6rem; top:0.55rem; color:var(--text-muted); font-size:0.75rem;"></i>
                    </div>
                </div>
            </div>

            <!-- Reports Table Container -->
            <div class="glass-panel" style="padding:0; overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:0.82rem; text-align:left;">
                    <thead>
                        <tr style="border-bottom:1px solid var(--glass-border); background:rgba(255,255,255,0.03);">
                            <th style="padding:0.75rem 1rem;">Report Title</th>
                            <th style="padding:0.75rem 0.5rem; text-align:center;">Category</th>
                            <th style="padding:0.75rem 0.5rem; text-align:center;">Format</th>
                            <th style="padding:0.75rem 0.5rem;">Date Generated</th>
                            <th style="padding:0.75rem 0.5rem; text-align:center;">Size</th>
                            <th style="padding:0.75rem 1rem; text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="reports-table-tbody">
                        <!-- Injected dynamically -->
                    </tbody>
                </table>
            </div>

            <!-- Report Preview Modal -->
            <div id="modal-report-preview" class="modal-overlay hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:99999;">
                <div class="glass-panel" style="width:92%; max-width:900px; height:85vh; display:flex; flex-direction:column; padding:1.5rem; background:var(--bg-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-lg);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid var(--glass-border); padding-bottom:0.75rem;">
                        <div>
                            <h3 id="preview-report-title" style="margin:0; font-size:1.1rem; color:var(--primary);"><i class="fa-solid fa-file-lines"></i> Report Preview</h3>
                            <div id="preview-report-meta" style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;"></div>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <button class="btn btn-secondary btn-sm" id="btn-preview-toggle-fmt" style="display:none; font-size:0.75rem;"><i class="fa-solid fa-code"></i> View Source</button>
                            <button class="icon-btn" id="btn-close-report-preview"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>

                    <div id="preview-report-body" style="flex:1; overflow-y:auto; padding:1rem; background:#0b1120; border-radius:var(--radius-sm); border:1px solid var(--glass-border); font-family:var(--font-mono); font-size:0.8rem; white-space:pre-wrap; color:#e2e8f0; line-height:1.6;">
                    </div>
                    <iframe id="preview-report-frame" style="display:none; flex:1; width:100%; border:1px solid var(--glass-border); border-radius:var(--radius-sm); background:#fff;"></iframe>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; padding-top:0.5rem; border-top:1px solid var(--glass-border);">
                        <button class="btn btn-secondary btn-sm" id="btn-preview-copy"><i class="fa-solid fa-copy"></i> Copy Content</button>
                        <div style="display:flex; gap:0.5rem;">
                            <button class="btn btn-secondary btn-sm" id="btn-preview-print"><i class="fa-solid fa-print"></i> Print</button>
                            <button class="btn btn-primary btn-sm" id="btn-preview-download"><i class="fa-solid fa-download"></i> Download</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        bindUIEvents(ctx);
        renderList();
        updateBadge();
    }

    function bindUIEvents(ctx) {
        const root = document.getElementById("reports-root");
        if (!root) return;

        // Category pills
        root.querySelectorAll(".filter-pill").forEach(btn => {
            btn.addEventListener("click", () => {
                root.querySelectorAll(".filter-pill").forEach(b => {
                    b.classList.remove("btn-primary");
                    b.classList.add("btn-secondary");
                });
                btn.classList.remove("btn-secondary");
                btn.classList.add("btn-primary");
                _currentFilter = btn.dataset.cat;
                renderList();
            });
        });

        // Search input
        const sInput = root.querySelector("#reports-search-input");
        sInput?.addEventListener("input", e => {
            _searchQuery = e.target.value.trim();
            renderList();
        });

        // Master Bundle
        root.querySelector("#btn-reports-bundle")?.addEventListener("click", () => {
            downloadBundle();
            notify(ctx, "Exported master reports bundle.");
        });

        // Clear All
        root.querySelector("#btn-reports-clear")?.addEventListener("click", () => {
            if (_reports.length === 0) return;
            if (confirm("Are you sure you want to clear all stored reports?")) {
                clearAll();
                notify(ctx, "All reports cleared.");
            }
        });

        // Modal close
        root.querySelector("#btn-close-report-preview")?.addEventListener("click", () => {
            root.querySelector("#modal-report-preview")?.classList.add("hidden");
        });
    }

    function renderList() {
        const tbody = document.getElementById("reports-table-tbody");
        if (!tbody) return;

        const filtered = getReports({ category: _currentFilter, query: _searchQuery });

        if (filtered.length === 0) {
            window.setSafeRows(tbody, `
                <tr>
                    <td colspan="6" style="padding:2.5rem; text-align:center; color:var(--text-muted);">
                        <i class="fa-solid fa-clipboard" style="font-size:2rem; margin-bottom:0.5rem; opacity:0.3; display:block;"></i>
                        No reports found in this view. Reports generated from Standards Compare, DXF Audits, Traverse Map Checks, and Legal Descriptions will appear here automatically.
                    </td>
                </tr>
            `);
            return;
        }

        const rows = filtered.map(r => {
            const dateStr = new Date(r.timestamp).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
            });
            const sizeKb = (r.content.length / 1024).toFixed(1) + " KB";
            const catBadgeClass = getCatBadgeClass(r.category);

            return `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:0.75rem 1rem;">
                        <div style="font-weight:600; color:#fff;">${clean(r.title)}</div>
                        <div style="font-size:0.72rem; color:var(--text-muted); font-family:var(--font-mono);">${clean(r.filename)}</div>
                    </td>
                    <td style="padding:0.75rem 0.5rem; text-align:center;">
                        <span style="padding:0.15rem 0.5rem; border-radius:3px; font-size:0.7rem; font-weight:700; ${catBadgeClass}">${clean(r.category.toUpperCase())}</span>
                    </td>
                    <td style="padding:0.75rem 0.5rem; text-align:center; font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">${clean(r.format.toUpperCase())}</td>
                    <td style="padding:0.75rem 0.5rem; font-size:0.78rem; color:var(--text-secondary);">${dateStr}</td>
                    <td style="padding:0.75rem 0.5rem; text-align:center; font-size:0.75rem; color:var(--text-muted);">${sizeKb}</td>
                    <td style="padding:0.75rem 1rem; text-align:right;">
                        <button class="btn btn-secondary btn-sm btn-report-view" data-id="${r.id}" title="Preview"><i class="fa-solid fa-eye"></i></button>
                        <button class="btn btn-secondary btn-sm btn-report-dl" data-id="${r.id}" title="Download"><i class="fa-solid fa-download"></i></button>
                        <button class="btn btn-secondary btn-sm btn-report-del" data-id="${r.id}" title="Delete" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        }).join("");

        window.setSafeRows(tbody, rows);

        // Bind row action buttons
        tbody.querySelectorAll(".btn-report-view").forEach(b => {
            b.addEventListener("click", () => showPreview(b.dataset.id));
        });
        tbody.querySelectorAll(".btn-report-dl").forEach(b => {
            b.addEventListener("click", () => exportReport(b.dataset.id));
        });
        tbody.querySelectorAll(".btn-report-del").forEach(b => {
            b.addEventListener("click", () => deleteReport(b.dataset.id));
        });
    }

    function getCatBadgeClass(cat) {
        switch (cat) {
            case "standards": return "color:var(--primary); background:rgba(2,132,199,0.15);";
            case "dxf": return "color:var(--accent); background:rgba(245,158,11,0.15);";
            case "cogo": return "color:var(--success); background:rgba(34,197,94,0.15);";
            case "legal": return "color:#a855f7; background:rgba(168,85,247,0.15);";
            case "plss": return "color:#ec4899; background:rgba(236,72,153,0.15);";
            default: return "color:var(--text-secondary); background:rgba(255,255,255,0.1);";
        }
    }

    let _activePreviewReport = null;
    let _showingHtmlFrame = false;

    function showPreview(id) {
        const rep = getReport(id);
        if (!rep) return;
        _activePreviewReport = rep;

        const modal = document.getElementById("modal-report-preview");
        if (!modal) return;

        document.getElementById("preview-report-title").textContent = rep.title;
        document.getElementById("preview-report-meta").textContent = `Filename: ${rep.filename} | Format: ${rep.format.toUpperCase()} | Generated: ${new Date(rep.timestamp).toLocaleString()}`;
        
        const body = document.getElementById("preview-report-body");
        const frame = document.getElementById("preview-report-frame");
        const toggleBtn = document.getElementById("btn-preview-toggle-fmt");

        if (rep.format === "html") {
            _showingHtmlFrame = true;
            if (frame) {
                frame.style.display = "block";
                frame.srcdoc = rep.content;
            }
            if (body) {
                body.style.display = "none";
                body.textContent = rep.content;
            }
            if (toggleBtn) {
                toggleBtn.style.display = "inline-flex";
                window.setSafeHTML(toggleBtn, `<i class="fa-solid fa-code"></i> View Source`);
                toggleBtn.onclick = () => {
                    _showingHtmlFrame = !_showingHtmlFrame;
                    if (_showingHtmlFrame) {
                        frame.style.display = "block";
                        body.style.display = "none";
                        window.setSafeHTML(toggleBtn, `<i class="fa-solid fa-code"></i> View Source`);
                    } else {
                        frame.style.display = "none";
                        body.style.display = "block";
                        window.setSafeHTML(toggleBtn, `<i class="fa-solid fa-browser"></i> View Rendered`);
                    }
                };
            }
        } else {
            _showingHtmlFrame = false;
            if (frame) frame.style.display = "none";
            if (body) {
                body.style.display = "block";
                body.textContent = rep.content;
            }
            if (toggleBtn) toggleBtn.style.display = "none";
        }

        modal.classList.remove("hidden");

        modal.querySelector("#btn-preview-copy")?.replaceWith(cloneButton("btn-preview-copy", async () => {
            let copied = false;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(rep.content);
                    copied = true;
                }
            } catch (e) {
                copied = false;
            }
            if (!copied) {
                const ta = document.createElement("textarea");
                ta.value = rep.content;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                try {
                    document.execCommand("copy");
                    copied = true;
                } catch (e) {}
                document.body.removeChild(ta);
            }
            alert(copied ? "Report copied to clipboard." : "Could not copy automatically. Please select text manually.");
        }));

        modal.querySelector("#btn-preview-download")?.replaceWith(cloneButton("btn-preview-download", () => {
            exportReport(rep.id);
        }));

        modal.querySelector("#btn-preview-print")?.replaceWith(cloneButton("btn-preview-print", () => {
            const printWin = window.open("", "_blank");
            if (printWin) {
                if (rep.format === "html") {
                    printWin.document.write(rep.content);
                } else {
                    printWin.document.write(`<pre style="font-family:monospace; white-space:pre-wrap;">${clean(rep.content)}</pre>`);
                }
                printWin.document.close();
                printWin.print();
            }
        }));
    }

    function cloneButton(id, handler) {
        const old = document.getElementById(id);
        if (!old) return document.createElement("button");
        const nw = old.cloneNode(true);
        nw.addEventListener("click", handler);
        return nw;
    }

    // ── Plugin Object ───────────────────────────────────────────────────────

    const Plugin = {
        init(ctx) {
            loadReports();
            renderUI(ctx);
        },
        onTabActivate(ctx) {
            renderUI(ctx);
        }
    };

    window.Reports = {
        addReport,
        getReports,
        getReport,
        deleteReport,
        clearAll,
        exportReport,
        downloadBundle,
        formatUnifiedHeader
    };

    // Load reports initially
    loadReports();

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
})();
