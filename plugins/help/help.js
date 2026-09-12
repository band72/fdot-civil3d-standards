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
                    <li><strong>Tools</strong> — DXF Project Auditor, QC Checklist &amp; Traverse Auditor, Legal Description QC, PLSS Section Breakdown, Parcel → DXF, Sign QTO, SSA Hydrology, Linework Editor, Electronic Field Book, LandXML Studio, Multi-Sheet Batch Auditor, Centralized Reports Hub, System Diagnostics, and JEA As-Built Standards 2024. These take input and compute results you can export.</li>
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
            id: "stdn-compare",
            title: "3.1  Start page — Standards Compare + Auto-Correct",
            html: `
                <p><em>Purpose:</em> check a drawing against a drafting standard, diff its geometry against a reference drawing, and auto-correct the deficiencies that are safe to fix. Runs entirely in the browser — nothing is uploaded. (This replaces the older layer-table-only "Template Compare".)</p>
                <h4>Check mode</h4>
                <p>Drop the <strong>drawing to check</strong>, then supply one or more of:</p>
                <ul>
                    <li><strong>A standard</strong> — the built-in <em>FDOT 2026 Layer Standard</em>, another built-in, or your own uploaded <code>.json</code> spec (layers, colours, linetypes, naming regex, required/prohibited layers, text-style whitelist, units, ByLayer policy). Pick <em>(none)</em> for a geometry-only diff.</li>
                    <li><strong>A master template DXF</strong> — its LAYER / LTYPE / STYLE tables and BLOCKS <em>become</em> the rules; merged on top of the JSON standard if you supply both.</li>
                    <li><strong>A reference drawing DXF</strong> — a drawing with real design content to tolerance-diff the geometry against (added / removed / modified entities, with a pan/zoom SVG overlay: gray = unchanged, blue = added, red = removed, orange = modified).</li>
                </ul>
                <p>The result shows a pass/fail verdict, a severity-filtered <strong>violations</strong> table, a geometry <strong>diff</strong> breakdown, and a downloadable <strong>HTML</strong> or <strong>Markdown</strong> report.</p>
                <h4>Auto-correct mode</h4>
                <p>Give a <strong>target</strong> + a <strong>master template</strong>. The tool auto-fixes what's safe — wrong layer colours / linetypes / lineweights, missing layers / linetypes / styles copied from the master, stray entity colour overrides reverted to ByLayer — and hands back a corrected <code>.dxf</code>. Renames, prohibited-layer removal, unit changes and (opt-in) missing blocks are listed for manual review, never guessed. ByBlock colour (code 0) is left untouched — it's a legitimate mode, not an error.</p>`
        },
        {
            id: "dxf-auditor",
            title: "3.2  DXF Project Auditor",
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
            title: "3.3  Layer Standards / Pay Items / Survey Keys",
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
            title: "3.4  QC Checklist & Traverse Auditor",
            html: `
                <p><em>Purpose:</em> the pre-submittal QA checklist plus a real traverse calculator.</p>
                <p><strong>QC checklist</strong> — the 7-item Map Check specification (mathematical closure &amp; area, curve node labels PC/PT/PRC, surveyor certification, legal-description congruency, adjoining road / R-O-W, acreage annotation, and Map Check Report generation). Read the objective and pass/fail logic for each.</p>
                <p><strong>Traverse Auditor</strong> — paste bearing/distance calls, one per line (see <a href="#fmt-bearings" data-goto="fmt-bearings">Section 5, bearing formats</a>). Click <em>Run Bow-tie Verification</em>. It computes, per course, the latitude (N·cos az) and departure (E·sin az); sums them; the residual vector back to the POB is the <strong>linear misclosure</strong>. <strong>Precision ratio</strong> = perimeter ÷ misclosure; FDOT boundary / R-O-W work is expected to close to at least <strong>1:10,000</strong> (Rule 5J-17). It also plots the polygon and tests it for self-intersection, and reports the Shoelace area in acres.</p>
                <p><em>Generate Map Check Report</em> downloads a <code>.log</code> with the course list, closure statistics, area, self-intersection result, and a P,N,E,Z,D coordinate block (points from 500, "COGO POB / COGO P1 …").</p>`
        },
        {
            id: "linework",
            title: "3.5  Linework Editor",
            html: `
                <p><em>Purpose:</em> import linework from <strong>field data</strong>, check it for the common blunders, and correct it interactively. (Linework already inside a DXF is corrected in the DXF Project Auditor.)</p>
                <h4>Import</h4>
                <ul>
                    <li><strong>File Upload &amp; Drag-and-Drop</strong> — Drop or browse point coordinate files (<code>.txt</code>, <code>.csv</code>, <code>.pts</code>, <code>.pnt</code>, <code>.dat</code>) or bearing/distance call lists directly into the upload dropzone. Supports quote-aware CSV parsing (preserving commas in descriptions such as <code>"CURB B, R10"</code>) and automatic header detection (e.g. <code>Point,Northing,Easting,...</code>). Malformed or corrupt rows are flagged in the interactive diagnostics panel and logged with line numbers and reasons to the <strong>System Logs</strong> plugin.</li>
                    <li><strong>Point file</strong> — a P,N,E,Z,D coordinate file (comma, tab, or space delimited; Z optional). Set the coordinate order (P,N,E,… or P,E,N,…). Descriptions carry linework codes after the feature code, matching the Civil 3D Linework Code Set: <code>B</code> begin a figure, <code>C</code> continue an interrupted figure, <code>E</code> end it (no closing segment), <code>CLS</code> close it (draws the segment back to the start), plus an optional figure number (so <code>EP 2 B</code> starts a second EP line). <strong>Curve codes are resolved into real geometry:</strong> <code>BC</code>…<code>EC</code> (or <code>PC</code>…<code>PT</code>) fits a circular arc through the bracketed shots — reported with radius and fit residual, exported as a DXF bulge; <code>CIR</code> makes the whole figure a circle from 2 shots (centre + radius) or 3 shots (through-points); <code>RECT</code> completes a rectangle from 3 shots. The remaining line codes (<code>RT</code> right-turn, <code>X</code> extend, <code>RPN</code>/<code>CPN</code> recall/connect, <code>H&lt;n&gt;</code>/<code>V&lt;n&gt;</code>/<code>SO</code> offsets) are recognized and listed but must be applied in CAD.</li>
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
                    <li><strong>Navigate</strong> — use <em>Zoom In (+)</em>, <em>Zoom Out (-)</em>, and <em>Fit (F)</em> buttons (or floating on-canvas controls), mouse wheel to zoom, drag background to pan, <kbd>+</kbd> / <kbd>-</kbd> / <kbd>F</kbd> shortcut keys.</li>
                    <li><strong>Vertex</strong> — click a red dot to select; drag to move (it snaps to a nearby vertex). The Selection panel gives numeric E/N, <em>Snap to nearest</em>, <em>Swap with next</em> (point-order bow-tie fix), and <em>Delete</em>. <kbd>Delete</kbd> removes the selected vertex.</li>
                    <li><strong>Course</strong> — click a segment to select; edit its bearing and distance numerically. <em>Traverse edit</em> (checkbox) shifts every downstream vertex with the course; otherwise only the far vertex moves. <em>Flip E/W</em> / <em>Flip N/S</em> fix a bearing entered in the wrong quadrant; <em>Insert vertex</em> splits the course.</li>
                    <li><strong>Figure</strong> — rename, set the target layer (defaulted from the description code and your active client template), toggle closed, reverse point order, delete, or add a new empty figure.</li>
                    <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo / redo.</li>
                </ul>
                <h4>Export</h4>
                <p><strong>DXF</strong> (closed/open polylines on the assigned layers), <strong>P,N,E,Z,D</strong> point file, <strong>Linework Script (.fbk)</strong> (Civil 3D Survey Command Language batch script with <code>FIG BEGIN/PT/CLOSE/END</code> and <code>NEZ</code>), <strong>Calls</strong> (bearing/distance per figure), and a <strong>Map Check</strong> report (perimeter, misclosure/precision for closed figures, area, self-intersection, and the full check list).</p>`
        },
        {
            id: "survey-cmd-lang",
            title: "3.6  Civil 3D Survey Command Language & Field Book Reference",
            html: `
                <p><em>Purpose:</em> reference and export guide for the text-based command interpreter built into <strong>Autodesk Civil 3D</strong> (Survey Toolspace &gt; Survey Database &gt; Networks &gt; Survey Command Window) and Autodesk Field Book (<code>.fbk</code>) files.</p>
                <h4>Core Syntax &amp; Bearings</h4>
                <ul>
                    <li><strong>Quadrant Bearings:</strong> <code>1 = NE</code>, <code>2 = SE</code>, <code>3 = SW</code>, <code>4 = NW</code>. Angles are entered in <code>DD.MMSS</code> notation (e.g. <code>1 45.3020</code> = N 45°30'20" E).</li>
                    <li><strong>Point Creation (COGO):</strong>
                        <code>NEZ [pt] [N] [E] [elev] (desc)</code> direct coordinate insertion;
                        <code>BD [pt] [quad] [bearing] [dist] (desc)</code> bearing &amp; distance from station;
                        <code>AD [pt] [angle] [dist]</code> angle &amp; distance;
                        <code>AZ [pt] [azimuth] [dist]</code> azimuth &amp; distance.
                    </li>
                    <li><strong>Figures &amp; Linework:</strong>
                        <code>FIG BEGIN [name]</code> starts a figure;
                        <code>FIG PT [pt]</code> appends a vertex;
                        <code>FIG CLOSE</code> closes back to POB;
                        <code>FIG END</code> finishes the figure.
                    </li>
                    <li><strong>Field Book Observations (.FBK):</strong>
                        <code>UNIT FOOT DMS</code> sets units;
                        <code>STN [pt] [HI]</code> occupies instrument station;
                        <code>BS [pt] [azimuth]</code> sets backsight reference;
                        <code>FS [pt] [angle] [dist] [zenith] [rod]</code> foresight traverse shot;
                        <code>SS [pt] [angle] [dist] [zenith] [rod]</code> sideshot topography.
                    </li>
                    <li><strong>Traverse &amp; Adjustments:</strong>
                        <code>TRV OPEN [name]</code>, <code>TRV COMP [name]</code> (misclosure calculation), <code>COMPASS</code> (Bowditch balance per FL Rule 5J-17), <code>TRANSIT</code>, <code>CRANDALL</code>.
                    </li>
                </ul>
                <p>The suite automatically generates production-ready <code>.fbk</code> scripts from the <strong>Linework Editor</strong>, <strong>Legal Description QC</strong>, and <strong>Traverse &amp; COGO Auditor</strong> tabs.</p>`
        },
        {
            id: "efbk-doc",
            title: "3.7  Electronic Field Book (EFB) & Chain Lists",
            html: `
                <p><em>Purpose:</em> models the planimetric surveying architecture specified in the <strong>FDOT EFB User’s Handbook</strong> and <strong>EFBP Processing Handbook</strong>. Bridges FDOT raw field data collector points and chain lists directly into Civil 3D figures.</p>
                <h4>Point Format (9 Columns)</h4>
                <p><code>NAME, N, E, Z, GEOM, ATTR, ZONE, REFNAME, FEATURE</code></p>
                <ul>
                    <li><strong>NAME:</strong> Prefix + trailing numeric suffix (e.g. <code>TAN19</code>, <code>A1</code>).</li>
                    <li><strong>GEOM:</strong> Point geometry flag: <code>P</code> (Point / straight) or <code>C</code> (Curve).</li>
                    <li><strong>ATTR:</strong> Optional attribute (per the EFB handbook): <code>G</code> (Ground — elevation is on the surface), <code>X</code> (Cross-section / HVD — station+offset to a baseline), <code>F</code> (Feature — planimetric only, elevation excluded from the TIN/surface model), <code>U</code> (User — not surface data, has a project-specific meaning e.g. utilities).</li>
                    <li><strong>ZONE:</strong> Optional elevation zone (1–9).</li>
                    <li><strong>REFNAME:</strong> Optional reference station name (leading period <code>.</code> marks a newly established control monument).</li>
                    <li><strong>FEATURE:</strong> Code and optional description separated by a dash (e.g. <code>TREE-48" OAK</code>, or <code>99-TEXT ONLY</code>).</li>
                </ul>
                <h4>Chain-List Mini-Language</h4>
                <ul>
                    <li><code>LOT1, BND, A1-4, A1</code> connects points A1 through A4 in sequence, closing back to A1.</li>
                    <li><code>-TAN</code> reverses the point numbering order.</li>
                    <li>Empty tokens (<code>,,</code>) break chains into separate disconnected runs.</li>
                </ul>
                <h4>P/C Curve Rules</h4>
                <ul>
                    <li><strong>Isolated C point:</strong> Solves the unique circular arc tangent to the two exterior back/ahead lines defined by bounding P points.</li>
                    <li><strong>3 C points:</strong> Standard circular arc (PC, POC, PT).</li>
                    <li><strong>4+ C points:</strong> Smooth continuous spline, densified via Catmull-Rom interpolation for DXF/CAD compatibility.</li>
                </ul>
                <p>Outputs can be exported directly as DXF, Civil 3D survey batch scripts, or sent into the Linework Editor for interactive visual verification.</p>`
        },
        {
            id: "legal-desc",
            title: "3.8  Legal Description QC",
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
            title: "3.9  PLSS Section Breakdown",
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
            title: "3.10  Parcel → DXF / Points / COGO",
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
            title: "3.11  Sign QTO & SSA Hydrology",
            html: `
                <p><strong>Sign Assemblies &amp; QTO</strong> — the FDOT sign assembly catalog (code, size, block, target pay item). The calculator takes a sign width and height (inches), computes the panel area in square feet, and classifies the pay item: ≤ 12 SF → <code>0700-1-11</code>, 12–20 SF → <code>0700-1-12</code>, &gt; 20 SF → <code>0700-1-14</code>.</p>
                <p><strong>SSA Hydrology &amp; IDF</strong> — pick one of the 11 FDOT IDF zones, enter drainage area (acres), runoff coefficient C, and time of concentration t<sub>c</sub> (minutes). It computes rainfall intensity i = a / (t<sub>c</sub> + b)<sup>c</sup> and peak discharge <strong>Q = C·i·A</strong> (cfs). The trench sizer estimates exfiltration trench length from treatment volume and the hydraulic conductivity k (FDOT Drainage Manual Ch. 7).</p>`
        },
        {
            id: "reference-tabs",
            title: "3.12  Block Libraries / Subassemblies / Sheet Standards / State Kit Inspector",
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
            id: "landxml-doc",
            title: "3.13  LandXML Studio & Interop",
            html: `
                <p><em>Purpose:</em> ingest, validate, visualize, and generate schema-compliant <strong>LandXML 1.0, 1.1, 1.2, and 2.0</strong> geometry files for parcels, alignments, surfaces, and survey points without requiring Autodesk Civil 3D.</p>
                <h4>Capabilities</h4>
                <ul>
                    <li><strong>Parsing:</strong> Extracts coordinate metadata (EPSG 2236 Florida State Plane, US Survey Feet), <code>&lt;CgPoints&gt;</code>, <code>&lt;Parcels&gt;</code> (with line and circular curve geometry, computed vs stated acreage), <code>&lt;Alignments&gt;</code> (centerline curves and tangents), and <code>&lt;Surfaces&gt;</code> (TIN vertices and faces).</li>
                    <li><strong>2D Interactive Canvas:</strong> Renders boundary parcel polylines (blue), highway alignment centerlines (amber), and survey points (red) in real-time with state plane coordinate bounding boxes.</li>
                    <li><strong>Linework Editor Bridge:</strong> Click <em>Send to Linework Editor</em> to instantly convert LandXML parcels into editable survey figures with preserved point names and circular arc bulges.</li>
                    <li><strong>Export:</strong> Generate strict LandXML 1.2 XML files directly from Linework Editor models, EFB chains, or imported survey traverses.</li>
                </ul>`
        },
        {
            id: "batchprocess-doc",
            title: "3.14  Multi-Sheet Batch Project Auditor",
            html: `
                <p><em>Purpose:</em> audit entire electronic submittal packages of 10 to 100+ DXF and LandXML drawings simultaneously against FDOT CADD standards.</p>
                <h4>Batch Workflow</h4>
                <ul>
                    <li><strong>Multi-File Ingestion:</strong> Drag and drop multiple drawing files simultaneously, or browse an entire submittal folder tree. Click <em>Load Demo Project Batch</em> for an instant 4-sheet sample audit.</li>
                    <li><strong>Compliance Matrix:</strong> Evaluates every sheet in parallel for layer naming/color compliance, zero-length entities, unclosed boundary gaps, bow-tie self-intersections, and off-grid coordinates. Categorizes sheets into <strong>PASS</strong>, <strong>WARN</strong>, or <strong>FAIL</strong>.</li>
                    <li><strong>Project Grade &amp; Verdict:</strong> Aggregates sheet metrics into an overall project compliance score (%) with readiness verdicts (<em>SUBMITTAL READY</em>, <em>REVISION REQUIRED</em>, or <em>SUBMITTAL BLOCKED</em>).</li>
                    <li><strong>Consolidated Deliverables:</strong> Download a master AutoCAD batch script (<code>fdot_batch_fix.scr</code>) that automatically executes <code>AUDIT</code>, layer color normalization, <code>PURGE</code>, and <code>OVERKILL</code> across all project drawings, plus printable HTML and Markdown Master Submittal Reports.</li>
                </ul>`
        },
        {
            id: "reports-doc",
            title: "3.15  Centralized Reports Hub & Submittal QA/QC Repository",
            html: `
                <p><em>Purpose:</em> unified central repository for all engineering and survey QA/QC audit logs, closure computations, mapchecks, and compliance scorecards generated across the entire FDOT suite.</p>
                <h4>Unified Standards & Automation</h4>
                <ul>
                    <li><strong>Automated Ingestion:</strong> Whenever you run a Traverse closure, Legal Description mapcheck, Linework boundary audit, PLSS breakdown, DXF Project Audit, Standards baseline comparison, or Batch submittal, the generated report automatically registers with the Reports Hub.</li>
                    <li><strong>FDOT Standard Headers:</strong> Every report is formatted with official FDOT metadata: Project, State Road / County, FPID, Surveyor / Engineer, Discipline, Standard Reference (FAC 5J-17 / 61G15 / Topic 625-050-001), and ISO timestamp.</li>
                    <li><strong>Persistent Storage:</strong> Reports persist across browser sessions in local storage. Live badges on the navigation bar alert you to the active report count.</li>
                    <li><strong>Filter &amp; Search:</strong> Filter instantaneously by category (<em>COGO</em>, <em>Legal</em>, <em>PLSS</em>, <em>DXF</em>, <em>Standards</em>) or search across report titles, FPIDs, authors, and summary contents.</li>
                    <li><strong>In-App Preview &amp; Deliverables:</strong> View full raw logs or formatted HTML reports inside the preview modal with one-click <strong>Copy to Clipboard</strong>, <strong>Print / PDF</strong>, and <strong>Direct Download</strong>. Export all stored reports into a single consolidated master zip/bundle.</li>
                </ul>`
        },
        {
            id: "logging-doc",
            title: "3.16  System Diagnostics, Error Logging & Real-Time Event Stream",
            html: `
                <p><em>Purpose:</em> centralized runtime event logger and diagnostic auditor across all plugins, parsing engines, file loaders, and background tasks.</p>
                <h4>Features &amp; Capabilities</h4>
                <ul>
                    <li><strong>Global Logging API (<code>window.Logging</code>):</strong> Standalone plugin providing <code>info()</code>, <code>warn()</code>, <code>error()</code>, and <code>debug()</code> event logging with source attribution and structured metadata.</li>
                    <li><strong>Linework File Upload &amp; Error Logging:</strong> Supports drag-and-drop and manual upload of point and call files (<code>.txt</code>, <code>.csv</code>, <code>.pts</code>, <code>.pnt</code>, <code>.dat</code>). Quote-aware CSV parsing correctly handles commas within description fields (e.g. <code>"CURB B, R10"</code>). Header rows are automatically detected and skipped. Malformed rows (insufficient tokens, non-numeric coordinates) are logged to the System Logs stream with line numbers and diagnostic reasons, and displayed in an interactive in-tab diagnostics panel with one-click navigation to System Logs.</li>
                    <li><strong>Automatic Exception Monitoring:</strong> Subscribes to global <code>window.onerror</code> and <code>window.onunhandledrejection</code> events, preventing silent failures and alerting users via a persistent navbar badge.</li>
                    <li><strong>Live Error Badge:</strong> Displays real-time error counts in the sidebar navigation menu.</li>
                    <li><strong>Filtering &amp; Real-Time Search:</strong> Filter logs by severity level (<em>ALL</em>, <em>ERROR</em>, <em>WARN</em>, <em>INFO</em>, <em>DEBUG</em>) or originating subsystem (<em>linework</em>, <em>batchprocess</em>, <em>landxml</em>, <em>dxf</em>, <em>reports</em>, <em>system</em>), with instant search filtering.</li>
                    <li><strong>Reports Hub Integration:</strong> One-click <em>Send to Reports Hub</em> packages the formatted audit log into an official FDOT QA/QC System Diagnostics report stored in the Reports Hub repository.</li>
                    <li><strong>Export Formats:</strong> Download raw logs as formatted text (<code>.log</code>) or structured JSON (<code>.json</code>).</li>
                </ul>`
        },
        {
            id: "jea-asbuilt-doc",
            title: "3.17  JEA As-Built Standards 2024 (tmp_jea24) & Utility As-Built Manual",
            html: `
                <p><em>Purpose:</em> complete engineering workflow, drawing builder, and automated QA/QC compliance auditing system for <strong>Jacksonville Electric Authority (JEA) As-Built Standards 2024</strong> (governing Potable Water, Wastewater, Reclaimed Water, Chilled Water, and Utility Crossing installations across Duval, Clay, St. Johns, and Nassau counties).</p>

                <h4>1. Regulatory &amp; Geodetic Authority</h4>
                <ul>
                    <li><strong>Standard Specification:</strong> <em>JEA As Built Template 2024.xlsx</em> and associated Civil 3D CADD deliverables.</li>
                    <li><strong>Projection &amp; Coordinate System:</strong> Florida State Plane Coordinate System 1983 (SPCS83), East Zone (FIPS 0901 / EPSG 2236), US Survey Feet.</li>
                    <li><strong>Geographic Bounding Envelope:</strong> Easting <code>320,000</code> to <code>590,000</code> ft; Northing <code>1,920,000</code> to <code>2,370,000</code> ft (encompassing Greater Jacksonville, Beaches, Orange Park, St. Augustine, and Nassau utility service corridors).</li>
                    <li><strong>Ground-Truthed Natural GPS (WGS84):</strong> Exact physical WGS84 GPS coordinates (29.0° N to 31.0° N, -83.0° W to -80.0° W) computed via rigorous Transverse Mercator forward/inverse reductions (<code>COGO.statePlaneToLatLon("EAST", e, n)</code>) with zero artificial coordinate fudging or synthetic offsets.</li>
                </ul>

                <h4>2. End-to-End Operational Workflow</h4>
                <div class="help-note" style="border-left-color:var(--accent); background:rgba(2,132,199,0.06); font-family:var(--font-mono); font-size:0.78rem; line-height:1.6;">
                    [Field Survey Shots (P,N,E,Z,D)]<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&darr;<br>
                    [Linework Editor / Network Model (JSON)] &rarr; [JEA Drawing Builder]<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&darr;<br>
                    [Civil 3D Compliant DXF] (W-MAIN, SS-GRAV, JEA_VALVE, JEA_MANHOLE, JEA_CROSSING with ATTRIB tags)<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&darr;<br>
                    [Reverse-Read DXF Auditor Engine] &larr; (Upload .dxf / Paste ASCII DXF)<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&darr;<br>
                    [5-Point QA/QC Standards Check]:<br>
                    &nbsp;&nbsp;&bull; State Plane East Bounding Envelope Check<br>
                    &nbsp;&nbsp;&bull; Standard Layer Validation (W-MAIN, SS-GRAV, UTIL-CROSS)<br>
                    &nbsp;&nbsp;&bull; 45 Picklist Domains Verification (Subtypes, Materials, Sizes, Manufacturers, Linings)<br>
                    &nbsp;&nbsp;&bull; Mandatory Attribute Fields (Elevations, Rim/Invert, Diameters)<br>
                    &nbsp;&nbsp;&bull; 18-Inch Pipe Crossing Vertical Separation Rule (&ge; 18.0" / 1.5')<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&darr;<br>
                    [Deliverables &amp; Output]:<br>
                    &nbsp;&nbsp;&bull; JEA 2024 As-Built CSV Tables (Pipe Crossing Table, Water Valve, Manhole)<br>
                    &nbsp;&nbsp;&bull; Local PostgreSQL Database Master Template (tpl_jea_2024)<br>
                    &nbsp;&nbsp;&bull; Certified QA/QC Audit Certificate registered in Centralized Reports Hub
                </div>

                <h4>3. Detailed Operator Manual — Sub-Panels</h4>
                <h5>A. Linework &amp; Drawing Builder (<code>#jea-sub-gen</code>)</h5>
                <ul>
                    <li><strong>Network Model:</strong> Enter or edit the utility linework JSON structure containing <code>pipes</code> (layer, subtype, diameter, material, class, lining, 3D vertices), <code>structures</code> (block name, coordinates, elevation, attributes map), and <code>crossings</code>.</li>
                    <li><strong>Build &amp; Download Civil 3D DXF:</strong> Click <em>Build &amp; Download Civil 3D DXF</em> to generate a valid AutoCAD 2004+ ASCII DXF (<code>JEA_AsBuilt_2024.dxf</code>) with native <code>BLOCK</code> symbol definitions, <code>ATTDEF</code> tags, <code>LWPOLYLINE</code> runs, and <code>INSERT</code> records.</li>
                    <li><strong>Export JEA 2024 CSV Tables:</strong> Generates official comma-separated table exports matching the 2024 JEA template sheets (e.g. <code>JEA_Pipe_Crossing_Table.csv</code>).</li>
                    <li><strong>Send to Linework Editor:</strong> Bridges utility pipe runs straight into the interactive Linework Editor for vertex adjustment and closure diagnostics.</li>
                </ul>

                <h5>B. Reverse-Read DXF Auditor (<code>#jea-sub-audit</code>)</h5>
                <ul>
                    <li><strong>File Upload &amp; Text Ingestion:</strong> Drag and drop any <code>.dxf</code> drawing file, or paste raw ASCII DXF content into the auditor text area.</li>
                    <li><strong>Run 2024 Standards Audit:</strong> Executes the reverse-read parser, extracts all block inserts with child <code>ATTRIB</code> entities, and runs the 5-point verification engine.</li>
                    <li><strong>Interactive Samples:</strong>
                        <ul>
                            <li><em>Load Compliant Sample:</em> Loads a fully compliant JEA water, gravity sewer, and crossing model (100% score).</li>
                            <li><em>Load Violation Sample (&lt;18" Clearance):</em> Loads a sample utility model with a 7.0" vertical pipe crossing clearance shortfall and invalid valve subtype to demonstrate automated violation detection.</li>
                        </ul>
                    </li>
                    <li><strong>Audit Results &amp; Issue Log:</strong> Displays a real-time compliance scorecard (0–100%), compliance status badge (<em>COMPLIANT</em> vs <em>NON-COMPLIANT</em>), total entity count, error tally, warning tally, and an interactive issues table with entity descriptions, layers, coordinates, and exact corrective guidance.</li>
                    <li><strong>Save to Reports Hub:</strong> Packages the audit results into a formal Markdown/HTML inspection certificate stored in the Centralized Reports Hub.</li>
                </ul>

                <h5>C. 45 JEA Validation Domains Browser (<code>#jea-sub-domains</code>)</h5>
                <ul>
                    <li>Browse and search all 45 official JEA validation lists extracted directly from the 2024 template (including <em>Subtype Water Valve</em>, <em>Subtype Manhole</em>, <em>Crossing Pipe Type</em>, <em>Pipe and Fitting Material</em>, <em>Size Inches</em>, <em>Valve Manufacturer</em>, and <em>Manhole Lining Material</em>).</li>
                    <li>Use the real-time search box to find valid picklist values or verify allowed casing, spelling, and nomenclature.</li>
                </ul>

                <h5>D. PostgreSQL Template Sync (<code>#jea-sub-dbsync</code>)</h5>
                <ul>
                    <li>Synchronizes the master JEA 2024 template (<code>tpl_jea_2024</code>) with your local PostgreSQL relational database (<code>fdot_survey_db / client_templates</code>).</li>
                    <li>Click <em>Sync Template to PostgreSQL</em> to push or refresh client settings, projection bounds, and crossing clearance rules.</li>
                </ul>

                <h4>4. Technical Standards &amp; Clearance Formulas</h4>
                <h5>Pipe Crossing Vertical Separation Rule</h5>
                <p>JEA standards mandate a minimum vertical clearance of <strong>18.0 inches (1.50 feet)</strong> between crossing pipes (e.g. potable water main crossing above a gravity sewer main):</p>
                <div class="help-note">
                    <code>Clearance (inches) = (Upper_Pipe_Bottom_Elevation - Lower_Pipe_Top_Elevation) &times; 12.0</code><br>
                    <strong>Requirement:</strong> <code>Clearance &ge; 18.0"</code> (If &lt; 18.0", audit flags critical non-compliance).
                </div>

                <h5>Standard Layer Specifications</h5>
                <table class="help-table">
                    <thead><tr><th>Layer</th><th>Color</th><th>Discipline / Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>W-MAIN</code></td><td>Color 4 (Cyan)</td><td>Water Distribution &amp; Transmission Mains</td></tr>
                        <tr><td><code>W-VALV</code></td><td>Color 5 (Blue)</td><td>Water Gate, Butterfly, and Air Release Valves</td></tr>
                        <tr><td><code>W-HYDR</code></td><td>Color 2 (Yellow)</td><td>Fire Hydrant Assemblies</td></tr>
                        <tr><td><code>W-FITT</code></td><td>Color 6 (Magenta)</td><td>Water Bends, Tees, Crosses, and Reducers</td></tr>
                        <tr><td><code>W-METR</code></td><td>Color 3 (Green)</td><td>Water Meters &amp; Backflow Preventers</td></tr>
                        <tr><td><code>W-LOC8</code></td><td>Color 1 (Red)</td><td>Water Locate Wire Boxes &amp; Marker Balls</td></tr>
                        <tr><td><code>SS-GRAV</code></td><td>Color 3 (Green)</td><td>Sanitary Gravity Sewer Mains</td></tr>
                        <tr><td><code>SS-FM</code></td><td>Color 30 (Orange)</td><td>Sanitary Sewer Force Mains</td></tr>
                        <tr><td><code>SS-MANH</code></td><td>Color 1 (Red)</td><td>Sanitary Sewer Manholes</td></tr>
                        <tr><td><code>SS-VALV</code></td><td>Color 5 (Blue)</td><td>Sewer Plug Valves &amp; Air Release Valves</td></tr>
                        <tr><td><code>SS-FITT</code></td><td>Color 6 (Magenta)</td><td>Sewer Fittings &amp; Cleanouts</td></tr>
                        <tr><td><code>SS-LOC8</code></td><td>Color 1 (Red)</td><td>Sewer Locate Wire Boxes</td></tr>
                        <tr><td><code>RW-MAIN</code></td><td>Color 210 (Purple)</td><td>Reclaimed Water Distribution Mains</td></tr>
                        <tr><td><code>UTIL-CROSS</code></td><td>Color 7 (White)</td><td>Pipe Crossing Symbols &amp; Clearance Annotations</td></tr>
                    </tbody>
                </table>

                <h5>Civil 3D Standard Block Schema</h5>
                <table class="help-table">
                    <thead><tr><th>Block Name</th><th>Mandatory Attributes (ATTDEF)</th><th>Standard Picklist Domain</th></tr></thead>
                    <tbody>
                        <tr><td><code>JEA_VALVE</code></td><td><code>SUBTYPE</code>, <code>VALVE_TYPE</code>, <code>SIZE</code>, <code>MATERIAL</code>, <code>MANUFACTURER</code>, <code>OPEN_DIR</code>, <code>STATUS</code>, <code>ELEVATION</code></td><td>Subtype Water Valve, Valve Type, Size Inches, Valve Manufacturer</td></tr>
                        <tr><td><code>JEA_MANHOLE</code></td><td><code>SUBTYPE</code>, <code>MANHOLE_TYPE</code>, <code>RIM_ELEV</code>, <code>INVERT_IN</code>, <code>INVERT_OUT</code>, <code>DEPTH</code>, <code>DIAMETER</code>, <code>MATERIAL</code>, <code>MANUFACTURER</code>, <code>LINING</code></td><td>Subtype Manhole, Manhole Type, Size Feet, Manhole Manufacturer, Manhole Lining Material</td></tr>
                        <tr><td><code>JEA_HYDRANT</code></td><td><code>SUBTYPE</code>, <code>MODEL</code>, <code>MANUFACTURER</code>, <code>VALVE_SIZE</code>, <code>BURY_DEPTH</code>, <code>ELEVATION</code></td><td>Hydrant Model, Valve Manufacturer, Size Inches</td></tr>
                        <tr><td><code>JEA_FITTING</code></td><td><code>SUBTYPE</code>, <code>SIZE</code>, <code>MATERIAL</code>, <code>MANUFACTURER</code>, <code>ELEVATION</code></td><td>Subtype Water Fitting, Size Inches, Fitting Manufacturers</td></tr>
                        <tr><td><code>JEA_METER</code></td><td><code>SUBTYPE</code>, <code>SIZE</code>, <code>BOX_MFR</code>, <code>BOX_MAT</code>, <code>ELEVATION</code>, <code>ACCOUNT_NO</code></td><td>Subtype Water Meter, Meter Size Inches, Meter Box Manufacturer, Meter Box Material</td></tr>
                        <tr><td><code>JEA_LOCATE_BOX</code></td><td><code>SUBTYPE</code>, <code>ELEVATION</code>, <code>COLOR</code></td><td>Subtype Locate Box</td></tr>
                        <tr><td><code>JEA_CROSSING</code></td><td><code>CROSS_NO</code>, <code>UPPER_TYPE</code>, <code>UPPER_SIZE</code>, <code>UPPER_BOT_ELEV</code>, <code>LOWER_TYPE</code>, <code>LOWER_SIZE</code>, <code>LOWER_TOP_ELEV</code>, <code>CLEARANCE_INCHES</code>, <code>COMPLIANT</code></td><td>Crossing Pipe Type, Size Inches</td></tr>
                    </tbody>
                </table>`
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
                <h4>License limit &amp; Stripe billing</h4>
                <p>The <strong>Free</strong> and <strong>Pro</strong> plans allow <strong>5 templates per user</strong>. Creating a sixth is blocked with an upgrade prompt. <strong>Firm</strong> ($199/mo) raises the cap to 25; <strong>Enterprise</strong> ($499/mo) is unlimited.</p>
                <h4>Stripe Billing &amp; Subscription Portal</h4>
                <p>Manage subscriptions from the <strong>Commercial SaaS Plans</strong> tab:</p>
                <ul>
                    <li><strong>Live Stripe vs. Simulation:</strong> Configure your publishable key (<code>pk_test_...</code> / <code>pk_live_...</code>) or custom Stripe Payment Links per tier in the Stripe Gateway Configuration panel. In simulation mode, checkouts run instantly in-browser with ASC 606 revenue-recognition ledgering and signed tier tokens.</li>
                    <li><strong>Modal Checkout:</strong> Click any plan CTA (<em>Upgrade to Pro</em>, <em>Upgrade to Firm</em>, <em>Contact / Upgrade Enterprise</em>) to open the Stripe checkout modal. Choose between direct card entry (Elements emulation) or external Stripe Payment Links.</li>
                    <li><strong>Self-Serve Management &amp; Cancellation:</strong> The Active Subscription Portal displays current tier badges, next renewal date, billing email, and seat counts. Click <em>Cancel Subscription</em> at any time to downgrade immediately back to the Free plan with recorded <code>customer.subscription.deleted</code> webhook auditing.</li>
                </ul>
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
                <p>ASCII (plain) DXF, R12 or later. Binary DXF is rejected. The auditor reads the LAYER table and LINE / LWPOLYLINE / ARC / CIRCLE / TEXT / MTEXT / INSERT / POINT entities.</p>
                <h4>JEA Utility Network JSON</h4>
                <p>JSON structure used by the JEA As-Built Drawing Builder (<code>#tab-jea24</code>). Requires a <code>pipes</code> array with 3D coordinate vertices, a <code>structures</code> array with block names (<code>JEA_VALVE</code>, <code>JEA_MANHOLE</code>, etc.) and attribute dictionaries, and a <code>crossings</code> array with upper and lower pipe elevations.</p>`
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
                        <tr><td><code>*_survey.fbk / linework_script.fbk / efbk_script.fbk</code></td><td>Linework, Legal Description, Traverse, EFB</td><td>Civil 3D Survey Command Language batch script &amp; Field Book (<code>FIG BEGIN/PT/CLOSE/END</code>, <code>NEZ</code>, <code>BD</code>, <code>STN</code>)</td></tr>
                        <tr><td><code>parcel_boundary.dxf / efbk.dxf</code></td><td>Parcel → DXF, EFB</td><td>Closed LWPOLYLINE + labels on AI-PROP-BNDY / AI-NODE-TEXT or EFB figure layers</td></tr>
                        <tr><td><code>parcel_cogo.scr</code></td><td>Parcel → DXF</td><td>AutoCAD PLINE script from the calls</td></tr>
                        <tr><td><code>plss_breakdown_report.log</code></td><td>PLSS</td><td>Per-parcel dimensions, acreage, courses, coordinates</td></tr>
                        <tr><td><code>export.xml / *.landxml</code></td><td>LandXML Studio</td><td>Schema-compliant LandXML 1.2 geometry with <code>&lt;Parcels&gt;</code>, <code>&lt;Alignments&gt;</code>, and <code>&lt;CgPoints&gt;</code></td></tr>
                        <tr><td><code>fdot_batch_fix.scr</code></td><td>Batch Auditor</td><td>Consolidated AutoCAD batch script running AUDIT, color resets, PURGE, and OVERKILL across all project drawings</td></tr>
                        <tr><td><code>fdot_master_submittal_report.html / .md</code></td><td>Batch Auditor</td><td>Consolidated project QA/QC submittal scorecard and sheet compliance matrix</td></tr>
                        <tr><td><code>fdot_reports_bundle.json / fdot_reports_manifest.txt</code></td><td>Reports Hub</td><td>Consolidated export bundle containing all active survey, engineering, DXF, and standards QA/QC submittal reports with unified FDOT metadata</td></tr>
                        <tr><td><code>JEA_AsBuilt_2024.dxf</code></td><td>JEA As-Built Standards</td><td>Civil 3D AutoCAD DXF with JEA layers, BLOCK symbols, ATTRIB metadata, and 3D pipe runs</td></tr>
                        <tr><td><code>JEA_Pipe_Crossing_Table.csv</code></td><td>JEA As-Built Standards</td><td>Tabular pipe crossing dataset matching official JEA As-Built 2024 spreadsheet format</td></tr>
                        <tr><td><code>JEA_Water_Valve.csv / JEA_Manhole.csv</code></td><td>JEA As-Built Standards</td><td>Attribute tables for water valves, manholes, and hydrants matching JEA 2024 sheets</td></tr>
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
                    <dt>JEA</dt><dd>Jacksonville Electric Authority — municipal utility authority providing water, wastewater, reclaimed water, and electric utility services in Northeast Florida.</dd>
                    <dt>Latitude</dt><dd>The north–south component of a course: distance × cos(azimuth).</dd>
                    <dt>Linear misclosure</dt><dd>The straight-line gap between the computed end of a traverse and its point of beginning.</dd>
                    <dt>P,N,E,Z,D</dt><dd>Point file format: Point number, Northing, Easting, Z (elevation), Description.</dd>
                    <dt>PC / PT / PRC / PCC</dt><dd>Point of Curvature / Tangency / Reverse Curvature / Compound Curvature — curve node labels expected on a plat.</dd>
                    <dt>Pipe Crossing Clearance</dt><dd>The vertical separation between the bottom elevation of an upper pipe and the top/crown elevation of a lower crossing pipe; JEA mandates &ge; 18.0 inches (1.5 ft).</dd>
                    <dt>POB</dt><dd>Point of Beginning.</dd>
                    <dt>Precision ratio</dt><dd>Perimeter ÷ linear misclosure, written 1:X. Higher is better; ≥ 1:10,000 is survey grade for boundary work.</dd>
                    <dt>Shoelace formula</dt><dd>Polygon area from vertex coordinates: ½·|Σ (x_j + x_i)(y_j − y_i)|.</dd>
                    <dt>SPCS83 East Zone</dt><dd>State Plane Coordinate System of 1983, Florida East Zone (FIPS 0901, EPSG 2236) in US Survey Feet.</dd>
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
