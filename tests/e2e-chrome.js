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

        // 7. Check for Any Uncaught In-Page Exceptions
        console.log("\n[TEST 7] Page Stability & Unhandled Exceptions Check");
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
