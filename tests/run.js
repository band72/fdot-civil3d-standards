#!/usr/bin/env node
"use strict";
/* Functional test runner for the FDOT Civil3D Standards site.
 * Usage:  node tests/run.js  [suiteName ...]
 */
const path = require("path");
const { t, summary } = require("./_assert");
const env = require("./_env");

const SUITES = ["cogo", "data", "dxf", "linework", "efbk", "landxml", "batchprocess", "reports", "logging", "stdn-cmp", "auth", "geo", "marketing"];
// Needs a live local PostgreSQL bridge (server.py + a running/initialized Postgres) — see
// tests/db.test.js's own header. Not part of the zero-install default suite; run it with
// `npm run test:db` (or `node tests/run.js db`) once that's up.
const OPTIONAL_SUITES = ["db"];
const SUITE_ALIASES = ["batch", "line", "mktg", "stdn"];
const ALL_SUITES = SUITES.concat(OPTIONAL_SUITES).concat(SUITE_ALIASES);

const SUITE_FILE_MAP = {
    batchprocess: "batch.test.js",
    batch: "batch.test.js",
    linework: "line.test.js",
    line: "line.test.js",
    marketing: "mktg.test.js",
    mktg: "mktg.test.js",
    "stdn-cmp": "stdn.test.js",
    stdn: "stdn.test.js"
};

(async () => {
    const started = Date.now();
    const loadRes = env.load();

    t.group("env/load");
    t.eq(loadRes.errors.length, 0, "all source files eval without error" +
        (loadRes.errors.length ? " — " + loadRes.errors.join("; ") : ""));
    t.eq(loadRes.loaded.length, 30, "30 source files loaded");
    ["COGO", "FDOT_DATA", "FDOTDXFInspector", "PluginRegistry", "BoundaryQCSecurity",
        "BoundaryQCBilling", "BoundaryQCCMS", "Security", "Dashboard", "Linework", "EFBK", "LandXML", "BatchProcess", "Reports", "Logging", "StdnEngine", "StdnCompare", "safeHTML", "setSafeRows", "DatabaseService", "DbSettings"]
        .forEach(g => t.ok(typeof loadRes.win[g] !== "undefined", "global " + g + " present"));

    const want = process.argv.slice(2).filter(a => ALL_SUITES.includes(a));
    const run = want.length ? want : SUITES;

    for (const name of run) {
        const testFile = SUITE_FILE_MAP[name] || (name + ".test.js");
        const suite = require(path.join(__dirname, testFile));
        try {
            await suite(t, { win: loadRes.win, fakeEl: loadRes.fakeEl, makeStorage: loadRes.makeStorage });
        } catch (e) {
            t.group(name + "/UNCAUGHT");
            t.ok(false, "suite threw: " + (e && e.stack || e));
        }
    }

    const s = summary();
    const ms = Date.now() - started;

    console.log("\n──────────── results by group ────────────");
    Object.keys(s.groups).sort().forEach(g => {
        const r = s.groups[g];
        const mark = r.fail ? "FAIL" : " ok ";
        console.log(`  [${mark}] ${String(r.pass + r.fail).padStart(4)}  ${g}${r.fail ? "   (" + r.fail + " failed)" : ""}`);
    });

    if (s.fails.length) {
        console.log("\n──────────── failures ────────────");
        s.fails.slice(0, 80).forEach(f => console.log("  ✗ " + f));
        if (s.fails.length > 80) console.log(`  … and ${s.fails.length - 80} more`);
    }

    console.log("\n════════════════════════════════════════");
    console.log(`  TOTAL ${s.total} assertions   ${s.pass} passed   ${s.fail} failed   (${ms} ms)`);
    console.log("════════════════════════════════════════");
    process.exit(s.fail ? 1 : 0);
})();
