"use strict";
/* Functional tests for DatabaseService + the local PostgreSQL bridge (server.py + db/schema.sql).
 *
 * Unlike every other suite here, this one needs real infrastructure: `server.py` serving
 * /api/db/* on localhost:8085, backed by a real, initialized PostgreSQL database (see
 * `npm run db:start` / `npm run db:init`, or `scripts/pg_ctl.sh start`/`init`). That's why it's
 * NOT in tests/run.js's default SUITES — `npm test` stays Node-only/zero-install — and instead
 * runs only via `npm run test:db` (or `node tests/run.js db` once the server is up).
 *
 * If the bridge isn't reachable, every assertion here is skipped (not failed) with one note,
 * so an accidental `node tests/run.js db` without the server running doesn't look like a real
 * regression.
 */
module.exports = async function (t, env) {
    const W = env.win;
    const DB = W.DatabaseService;

    t.group("db/service definition");
    t.ok(typeof DB !== "undefined" && DB !== null, "DatabaseService global exists");
    t.ok(typeof DB.getStatus === "function", "getStatus method exists");
    t.ok(typeof DB.syncToDatabase === "function", "syncToDatabase method exists");
    t.ok(typeof DB.pullFromDatabase === "function", "pullFromDatabase method exists");
    t.ok(typeof DB.saveLinework === "function", "saveLinework method exists");
    t.ok(typeof DB.loadLinework === "function", "loadLinework method exists");
    t.ok(typeof DB.configureDatabase === "function", "configureDatabase method exists");

    DB.apiUrl = "http://localhost:8085/api/db";
    let statusRes;
    try {
        statusRes = await DB.getStatus();
    } catch (e) {
        statusRes = { ok: false, connected: false, error: e.message };
    }

    if (!statusRes.ok || !statusRes.connected) {
        t.group("db/SKIPPED — no local PostgreSQL bridge reachable");
        t.ok(true, "start it with `npm run db:start && npm run db:init && python3 server.py 8085`, " +
            "then rerun with `npm run test:db`" +
            (statusRes.error ? ` (last error: ${statusRes.error})` : ""));
        return;
    }

    t.group("db/live status check");
    t.ok(statusRes.connected === true, "PostgreSQL connection state is connected");
    t.ok(statusRes.counts && typeof statusRes.counts === "object", "table counts dictionary returned");
    t.ok(typeof statusRes.counts.organizations === "number", "organizations table count reported");
    t.ok(typeof statusRes.counts.projects === "number", "projects table count reported");
    t.ok(typeof statusRes.counts.users === "number", "users table count reported");
    t.ok(typeof statusRes.counts.linework_sessions === "number", "linework_sessions count reported");

    t.group("db/linework session persistence");
    const sessionId = "lw_test_suite_session_" + Date.now();
    const testSession = {
        id: sessionId,
        name: "Test Linework Corridor Model",
        model: {
            figures: [
                {
                    id: "fig_101",
                    code: "EP",
                    style: "PVM_EP",
                    pts: [
                        { ptNum: "PC1", e: 100000.0, n: 200000.0, z: 15.5, desc: "EP P1" },
                        { ptNum: 2, e: 100150.0, n: 200050.0, z: 15.8, desc: "EP P2" },
                        { ptNum: 3, e: 100300.0, n: 200100.0, z: 16.1, desc: "EP P3" }
                    ]
                }
            ]
        },
        view: { zoom: 1.5, cx: 100150, cy: 200050 }
    };

    const saveRes = await DB.saveLinework(testSession);
    t.ok(saveRes.ok, "linework session saved successfully to PostgreSQL");
    t.eq(saveRes.id, sessionId, "saved session returns matching session ID");
    t.eq(saveRes.point_count, 3, "saved point count matches the 3 figure points");

    const loadRes = await DB.loadLinework(sessionId);
    t.ok(loadRes.ok, "linework session loaded from PostgreSQL");
    // The row's columns land directly on `session` — no session_data wrapper.
    t.ok(loadRes.session && loadRes.session.model, "linework session model retrieved");
    t.eq(loadRes.session.model.figures.length, 1, "loaded figure count matches saved");
    t.eq(loadRes.session.model.figures[0].code, "EP", "figure code EP preserved");
    t.eq(loadRes.session.model.figures[0].pts.length, 3, "figure points count preserved");
    t.eq(String(loadRes.session.model.figures[0].pts[0].ptNum), "PC1", "alphanumeric ptNum round-trips");

    t.group("db/sync push and pull");
    const tenantId = "org_test_suite_" + Date.now();
    const pushPayload = {
        tenantId,
        tables: {
            organizations: [{ id: tenantId, name: "Test Engineering Firm", plan: "enterprise", purchasedSeats: 10 }],
            projects: [{ id: "prj_test_suite_" + Date.now(), fpid: "999999-1-52-01", name: "I-4 S.R. 400 Widening", county: "Orange", district: 5, status: "ACTIVE" }]
        }
    };

    const pushRes = await DB.syncToDatabase(pushPayload);
    t.ok(pushRes.ok, "syncToDatabase accepted and executed transaction");
    t.ok(pushRes.synced && pushRes.synced.organizations === 1, "pushed organization counted in synced{}");
    t.ok(pushRes.synced && pushRes.synced.projects === 1, "pushed project counted in synced{}");

    // DatabaseService.pullFromDatabase() scopes to the *current* CMS user's orgId, not an
    // arbitrary tenantId, so it won't see this test's freshly-pushed tenant — hit the endpoint
    // directly instead, the same way the client does under the hood.
    const pullFetchRes = await W.fetch(`${DB.apiUrl}/sync/pull?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
    const pullRes = await pullFetchRes.json();
    t.ok(pullRes.ok, "pull returned valid database state for the test tenant");
    const pulledTables = pullRes.tables || {};
    t.ok(Array.isArray(pulledTables.projects), "pull returned a projects array");
    t.ok(Array.isArray(pulledTables.organizations), "pull returned an organizations array");
    t.ok(pulledTables.projects.some(p => p.name.includes("I-4") || p.name.includes("S.R. 400")), "test project found in pulled database records");
    t.ok(pulledTables.organizations.some(o => o.id === tenantId), "test organization found in pulled database records");

    t.group("db/remote configuration error handling");
    const badConfigRes = await DB.configureDatabase("postgresql://fakeuser:fakepass@127.0.0.99:5432/nonexistent");
    t.notOk(badConfigRes.ok, "unreachable database host rejected");
    t.ok(badConfigRes.error && badConfigRes.error.length > 0, "descriptive error message returned on failure");

    const goodConfigRes = await DB.configureDatabase("postgresql://postgres@localhost:5432/fdot_survey_db");
    t.ok(goodConfigRes.ok, "valid local PostgreSQL connection string confirmed");
};
