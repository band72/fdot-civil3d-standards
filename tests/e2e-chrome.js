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
        const pluginNames = await evaluate("window.PluginRegistry ? window.PluginRegistry.getAll().map(p => p.manifest.name) : []");
        const pluginCount = pluginNames ? pluginNames.length : 0;
        console.log(`  ✓ Plugins registered & active (${pluginCount}):`, pluginNames);
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

        // Test Zoom In, Zoom Out, and Fit controls
        const wInitial = await evaluate("window.Linework._Ed.view.w");
        await evaluate("document.getElementById('btn-lw-zoom-in').click()");
        const wAfterZoomIn = await evaluate("window.Linework._Ed.view.w");
        console.log(`  ✓ Zoom In: initial width = ${wInitial.toFixed(1)}, after zoom in = ${wAfterZoomIn.toFixed(1)}`);
        if (wAfterZoomIn >= wInitial) throw new Error("Zoom in did not reduce view width");

        await evaluate("document.getElementById('btn-lw-zoom-out').click()");
        const wAfterZoomOut = await evaluate("window.Linework._Ed.view.w");
        console.log(`  ✓ Zoom Out: after zoom out = ${wAfterZoomOut.toFixed(1)}`);
        if (wAfterZoomOut <= wAfterZoomIn) throw new Error("Zoom out did not increase view width");

        // Test floating on-canvas zoom buttons
        await evaluate("document.getElementById('btn-lw-float-zoom-in').click()");
        const wFloatZoomIn = await evaluate("window.Linework._Ed.view.w");
        if (wFloatZoomIn >= wAfterZoomOut) throw new Error("Floating zoom in failed");

        await evaluate("document.getElementById('btn-lw-float-fit').click()");
        const wAfterFit = await evaluate("window.Linework._Ed.view.w");
        console.log(`  ✓ Fit reset view width: ${wAfterFit.toFixed(1)}`);

        // Test Figure Selection and Figure Points Grid editing
        await evaluate("document.querySelector('[data-lw=\"fig-sel\"]').click()");
        const gridCardVisible = await evaluate("document.getElementById('lw-fig-points-card').style.display !== 'none'");
        const initialPtRows = await evaluate("document.querySelectorAll('#lw-fig-points-tbody tr.lw-pt-row').length");
        console.log(`  ✓ Figure selected -> Points Grid Visible: ${gridCardVisible} | Points rendered: ${initialPtRows}`);
        if (!gridCardVisible || initialPtRows !== 2) throw new Error("Figure selection failed to open points grid or render points");

        // In-place edit Northing and Description in the grid
        await evaluate(`(() => {
            const row2Desc = document.querySelector('#lw-fig-points-tbody tr.lw-pt-row[data-idx="1"] input[data-prop="desc"]');
            row2Desc.value = "EP CLS";
            row2Desc.dispatchEvent(new Event('input', { bubbles: true }));
            row2Desc.dispatchEvent(new Event('change', { bubbles: true }));

            const row2N = document.querySelector('#lw-fig-points-tbody tr.lw-pt-row[data-idx="1"] input[data-prop="n"]');
            row2N.value = "2015750.00";
            row2N.dispatchEvent(new Event('input', { bubbles: true }));
            row2N.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);

        const updatedDesc = await evaluate("window.Linework._Ed.model.figures[0].pts[1].desc");
        const updatedN = await evaluate("window.Linework._Ed.model.figures[0].pts[1].n");
        console.log(`  ✓ Grid Point In-Place Edit -> Northing: ${updatedN}, Description: "${updatedDesc}"`);
        if (updatedDesc !== "EP CLS" || updatedN !== 2015750.00) throw new Error("Grid editing failed to update figure point in model");

        // Add Point via button
        await evaluate("document.getElementById('btn-lw-fig-add-pt').click()");
        const rowsAfterAdd = await evaluate("document.querySelectorAll('#lw-fig-points-tbody tr.lw-pt-row').length");
        console.log(`  ✓ Add Point to Figure -> New point count: ${rowsAfterAdd}`);
        if (rowsAfterAdd !== 3) throw new Error("Add point button failed to append point to figure");

        // Test Linework Save Button and LocalStorage persistence
        console.log("\n[TEST 7b] Linework Save Session, Restore & Export CSV / LandXML");
        const hasSaveBtn = await evaluate("!!document.getElementById('btn-lw-save')");
        const hasFigSaveBtn = await evaluate("!!document.getElementById('btn-lw-fig-save')");
        const hasRestoreBtn = await evaluate("!!document.getElementById('btn-lw-load-saved')");
        const hasExpCsvBtn = await evaluate("!!document.getElementById('btn-lw-exp-csv')");
        const hasExpLandXmlBtn = await evaluate("!!document.getElementById('btn-lw-exp-landxml')");
        const hasFigExpCsvBtn = await evaluate("!!document.getElementById('btn-lw-fig-exp-csv')");
        const hasFigExpLandXmlBtn = await evaluate("!!document.getElementById('btn-lw-fig-exp-landxml')");
        console.log(`  ✓ Export/Save UI elements: Save=${hasSaveBtn}, FigSave=${hasFigSaveBtn}, Restore=${hasRestoreBtn}, ExpCSV=${hasExpCsvBtn}, ExpLandXML=${hasExpLandXmlBtn}`);
        if (!hasSaveBtn || !hasFigSaveBtn || !hasRestoreBtn || !hasExpCsvBtn || !hasExpLandXmlBtn) {
            throw new Error("Missing Linework Save or Export buttons in toolbar/figure card");
        }

        // Click Save button and check localStorage
        await evaluate("document.getElementById('btn-lw-save').click()");
        const savedSession = await evaluate("localStorage.getItem('fdot_linework_saved_session')");
        if (!savedSession || !savedSession.includes("figures")) throw new Error("Save button failed to persist session to localStorage");
        console.log(`  ✓ Session successfully saved to localStorage (${savedSession.length} bytes)`);

        // Test Export CSV
        const exportedCsv = await evaluate("window.Linework.exportCSV()");
        if (!exportedCsv || !exportedCsv.startsWith("Point,Northing,Easting,Elevation,Description")) {
            throw new Error("exportCSV() failed to produce valid CSV with header");
        }
        console.log(`  ✓ Exported CSV sample: ${exportedCsv.split('\\n')[0]} | Total rows: ${exportedCsv.split('\\n').length}`);

        // Test Export LandXML
        const exportedLandXml = await evaluate("window.Linework.exportLandXML()");
        if (!exportedLandXml || !exportedLandXml.includes("<LandXML") || !exportedLandXml.includes("<CgPoints>")) {
            throw new Error("exportLandXML() failed to produce valid LandXML document");
        }
        console.log(`  ✓ Exported LandXML root and CgPoints verified (${exportedLandXml.length} bytes)`);

        // Test Restore Saved button
        await evaluate("window.Linework._Ed.setModel({ figures: [] })");
        const countBeforeRestore = await evaluate("window.Linework._Ed.model.figures.length");
        if (countBeforeRestore !== 0) throw new Error("Failed to clear model for restore test");
        await evaluate("document.getElementById('btn-lw-load-saved').click()");
        const countAfterRestore = await evaluate("window.Linework._Ed.model.figures.length");
        console.log(`  ✓ Restore Saved: before=${countBeforeRestore}, after restore=${countAfterRestore}`);
        if (countAfterRestore < 1) throw new Error("Restore Saved button failed to reload model");

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

        // 10. PostgreSQL Database & Cloud Sync Bridge Workflow
        console.log("\n[TEST 10] PostgreSQL Database Status & Cloud Sync Bridge");
        await evaluate("document.querySelector('[data-tab=\"tab-cms\"]').click()");
        const isCmsActive = await evaluate("document.getElementById('tab-cms').classList.contains('active')");
        console.log(`  ✓ Tab switch to Admin Dashboard (tab-cms): ${isCmsActive}`);
        if (!isCmsActive) throw new Error("tab-cms did not activate");

        const hasDbPanel = await evaluate("!!document.getElementById('cms-db-panel')");
        const dbStatusBadge = await evaluate("document.getElementById('db-status-badge')?.textContent.trim()");
        const hasSyncPushBtn = await evaluate("!!document.getElementById('btn-db-sync-push')");
        const hasSyncPullBtn = await evaluate("!!document.getElementById('btn-db-sync-pull')");
        const hasConfigBtn = await evaluate("!!document.getElementById('btn-db-configure')");
        console.log(`  ✓ Database Card Present: ${hasDbPanel} | Status: "${dbStatusBadge}"`);
        console.log(`  ✓ Sync Controls: Push=${hasSyncPushBtn}, Pull=${hasSyncPullBtn}, Configure=${hasConfigBtn}`);
        if (!hasDbPanel || !hasSyncPushBtn || !hasSyncPullBtn || !hasConfigBtn) throw new Error("Database UI controls missing from Admin Dashboard");

        // Verify table counter chips
        const prjCount = await evaluate("document.getElementById('db-cnt-projects')?.textContent.trim()");
        const lwCount = await evaluate("document.getElementById('db-cnt-linework')?.textContent.trim()");
        const ptCount = await evaluate("document.getElementById('db-cnt-pts')?.textContent.trim()");
        console.log(`  ✓ Table Metric Chips -> Projects: ${prjCount}, Linework Sessions: ${lwCount}, Survey Points: ${ptCount}`);

        // 10b. JEA 2024 As-Built Standards Tab & Reverse-Read Auditor Workflow
        console.log("\n[TEST 10b] JEA 2024 As-Built Standards & Clearance Auditor");
        await evaluate("document.querySelector('[data-tab=\"tab-jea24\"]').click()");
        const isJeaActive = await evaluate("document.getElementById('tab-jea24').classList.contains('active')");
        console.log(`  ✓ Tab switch to JEA As-Built Standards (tab-jea24): ${isJeaActive}`);
        if (!isJeaActive) throw new Error("tab-jea24 did not activate");

        // Check 45 Domains view
        await evaluate("document.getElementById('jea-sub-domains').click()");
        const domainCardsCount = await evaluate("document.querySelectorAll('#jea-domains-list .domain-card').length");
        console.log(`  ✓ 45 Validation Domains Rendered: ${domainCardsCount} domains`);
        if (domainCardsCount !== 45) throw new Error(`Expected 45 domain cards, got ${domainCardsCount}`);

        // Check Reverse-Read Audit view
        await evaluate("document.getElementById('jea-sub-audit').click()");
        await evaluate("document.getElementById('jea-btn-audit-pass').click()");
        const passBadge = await evaluate("document.querySelector('#jea-audit-results-panel .badge')?.textContent.trim()");
        const passScore = await evaluate("document.querySelector('#jea-audit-results-panel span[style*=\"font-weight:800\"]')?.textContent.trim()");
        console.log(`  ✓ Compliant Sample Audit -> Status: "${passBadge}", Score: ${passScore}`);
        if (passBadge !== "COMPLIANT" || passScore !== "100%") throw new Error("Compliant sample audit did not pass with 100%");

        // Check 18-inch clearance violation detection
        await evaluate("document.getElementById('jea-btn-audit-fail').click()");
        const failBadge = await evaluate("document.querySelector('#jea-audit-results-panel .badge')?.textContent.trim()");
        const failHasRule = await evaluate("document.querySelector('#jea-audit-results-panel')?.textContent.includes('18-Inch Clearance Rule')");
        console.log(`  ✓ Clearance Violation Sample Audit -> Status: "${failBadge}", 18" Rule Flagged: ${failHasRule}`);
        if (failBadge !== "NON-COMPLIANT" || !failHasRule) throw new Error("Clearance shortfall was not flagged");

        // 11. Check for Any Uncaught In-Page Exceptions
        console.log("\n[TEST 11] Page Stability & Unhandled Exceptions Check");
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
