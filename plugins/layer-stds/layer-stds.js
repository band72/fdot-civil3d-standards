/**
 * Plugin: layer-stds (Layer Standards)
 * plugins/layer-stds/layer-stds.js
 *
 * Handles the FDOT 2026 Layer Standards browser tab:
 * - Layer table rendering with discipline/plot filters
 * - Survey description key set table
 * - Pay item catalog table
 * - Copy-to-clipboard for layer names
 *
 * Registers via window.PluginRegistry.
 */
(function () {
    const MANIFEST = {
        name: "layer-stds",
        version: "2.6.0",
        description: "FDOT 2026 Layer Standards browser with discipline/plot filters.",
        tab: "tab-layers",
        icon: "fa-layer-group",
        tier: "Free",
        dependencies: []
    };

    // ── Render ─────────────────────────────────────────────────────────────

    function renderLayers(state) {
        const tbody = document.getElementById("layers-tbody");
        const summary = document.getElementById("layers-count-summary");
        if (!tbody) return;

        let layers = [...(window.FDOT_DATA?.layers || [])];

        if (state.selectedDiscipline && state.selectedDiscipline !== "ALL") {
            layers = layers.filter(l => l.discipline === state.selectedDiscipline);
        }
        if (state.plotFilter === "PLOT") {
            layers = layers.filter(l => l.plot === true);
        } else if (state.plotFilter === "NOPLOT") {
            layers = layers.filter(l => l.plot === false);
        }
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            layers = layers.filter(l =>
                l.name.toLowerCase().includes(q) ||
                (l.description || "").toLowerCase().includes(q) ||
                l.discipline.toLowerCase().includes(q)
            );
        }

        tbody.innerHTML = "";
        layers.forEach(layer => {
            const tr = document.createElement("tr");
            window.setSafeHTML(tr, `
                <td style="font-family:var(--font-mono); font-size:0.8rem;">
                    <span style="display:inline-block; width:0.8rem; height:0.8rem; border-radius:2px; vertical-align:middle; margin-right:0.4rem; background:${layer.colorHex || '#888'}; border:1px solid var(--glass-border);"></span>${layer.colorName || layer.color}
                </td>
                <td style="font-family:var(--font-mono); font-weight:600; color:var(--primary);">${layer.name}</td>
                <td><span class="tag tag-discipline">${layer.discipline}</span></td>
                <td style="font-family:var(--font-mono); font-size:0.8rem;">${layer.linetype}</td>
                <td style="font-family:var(--font-mono); font-size:0.8rem;">${layer.lineweight || ""}</td>
                <td style="font-size:0.8rem; color:${layer.plot ? 'var(--success)' : 'var(--text-muted)'};">${layer.plot ? "Yes" : "No-Plot"}</td>
                <td style="font-size:0.8rem; color:var(--text-secondary);">${layer.description || ""}</td>
                <td>
                    <button class="btn btn-secondary btn-sm btn-copy-layer" data-layer="${layer.name}" title="Copy layer name">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </td>`);
            tbody.appendChild(tr);
        });

        if (summary) summary.textContent = `${layers.length} layers`;
    }

    function renderPayItems(state) {
        const tbody = document.getElementById("payitem-tbody");
        if (!tbody) return;
        const searchInput = document.getElementById("payitem-search");
        const q = (searchInput?.value || state.searchQuery || "").toLowerCase();

        let items = [...(window.FDOT_DATA?.payItems || [])];
        if (q) items = items.filter(p =>
            p.code.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            (p.unit || "").toLowerCase().includes(q)
        );

        tbody.innerHTML = "";
        items.forEach(item => {
            const tr = document.createElement("tr");
            window.setSafeHTML(tr, `
                <td style="font-family:var(--font-mono); color:var(--primary);">${item.code}</td>
                <td>${item.description}</td>
                <td style="font-family:var(--font-mono);">${item.unit}</td>
                <td><span class="tag tag-discipline">${item.category}</span></td>
                <td>
                    <button class="btn btn-secondary btn-sm btn-copy-layer" data-layer="${item.code}" title="Copy pay item number">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </td>`);
            tbody.appendChild(tr);
        });
    }

    function renderSurveyKeys(state) {
        const tbody = document.getElementById("survey-tbody");
        if (!tbody) return;
        const searchInput = document.getElementById("survey-search");
        const q = (searchInput?.value || state.searchQuery || "").toLowerCase();

        let keys = [...(window.FDOT_DATA?.surveyKeys || [])];
        if (q) keys = keys.filter(k =>
            k.code.toLowerCase().includes(q) ||
            k.description.toLowerCase().includes(q)
        );

        tbody.innerHTML = "";
        keys.forEach(k => {
            const tr = document.createElement("tr");
            window.setSafeHTML(tr, `
                <td style="font-family:var(--font-mono); font-weight:700; color:var(--accent);">${k.code}</td>
                <td style="font-family:var(--font-mono); font-size:0.8rem;">${k.block}</td>
                <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--primary);">${k.layer}</td>
                <td style="font-size:0.8rem; color:var(--text-muted);">${k.group}</td>
                <td style="font-size:0.8rem; color:var(--text-secondary);">${k.description}</td>
                <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--accent);">${k.format || ""}</td>`);
            tbody.appendChild(tr);
        });
    }

    // ── Plugin API ──────────────────────────────────────────────────────────

    const Plugin = {
        init(ctx) {
            renderLayers(ctx.state);
            renderPayItems(ctx.state);
            renderSurveyKeys(ctx.state);
        },

        setupEvents(ctx) {
            const { state, showToast } = ctx;

            // Discipline pill filter
            document.getElementById("discipline-filters")?.addEventListener("click", e => {
                if (e.target.classList.contains("pill-btn")) {
                    document.querySelectorAll("#discipline-filters .pill-btn").forEach(b => b.classList.remove("active"));
                    e.target.classList.add("active");
                    state.selectedDiscipline = e.target.getAttribute("data-discipline");
                    renderLayers(state);
                }
            });

            // Plot style dropdown filter
            document.getElementById("select-plot-filter")?.addEventListener("change", e => {
                state.plotFilter = e.target.value;
                renderLayers(state);
            });

            // Pay item search
            document.getElementById("payitem-search")?.addEventListener("input", () => renderPayItems(state));

            // Survey key search
            document.getElementById("survey-search")?.addEventListener("input", () => renderSurveyKeys(state));

            // Copy layer name / pay item number (event delegation across all three tables)
            const wireCopy = (id) => document.getElementById(id)?.addEventListener("click", e => {
                const btn = e.target.closest(".btn-copy-layer");
                if (!btn) return;
                const value = btn.getAttribute("data-layer");
                navigator.clipboard.writeText(value)
                    .then(() => showToast(`Copied "${value}" to clipboard!`))
                    .catch(() => showToast(`Copied: ${value}`));
            });
            wireCopy("layers-tbody");
            wireCopy("payitem-tbody");
        },

        /** Called by PluginRegistry when the layer-stds tab is activated */
        onTabActivate(ctx) {
            renderLayers(ctx.state);
        }
    };

    window.PluginRegistry.register(MANIFEST, Plugin);
})();
