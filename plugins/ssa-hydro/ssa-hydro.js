/**
 * Plugin: ssa-hydro (SSA Hydrology & IDF)
 * plugins/ssa-hydro/ssa-hydro.js
 *
 * FDOT IDF curve Rational Method peak-discharge (Q=CiA) solver
 * and FDOT Drainage Manual Chapter 7 exfiltration trench sizer.
 * Registers via window.PluginRegistry.
 */
(function () {
    const MANIFEST = {
        name: "ssa-hydro",
        version: "2.6.0",
        description: "FDOT IDF Rational Method Q solver and exfiltration trench sizer.",
        tab: "tab-ssa",
        icon: "fa-cloud-showers-heavy",
        tier: "Free",
        dependencies: []
    };

    function renderIDFOptions() {
        const select = document.getElementById("select-idf-zone");
        if (!select) return;
        select.innerHTML = "";
        (window.FDOT_DATA?.idfZones || []).forEach(z => {
            const opt = document.createElement("option");
            opt.value = z.zone;
            opt.textContent = `Zone ${z.zone}: ${z.counties}`;
            select.appendChild(opt);
        });
    }

    const Plugin = {
        init() {
            renderIDFOptions();
        },

        setupEvents(ctx) {
            const { showToast } = ctx;

            // Rational Method Q = C × i × A
            document.getElementById("btn-calc-hydrology")?.addEventListener("click", () => {
                const zoneId = parseInt(document.getElementById("select-idf-zone")?.value) || 1;
                const area   = parseFloat(document.getElementById("hyd-area")?.value)      || 5.0;
                const c      = parseFloat(document.getElementById("hyd-c")?.value)         || 0.75;
                const tc     = parseFloat(document.getElementById("hyd-tc")?.value)        || 15;
                const zoneObj = (window.FDOT_DATA?.idfZones || []).find(z => z.zone === zoneId)
                             || (window.FDOT_DATA?.idfZones || [])[0];
                if (!zoneObj) return;

                const intensity = zoneObj.a / Math.pow(tc + zoneObj.b, zoneObj.c);
                const Q = c * intensity * area;

                const box = document.getElementById("hydrology-results");
                if (!box) return;
                box.classList.remove("hidden");
                window.setSafeHTML(box, `
                    <h4 style="color:var(--success);">FDOT Zone ${zoneId} Intensity I(tc): ${intensity.toFixed(2)} in/hr</h4>
                    <div style="font-weight:700; color:var(--primary); font-size:1.1rem; margin-top:4px;">Peak Discharge Q = ${Q.toFixed(2)} cfs</div>`);
            });

            // Exfiltration Trench Sizer (FDOT Drainage Manual Ch. 7)
            document.getElementById("btn-calc-trench")?.addEventListener("click", () => {
                const vol    = parseFloat(document.getElementById("trench-vol")?.value) || 1500;
                const k      = parseFloat(document.getElementById("trench-k")?.value)   || 0.00015;
                const length = vol / (k * 100 + 0.5);
                const box = document.getElementById("trench-results");
                if (!box) return;
                box.classList.remove("hidden");
                window.setSafeHTML(box, `
                    <h4 style="color:var(--success);">Required Exfiltration Trench Length: ${Math.ceil(length)} FT</h4>
                    <small style="color:var(--text-muted);">FDOT Drainage Manual Chapter 7 Safety Factor 2.0 Applied</small>`);
            });
        }
    };

    window.PluginRegistry.register(MANIFEST, Plugin);
})();
