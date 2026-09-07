/**
 * Plugin: help (Help & User Manual)
 * plugins/help/help.js
 *
 * Renders the in-app user manual into the Help tab. Content is inline (the app
 * runs from file:// and CSP blocks fetch, so an external .md/.html cannot be
 * loaded). Also binds "?" / F1 to jump to Help, and offers a printable copy.
 *
 * Registers via window.PluginRegistry.
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "help",
        version: "1.0.0",
        description: "In-app user manual: every tab, the input formats it accepts, what it computes, exports, a glossary, and the limits of this demo build.",
        tab: "tab-help",
        icon: "fa-circle-question",
        tier: "Free",
        dependencies: []
    };

    // ── Manual content ───────────────────────────────────────────────────────
    // Each section: { id, title, html }. Rendered with a table of contents.

    const SECTIONS = [
        {
            id: "overview",
            title: "1. Overview",
            html: `
                <p>The <strong>FDOT Civil3D Standards Suite</strong> is a browser tool for surveyors and civil designers working to FDOT CADD standards. It runs entirely in your browser — there is no server, no upload, and no account. Files you drop in are read locally and never leave the machine.</p>
                <p>The app is organized into tabs on the left. Each tab is an independent plugin. The three groups are:</p>
                <ul>
                    <li><strong>Reference</strong> — Layer Standards, Pay Item Takeoff, Survey Description Keys, Block Libraries, Subassemblies, Sheet Standards, State Kit Inspector. Read-only catalogs.</li>
                    <li><strong>Tools</strong> — DXF Project Auditor, QC Checklist &amp; Traverse Auditor, Legal Description QC, PLSS Section Breakdown, Parcel → DXF, Sign QTO, SSA Hydrology. These take input and compute results you can export.</li>
                    <li><strong>Demo</strong> — Commercial SaaS Plans, Enterprise &amp; C3D Plugin, CMS Control Panel. These illustrate a product shell; see <a href="#limits" data-goto="limits">Section 8, Limits</a>.</li>
                </ul>
                <div class="help-note help-note--warn">
                    <strong>Demo build.</strong> Anything about licensing, sign-in, payments, PKI seal validation, or multi-tenant isolation is illustrative only and enforced by nothing. Do not rely on it. The calculation tools (closure, area, DXF audit, PLSS math) are real.
                </div>`
        },
        {
            id: "navigation",
            title: "2. Navigation & shortcuts",
            html: `
                <table class="help-table">
                    <thead><tr><th>Action</th><th>How</th></tr></thead>
                    <tbody>
                        <tr><td>Switch tab</td><td>Click a button in the left sidebar</td></tr>
                        <tr><td>Focus the global search</td><td><kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>⌘</kbd>+<kbd>K</kbd>)</td></tr>
                        <tr><td>Search layers / pay items / survey keys</td><td>Type in the header search box — it filters all three reference tables and jumps you to Layer Standards</td></tr>
                        <tr><td>Open this Help</td><td><kbd>?</kbd> or <kbd>F1</kbd> (when not typing in a field)</td></tr>
                        <tr><td>Light / dark theme</td><td>The sun/moon button in the header</td></tr>
                        <tr><td>Dismiss a dialog</td><td><kbd>Esc</kbd></td></tr>
                    </tbody>
                </table>`
        },
        {
            id: "dxf-auditor",
            title: "3.1  DXF Project Auditor",
            html: `
                <p><em>Purpose:</em> score an FDOT project DXF against CADD standards and flag geometry / scripting errors before submittal.</p>
                <p><strong>Input:</strong> drag an ASCII DXF onto the drop zone, click <em>Browse DXF File</em>, or load one of the three bundled samples (SR-50 corridor, Jacksonville bow-tie, non-compliant drainage). Binary DXF is not supported — save as ASCII/plain DXF from Civil 3D.</p>
                <p><strong>What it checks:</strong></p>
                <ul>
                    <li>Entities on <code>Layer 0</code> or <code>DEFPOINTS</code> (should be on FDOT discipline layers / <code>ROAD_NOPLOT_WORK</code>).</li>
                    <li>Layer names that do not start with an FDOT discipline prefix (<code>ROAD_ DRAIN_ SURV_ UTIL_ STR_ RW_ ENV_ TRAF_ LIGHT_</code>).</li>
                    <li>Layer color that does not match the FDOT standard ACI for that layer name.</li>
                    <li>Zero-length lines; unclosed boundary polylines (gap between first and last vertex on <code>SURV_BND*</code> / <code>RW_LINE*</code>).</li>
                    <li>Self-intersecting ("bow-tie") polylines — every non-adjacent segment pair is tested, including the closing segment of a closed polyline.</li>
                    <li>Coordinates outside the Florida State Plane NAD83 (US ft) envelope.</li>
                </ul>
                <p><strong>Output:</strong> a compliance score (100 minus weighted deductions), a layer / entity count, an itemized issue list by severity, a canvas preview of the geometry with the bow-tie marked, and an <em>auto-fix <code>.scr</code></em> — an AutoCAD script that runs <code>AUDIT</code>, resets non-standard layer colors to the FDOT ACI, purges, and overkills. <strong>Review the script in a scratch copy before running it on a production drawing.</strong></p>
                <p>Hover the preview to read live NAD83 coordinates. The R-Tree line reports how many entities were indexed and the parse time — informational only.</p>`
        },
        {
            id: "layers",
            title: "3.2  Layer Standards / Pay Items / Survey Keys",
            html: `
                <p><em>Purpose:</em> the FDOT 2026 reference catalogs.</p>
                <ul>
                    <li><strong>Layer Standards</strong> — name, color swatch + ACI, discipline, linetype, lineweight, plot status, description. Filter by discipline pill or the plot-status dropdown. The header search box also filters this table. Click the copy button to put a layer name on the clipboard.</li>
                    <li><strong>Pay Item Takeoff</strong> — FDOT pay item number, description, unit, category, and the Civil 3D layer the item maps to for quantity takeoff. Copy button copies the item number.</li>
                    <li><strong>Survey Description Keys</strong> — point-code pattern, style block, target layer, point group, description, and format string.</li>
                </ul>`
        },
        {
            id: "qc-traverse",
            title: "3.3  QC Checklist & Traverse Auditor",
            html: `
                <p><em>Purpose:</em> the pre-submittal QA checklist plus a real traverse calculator.</p>
                <p><strong>QC checklist</strong> — the 7-item Map Check specification (mathematical closure &amp; area, curve node labels PC/PT/PRC, surveyor certification, legal-description congruency, adjoining road / R-O-W, acreage annotation, and Map Check Report generation). Read the objective and pass/fail logic for each.</p>
                <p><strong>Traverse Auditor</strong> — paste bearing/distance calls, one per line (see <a href="#fmt-bearings" data-goto="fmt-bearings">Section 5, bearing formats</a>). Click <em>Run Bow-tie Verification</em>. It computes, per course, the latitude (N·cos az) and departure (E·sin az); sums them; the residual vector back to the POB is the <strong>linear misclosure</strong>. <strong>Precision ratio</strong> = perimeter ÷ misclosure; FDOT boundary / R-O-W work is expected to close to at least <strong>1:10,000</strong> (Rule 5J-17). It also plots the polygon and tests it for self-intersection, and reports the Shoelace area in acres.</p>
                <p><em>Generate Map Check Report</em> downloads a <code>.log</code> with the course list, closure statistics, area, self-intersection result, and a P,N,E,Z,D coordinate block (points from 500, "COGO POB / COGO P1 …").</p>`
        },
        {
            id: "linework",
            title: "3.4  Linework Editor",
            html: `
                <p><em>Purpose:</em> import linework from <strong>field data</strong>, check it for the common blunders, and correct it interactively. (Linework already inside a DXF is corrected in the DXF Project Auditor.)</p>
                <h4>Import</h4>
                <ul>
                    <li><strong>Point file</strong> — a P,N,E,Z,D coordinate file (comma, tab, or space delimited; Z optional). Set the coordinate order (P,N,E,… or P,E,N,…). Descriptions carry linework codes after the feature code, matching the Civil 3D Linework Code Set: <code>B</code> begin a figure, <code>C</code> continue an interrupted figure, <code>E</code> end it (no closing segment), <code>CLS</code> close it (draws the segment back to the start), plus an optional figure number (so <code>EP 2 B</code> starts a second EP line). Curve / rectangle / offset codes (<code>BC EC CIR OC RECT RT X H&lt;n&gt; V&lt;n&gt;</code>) are recognized and noted, but their segments are drawn as straight chords for now.</li>
                    <li><strong>Build linework</strong> — <em>By description code</em> connects points that share a code, in point-number order. <em>By figure</em> also splits on a trailing figure number (so <code>EP 1</code> and <code>EP 2</code> are separate lines). <em>Single line</em> connects every point in order.</li>
                    <li><strong>Bearing/distance calls</strong> — paste a traverse (one course per line) and <em>Import as calls</em>. This figure is treated as a traverse, so misclosure and precision are checked.</li>
                    <li><em>Load sample field data</em> gives you a set with a normal boundary, a re-shot POB, a duplicate shot, and a bow-tie to see the checks fire.</li>
                </ul>
                <h4>Checks</h4>
                <p>Run automatically on import and after every edit: coincident / zero-length courses, spike / backtrack vertices (a course that reverses on itself — usually a mis-sequenced shot), near-coincident vertices (merge candidates), self-intersection (bow-tie), traverse misclosure and precision (calls only), duplicate point numbers, coordinates outside the Florida State Plane envelope, and figures that cross each other. Each finding has <em>Go to</em> (select and pan to it) and, where possible, <em>Fix</em> (delete the vertex, merge, snap to POB, or auto-untangle a bow-tie).</p>
                <h4>Playback</h4>
                <p>The bar under the canvas walks the shots <strong>in field-collection order</strong>. Drag the slider, use ◀ ▶ (or the <kbd>←</kbd> <kbd>→</kbd> keys), or press play (<kbd>Space</kbd>) to animate. Points and courses up to the cursor are drawn bright, the rest dimmed, and the readout shows the current shot number, code, and coordinates — a fast way to find the exact shot where the linework goes wrong. Clicking a vertex moves the slider to it.</p>
                <h4>Editing</h4>
                <ul>
                    <li><strong>Navigate</strong> — scroll to zoom, drag the background to pan, <em>Fit</em> to reset.</li>
                    <li><strong>Vertex</strong> — click a red dot to select; drag to move (it snaps to a nearby vertex). The Selection panel gives numeric E/N, <em>Snap to nearest</em>, <em>Swap with next</em> (point-order bow-tie fix), and <em>Delete</em>. <kbd>Delete</kbd> removes the selected vertex.</li>
                    <li><strong>Course</strong> — click a segment to select; edit its bearing and distance numerically. <em>Traverse edit</em> (checkbox) shifts every downstream vertex with the course; otherwise only the far vertex moves. <em>Flip E/W</em> / <em>Flip N/S</em> fix a bearing entered in the wrong quadrant; <em>Insert vertex</em> splits the course.</li>
                    <li><strong>Figure</strong> — rename, set the target layer (defaulted from the description code and your active client template), toggle closed, reverse point order, delete, or add a new empty figure.</li>
                    <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo / redo.</li>
                </ul>
                <h4>Export</h4>
                <p><strong>DXF</strong> (closed/open polylines on the assigned layers), <strong>P,N,E,Z,D</strong> point file, <strong>Calls</strong> (bearing/distance per figure), and a <strong>Map Check</strong> report (perimeter, misclosure/precision for closed figures, area, self-intersection, and the full check list).</p>`
        },
        {
            id: "legal-desc",
            title: "3.5  Legal Description QC",
            html: `
                <p><em>Purpose:</em> parse a written metes-and-bounds legal description and check it, without hand-keying each call.</p>
                <p><strong>Input:</strong> paste the narrative text. The parser splits on <code>THENCE</code> / <code>COMMENCE</code> / <code>BEGINNING</code> and recognizes:</p>
                <ul>
                    <li><strong>Line calls</strong> — a bearing (compact <code>N 45°12'30" E</code> or spelled-out "North 45 degrees 12 minutes 30 seconds East") followed by a distance ("a distance of 150.00 feet", "150.00 feet", "150.00'").</li>
                    <li><strong>Curve calls</strong> — "radius of R feet", "arc distance of A feet", "chord bearing of …", "chord distance of C feet", "concave to the …", "central angle / delta …". If the chord distance is missing it is back-solved from R and A (chord = 2R·sin(Δ/2)).</li>
                </ul>
                <p><strong>Checks (from the BoundaryQC rule set):</strong> fewer than 3 calls; non-positive line distance; non-positive curve radius/arc/chord; unparseable chord bearing; <strong>curve geometry inconsistency</strong> (computed chord vs stated chord differs by &gt; 0.1 ft — usually a swapped radius/arc or a delta in the wrong units); a <code>LESS AND EXCEPT</code> clause (computed acreage is then the <em>gross</em> area only); closure failure or sub-1:10,000 precision; and self-intersection of the plotted boundary.</p>
                <p><strong>Output:</strong> a parsed-calls table, closure + Shoelace area, an issue list, and two downloads — a <em>P,N,E,Z,D</em> coordinate file and a <em>Map Check Report</em>.</p>`
        },
        {
            id: "plss",
            title: "3.6  PLSS Section Breakdown",
            html: `
                <p><em>Purpose:</em> resolve an aliquot ("quarter-quarter") description into a rectangle, dimensions, and acreage.</p>
                <p><strong>Input:</strong> an aliquot description, e.g. <code>S 1/2 of the SE 1/4 of the NE 1/4 of Section 8, Township 7 North, Range 7 East</code>. Put one parcel per line for a multi-parcel description. Spelled-out compass words ("Northeast 1/4") and abbreviations ("NE 1/4") both work.</p>
                <p><strong>How it computes:</strong> starting from an ideal <strong>5,280 ft × 5,280 ft</strong> section, it applies each fraction from the outermost (largest) inward — a quarter takes one corner of the current box, a half splits it on the center line. It reports the resulting rectangle's E-W and N-S dimensions, the computed area (width × height ÷ 43,560), the ideal aliquot acreage from the standard table (640 / 160 / 40 / 10 / 2.5 …), and a mismatch flag against any stated acreage.</p>
                <p>The four sides are true cardinal bearings (N 00°, N 90° E, etc.) and an ideal section closes exactly.</p>
                <div class="help-note help-note--warn">
                    <strong>Qualified descriptions.</strong> Text like "That part of … which lies northerly of …", "within 50 feet of the Quarter Section line", or "EXCEPTING any part …" describes an irregular strip or trimmed parcel, <em>not</em> the full aliquot rectangle. The tool detects this and warns you; the rectangle it shows is only the gross parent container.
                </div>
                <p><strong>Output:</strong> per-parcel cards, a P,N,E,Z,D file, and a breakdown report.</p>`
        },
        {
            id: "plat2dxf",
            title: "3.7  Parcel → DXF / Points / COGO",
            html: `
                <p><em>Purpose:</em> turn a bearing/distance call list into CAD-ready files. <strong>There is no image tracing in this build</strong> — the earlier "computer vision" wording was a mockup.</p>
                <p><strong>Input:</strong> a call list (one <code>N 45-12-30 E 150.00</code> per line) in the box, or leave it empty to use the bundled sample parcel. Click <em>Build Parcel DXF / Points</em>.</p>
                <p><strong>Output (three downloads):</strong></p>
                <ul>
                    <li><code>parcel_boundary.dxf</code> — a valid ASCII DXF: a closed LWPOLYLINE on <code>AI-PROP-BNDY</code> plus bearing/distance and point labels on <code>AI-NODE-TEXT</code>.</li>
                    <li><code>parcel_coordinates.txt</code> — P,N,E,Z,D point file, points from 500.</li>
                    <li><code>parcel_cogo.scr</code> — an AutoCAD script that draws the boundary polyline from the calls.</li>
                </ul>`
        },
        {
            id: "signs-ssa",
            title: "3.8  Sign QTO & SSA Hydrology",
            html: `
                <p><strong>Sign Assemblies &amp; QTO</strong> — the FDOT sign assembly catalog (code, size, block, target pay item). The calculator takes a sign width and height (inches), computes the panel area in square feet, and classifies the pay item: ≤ 12 SF → <code>0700-1-11</code>, 12–20 SF → <code>0700-1-12</code>, &gt; 20 SF → <code>0700-1-14</code>.</p>
                <p><strong>SSA Hydrology &amp; IDF</strong> — pick one of the 11 FDOT IDF zones, enter drainage area (acres), runoff coefficient C, and time of concentration t<sub>c</sub> (minutes). It computes rainfall intensity i = a / (t<sub>c</sub> + b)<sup>c</sup> and peak discharge <strong>Q = C·i·A</strong> (cfs). The trench sizer estimates exfiltration trench length from treatment volume and the hydraulic conductivity k (FDOT Drainage Manual Ch. 7).</p>`
        },
        {
            id: "reference-tabs",
            title: "3.9  Block Libraries / Subassemblies / Sheet Standards / State Kit Inspector",
            html: `
                <p>Static reference cards:</p>
                <ul>
                    <li><strong>Block Libraries</strong> — FDOT block name, source drawing, discipline, target layer, associated pay item.</li>
                    <li><strong>Subassemblies &amp; PKT</strong> — corridor subassembly reference with the input parameters each one exposes.</li>
                    <li><strong>Sheet Standards &amp; DWT</strong> — sheet template name, title, layout size, and viewport plot scale.</li>
                    <li><strong>State Kit Inspector</strong> — the reverse-engineered FDOT Civil 3D State Kit folder tree.</li>
                </ul>`
        },
        {
            id: "accounts",
            title: "4. Accounts, sign-in & client templates (CMS tab)",
            html: `
                <h4>Sign in</h4>
                <p>Open the CMS Control Panel tab (or <em>Switch Account</em>). Sign in with an email + password. Passwords are salted and hashed with <strong>PBKDF2-SHA-256</strong> (SubtleCrypto) — the plaintext is never stored. After 5 wrong attempts the account is locked for 60 seconds. A session lasts 8 hours, or 30 days with <em>Keep me signed in</em>. Sign out from the header.</p>
                <p>The three bundled demo accounts all use the password <code>Fdot2026!</code>:</p>
                <ul>
                    <li><code>jane.doe@kimley-horn.com</code> — PSM Surveyor</li>
                    <li><code>robert.vance@kimley-horn.com</code> — PE Engineer</li>
                    <li><code>sarah.c@kimley-horn.com</code> — Firm Admin</li>
                </ul>
                <p><em>Create Account</em> registers a new user (min 8-char password with a letter and a digit). <em>Change password</em> is on the CMS profile card. The team directory's <em>Switch</em> button changes the active account within the workspace without re-entering a password — it is a convenience, and every switch is written to the audit log.</p>
                <h4>Client master templates</h4>
                <p>Each user keeps their own set of <strong>master templates</strong> — one per client. A template stores the defaults you use for that client: discipline, IDF zone, sheet template (DWT), closure pass ratio, FPID prefix, county, and district.</p>
                <ul>
                    <li><strong>Create</strong> — <em>New Template</em> opens the form. Fill in at least a client name and Save.</li>
                    <li><strong>Activate</strong> — the <em>Active</em> dropdown at the top of the panel selects which template is current. The active client shows as a badge on your profile and drives defaults elsewhere: the SSA Hydrology tab pre-selects the template's IDF zone, and the Traverse Auditor / Legal Description QC use its closure pass ratio instead of the default 1:10,000.</li>
                    <li><strong>Edit / Delete</strong> — buttons on each row. Deleting the active template moves "active" to the next one.</li>
                </ul>
                <h4>License limit</h4>
                <p>The <strong>Free</strong> and <strong>Pro</strong> plans allow <strong>5 templates per user</strong>. Creating a sixth is blocked with an upgrade prompt. <strong>Firm</strong> ($199/mo) raises the cap to 25; <strong>Enterprise</strong> ($499/mo) is unlimited. Change the plan from the Commercial SaaS Plans tab (demo checkout).</p>
                <div class="help-note help-note--warn">
                    <strong>All of this runs in your browser.</strong> The password hashing, sessions, lockout, per-user isolation, and the template limit are real code, but there is no server — a determined user can edit <code>localStorage</code> from devtools and bypass any of it. Treat it as a UX model, not a security boundary.
                </div>`
        },
        {
            id: "fmt",
            title: "5. Input format reference",
            html: `
                <h4 id="fmt-bearings" data-sec="fmt-bearings">Bearings</h4>
                <p>Quadrant bearings only. All of these parse to the same course:</p>
                <ul>
                    <li><code>N 45-12-30 E 150.00</code></li>
                    <li><code>N45°12'30"E 150'</code></li>
                    <li><code>North 45 degrees 12 minutes 30 seconds East, a distance of 150.00 feet</code></li>
                </ul>
                <p>Quadrant is <code>N|S</code> then <code>E|W</code>. Minutes and seconds are optional (<code>N 45 E 150</code> works). Seconds may be decimal. The degree mark can be any non-digit character (handles Word / OCR artifacts).</p>
                <h4>Call lists (Traverse Auditor, Parcel → DXF)</h4>
                <p>One course per line: <code>&lt;bearing&gt; &lt;distance&gt;</code>. The distance is the last number on the line; "feet"/"ft"/"'" are optional.</p>
                <h4>PLSS aliquot descriptions</h4>
                <p>Fractions separated by "of", largest last, then the section header:</p>
                <p><code>N 1/2 of the SW 1/4 of Section 14, Township 2 South, Range 27 East</code></p>
                <p>Quarters: <code>NE NW SE SW</code> (+ "1/4" or "quarter"). Halves: <code>N S E W</code> (+ "1/2" or "half"). Header: "Section N, Township N N/S, Range N E/W" or "T N N., R N E.".</p>
                <h4>DXF</h4>
                <p>ASCII (plain) DXF, R12 or later. Binary DXF is rejected. The auditor reads the LAYER table and LINE / LWPOLYLINE / ARC / CIRCLE / TEXT / MTEXT / INSERT / POINT entities.</p>`
        },
        {
            id: "exports",
            title: "6. Exports",
            html: `
                <table class="help-table">
                    <thead><tr><th>File</th><th>From</th><th>Contents</th></tr></thead>
                    <tbody>
                        <tr><td><code>*_fix.scr</code></td><td>DXF Auditor</td><td>AutoCAD script: AUDIT, layer-color resets, PURGE, OVERKILL, QSAVE</td></tr>
                        <tr><td><code>FDOT_EDG_Signed_Manifest.json</code></td><td>DXF Auditor</td><td>SHA-256 file digest manifest (demo signing)</td></tr>
                        <tr><td><code>*_mapcheck.log</code></td><td>Traverse, Legal Description</td><td>Courses, closure &amp; area, self-intersection, P,N,E,Z,D block</td></tr>
                        <tr><td><code>*_coordinates.txt</code></td><td>Traverse, Legal Description, PLSS, Parcel→DXF</td><td>P,N,E,Z,D point file — Point,Northing,Easting,Elev,Desc; points from 500; "COGO POB", "COGO P1", …</td></tr>
                        <tr><td><code>parcel_boundary.dxf</code></td><td>Parcel → DXF</td><td>Closed LWPOLYLINE + labels on AI-PROP-BNDY / AI-NODE-TEXT</td></tr>
                        <tr><td><code>parcel_cogo.scr</code></td><td>Parcel → DXF</td><td>AutoCAD PLINE script from the calls</td></tr>
                        <tr><td><code>plss_breakdown_report.log</code></td><td>PLSS</td><td>Per-parcel dimensions, acreage, courses, coordinates</td></tr>
                    </tbody>
                </table>`
        },
        {
            id: "glossary",
            title: "7. Glossary",
            html: `
                <dl class="help-dl">
                    <dt>Aliquot part</dt><dd>A PLSS subdivision by repeated halving/quartering of a section (e.g. "SW 1/4 of the NE 1/4").</dd>
                    <dt>Azimuth</dt><dd>Direction measured clockwise from north, 0–360°. Used internally; displayed as a quadrant bearing.</dd>
                    <dt>Bow-tie</dt><dd>A polygon whose boundary crosses itself — a topological error, usually from an inverted bearing quadrant or an out-of-order call.</dd>
                    <dt>Departure</dt><dd>The east–west component of a course: distance × sin(azimuth).</dd>
                    <dt>Latitude</dt><dd>The north–south component of a course: distance × cos(azimuth).</dd>
                    <dt>Linear misclosure</dt><dd>The straight-line gap between the computed end of a traverse and its point of beginning.</dd>
                    <dt>P,N,E,Z,D</dt><dd>Point file format: Point number, Northing, Easting, Z (elevation), Description.</dd>
                    <dt>PC / PT / PRC / PCC</dt><dd>Point of Curvature / Tangency / Reverse Curvature / Compound Curvature — curve node labels expected on a plat.</dd>
                    <dt>POB</dt><dd>Point of Beginning.</dd>
                    <dt>Precision ratio</dt><dd>Perimeter ÷ linear misclosure, written 1:X. Higher is better; ≥ 1:10,000 is survey grade for boundary work.</dd>
                    <dt>Shoelace formula</dt><dd>Polygon area from vertex coordinates: ½·|Σ (x_j + x_i)(y_j − y_i)|.</dd>
                </dl>`
        },
        {
            id: "limits",
            title: "8. Limits of this build",
            html: `
                <ul>
                    <li><strong>No server.</strong> Sign-in uses real salted PBKDF2 password hashing, sessions, and lockout, and the template limit is enforced in code — but it all lives in <code>localStorage</code> on this device and can be bypassed from devtools. Subscription tier is just a stored value, "Stripe webhooks" and PKI seal validation are simulated, and the CMS audit log is a local hash chain (tamper-evident for in-place edits only — not an external notarization).</li>
                    <li><strong>The C# Civil 3D add-in</strong> in <code>plugins/civil3d-addin/</code> is a licensing/ribbon scaffold. The audit, layer-purge, and manifest commands are stubs; they do not read the drawing.</li>
                    <li><strong>No image / plat tracing.</strong> Parcel → DXF works from typed calls, not scanned plats.</li>
                    <li><strong>Ideal PLSS only.</strong> The breakdown assumes a perfect 5,280 ft section. Real retracement must honor the GLO plat, found corners, and fractional lots.</li>
                    <li><strong>Curve traverse legs</strong> are approximated by their chord when computing closure and area.</li>
                    <li>The bundled reference data (layers, pay items, keys) is a representative subset, not the complete FDOT release.</li>
                </ul>
                <p>Reference: FDOT CADD Manual Topic No. 625-050-001; F.A.C. Rules 61G15-23.004 (PE) and 5J-17.062 (PSM). This tool does not replace professional review.</p>`
        }
    ];

    const STYLE_CSS = `
        .help-wrap { max-width: 60rem; }
        .help-wrap h2 { font-size: 1.3rem; margin-bottom: 0.25rem; }
        .help-wrap h3 { font-size: 1rem; margin: 1.5rem 0 0.5rem; color: var(--primary); border-top: 1px solid var(--glass-border); padding-top: 1rem; }
        .help-wrap h4 { font-size: 0.9rem; margin: 1rem 0 0.35rem; color: var(--accent); }
        .help-wrap p, .help-wrap li, .help-wrap dd { font-size: 0.88rem; line-height: 1.55; color: var(--text-secondary); }
        .help-wrap ul { margin: 0.4rem 0 0.4rem 1.1rem; }
        .help-wrap li { margin: 0.2rem 0; }
        .help-wrap code { font-family: var(--font-mono); font-size: 0.82em; background: var(--bg-secondary); padding: 0.1em 0.35em; border-radius: 3px; color: var(--accent); }
        .help-wrap kbd { font-family: var(--font-mono); font-size: 0.78em; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-bottom-width: 2px; border-radius: 4px; padding: 0.1em 0.4em; }
        .help-wrap a { color: var(--primary); }
        .help-toc { background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.9rem 1.1rem; margin: 1rem 0 1.5rem; columns: 2; column-gap: 2rem; }
        .help-toc a { display: block; font-size: 0.82rem; padding: 0.15rem 0; }
        .help-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.82rem; }
        .help-table th, .help-table td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--glass-border); vertical-align: top; }
        .help-table th { color: var(--text-muted); text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.03em; }
        .help-dl dt { font-weight: 700; color: var(--text-main); font-size: 0.85rem; margin-top: 0.5rem; }
        .help-dl dd { margin: 0.1rem 0 0 0; }
        .help-note { border-left: 3px solid var(--primary); background: rgba(2,132,199,0.08); padding: 0.7rem 0.9rem; border-radius: var(--radius-sm); margin: 0.8rem 0; font-size: 0.84rem; }
        .help-note--warn { border-left-color: var(--warning); background: rgba(245,158,11,0.1); }`;

    function ensureStyle() {
        if (document.getElementById("help-plugin-style")) return;
        const el = document.createElement("style");
        el.id = "help-plugin-style";
        el.textContent = STYLE_CSS;   // static, author-controlled CSS — safe to inject directly
        document.head.appendChild(el);
    }

    function renderInto(rootId) {
        ensureStyle();
        const root = document.getElementById(rootId);
        if (!root) return;
        // TOC + headings use data-* attributes (always preserved by the sanitizer) so
        // in-pane navigation does not depend on id / href#fragment surviving.
        const toc = SECTIONS.map(s => `<a href="#${s.id}" data-goto="${s.id}">${s.title}</a>`).join("");
        const body = SECTIONS.map(s => `<section><h3 id="${s.id}" data-sec="${s.id}">${s.title}</h3>${s.html}</section>`).join("");
        window.setSafeHTML(root, `
            <div class="glass-panel help-wrap" style="padding:1.5rem;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap;">
                    <div>
                        <h2><i class="fa-solid fa-circle-question" style="color:var(--primary);"></i> User Manual</h2>
                        <p style="font-size:0.85rem; color:var(--text-muted);">FDOT Civil3D Standards Suite — v2.6.0. Press <kbd>?</kbd> anywhere to return here.</p>
                    </div>
                    <button class="btn btn-secondary" data-help-print><i class="fa-solid fa-print"></i> Print / Save PDF</button>
                </div>
                <div class="help-toc">${toc}</div>
                ${body}
            </div>`);

        root.querySelector("[data-help-print]")?.addEventListener("click", () => window.print());
        root.querySelectorAll("a[data-goto]").forEach(a => {
            a.addEventListener("click", e => {
                e.preventDefault();
                const el = root.querySelector('[data-sec="' + a.getAttribute("data-goto") + '"]');
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }

    const Plugin = {
        init() {
            renderInto("help-root");
        },
        setupEvents() {
            // "?" or F1 jumps to the Help tab (unless typing in a field).
            window.addEventListener("keydown", e => {
                const tag = (e.target.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
                if (e.key === "?" || e.key === "F1") {
                    e.preventDefault();
                    document.querySelector('.nav-btn[data-tab="tab-help"]')?.click();
                }
            });
        },
        onTabActivate() {
            renderInto("help-root");
        }
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
})();
