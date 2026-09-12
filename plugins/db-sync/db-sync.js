/**
 * Plugin: db-sync (PostgreSQL Database Client & Cloud Sync Bridge)
 * plugins/db-sync/db-sync.js
 *
 * Provides bidirectional synchronization between the client workspace (CMS,
 * templates, submittals, linework models, audit logs) and the PostgreSQL
 * database (supporting both local PostgreSQL and remote/cloud database instances).
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "db-sync",
        version: "1.0.0",
        description: "PostgreSQL database client & sync bridge for local and remote relational data storage.",
        icon: "fa-database",
        tier: "Free",
        dependencies: ["cms-engine"]
    };

    let _lastStatus = { ok: false, connected: false };
    const _listeners = new Set();

    let _apiUrl = "http://localhost:8085/api/db";

    function _resolveUrl(subpath) {
        let base = _apiUrl;
        if (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null" && window.location.protocol.startsWith("http")) {
            base = window.location.origin + "/api/db";
        }
        const rel = subpath.startsWith("/api/db") ? subpath.slice("/api/db".length) : subpath;
        return base.replace(/\/+$/, "") + (rel.startsWith("/") ? rel : "/" + rel);
    }

    async function getStatus() {
        try {
            const url = _resolveUrl("/status");
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            _lastStatus = await res.json();
        } catch (err) {
            _lastStatus = {
                ok: false,
                connected: false,
                error: err.message || "Failed to reach database bridge server."
            };
        }
        notifyListeners();
        return _lastStatus;
    }

    function notifyListeners() {
        for (const fn of _listeners) {
            try { fn(_lastStatus); } catch (e) { console.error("[db-sync] Listener error:", e); }
        }
    }

    async function configureDatabase(urlOrReset) {
        const body = typeof urlOrReset === "string" ? { database_url: urlOrReset } : { reset_default: true };
        const res = await fetch(_resolveUrl("/config"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return { ok: false, error: data.error || "Failed to configure database." };
        await getStatus();
        return data;
    }

    async function syncToDatabase(overridePayload) {
        let payload = overridePayload;
        if (!payload) {
            if (!window.BoundaryQCCMS) throw new Error("CMS Engine is not loaded.");
            payload = window.BoundaryQCCMS.generateCloudSyncPayload();
        }
        const res = await fetch(_resolveUrl("/sync/push"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Database push failed.");
        await getStatus();
        return data;
    }

    async function pullFromDatabase() {
        const cms = window.BoundaryQCCMS;
        let tenantId = "org_kh_01";
        if (cms && typeof cms.getCurrentUser === "function") {
            const user = cms.getCurrentUser();
            if (user && user.orgId) tenantId = user.orgId;
        }

        const res = await fetch(_resolveUrl(`/sync/pull?tenantId=${encodeURIComponent(tenantId)}`), { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Database pull failed.");

        const tables = data.tables || {};

        // Ingest every pulled table into the real cms-engine collections (localStorage-backed,
        // under the actual bqc_cms_* keys) via its import*() methods — these translate the
        // server's snake_case rows back to this app's camelCase shape and merge by id, rather
        // than replacing outright, so a pull never drops a not-yet-synced local row.
        if (cms) {
            if (Array.isArray(tables.organizations)) cms.importOrganizations(tables.organizations);
            if (Array.isArray(tables.users)) cms.importUsers(tables.users);
            if (Array.isArray(tables.projects)) cms.importProjects(tables.projects);
            if (Array.isArray(tables.client_templates)) cms.importTemplates(tables.client_templates);
            if (Array.isArray(tables.submittals)) cms.importSubmittals(tables.submittals);
            if (Array.isArray(tables.transactions)) cms.importTransactions(tables.transactions);
            if (Array.isArray(tables.audit_chain)) cms.importAuditChain(tables.audit_chain);
        }

        await getStatus();
        return Object.assign({ ok: true }, tables);
    }

    async function saveLinework(session) {
        const res = await fetch(_resolveUrl("/linework/save"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save linework session to database.");
        return data;
    }

    async function loadLinework(id) {
        const sub = id ? `/linework/load?id=${encodeURIComponent(id)}` : "/linework/load";
        const res = await fetch(_resolveUrl(sub), { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load linework session from database.");
        return data;
    }

    // db-sync owns no tab of its own (no MANIFEST.tab), so PluginRegistry.notifyTabActivate()
    // — which only calls onTabActivate on the plugin that owns the activated tab — would never
    // fire here even if defined; the Dashboard tab re-checks status on its own onTabActivate,
    // via window.DatabaseService.getStatus(), instead of relying on this plugin to push it.
    const Plugin = {
        init(ctx) {
            getStatus().catch(() => {});
        }
    };

    window.DatabaseService = {
        get apiUrl() { return _apiUrl; },
        set apiUrl(v) { _apiUrl = String(v); },
        getStatus,
        getLastStatus: () => _lastStatus,
        configureDatabase,
        syncToDatabase,
        pullFromDatabase,
        saveLinework,
        loadLinework,
        onStatusChange(fn) {
            _listeners.add(fn);
            fn(_lastStatus);
            return () => _listeners.delete(fn);
        }
    };

    if (window.PluginRegistry) {
        window.PluginRegistry.register(MANIFEST, Plugin);
    }
})();
