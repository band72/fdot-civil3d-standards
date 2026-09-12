/**
 * Plugin: dashboard (Admin Dashboard)
 * plugins/dashboard/dashboard.js
 *
 * The "tab-cms" admin panel: signed-in-user profile card, per-client master
 * templates (billing-tier limited), DOT projects manager, submittal/QC
 * vault, transaction ledger, the organization's Team Directory & User
 * Management table, and the hash-chained audit log viewer.
 *
 * Split out of what used to be plugins/cms-engine/cms-engine.js's own DOM
 * code — the account data itself still lives in window.BoundaryQCCMS
 * (plugins/cms-engine/cms-engine.js); the sign-in/register modal and header
 * account indicator moved to plugins/security/security.js. This plugin
 * reaches into that one (window.Security.openModal) for the "Switch
 * Account" / "Add Team Member" actions rather than owning #modal-auth
 * itself.
 *
 * Registers via window.PluginRegistry. Depends on cms-engine (the account/
 * template/project data) and billing (template-limit upsell).
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "dashboard",
        version: "1.0.0",
        description: "Admin dashboard: profile, per-client master templates, DOT projects & submittal vault, transaction ledger, team directory / user management, and the hash-chained audit log.",
        tab: "tab-cms",
        icon: "fa-gauge-high",
        tier: "Firm",
        dependencies: ["cms-engine", "billing", "db-sync"],
    };

    function render(ctx) {
        const cms = window.BoundaryQCCMS;
        if (!cms) return;
        const currentUser = cms.getCurrentUser();

        if (!currentUser) {
            // Signed out (or never signed in): clear every panel this function ever populates,
            // not just the templates list — otherwise the previous session's Team Directory
            // (names/emails/roles/license numbers), DOT projects, submittals (incl. SHA256
            // hashes), transactions, and audit log stay fully rendered on-screen after logout.
            const emptyMsg = `<div style="color:var(--text-muted); padding:0.5rem 0;"><i class="fa-solid fa-user-lock"></i> Sign in to view.</div>`;
            const nameEl = document.getElementById("cms-profile-name");
            if (nameEl) nameEl.textContent = "Not signed in";
            const emailEl = document.getElementById("cms-profile-email");
            if (emailEl) emailEl.textContent = "—";
            const roleEl = document.getElementById("cms-profile-role");
            if (roleEl) roleEl.textContent = "—";
            const licenseEl = document.getElementById("cms-profile-license");
            if (licenseEl) licenseEl.textContent = "—";
            const activeBadge = document.getElementById("cms-active-client-badge");
            if (activeBadge) activeBadge.hidden = true;

            const templatesList = document.getElementById("cms-templates-list");
            if (templatesList) window.setSafeHTML(templatesList, `<div style="color:var(--text-muted); padding:0.5rem 0;"><i class="fa-solid fa-user-lock"></i> Sign in to manage client templates and workspace.</div>`);
            const tplCount = document.getElementById("cms-tpl-count");
            if (tplCount) tplCount.textContent = "0 / —";
            const tplSel = document.getElementById("cms-active-template");
            if (tplSel) window.setSafeHTML(tplSel, "");
            const tplUpsell = document.getElementById("cms-tpl-upsell");
            if (tplUpsell) tplUpsell.hidden = true;

            const projList = document.getElementById("cms-projects-list");
            if (projList) window.setSafeHTML(projList, emptyMsg);
            const projCount = document.getElementById("cms-proj-count");
            if (projCount) projCount.textContent = "0 Projects";

            const subList = document.getElementById("cms-submittals-list");
            if (subList) window.setSafeHTML(subList, emptyMsg);
            const subCount = document.getElementById("cms-sub-count");
            if (subCount) subCount.textContent = "0 Submittals";

            const txList = document.getElementById("cms-transactions-list");
            if (txList) window.setSafeHTML(txList, emptyMsg);

            const auditTable = document.getElementById("cms-audit-table-body");
            if (auditTable) window.setSafeRows(auditTable, "");

            const usersTable = document.getElementById("cms-users-table-body");
            if (usersTable) window.setSafeRows(usersTable, "");

            return;
        }

        const activeTpl = cms.getActiveTemplate();
        const activeBadge = document.getElementById("cms-active-client-badge");
        if (activeBadge) {
            if (activeTpl) { activeBadge.textContent = "Client: " + activeTpl.clientName; activeBadge.hidden = false; }
            else activeBadge.hidden = true;
        }
        renderTemplates();

        const profileName = document.getElementById("cms-profile-name");
        const profileEmail = document.getElementById("cms-profile-email");
        const profileRole = document.getElementById("cms-profile-role");
        const profileLicense = document.getElementById("cms-profile-license");
        if (profileName) profileName.textContent = currentUser.fullName;
        if (profileEmail) profileEmail.textContent = currentUser.email;
        if (profileRole) profileRole.textContent = cms.roles[currentUser.role]?.name || currentUser.role;
        if (profileLicense) profileLicense.textContent = `${currentUser.licenseState || "FL"} #${currentUser.licenseNumber || "LS6842"}`;

        // Projects
        const projList = document.getElementById("cms-projects-list");
        const projCount = document.getElementById("cms-proj-count");
        const projects = cms.getProjects();
        if (projCount) projCount.textContent = `${projects.length} Projects`;
        if (projList) {
            window.setSafeHTML(projList, projects.map(p => `
                <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color:var(--text-main); font-size:0.9rem;">${p.name}</strong>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">
                            FPID: <code style="color:var(--primary);">${p.fpid}</code> • District ${p.district} (${p.county} Co.)
                        </div>
                    </div>
                    <span class="badge" style="background:var(--success); font-size:0.7rem;">${p.status}</span>
                </div>
            `).join(""));
        }

        // Submittals
        const subList = document.getElementById("cms-submittals-list");
        const subCount = document.getElementById("cms-sub-count");
        const submittals = cms.getSubmittals();
        if (subCount) subCount.textContent = `${submittals.length} Submittals`;
        if (subList) {
            window.setSafeHTML(subList, submittals.map(s => `
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
            `).join(""));
        }

        // Transactions
        const txList = document.getElementById("cms-transactions-list");
        const txs = cms.getTransactions();
        if (txList) {
            window.setSafeHTML(txList, txs.map(t => `
                <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:0.85rem; color:var(--text-main);">${t.description}</strong>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">ASC 606 Verified • ${new Date(t.timestamp).toLocaleDateString()}</div>
                    </div>
                    <strong style="color:var(--success); font-size:0.95rem;">$${t.amount.toFixed(2)}</strong>
                </div>
            `).join(""));
        }

        // Audit log
        const auditTable = document.getElementById("cms-audit-table-body");
        const logs = cms.getAuditLogs();
        if (auditTable) {
            window.setSafeRows(auditTable, logs.slice().reverse().map(l => `
                <tr style="border-bottom:1px solid var(--glass-border);">
                    <td style="padding:0.5rem; font-family:monospace; color:var(--primary);">${l.sequence}</td>
                    <td style="padding:0.5rem;">${l.actor}</td>
                    <td style="padding:0.5rem;"><span class="badge" style="background:var(--primary); font-size:0.7rem;">${l.action}</span></td>
                    <td style="padding:0.5rem; color:var(--text-secondary);">${l.details}</td>
                    <td style="padding:0.5rem; font-family:monospace; font-size:0.7rem; color:var(--text-muted);">${l.hash.substring(0, 16)}...</td>
                </tr>
            `).join(""));
        }

        // Team Directory / User Management
        const usersTable = document.getElementById("cms-users-table-body");
        const allUsers = cms.getUsers();
        if (usersTable) {
            window.setSafeRows(usersTable, allUsers.map(u => `
                <tr style="border-bottom:1px solid var(--glass-border); ${u.id === currentUser.id ? "background:rgba(2, 132, 199, 0.08);" : ""}">
                    <td style="padding:0.5rem;">
                        <strong>${u.fullName}</strong>
                        ${u.id === currentUser.id ? '<span class="badge" style="background:var(--success); font-size:0.65rem; margin-left:4px;">ACTIVE SESSION</span>' : ""}
                    </td>
                    <td style="padding:0.5rem; color:var(--text-secondary);">${u.email}</td>
                    <td style="padding:0.5rem;">
                        <span class="badge" style="background:var(--primary); font-size:0.7rem;">${cms.roles[u.role]?.name || u.role}</span>
                    </td>
                    <td style="padding:0.5rem; font-family:monospace; font-size:0.8rem; color:var(--accent);">${u.licenseState || "FL"} #${u.licenseNumber || "N/A"}</td>
                    <td style="padding:0.5rem;">
                        <div style="display:flex; gap:0.4rem;">
                            ${u.id !== currentUser.id ? `
                                <button class="btn btn-primary btn-sm btn-switch-user-row" data-email="${u.email}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">Switch</button>
                                <button class="btn btn-secondary btn-sm btn-delete-user-row" data-id="${u.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--danger); border-color:var(--danger-light);">Remove</button>
                            ` : '<span style="font-size:0.75rem; color:var(--success); font-weight:600;">Current User</span>'}
                        </div>
                    </td>
                </tr>
            `).join(""));
        }

        renderDatabaseStatus();
    }

    function renderDatabaseStatus() {
        const dbBadge = document.getElementById("db-status-badge");
        const dbInfo = document.getElementById("db-connection-info");
        if (!dbBadge || !window.DatabaseService) return;

        const st = window.DatabaseService.getLastStatus();
        if (st && st.connected) {
            const isLocal = !!st.is_local;
            const label = isLocal ? "Local PostgreSQL (v16.15)" : "Remote PostgreSQL (Cloud)";
            window.setSafeHTML(dbBadge, `<i class="fa-solid fa-circle-check"></i> ${label} Connected`);
            dbBadge.style.background = isLocal ? "rgba(16, 185, 129, 0.15)" : "rgba(14, 165, 233, 0.15)";
            dbBadge.style.borderColor = isLocal ? "var(--success)" : "var(--primary)";
            dbBadge.style.color = isLocal ? "var(--success)" : "var(--primary)";

            if (dbInfo) {
                dbInfo.textContent = `Connected to ${isLocal ? "local cluster" : "remote host"} (${st.host}:${st.port}/${st.database}) · Row-Level Security & ACID Ready`;
            }

            const counts = st.counts || {};
            const setCnt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v != null ? String(v) : "—"); };
            setCnt("db-cnt-projects", counts.projects);
            setCnt("db-cnt-templates", counts.client_templates);
            setCnt("db-cnt-submittals", counts.submittals);
            setCnt("db-cnt-transactions", counts.transactions);
            setCnt("db-cnt-audit", counts.audit_chain);
            setCnt("db-cnt-linework", counts.linework_sessions);
            setCnt("db-cnt-pts", counts.survey_points);
        } else {
            window.setSafeHTML(dbBadge, `<i class="fa-solid fa-circle-xmark"></i> Database Disconnected`);
            dbBadge.style.background = "rgba(239, 68, 68, 0.15)";
            dbBadge.style.borderColor = "var(--danger)";
            dbBadge.style.color = "var(--danger)";
            if (dbInfo) {
                dbInfo.textContent = st?.error ? `Database error: ${st.error}` : "PostgreSQL service is offline or unreachable. Working in local memory mode.";
            }
        }
    }

    /** The Client Master Templates panel (count, active dropdown, list, upsell, form selects). */
    function renderTemplates() {
        const cms = window.BoundaryQCCMS;
        if (!cms || !cms.isAuthenticated()) return;

        const templates = cms.getTemplates();
        const limit = cms.getTemplateLimit();
        const activeId = cms.getActiveTemplateId();
        const disc = (window.FDOT_DATA && window.FDOT_DATA.disciplines) || [{ id: "ALL", name: "All Disciplines" }];
        const sheets = (window.FDOT_DATA && window.FDOT_DATA.sheetStandards) || [];

        const countEl = document.getElementById("cms-tpl-count");
        if (countEl) {
            countEl.textContent = `${templates.length} / ${limit >= 999 ? "∞" : limit}`;
            countEl.style.color = templates.length >= limit ? "var(--danger)" : "var(--text-secondary)";
        }

        const upsell = document.getElementById("cms-tpl-upsell");
        if (upsell) {
            const atLimit = templates.length >= limit;
            upsell.hidden = !atLimit;
            if (atLimit) {
                const up = cms.getTemplateUpgrade();
                const txt = document.getElementById("cms-tpl-upsell-text");
                const btn = document.getElementById("btn-cms-tpl-upgrade");
                if (txt) txt.textContent = up
                    ? `Template limit reached (${templates.length}/${limit} on the ${cms._planLabel()} plan). ${up.name} raises it to ${up.limit >= 999 ? "unlimited" : up.limit} for $${up.price}/mo.`
                    : `Template limit reached (${templates.length}/${limit}).`;
                if (btn && up) { btn.setAttribute("data-plan", up.name); btn.setAttribute("data-price", String(up.price)); }
            }
        }

        const sel = document.getElementById("cms-active-template");
        if (sel) {
            window.setSafeHTML(sel, [
                `<option value="">— none —</option>`,
                ...templates.map(t => `<option value="${t.id}" ${t.id === activeId ? "selected" : ""}>${t.clientName} — ${t.label}</option>`)
            ].join(""));
        }

        const list = document.getElementById("cms-templates-list");
        if (list) {
            window.setSafeHTML(list, templates.length ? templates.map(t => `
                <div style="background:var(--bg-primary); padding:0.7rem 0.85rem; border-radius:var(--radius-sm); border:1px solid ${t.id === activeId ? "var(--accent)" : "var(--glass-border)"}; display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
                    <div>
                        <strong style="color:var(--text-main); font-size:0.88rem;">${t.clientName}</strong>
                        ${t.id === activeId ? '<span class="badge" style="background:var(--accent); font-size:0.62rem; margin-left:6px;">ACTIVE</span>' : ""}
                        <div style="font-size:0.74rem; color:var(--text-muted); margin-top:0.15rem;">
                            ${t.label} · ${t.settings.discipline} · IDF ${t.settings.idfZone} · ${t.settings.sheetDwt} · close 1:${Number(t.settings.precisionPass).toLocaleString()}${t.settings.fpidPrefix ? " · FPID " + t.settings.fpidPrefix : ""}
                        </div>
                    </div>
                    <div style="display:flex; gap:0.35rem;">
                        <button class="btn btn-secondary btn-sm btn-tpl-edit" data-id="${t.id}" style="padding:0.15rem 0.5rem; font-size:0.72rem;">Edit</button>
                        <button class="btn btn-secondary btn-sm btn-tpl-del" data-id="${t.id}" style="padding:0.15rem 0.5rem; font-size:0.72rem; color:var(--danger); border-color:var(--danger-light);">Delete</button>
                    </div>
                </div>
            `).join("") : `<div style="color:var(--text-muted); font-size:0.82rem; padding:0.3rem 0;">No templates yet. Click <strong>New Template</strong> to create per-client defaults.</div>`);
        }

        const dSel = document.getElementById("tpl-discipline");
        if (dSel) window.setSafeHTML(dSel, disc.map(d => `<option value="${d.id}">${d.name}</option>`).join(""));
        const iSel = document.getElementById("tpl-idf");
        if (iSel) window.setSafeHTML(iSel, Array.from({ length: 11 }, (_, i) => `<option value="${i + 1}">Zone ${i + 1}</option>`).join(""));
        const sSel = document.getElementById("tpl-sheet");
        if (sSel) window.setSafeHTML(sSel, (sheets.length ? sheets.map(s => s.dwt) : ["CombinedLayers.dwt"]).map(n => `<option value="${n}">${n}</option>`).join(""));
    }

    const Plugin = {
        init(ctx) { render(ctx); },
        onTabActivate(ctx) {
            render(ctx);
            // Refresh the DB connection badge/counts on every visit, not just the cached value
            // from page load — db-sync has no tab of its own to do this from (see db-sync.js).
            if (window.DatabaseService) window.DatabaseService.getStatus().then(() => renderDatabaseStatus()).catch(() => {});
        },

        setupEvents(ctx) {
            document.getElementById("btn-cms-switch-user")?.addEventListener("click", () => window.Security?.openModal());
            document.getElementById("btn-cms-add-user")?.addEventListener("click", () => window.Security?.openModal("register"));

            document.getElementById("cms-users-table-body")?.addEventListener("click", e => {
                const switchBtn = e.target.closest(".btn-switch-user-row");
                if (switchBtn) {
                    const email = switchBtn.getAttribute("data-email");
                    try {
                        // Team-directory switch is a within-workspace convenience (no
                        // re-auth) — routed through the Security plugin, which owns
                        // every session/identity mutation.
                        const user = window.Security.impersonate(email, ctx);
                        ctx.showToast(`Switched active session to ${user.fullName}.`);
                    } catch (err) {
                        ctx.showToast(`Error: ${err.message}`, true);
                    }
                    return;
                }
                const deleteBtn = e.target.closest(".btn-delete-user-row");
                if (deleteBtn) {
                    const userId = deleteBtn.getAttribute("data-id");
                    ctx.showConfirmModal("Are you sure you want to remove this team member from the organization?").then(confirmed => {
                        if (!confirmed) return;
                        window.BoundaryQCCMS.deleteUser(userId);
                        render(ctx);
                        ctx.showToast("Team member removed from organization.");
                    });
                }
            });

            document.getElementById("btn-cms-new-proj")?.addEventListener("click", async () => {
                const fpid = await ctx.showInputModal("Enter FDOT FPID (Financial Project ID):", "441209-1-52-01");
                if (!fpid) return;
                const name = await ctx.showInputModal("Enter Project Name:", "SR-408 Roadway Realignment");
                if (!name) return;
                window.BoundaryQCCMS.createProject(fpid, name, "Orange", 5);
                render(ctx);
                ctx.showToast(`Created DOT Project ${fpid}!`);
            });

            // ── Client Master Templates ──────────────────────────────────────
            const tplForm = document.getElementById("cms-tpl-form");
            const showTplForm = tpl => {
                if (!tplForm) return;
                document.getElementById("tpl-edit-id").value = tpl ? tpl.id : "";
                document.getElementById("tpl-client").value = tpl ? tpl.clientName : "";
                document.getElementById("tpl-label").value = tpl ? tpl.label : "";
                const s = (tpl && tpl.settings) || {};
                const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
                set("tpl-discipline", s.discipline || "ALL");
                set("tpl-idf", s.idfZone || 7);
                set("tpl-sheet", s.sheetDwt || "CombinedLayers.dwt");
                set("tpl-precision", s.precisionPass || 10000);
                set("tpl-fpid", s.fpidPrefix || "");
                set("tpl-county", s.county || "");
                set("tpl-district", s.district || 5);
                set("tpl-notes", s.notes || "");
                tplForm.hidden = false;
            };

            document.getElementById("btn-cms-new-tpl")?.addEventListener("click", () => {
                const cms = window.BoundaryQCCMS;
                if (cms.getTemplates().length >= cms.getTemplateLimit()) {
                    const up = cms.getTemplateUpgrade();
                    ctx.showToast(up
                        ? `Template limit reached. Upgrade to ${up.name} ($${up.price}/mo) for ${up.limit >= 999 ? "unlimited" : up.limit} templates.`
                        : "Template limit reached.", true);
                    renderTemplates();
                    return;
                }
                showTplForm(null);
            });
            document.getElementById("btn-tpl-cancel")?.addEventListener("click", () => { if (tplForm) tplForm.hidden = true; });

            document.getElementById("btn-tpl-save")?.addEventListener("click", () => {
                const id = document.getElementById("tpl-edit-id")?.value;
                const clientName = document.getElementById("tpl-client")?.value;
                const label = document.getElementById("tpl-label")?.value;
                const settings = {
                    discipline: document.getElementById("tpl-discipline")?.value,
                    idfZone: document.getElementById("tpl-idf")?.value,
                    sheetDwt: document.getElementById("tpl-sheet")?.value,
                    precisionPass: document.getElementById("tpl-precision")?.value,
                    fpidPrefix: document.getElementById("tpl-fpid")?.value,
                    county: document.getElementById("tpl-county")?.value,
                    district: document.getElementById("tpl-district")?.value,
                    notes: document.getElementById("tpl-notes")?.value
                };
                try {
                    if (id) {
                        window.BoundaryQCCMS.updateTemplate(id, { clientName, label, settings });
                        ctx.showToast("Template updated.");
                    } else {
                        const t = window.BoundaryQCCMS.createTemplate(clientName, label, settings);
                        ctx.showToast(`Template "${t.label}" created.`);
                    }
                    if (tplForm) tplForm.hidden = true;
                    render(ctx);
                } catch (err) {
                    ctx.showToast(err.message, true);
                    if (err.code === "TEMPLATE_LIMIT") renderTemplates();
                }
            });

            document.getElementById("cms-templates-list")?.addEventListener("click", e => {
                const editBtn = e.target.closest(".btn-tpl-edit");
                if (editBtn) {
                    const t = window.BoundaryQCCMS.getTemplates().find(x => x.id === editBtn.getAttribute("data-id"));
                    if (t) showTplForm(t);
                    return;
                }
                const delBtn = e.target.closest(".btn-tpl-del");
                if (delBtn) {
                    const id = delBtn.getAttribute("data-id");
                    ctx.showConfirmModal("Delete this client master template?").then(ok => {
                        if (!ok) return;
                        window.BoundaryQCCMS.deleteTemplate(id);
                        render(ctx);
                        ctx.showToast("Template deleted.");
                    });
                }
            });

            document.getElementById("cms-active-template")?.addEventListener("change", e => {
                window.BoundaryQCCMS.setActiveTemplate(e.target.value || null);
                render(ctx);
                const t = window.BoundaryQCCMS.getActiveTemplate();
                ctx.showToast(t ? `Active template: ${t.clientName} — ${t.label}` : "No active template.");
            });

            // Audit hash-chain verifier
            document.getElementById("btn-verify-audit-chain")?.addEventListener("click", async () => {
                if (!window.BoundaryQCCMS) return;
                const badge = document.getElementById("cms-audit-status-badge");
                if (badge) {
                    window.setSafeHTML(badge, `<i class="fa-solid fa-spinner fa-spin"></i> VERIFYING CHAIN...`);
                    badge.style.color = "var(--primary)"; badge.style.borderColor = "var(--primary)";
                }
                try {
                    const result = await window.BoundaryQCCMS.verifyAuditIntegrity();
                    if (result.isValid) {
                        if (badge) {
                            window.setSafeHTML(badge, `<i class="fa-solid fa-circle-check"></i> HASH CHAIN VERIFIED (${result.totalBlocksVerified} BLOCKS)`);
                            badge.style.color = "var(--success)"; badge.style.borderColor = "var(--success)"; badge.style.background = "rgba(16, 185, 129, 0.15)";
                        }
                        ctx.showToast(`✓ Audit hash chain verified! Head: ${result.rootHash.substring(0, 14)}...`);
                    } else {
                        if (badge) {
                            window.setSafeHTML(badge, `<i class="fa-solid fa-triangle-exclamation"></i> TAMPER DETECTED (SEQ #${result.blockSequence})`);
                            badge.style.color = "var(--danger)"; badge.style.borderColor = "var(--danger)"; badge.style.background = "rgba(239, 68, 68, 0.15)";
                        }
                        ctx.showToast(`🚨 Security Alert: ${result.message}`);
                    }
                } catch (err) {
                    ctx.showToast(`Verification error: ${err.message}`);
                }
            });

            document.getElementById("btn-export-cloud-sync")?.addEventListener("click", () => {
                if (!window.BoundaryQCCMS) return;
                const payload = window.BoundaryQCCMS.generateCloudSyncPayload();
                window.COGO.downloadText("fdot_postgresql_cloud_sync_schema.json", JSON.stringify(payload, null, 2), "application/json");
                ctx.showToast("Exported PostgreSQL RLS Cloud Schema (`fdot_postgresql_cloud_sync_schema.json`)!");
            });

            // PostgreSQL Database & Cloud Sync Actions
            if (window.DatabaseService) {
                window.DatabaseService.onStatusChange(() => renderDatabaseStatus());
                window.DatabaseService.getStatus().then(() => renderDatabaseStatus()).catch(() => {});
            }

            document.getElementById("btn-db-sync-push")?.addEventListener("click", async () => {
                if (!window.DatabaseService) return;
                const btn = document.getElementById("btn-db-sync-push");
                if (btn) btn.disabled = true;
                try {
                    const res = await window.DatabaseService.syncToDatabase();
                    ctx.showToast(`✓ Synchronized state to PostgreSQL`);
                    render(ctx);
                } catch (err) {
                    ctx.showToast(`Sync Error: ${err.message}`, true);
                } finally {
                    if (btn) btn.disabled = false;
                }
            });

            document.getElementById("btn-db-sync-pull")?.addEventListener("click", async () => {
                if (!window.DatabaseService) return;
                const btn = document.getElementById("btn-db-sync-pull");
                if (btn) btn.disabled = true;
                try {
                    const res = await window.DatabaseService.pullFromDatabase();
                    // pullFromDatabase() flattens the pulled tables onto the result itself
                    // (Object.assign({ok:true}, tables)) — there is no res.tables wrapper.
                    const nProj = res.projects?.length || 0;
                    const nTpl = res.client_templates?.length || 0;
                    ctx.showToast(`✓ Pulled records from PostgreSQL (${nProj} projects, ${nTpl} templates)`);
                    render(ctx);
                } catch (err) {
                    ctx.showToast(`Pull Error: ${err.message}`, true);
                } finally {
                    if (btn) btn.disabled = false;
                }
            });

            // Database Settings Modal
            const modalDb = document.getElementById("modal-db-settings");
            const inputUrl = document.getElementById("input-db-url");
            const testFeedback = document.getElementById("db-test-feedback");

            document.getElementById("btn-db-configure")?.addEventListener("click", () => {
                const st = window.DatabaseService?.getLastStatus();
                if (inputUrl && st?.database_url_masked) {
                    inputUrl.value = st.database_url_masked;
                }
                if (testFeedback) testFeedback.style.display = "none";
                modalDb?.classList.remove("hidden");
            });

            document.getElementById("btn-close-db-modal")?.addEventListener("click", () => {
                modalDb?.classList.add("hidden");
            });

            document.getElementById("radio-db-local")?.addEventListener("change", e => {
                if (e.target.checked && inputUrl) {
                    inputUrl.value = "postgresql://postgres@localhost:5432/fdot_survey_db";
                }
            });

            document.getElementById("radio-db-remote")?.addEventListener("change", e => {
                if (e.target.checked && inputUrl && inputUrl.value.includes("localhost")) {
                    inputUrl.value = "postgresql://survey_user:PASSWORD@remote-db.cloud.provider:5432/fdot_survey_db?sslmode=require";
                    inputUrl.focus();
                }
            });

            document.getElementById("btn-db-reset-default")?.addEventListener("click", async () => {
                if (!window.DatabaseService) return;
                try {
                    const res = await window.DatabaseService.configureDatabase(null);
                    ctx.showToast("Reset to default local PostgreSQL configuration.");
                    if (inputUrl) inputUrl.value = res.database_url_masked || "postgresql://postgres@localhost:5432/fdot_survey_db";
                    if (testFeedback) {
                        testFeedback.style.display = "block";
                        testFeedback.style.background = "rgba(16, 185, 129, 0.15)";
                        testFeedback.style.color = "var(--success)";
                        testFeedback.textContent = "✓ Connected to local PostgreSQL server.";
                    }
                    render(ctx);
                } catch (err) {
                    ctx.showToast(err.message, true);
                }
            });

            document.getElementById("btn-db-test-conn")?.addEventListener("click", async () => {
                const url = inputUrl?.value?.trim();
                if (!url) { ctx.showToast("Enter a PostgreSQL connection URL.", true); return; }
                const testBtn = document.getElementById("btn-db-test-conn");
                if (testBtn) testBtn.disabled = true;
                if (testFeedback) {
                    testFeedback.style.display = "block";
                    testFeedback.style.background = "rgba(51, 103, 145, 0.15)";
                    testFeedback.style.color = "var(--primary)";
                    testFeedback.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Testing connection...`;
                }
                try {
                    const res = await window.DatabaseService.configureDatabase(url);
                    if (testFeedback) {
                        testFeedback.style.background = "rgba(16, 185, 129, 0.15)";
                        testFeedback.style.color = "var(--success)";
                        testFeedback.textContent = `✓ Connection successful: ${res.version ? res.version.split(" on ")[0] : "PostgreSQL Connected"}`;
                    }
                    ctx.showToast("Database connection test succeeded!");
                    render(ctx);
                } catch (err) {
                    if (testFeedback) {
                        testFeedback.style.background = "rgba(239, 68, 68, 0.15)";
                        testFeedback.style.color = "var(--danger)";
                        testFeedback.textContent = `✗ Connection failed: ${err.message}`;
                    }
                } finally {
                    if (testBtn) testBtn.disabled = false;
                }
            });

            document.getElementById("btn-db-save-conn")?.addEventListener("click", async () => {
                const url = inputUrl?.value?.trim();
                if (!url) { ctx.showToast("Enter a PostgreSQL connection URL.", true); return; }
                try {
                    await window.DatabaseService.configureDatabase(url);
                    modalDb?.classList.add("hidden");
                    ctx.showToast("Database configuration saved and active!");
                    render(ctx);
                } catch (err) {
                    ctx.showToast(`Error saving configuration: ${err.message}`, true);
                }
            });
        },
    };

    window.Dashboard = { render, renderTemplates };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
})();
