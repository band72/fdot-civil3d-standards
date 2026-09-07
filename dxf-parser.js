/* FDOT Civil3D Standards - DXF Parser & CADD Scripting Inspector Engine */

class FDOTDXFInspector {
    constructor(fdotStandardsData) {
        this.standards = fdotStandardsData;
        this.fdotLayerMap = new Map();
        this.fdotStandardsDataLayers = fdotStandardsData.layers || [];
        
        this.fdotStandardsDataLayers.forEach(l => {
            this.fdotLayerMap.set(l.name.toUpperCase(), l);
        });
    }

    parseDXF(dxfText) {
        const lines = dxfText.split(/\r?\n/);
        let inEntities = false;
        let inTables = false;
        let currentSection = "";
        
        const layers = [];
        const entities = [];
        let currentEntity = null;
        let currentLayer = null;

        for (let i = 0; i < lines.length; i += 2) {
            if (i + 1 >= lines.length) break;
            const code = parseInt(lines[i].trim(), 10);
            const value = lines[i + 1].trim();

            if (code === 0 && value === "SECTION") {
                currentSection = "";
                continue;
            }

            if (code === 2 && currentSection === "") {
                currentSection = value;
                if (currentSection === "ENTITIES") inEntities = true;
                if (currentSection === "TABLES") inTables = true;
                continue;
            }

            if (code === 0 && value === "ENDSEC") {
                inEntities = false;
                inTables = false;
                currentSection = "";
                continue;
            }

            // Parse Layer Table
            if (inTables && code === 0 && value === "LAYER") {
                if (currentLayer) layers.push(currentLayer);
                currentLayer = { name: "", color: 7, linetype: "CONTINUOUS", plot: true };
                continue;
            }

            if (inTables && currentLayer) {
                if (code === 2) currentLayer.name = value;
                if (code === 62) currentLayer.color = Math.abs(parseInt(value, 10));
                if (code === 6) currentLayer.linetype = value;
                if (code === 290) currentLayer.plot = value === "1";
            }

            // Parse Entities Section
            if (inEntities && code === 0) {
                if (currentEntity) entities.push(currentEntity);
                
                const entityType = value;
                if (["LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "TEXT", "MTEXT", "INSERT", "POINT"].includes(entityType)) {
                    currentEntity = {
                        type: entityType,
                        layer: "0",
                        color: 256, // BYLAYER
                        vertices: [],
                        startX: 0, startY: 0, endX: 0, endY: 0,
                        radius: 0, text: "", closed: false
                    };
                } else {
                    currentEntity = null;
                }
                continue;
            }

            if (inEntities && currentEntity) {
                if (code === 8) currentEntity.layer = value.toUpperCase();
                if (code === 62) currentEntity.color = Math.abs(parseInt(value, 10));
                
                if (currentEntity.type === "LINE") {
                    if (code === 10) currentEntity.startX = parseFloat(value);
                    if (code === 20) currentEntity.startY = parseFloat(value);
                    if (code === 11) currentEntity.endX = parseFloat(value);
                    if (code === 21) currentEntity.endY = parseFloat(value);
                }

                if (currentEntity.type === "LWPOLYLINE") {
                    if (code === 70) currentEntity.closed = (parseInt(value, 10) & 1) === 1;
                    if (code === 10) {
                        currentEntity.vertices.push({ x: parseFloat(value), y: 0 });
                    }
                    if (code === 20 && currentEntity.vertices.length > 0) {
                        currentEntity.vertices[currentEntity.vertices.length - 1].y = parseFloat(value);
                    }
                }

                if (currentEntity.type === "ARC" || currentEntity.type === "CIRCLE") {
                    if (code === 10) currentEntity.startX = parseFloat(value);
                    if (code === 20) currentEntity.startY = parseFloat(value);
                    if (code === 40) currentEntity.radius = parseFloat(value);
                    if (code === 50) currentEntity.startAngle = parseFloat(value);
                    if (code === 51) currentEntity.endAngle = parseFloat(value);
                }

                if (currentEntity.type === "TEXT" || currentEntity.type === "MTEXT") {
                    if (code === 1) currentEntity.text = value;
                    if (code === 10) currentEntity.startX = parseFloat(value);
                    if (code === 20) currentEntity.startY = parseFloat(value);
                }

                if (currentEntity.type === "INSERT") {
                    if (code === 2) currentEntity.text = value; // Block Name
                    if (code === 10) currentEntity.startX = parseFloat(value);
                    if (code === 20) currentEntity.startY = parseFloat(value);
                }
            }
        }

        if (currentLayer) layers.push(currentLayer);
        if (currentEntity) entities.push(currentEntity);

        return { layers, entities };
    }

    inspectProject(parsedDXF) {
        const { layers, entities } = parsedDXF;
        const issues = [];
        let score = 100;

        const disciplinePrefixes = ["ROAD_", "DRAIN_", "SURV_", "UTIL_", "STR_", "RW_", "ENV_", "TRAF_", "LIGHT_"];
        const entityLayerCounts = {};

        // 1. Audit Layers
        layers.forEach(layer => {
            const layerName = layer.name.toUpperCase();
            
            if (layerName === "0") {
                issues.push({
                    severity: "CRITICAL",
                    category: "CADD Standards",
                    title: "Entities on Layer 0",
                    description: "Layer 0 should not contain project design elements. Move entities to FDOT discipline layers.",
                    layer: "0"
                });
                score -= 10;
            } else if (layerName === "DEFPOINTS") {
                issues.push({
                    severity: "WARNING",
                    category: "CADD Standards",
                    title: "Defpoints Layer Usage",
                    description: "Defpoints layer detected. FDOT standards mandate using `ROAD_NOPLOT_WORK` for non-plotting geometry.",
                    layer: "DEFPOINTS"
                });
                score -= 5;
            } else {
                const hasValidPrefix = disciplinePrefixes.some(prefix => layerName.startsWith(prefix));
                if (!hasValidPrefix) {
                    issues.push({
                        severity: "HIGH",
                        category: "Naming Convention",
                        title: "Non-Compliant FDOT Layer Prefix",
                        description: `Layer \`${layer.name}\` does not start with an official FDOT discipline prefix (e.g. ROAD_, DRAIN_, SURV_).`,
                        layer: layer.name
                    });
                    score -= 8;
                }

                // Check standard color match
                const stdLayer = this.fdotLayerMap.get(layerName);
                if (stdLayer && layer.color !== 256 && layer.color !== stdLayer.color) {
                    issues.push({
                        severity: "MEDIUM",
                        category: "Symbology Error",
                        title: "Non-Standard Layer Color",
                        description: `Layer \`${layer.name}\` color (ACI ${layer.color}) does not match FDOT standard color (ACI ${stdLayer.color}).`,
                        layer: layer.name
                    });
                    score -= 4;
                }
            }
        });

        // 2. Audit Entities (Scripting & Geometry Errors)
        entities.forEach((ent, idx) => {
            entityLayerCounts[ent.layer] = (entityLayerCounts[ent.layer] || 0) + 1;

            if (ent.layer === "0") {
                issues.push({
                    severity: "CRITICAL",
                    category: "Entity Standard",
                    title: `Entity ${ent.type} placed on Layer 0`,
                    description: `${ent.type} (Entity #${idx+1}) is assigned to Layer 0. Move to an FDOT discipline layer.`,
                    layer: "0"
                });
                score -= 3;
            }

            // Zero-Length Line Check
            if (ent.type === "LINE") {
                const len = Math.hypot(ent.endX - ent.startX, ent.endY - ent.startY);
                if (len < 0.001) {
                    issues.push({
                        severity: "HIGH",
                        category: "Scripting / Geometry Error",
                        title: "Zero-Length Line Detected",
                        description: `Zero-length line entity found at (${ent.startX.toFixed(2)}, ${ent.startY.toFixed(2)}).`,
                        layer: ent.layer
                    });
                    score -= 5;
                }
            }

            // Unclosed Boundary Polyline Check
            if (ent.type === "LWPOLYLINE") {
                const isBoundaryLayer = ent.layer.includes("SURV_BND") || ent.layer.includes("RW_LINE");
                if (isBoundaryLayer && !ent.closed && ent.vertices.length > 2) {
                    // Check if end matches start
                    const first = ent.vertices[0];
                    const last = ent.vertices[ent.vertices.length - 1];
                    const gap = Math.hypot(last.x - first.x, last.y - first.y);
                    
                    if (gap > 0.01) {
                        issues.push({
                            severity: "CRITICAL",
                            category: "Topological Error",
                            title: "Unclosed Boundary Polyline (Gap)",
                            description: `Boundary polygon on layer \`${ent.layer}\` has an unclosed gap of ${gap.toFixed(3)} ft at endpoint.`,
                            layer: ent.layer
                        });
                        score -= 10;
                    }
                }

                // Self-Intersection / Bow-Tie Detection
                if (ent.vertices.length >= 4) {
                    const isSelfIntersecting = this.checkPolylineBowtie(ent.vertices);
                    if (isSelfIntersecting) {
                        issues.push({
                            severity: "CRITICAL",
                            category: "Bow-Tie / Self-Intersection",
                            title: "Self-Intersecting Polyline (Bow-Tie Warning)",
                            description: `Polyline on layer \`${ent.layer}\` crosses over itself, creating a bow-tie topological error.`,
                            layer: ent.layer
                        });
                        score -= 12;
                    }
                }
            }

            // Florida State Plane Datum Coordinate Check
            const px = ent.startX || (ent.vertices.length > 0 ? ent.vertices[0].x : 0);
            const py = ent.startY || (ent.vertices.length > 0 ? ent.vertices[0].y : 0);
            if (px !== 0 && py !== 0) {
                if (px < 50000 || px > 3500000 || py < 50000 || py > 4500000) {
                    issues.push({
                        severity: "WARNING",
                        category: "Coordinate Datum",
                        title: "Out-of-Bounds Coordinate Range",
                        description: `Entity at (${px.toFixed(1)}, ${py.toFixed(1)}) falls outside typical Florida State Plane NAD83 US Survey Feet coordinate envelope.`,
                        layer: ent.layer
                    });
                    score -= 3;
                }
            }
        });

        score = Math.max(0, Math.min(100, Math.round(score)));

        return {
            score,
            layersCount: layers.length,
            entitiesCount: entities.length,
            issues,
            entityLayerCounts
        };
    }

    checkPolylineBowtie(vertices) {
        // Line segment intersection detection
        const n = vertices.length;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 2; j < n - 1; j++) {
                if (i === 0 && j === n - 2) continue; // Adjacent endpoints
                const p1 = vertices[i], p2 = vertices[i + 1];
                const p3 = vertices[j], p4 = vertices[j + 1];
                if (this.linesIntersect(p1, p2, p3, p4)) {
                    return true;
                }
            }
        }
        return false;
    }

    linesIntersect(p1, p2, p3, p4) {
        function crossProduct(A, B, C) {
            return (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x);
        }
        const cp1 = crossProduct(p1, p2, p3);
        const cp2 = crossProduct(p1, p2, p4);
        const cp3 = crossProduct(p3, p4, p1);
        const cp4 = crossProduct(p3, p4, p2);

        if (((cp1 > 1e-7 && cp2 < -1e-7) || (cp1 < -1e-7 && cp2 > 1e-7)) &&
            ((cp3 > 1e-7 && cp4 < -1e-7) || (cp3 < -1e-7 && cp4 > 1e-7))) {
            return true;
        }
        return false;
    }

    generateFixScript(issues) {
        let scr = `; FDOT Civil3D Standards - Automated Fix Script (.scr)\n`;
        scr += `; Generated by FDOT Civil3D Standards Inspector\n\n`;
        scr += `_AUDIT Y\n`;

        const layer0Issues = issues.filter(i => i.layer === "0");
        if (layer0Issues.length > 0) {
            scr += `; Fix: Purge and move Layer 0 entities\n`;
            scr += `_LAYTRANS\n`;
        }

        issues.filter(i => i.category === "Symbology Error").forEach(issue => {
            scr += `_-LAYER C BYLAYER "${issue.layer}" \n`;
        });

        scr += `_PURGE A * N\n`;
        scr += `_OVERKILL ALL  \n`;
        scr += `_QSAVE\n`;
        return scr;
    }
}
