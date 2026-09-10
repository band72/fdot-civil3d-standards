/**
 * BoundaryQC / FDOT Civil3D Standards — shared COGO math
 * core/cogo.js
 *
 * Ported from the BoundaryQC desktop app (Services/CogoMath.cs,
 * Services/Writer/TraverseGeometryEngine.cs). Conventions:
 *   - Azimuth measured clockwise from North, in radians.
 *   - Coordinates are (E, N) = (easting, northing); N is +Y.
 *   - Bearings are quadrant bearings: N/S <deg> <min> <sec> E/W.
 *   - Per the BoundaryQC "decimal-angle-bearing-tolerance" rule: math carried to
 *     0.001, reported to 0.01; angles to 0.1"; coordinate points start at 500 with
 *     descriptions "COGO POB", "COGO P1", "COGO P2", ...
 *
 * Exposed as window.COGO.
 */
(function () {
    "use strict";

    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;

    /** Parse a quadrant bearing string → { quad, deg, min, sec, azimuthDeg } or null. */
    function parseBearing(text) {
        if (!text) return null;
        let s = String(text);
        // Normalize every common DMS notation to space-separated numbers:
        //   "North 45 degrees 12 minutes 30 seconds East", "N45°12'30\"E",
        //   "N 45-12-30 E", "N45d12m30sE", "N.45*12'30\"W"
        s = s.replace(/\bnorth\b/gi, "N").replace(/\bsouth\b/gi, "S")
             .replace(/\beast\b/gi, "E").replace(/\bwest\b/gi, "W")
             .replace(/\s*deg(?:rees?)?\.?\s*/gi, " ").replace(/\s*min(?:utes?)?\.?\s*/gi, " ").replace(/\s*sec(?:onds?)?\.?\s*/gi, " ")
             .replace(/[°'"′″*]/g, " ")                       // degree / minute / second marks
             .replace(/(\d)\s*[-–—]\s*(?=\d)/g, "$1 ")        // 45-12-30  ->  45 12 30
             .replace(/(\d)\s*[dm]\s*(?=\d)/gi, "$1 ")        // 45d12m30  ->  45 12 30
             .replace(/(\d)\s*s\s*(?=[EW\d])/gi, "$1 ")       // 30sE      ->  30 E
             .replace(/\s+/g, " ").trim();
        const m = s.match(
            /([NS])\s*\.?\s*(\d{1,3}(?:\.\d+)?)(?:\s+(\d{1,2}(?:\.\d+)?))?(?:\s+(\d{1,2}(?:\.\d+)?))?\s*([EW])/i
        );
        if (!m) return null;
        const quad = (m[1] + m[5]).toUpperCase();
        const deg = parseFloat(m[2]);
        const min = m[3] ? parseFloat(m[3]) : 0;
        const sec = m[4] ? parseFloat(m[4]) : 0;
        const inner = deg + min / 60 + sec / 3600;
        let az;
        switch (quad) {
            case "NE": az = inner; break;
            case "SE": az = 180 - inner; break;
            case "SW": az = 180 + inner; break;
            case "NW": az = 360 - inner; break;
            default:   az = inner;
        }
        return { quad, deg, min, sec, azimuthDeg: (az % 360 + 360) % 360 };
    }

    /** Azimuth degrees → "N dd°mm'ss.s\" E" quadrant-bearing string. */
    function azimuthToBearing(azDeg) {
        let deg = ((azDeg % 360) + 360) % 360;
        let ns = "N", ew = "E", b = 0;
        if (deg <= 90)        { ns = "N"; ew = "E"; b = deg; }
        else if (deg <= 180)  { ns = "S"; ew = "E"; b = 180 - deg; }
        else if (deg <= 270)  { ns = "S"; ew = "W"; b = deg - 180; }
        else                  { ns = "N"; ew = "W"; b = 360 - deg; }
        const d = Math.floor(b);
        const mDec = (b - d) * 60;
        const mm = Math.floor(mDec);
        const ss = (mDec - mm) * 60;
        return `${ns} ${String(d).padStart(2, "0")}°${String(mm).padStart(2, "0")}'${ss.toFixed(1).padStart(4, "0")}" ${ew}`;
    }

    /** Advance an {e, n} point along an azimuth (deg) for a distance. */
    function advance(pt, azimuthDeg, distance) {
        const a = azimuthDeg * D2R;
        return { e: pt.e + Math.sin(a) * distance, n: pt.n + Math.cos(a) * distance };
    }

    /** Plane distance between two {e, n} points. */
    function distanceBetween(a, b) { return Math.hypot(b.e - a.e, b.n - a.n); }

    /** Azimuth (deg, clockwise from north) from point a to point b. */
    function azimuthDegBetween(a, b) {
        const az = Math.atan2(b.e - a.e, b.n - a.n) * R2D;
        return (az % 360 + 360) % 360;
    }

    /** Included angle (deg, 0..180) at vertex `at` between the rays to `prev` and `next`. */
    function includedAngleDeg(prev, at, next) {
        const a1 = azimuthDegBetween(at, prev);
        const a2 = azimuthDegBetween(at, next);
        let d = Math.abs(a1 - a2);
        if (d > 180) d = 360 - d;
        return d;
    }

    /** Chord distance from radius + arc length: 2R·sin(Δ/2), Δ = arc/R. */
    function chordFromArc(radius, arcLength) {
        if (!(radius > 0) || !(arcLength > 0)) return 0;
        return 2 * radius * Math.sin(arcLength / radius / 2);
    }

    /** Delta angle (deg) from radius + arc length. */
    function deltaDegFromArc(radius, arcLength) {
        if (!(radius > 0) || !(arcLength > 0)) return 0;
        return (arcLength / radius) * R2D;
    }

    /** Shoelace area (sq ft) for a list of {e, n} vertices. */
    function shoelaceArea(verts) {
        if (!verts || verts.length < 3) return 0;
        let a = 0;
        for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
            a += (verts[j].e + verts[i].e) * (verts[j].n - verts[i].n);
        }
        return Math.abs(a / 2);
    }

    const SQFT_PER_ACRE = 43560;

    /**
     * Run a traverse from an origin through a list of legs.
     * Each leg: { kind:'line', azimuthDeg, distance } or
     *           { kind:'curve', chordAzimuthDeg, chordDistance, arcLength }.
     * Returns { vertices, perimeter, misclosure, precisionDenominator, areaSqFt,
     *           areaAcres, closeAzimuthDeg, closes }.
     * `closes` is true when the trace returns to the origin (misclosure ≈ 0); the
     * area fields assume closure and are not meaningful for an open traverse.
     */
    function runTraverse(legs, origin) {
        const start = origin || { e: 0, n: 0 };
        const vertices = [{ ...start }];
        let perimeter = 0;
        let cur = { ...start };
        for (const leg of legs) {
            if (leg.kind === "curve") {
                cur = advance(cur, leg.chordAzimuthDeg, leg.chordDistance || 0);
                perimeter += leg.arcLength || leg.chordDistance || 0;
            } else {
                cur = advance(cur, leg.azimuthDeg, leg.distance || 0);
                perimeter += leg.distance || 0;
            }
            vertices.push({ ...cur });
        }
        const end = vertices[vertices.length - 1];
        const dE = start.e - end.e, dN = start.n - end.n;
        const misclosure = Math.hypot(dE, dN);
        const precisionDenominator = misclosure > 1e-4 ? perimeter / misclosure : Infinity;
        // area on the polygon that closes the trace back to the origin
        const ring = vertices.slice(0, -1);
        const areaSqFt = shoelaceArea(ring.length >= 3 ? ring : vertices);
        const closeAzimuthDeg = misclosure > 1e-4
            ? ((Math.atan2(dE, dN) * R2D) % 360 + 360) % 360
            : null;
        return {
            vertices, perimeter, misclosure, precisionDenominator,
            areaSqFt, areaAcres: areaSqFt / SQFT_PER_ACRE, closeAzimuthDeg,
            closes: misclosure <= 1e-4
        };
    }

    /**
     * Build a P,N,E,Z,D point-file string. Points start at 500; descriptions
     * "COGO POB", "COGO P1", ... (BoundaryQC decimal-angle-bearing-tolerance rule).
     */
    function pnezd(vertices, startNumber) {
        const n0 = startNumber || 500;
        const rows = ["P,N,E,Z,D"];
        vertices.forEach((v, i) => {
            const desc = i === 0 ? "COGO POB" : `COGO P${i}`;
            rows.push(`${n0 + i},${v.n.toFixed(3)},${v.e.toFixed(3)},0.000,${desc}`);
        });
        return rows.join("\r\n") + "\r\n";
    }

    /** Test whether the closed polygon over {e,n} vertices intersects itself. */
    function selfIntersects(verts) {
        const cross = (a, b, c) => (c.n - a.n) * (b.e - a.e) - (b.n - a.n) * (c.e - a.e);
        const ring = verts.concat([verts[0]]);
        const n = ring.length - 1;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
                const [p1, p2, p3, p4] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
                const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
                const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
                if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
                    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) {
                    return { i: i + 1, j: j + 1 };
                }
            }
        }
        return null;
    }

    /** Bulge factor for an LWPOLYLINE arc segment: tan(includedAngle / 4). Sign: + = CCW. */
    function bulge(includedAngleRad) { return Math.tan(includedAngleRad / 4); }

    /**
     * Build a minimal ASCII DXF (R12-style) from layers + entities.
     * layers:    [{ name, color }]  (ACI colour number)
     * polylines: [{ layer, closed, points:[{ e, n, bulge? }] }]   bulge on a vertex = arc to the next vertex
     * texts:     [{ layer, e, n, height, value }]
     * circles:   [{ layer, cx, cy, r }]
     */
    function buildDxf({ layers = [], polylines = [], texts = [], circles = [] }) {
        const out = [];
        const p = (code, val) => { out.push(String(code)); out.push(String(val)); };

        p(0, "SECTION"); p(2, "TABLES");
        p(0, "TABLE"); p(2, "LAYER"); p(70, layers.length || 1);
        (layers.length ? layers : [{ name: "0", color: 7 }]).forEach(l => {
            p(0, "LAYER"); p(2, l.name); p(70, 0); p(62, l.color == null ? 7 : l.color); p(6, "CONTINUOUS");
        });
        p(0, "ENDTAB"); p(0, "ENDSEC");

        p(0, "SECTION"); p(2, "ENTITIES");
        polylines.forEach(pl => {
            p(0, "LWPOLYLINE"); p(8, pl.layer || "0");
            p(90, pl.points.length); p(70, pl.closed ? 1 : 0);
            pl.points.forEach(pt => {
                p(10, pt.e.toFixed(4)); p(20, pt.n.toFixed(4));
                if (pt.bulge) p(42, pt.bulge.toFixed(6));
            });
        });
        circles.forEach(c => {
            p(0, "CIRCLE"); p(8, c.layer || "0");
            p(10, c.cx.toFixed(4)); p(20, c.cy.toFixed(4)); p(40, c.r.toFixed(4));
        });
        texts.forEach(t => {
            p(0, "TEXT"); p(8, t.layer || "0");
            p(10, t.e.toFixed(4)); p(20, t.n.toFixed(4));
            p(40, (t.height || 5).toFixed(4)); p(1, t.value);
        });
        p(0, "ENDSEC");
        p(0, "EOF");
        return out.join("\r\n") + "\r\n";
    }

    /** Trigger a browser download of a text blob. */
    function downloadText(filename, text, mime) {
        const blob = new Blob([text], { type: mime || "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    window.COGO = {
        D2R, R2D, SQFT_PER_ACRE,
        parseBearing, azimuthToBearing, advance,
        distanceBetween, azimuthDegBetween, includedAngleDeg,
        chordFromArc, deltaDegFromArc, shoelaceArea, bulge,
        runTraverse, pnezd, selfIntersects, buildDxf, downloadText
    };
})();
