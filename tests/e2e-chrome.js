/**
 * End-to-End Headless Chrome Integration Test Suite
 * tests/e2e-chrome.js
 *
 * Launches real headless Google Chrome, attaches to Chrome DevTools Protocol (CDP),
 * exercises all critical user workflows across plugins, and verifies zero unhandled
 * exceptions or runtime errors.
 */

const { spawn } = require("child_process");

const CHROME_PORT = 9222;
const APP_URL = "http://localhost:8085";

async function main() {
    console.log("================================================================================");
    console.log("  FDOT Civil3D Standards Suite - End-to-End Chrome Integration Tests");
    console.log("================================================================================");

    const chrome = spawn("google-chrome", [
        "--headless",
        "--disable-gpu",
        `--remote-debugging-port=${CHROME_PORT}`,
        APP_URL
    ]);

    chrome.on("error", (err) => {
        console.error("Failed to spawn Google Chrome:", err);
        process.exit(1);
    });

    // Wait for Chrome to bind
    await new Promise(r => setTimeout(r, 1200));

    let ws = null;
    try {
        const res = await fetch(`http://localhost:${CHROME_PORT}/json`);
        const targets = await res.json();
        const page = targets.find(t => t.type === "page");
        if (!page) throw new Error("No Chrome page target found");

        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        let msgId = 1;
        function send(method, params = {}) {
            return new Promise((resolve) => {
                const id = msgId++;
                const handler = (evt) => {
                    const msg = JSON.parse(evt.data);
                    if (msg.id === id) {
                        ws.removeEventListener("message", handler);
                        resolve(msg.result);
                    }
                };
                ws.addEventListener("message", handler);
                ws.send(JSON.stringify({ id, method, params }));
            });
        }

        async function evaluate(expression) {
            const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (res && res.exceptionDetails) {
                const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
                throw new Error(`[In-Page Exception] ${desc}`);
            }
            return res?.result?.value;
        }

        const uncaughtExceptions = [];
        ws.addEventListener("message", (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.method === "Runtime.exceptionThrown") {
                uncaughtExceptions.push(msg.params.exceptionDetails);
            }
        });

        await send("Runtime.enable");

        // 1. Initial Load Checks
        console.log("\n[TEST 1] Initial Page & Plugin Initialization");
        const pluginCount = await evaluate("window.PluginRegistry ? window.PluginRegistry.getAll().length : 0");
        console.log(`  ✓ Plugins registered & active: ${pluginCount}`);
        if (pluginCount < 18) throw new Error(`Expected >= 18 plugins, got ${pluginCount}`);

        // 2. Batch Project Auditor Workflow
        console.log("\n[TEST 2] Multi-Sheet Batch Project Auditor Workflow");
        await evaluate("document.querySelector('[data-tab=\"tab-batchprocess\"]').click()");
        const isBatchActive = await evaluate("document.getElementById('tab-batchprocess').classList.contains('active')");
        console.log(`  ✓ Tab switch to Batch Auditor: ${isBatchActive}`);
        if (!isBatchActive) throw new Error("tab-batchprocess did not activate");

        await evaluate("document.getElementById('btn-batch-demo').click()");
        await new Promise(r => setTimeout(r, 650));

        const batchScore = await evaluate("document.getElementById('stat-batch-score').textContent");
        const batchTotal = await evaluate("document.getElementById('stat-batch-total').textContent");
        const batchPassed = await evaluate("document.getElementById('stat-batch-passed').textContent");
        console.log(`  ✓ Batch Demo Executed -> Total Sheets: ${batchTotal}, Average Score: ${batchScore}, Passed: ${batchPassed}`);
        if (batchTotal !== "4") throw new Error(`Expected 4 batch sheets, got ${batchTotal}`);

        // 3. Reports Hub Ingestion & Verification
        console.log("\n[TEST 3] Centralized Reports Hub Repository & Auto-Ingestion");
        await evaluate("document.querySelector('[data-tab=\"tab-reports\"]').click()");
        const isReportsActive = await evaluate("document.getElementById('tab-reports').classList.contains('active')");
        console.log(`  ✓ Tab switch to Reports Hub: ${isReportsActive}`);
        if (!isReportsActive) throw new Error("tab-reports did not activate");

        const reportsCount = await evaluate("window.Reports.getReports().length");
        const badgeCount = await evaluate("document.getElementById('reports-count-badge').textContent");
        console.log(`  ✓ Registered Reports in Store: ${reportsCount}, Navbar Badge Count: ${badgeCount}`);
        if (reportsCount < 2) throw new Error(`Expected >= 2 reports from batch audit, found ${reportsCount}`);

        // 4. In-App Preview Modal & Close
        console.log("\n[TEST 4] In-App Report Preview Modal (HTML Frame / Raw View)");
        await evaluate("document.querySelector('.btn-report-view').click()");
        const modalOpen = await evaluate("!document.getElementById('modal-report-preview').classList.contains('hidden')");
        const modalTitle = await evaluate("document.getElementById('preview-report-title').textContent");
        console.log(`  ✓ Modal opened: ${modalOpen} | Title: "${modalTitle}"`);
        if (!modalOpen) throw new Error("Preview modal did not open");

        await evaluate("document.getElementById('btn-close-report-preview').click()");
        const modalClosed = await evaluate("document.getElementById('modal-report-preview').classList.contains('hidden')");
        console.log(`  ✓ Modal closed properly: ${modalClosed}`);
        if (!modalClosed) throw new Error("Preview modal did not close");

        // 5. LandXML Studio Interop
        console.log("\n[TEST 5] LandXML Studio & Linework Bridge");
        await evaluate("document.querySelector('[data-tab=\"tab-landxml\"]').click()");
        await evaluate("document.getElementById('btn-landxml-sample').click()");
        await new Promise(r => setTimeout(r, 250));

        const parcels = await evaluate("document.getElementById('stat-landxml-parcels').textContent");
        const points = await evaluate("document.getElementById('stat-landxml-points').textContent");
        console.log(`  ✓ LandXML Parsed -> Parcels: ${parcels}, Survey Points: ${points}`);
        if (parcels !== "1" || points !== "4") throw new Error(`Unexpected LandXML stats: ${parcels} parcels, ${points} points`);

        // 6. Traverse COGO & Auto-Report Ingestion
        console.log("\n[TEST 6] Traverse COGO Calculation & Automatic Report Registration");
        await evaluate("document.querySelector('[data-tab=\"tab-qc\"]').click()");
        await evaluate("document.getElementById('btn-calc-traverse').click()");
        await evaluate("document.getElementById('btn-gen-qc-report').click()");
        await new Promise(r => setTimeout(r, 250));

        const finalReportCount = await evaluate("window.Reports.getReports().length");
        console.log(`  ✓ Reports count after Traverse COGO: ${finalReportCount}`);
        if (finalReportCount <= reportsCount) throw new Error("Traverse report did not register in Reports Hub");

        // 7. Linework Editor File Import & Error Diagnostics Workflow
        console.log("\n[TEST 7] Linework Editor File Import, Diagnostics & System Logs");
        await evaluate("document.querySelector('[data-tab=\"tab-linework\"]').click()");
        const isLineworkActive = await evaluate("document.getElementById('tab-linework').classList.contains('active')");
        console.log(`  ✓ Tab switch to Linework Editor: ${isLineworkActive}`);
        if (!isLineworkActive) throw new Error("tab-linework did not activate");

        // Paste CSV with quotes and an intentional error row
        const testCsv = [
            "Point,Northing,Easting,Elevation,Description",
            "1,2015600.00,642100.00,12.5,\\\"EP B, R10\\\"",
            "corrupt_row_with_no_coords",
            "2,2015700.00,642100.00,12.5,\\\"EP E\\\""
        ].join("\\n");

        await evaluate(`document.getElementById('lw-paste').value = "${testCsv}"`);
        await evaluate("document.getElementById('btn-lw-parse-points').click()");
        await new Promise(r => setTimeout(r, 200));

        const diagVisible = await evaluate("document.getElementById('lw-import-diagnostics').style.display !== 'none'");
        const diagContent = await evaluate("document.getElementById('lw-import-diagnostics').textContent");
        console.log(`  ✓ Diagnostics rendered: ${diagVisible} | Contains skipped row alert: ${diagContent.includes("skipped")}`);
        if (!diagVisible || !diagContent.includes("skipped")) throw new Error("Linework diagnostics failed to render skipped row warning");

        // 8. System Logs Viewer & Verification
        console.log("\n[TEST 8] System Logs Viewer & Error Audit Stream");
        await evaluate("document.querySelector('[data-tab=\"tab-logging\"]').click()");
        const isLogsActive = await evaluate("document.getElementById('tab-logging').classList.contains('active')");
        console.log(`  ✓ Tab switch to System Logs: ${isLogsActive}`);
        if (!isLogsActive) throw new Error("tab-logging did not activate");

        const logStats = await evaluate("window.Logging.getStats()");
        console.log(`  ✓ System Logs Recorded -> Total: ${logStats.total}, Errors: ${logStats.errors}, Warnings: ${logStats.warnings}`);
        if (logStats.total < 1) throw new Error("Expected at least 1 log entry in Logging store");

        // 9. Home Page Target & Template Upload and Results Grid Workflow
        console.log("\n[TEST 9] Home Page Target & Template Upload and Results Grid");
        await evaluate("document.querySelector('[data-tab=\"tab-stdn-compare\"]').click()");
        const isHomeActive = await evaluate("document.getElementById('tab-stdn-compare').classList.contains('active')");
        console.log(`  ✓ Tab switch to Home (tab-stdn-compare): ${isHomeActive}`);
        if (!isHomeActive) throw new Error("tab-stdn-compare did not activate");

        const hasTargetInput = await evaluate("!!document.getElementById('target-file-text')");
        const hasTemplateInput = await evaluate("!!document.getElementById('template-file-text')");
        const hasExecuteBtn = await evaluate("!!document.getElementById('btn-compare-execute')");
        console.log(`  ✓ Home page elements: Target=${hasTargetInput}, Template=${hasTemplateInput}, Execute=${hasExecuteBtn}`);
        if (!hasTargetInput || !hasTemplateInput || !hasExecuteBtn) throw new Error("Missing Target, Template, or Execute elements on Home Page");

        // Click demo pair
        await evaluate("document.getElementById('btn-compare-demo').click()");
        const targetVal = await evaluate("document.getElementById('target-file-text').value");
        const templateVal = await evaluate("document.getElementById('template-file-text').value");
        console.log(`  ✓ Loaded demo pair -> Target: "${targetVal}", Template: "${templateVal}"`);
        if (!targetVal || !templateVal) throw new Error("Failed to load demo pair into textboxes");

        // Click Execute
        await evaluate("document.getElementById('btn-compare-execute').click()");
        await new Promise(r => setTimeout(r, 300));

        // Verify Results Grid is rendered
        const isGridVisible = await evaluate("document.getElementById('compare-grid-card').style.display !== 'none'");
        const totalRows = await evaluate("document.getElementById('compare-results-tbody').querySelectorAll('tr').length");
        const totalStat = await evaluate("document.getElementById('grid-stat-total').textContent");
        const matchesStat = await evaluate("document.getElementById('grid-stat-matches').textContent");
        const mismatchesStat = await evaluate("document.getElementById('grid-stat-mismatches').textContent");
        const missingStat = await evaluate("document.getElementById('grid-stat-missing').textContent");
        const scoreStat = await evaluate("document.getElementById('grid-stat-score').textContent");

        console.log(`  ✓ Results Grid Visible: ${isGridVisible} | Total: ${totalStat} (${totalRows} table rows), Matches: ${matchesStat}, Mismatches: ${mismatchesStat}, Missing: ${missingStat}, Score: ${scoreStat}`);
        if (!isGridVisible || totalRows === 0) throw new Error("Results Grid failed to render comparison rows");

        // Test Filter Pill
        await evaluate("document.querySelector('[data-grid-filter=\"mismatch\"]').click()");
        const mismatchRows = await evaluate("document.getElementById('compare-results-tbody').querySelectorAll('tr').length");
        console.log(`  ✓ Filter by Mismatch -> Rows: ${mismatchRows}`);

        // Test Search Input
        await evaluate("document.querySelector('[data-grid-filter=\"all\"]').click()");
        await evaluate("document.getElementById('grid-search-input').value = 'WALLS'; document.getElementById('grid-search-input').dispatchEvent(new Event('input'))");
        const wallsRows = await evaluate("document.getElementById('compare-results-tbody').querySelectorAll('tr').length");
        console.log(`  ✓ Search for 'WALLS' -> Rows: ${wallsRows}`);

        // 10. Check for Any Uncaught In-Page Exceptions
        console.log("\n[TEST 10] Page Stability & Unhandled Exceptions Check");
        console.log(`  ✓ Total Uncaught Runtime Exceptions: ${uncaughtExceptions.length}`);
        if (uncaughtExceptions.length > 0) {
            console.error("Uncaught exceptions detected:", uncaughtExceptions);
            throw new Error(`Detected ${uncaughtExceptions.length} unhandled runtime exceptions`);
        }

        console.log("\n================================================================================");
        console.log("  ALL END-TO-END CHROME IN-BROWSER TESTS PASSED (0 FAILURES, 0 EXCEPTIONS)");
        console.log("================================================================================\n");

        ws.close();
        chrome.kill();
        process.exit(0);

    } catch (err) {
        console.error("\n❌ E2E Integration Test Failed:", err.message);
        if (ws) ws.close();
        chrome.kill();
        process.exit(1);
    }
}

main();
