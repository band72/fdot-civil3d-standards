/**
 * Plugin: tmplt-jea2024 (JEA As-Built Standards 2024)
 * plugins/tmplt-jea2024/tmplt-jea2024.js
 *
 * Implements JEA As-Built 2024 Standards for Civil 3D drawings:
 *  - 45 reference picklist domains (Materials, Sizes, Subtypes, Manufacturers, Classes, Linings);
 *    the reverse-read audit engine actively checks attributes against 21 of them today (Water
 *    valves/manholes/hydrants/fittings/meters/crossings) — Sewer/Reclaimed/Chilled Water domains
 *    are fully defined in DOMAINS but not yet wired into auditDrawing()'s per-block checks.
 *  - 29 sheet rules & field requirements (Water, Wastewater, Reclaimed, Chilled, Crossings)
 *  - Florida State Plane East (US Survey Feet) geodetic boundary checks, cross-verified against
 *    the natural WGS84 GPS envelope via core/cogo.js's SPCS83 conversion
 *  - Civil 3D DXF generation with native BLOCKS, ATTRIB metadata, and JEA utility layers
 *  - Reverse-read DXF parsing and rigorous QA/QC audit engine
 *  - Pipe crossing minimum 18-inch clearance vertical separation verification
 *  - "The 2024 JEA template" (CLIENT_TEMPLATE, id tpl_jea_2024): addAsClientTemplate() adds/
 *    updates it in the signed-in user's local Client Master Templates (window.BoundaryQCCMS);
 *    syncTemplateWithDb() separately pushes it to the PostgreSQL client_templates table via
 *    window.DatabaseService. Neither runs automatically — cms-engine.js no longer seeds this
 *    (a plugin-specific template doesn't belong baked into that domain-agnostic engine), so this
 *    plugin is the one place that knows what "the JEA template" contains.
 *  - Centralized Reports Hub integration (window.Reports)
 *
 * Registers via window.PluginRegistry.
 */
(function () {
    "use strict";

    const MANIFEST = {
        name: "tmplt-jea2024",
        version: "1.0.0",
        description: "JEA 2024 As-Built Standards: Civil 3D drawing builder, reverse-read DXF auditor, and validation against 45 JEA domains and State Plane East specs.",
        tab: "tab-jea24",
        icon: "fa-faucet-drip",
        tier: "Pro",
        dependencies: ["linework", "reports"]
    };

    const clean = s => window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(String(s ?? "")) : String(s ?? "");

    // ═════════════════════════════════════════════════════════════════════
    // 1. JEA Standards Specifications & Reference Data
    // ═════════════════════════════════════════════════════════════════════

    const BOUNDS = {
        projection: "FL_EAST_83",
        eastingMin: 320000,
        eastingMax: 590000,
        northingMin: 1920000,
        northingMax: 2370000,
        latMin: 29.0,
        latMax: 31.0,
        lonMin: -83.0,
        lonMax: -80.0,
        minCrossingClearanceInches: 18.0, // 1.5 ft required vertical separation
        minCrossingClearanceFeet: 1.5
    };

    // The single definition of "the JEA 2024 template" — what addAsClientTemplate() writes into
    // the signed-in user's local Client Master Templates (window.BoundaryQCCMS) and what
    // syncTemplateWithDb() pushes to the PostgreSQL client_templates table. Built from BOUNDS
    // rather than repeating its numbers, so there's one source of truth for both.
    const CLIENT_TEMPLATE = {
        id: "tpl_jea_2024",
        clientName: "JEA",
        label: "JEA As-Built Standards 2024",
        settings: {
            discipline: "UTILITY",
            projection: BOUNDS.projection,
            minClearanceInches: BOUNDS.minCrossingClearanceInches,
            eastingMin: BOUNDS.eastingMin,
            eastingMax: BOUNDS.eastingMax,
            northingMin: BOUNDS.northingMin,
            northingMax: BOUNDS.northingMax,
            sheetDwt: "JEA_AsBuilt_2024.dwt",
            county: "Duval",
            district: 2,
            rulesVersion: "2024.1"
        }
    };

    const LAYERS = [
        { name: "W-MAIN", color: 4, desc: "Water Distribution & Transmission Mains" },
        { name: "W-VALV", color: 5, desc: "Water Gate/Butterfly/ARV Valves" },
        { name: "W-HYDR", color: 2, desc: "Water Fire Hydrants" },
        { name: "W-FITT", color: 6, desc: "Water Fittings (Tee, Cross, Reducer, Bend)" },
        { name: "W-METR", color: 3, desc: "Water Service Meters & Backflow Units" },
        { name: "W-LOC8", color: 1, desc: "Water Locate Wire Boxes & Marker Balls" },
        { name: "SS-GRAV", color: 3, desc: "Sanitary Gravity Sewer Mains" },
        { name: "SS-FM", color: 30, desc: "Sanitary Sewer Force Mains & Low Pressure" },
        { name: "SS-MANH", color: 1, desc: "Sanitary Sewer Manholes" },
        { name: "SS-VALV", color: 5, desc: "Sewer Valves (Plug, Gate, Air Release)" },
        { name: "SS-FITT", color: 6, desc: "Sewer Fittings & Cleanouts" },
        { name: "SS-METR", color: 3, desc: "Sewer Customer Points & Flow Meters" },
        { name: "SS-LOC8", color: 1, desc: "Sewer Locate Wire Boxes & Marker Balls" },
        { name: "RW-MAIN", color: 210, desc: "Reclaimed Water Distribution Mains" },
        { name: "RW-VALV", color: 5, desc: "Reclaimed Water Valves" },
        { name: "RW-HYDR", color: 2, desc: "Reclaimed Water Hydrants" },
        { name: "RW-METR", color: 3, desc: "Reclaimed Water Meters" },
        { name: "RW-FITT", color: 6, desc: "Reclaimed Water Fittings" },
        { name: "CW-MAIN", color: 140, desc: "Chilled Water Supply & Return Mains" },
        { name: "UTIL-CROSS", color: 7, desc: "Utility Pipe Crossing Markers & Labels" }
    ];

    const DOMAINS = {
    "Subtype Chilled Fitting": [
        "Cross",
        "Elbow 11.25",
        "Elbow 22.5",
        "Elbow 45",
        "Elbow 90",
        "Plug",
        "Reducer",
        "Repair Coupling",
        "Sleeve",
        "Tapping Sleeve",
        "Tee",
        "Transition Coupling",
        "Other",
        "Unknown Fitting",
        "Vertical"
    ],
    "Subtype Locate Box": [
        "Marker Ball",
        "Locate Wire Box"
    ],
    "Subtype Manhole": [
        "Collection",
        "Effluent",
        "Force Main",
        "Low Pressure",
        "Trunk"
    ],
    "Subtype Reclaimed Fitting": [
        "Cross",
        "Elbow 11.25",
        "Elbow 22.5",
        "Elbow 45",
        "Elbow 90",
        "Lateral Main Connection",
        "Plug",
        "Reducer",
        "Repair Coupling",
        "Service Lateral Fitting",
        "Sleeve",
        "Tapping Sleeve",
        "Tapping Saddle",
        "Tee",
        "Transition Coupling",
        "WYE",
        "Other",
        "Unknown Fitting",
        "Vertical",
        "Cap, Tapped",
        "Stub",
        "Cap"
    ],
    "Subtype Reclaimed Meter": [
        "Control Meter",
        "Major Meter",
        "Minor Meter",
        "Plant Meter"
    ],
    "Subtype Reclaimed Pipe": [
        "Augmentation Main",
        "Hydrant Lateral",
        "Reclaimed Main",
        "Service Lateral"
    ],
    "Subtype Reclaimed Valve": [
        "Valve",
        "Backflow Preventor",
        "Hydrant Valve"
    ],
    "Subtype Sewer Customer Point": [
        "Customer Point",
        "Sewer Flow Meter"
    ],
    "Subtype Sewer Fitting": [
        "Cleanout",
        "Cross",
        "Elbow 11.25",
        "Elbow 22.5",
        "Elbow 45",
        "Elbow 90",
        "Lateral Main Connection",
        "Other",
        "Plug",
        "Reducer",
        "Repair Coupling",
        "Service Lateral Fitting",
        "Sleeve",
        "Stub",
        "Tapping Sleeve",
        "Tapping Saddle",
        "Tee",
        "Transition Coupling",
        "Unknown Fitting",
        "Vertical",
        "WYE",
        "Cap, Tapped",
        "Cap"
    ],
    "Subtype Sewer Gravity Pipe": [
        "Collection Main",
        "Trunk Main",
        "Collection Lateral"
    ],
    "Subtype Sewer Pressure Pipe": [
        "Force Main",
        "Low Pressure Main",
        "Vacuum Main",
        "Sludge Main",
        "Effluent Main",
        "Plant Pipe",
        "Low Pressure Lateral",
        "Vacuum Lateral"
    ],
    "Subtype Sewer Valve": [
        "Valve",
        "Pump Out",
        "Air Release Valve"
    ],
    "Subtype Water Fitting": [
        "Cross",
        "Elbow 11.25",
        "Elbow 22.5",
        "Elbow 45",
        "Elbow 90",
        "Lateral Main Connection",
        "Plug",
        "Reducer",
        "Repair Coupling",
        "Service Lateral Fitting",
        "Sleeve",
        "Tapping Sleeve",
        "Tapping Saddle",
        "Tee",
        "Transition Coupling",
        "Vertical",
        "WYE",
        "Other",
        "Unknown Fitting",
        "Cap, Tapped",
        "Stub",
        "Cap"
    ],
    "Subtype Water Meter": [
        "Interconnect",
        "Major Meter",
        "Minor Meter",
        "Plant Meter",
        "Irrigation Meter",
        "Fire Meter"
    ],
    "Subtype Water Pipe": [
        "Distribution Main",
        "Fire Line Main",
        "Raw Water Main",
        "Transmission Main",
        "Service Lateral",
        "Hydrant Lateral"
    ],
    "Subtype Water Valve": [
        "Valve",
        "Backflow Preventor",
        "Hydrant Valve",
        "Air Release Valve"
    ],
    "Chilled Pipe Class": [
        "CL50",
        "CL51",
        "DR11",
        "DR14",
        "DR17",
        "DR18",
        "DR25",
        "PC150",
        "PC250",
        "N/A",
        "Other",
        "Unknown"
    ],
    "Chilled Pipe Role": [
        "Return",
        "Supply"
    ],
    "County": [
        "Clay",
        "Duval",
        "Nassau",
        "St Johns"
    ],
    "Crossing Pipe Type": [
        "Potable Water",
        "Gravity Sewer",
        "Force Main",
        "Vacuum Sewer",
        "Reclaimed",
        "Storm"
    ],
    "Facility Owner": [
        "JEA",
        "Private",
        "Unknown"
    ],
    "Fitting Manufacturers": [
        "American Cast Iron Pipe Company",
        "Cascade Waterworks Mfg",
        "Charlotte Pipe and Foundry Co",
        "Chemtrol/NIBCO",
        "Clow Valve",
        "Dresser Inc/GE",
        "FERNCO",
        "Ford Meter Box",
        "Galaxy Plastics",
        "Georg Fisher Sloane Manufacturing",
        "GPK Products Inc",
        "Harco Inc",
        "Harrington Corporation (HARCO)",
        "Ipex",
        "JCM Industries Inc",
        "Lasco Fittings Inc",
        "M&H Valve Company",
        "Mueller",
        "Mueller Aqua Grip",
        "Mueller Company",
        "Multi-Fittings",
        "Other",
        "Plastic Trends (Royal Building Projects)",
        "Power Seal",
        "Romac",
        "Romac Industries Inc",
        "Sigma Corp (Russell Pipe)",
        "SIP Industries",
        "Smith-Blair",
        "Spears Manufacturing",
        "Star Pipe Products",
        "TigreADS USA",
        "TPS Hymax",
        "Tyler Union",
        "Unknown",
        "US Pipe"
    ],
    "Hydrant Model": [
        "American Darling",
        "American Flow",
        "AVK",
        "Clow",
        "Kennedy",
        "M&H",
        "Matthews",
        "Mueller",
        "US Pipe",
        "Waterous",
        "Other",
        "Unknown"
    ],
    "Manhole Drop Type": [
        "Outside",
        "Inside",
        "Unknown"
    ],
    "Manhole Exterior Joint Tape Manufacturer": [
        "Con Seal",
        "Rub-R-Nek/Henry Company",
        "Wrapid Seal (CCI Pipeline systems)",
        "Other",
        "Unknown"
    ],
    "Manhole Lining Material": [
        "Polyethylene",
        "Polyurethane",
        "Epoxy",
        "Fiberglass",
        "Fosroc",
        "Polyurea",
        "Spectrashield",
        "Other",
        "Unknown",
        "N/A"
    ],
    "Manhole Manufacturer": [
        "Armorock",
        "Del Zotto Precast",
        "Forterra",
        "Standard Precast",
        "Other",
        "Unknown"
    ],
    "Manhole Material": [
        "Brick Masonry",
        "Concrete Block",
        "Precast",
        "Cast In Place",
        "Fiberglass",
        "Polymer Concrete",
        "Unknown"
    ],
    "Manhole Type": [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "Junction",
        "Special",
        "Special Meter",
        "Unknown"
    ],
    "Meter Box Manufacturer": [
        "Glassmasters",
        "Southern Meter Box",
        "Pentek",
        "Other",
        "Unknown"
    ],
    "Meter Box Material": [
        "Polymer",
        "Concrete",
        "Other",
        "Unknown"
    ],
    "Meter Size Inches": [
        "0.75",
        "1",
        "1.25",
        "1.5",
        "1.75",
        "2",
        "2.25",
        "2.5",
        "3",
        "3.5",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "12",
        "14",
        "15",
        "16",
        "18",
        "20",
        "21",
        "22",
        "24",
        "27",
        "30",
        "36",
        "42",
        "48",
        "50",
        "54",
        "57",
        "60",
        "66",
        "72",
        "78",
        "84",
        "102",
        "120",
        "-998",
        "-999",
        "Existing"
    ],
    "Pipe and Fitting Material": [
        "Asbestos Cement",
        "Brass",
        "Brick Masonry",
        "Cast Iron",
        "Concrete",
        "Copper",
        "Ductile Iron",
        "Galvanized",
        "High Density Polyethylene",
        "Orangeburg",
        "Polybutylene",
        "Polyethylene",
        "PVC",
        "Reinforced Concrete",
        "Stainless Steel",
        "Steel",
        "Vitrified Clay",
        "Other",
        "Unknown"
    ],
    "Pipe Location": [
        "Point of Connection",
        "Top of Pipe Shot",
        "Top of Casing"
    ],
    "Pipe Manufacturers": [
        "Accord Industries",
        "Advanced Drainage System",
        "American Cast Iron Pipe Company",
        "Charlotte Pipe and Foundry Co",
        "Charter Plastics",
        "Diamond Plastics",
        "Endot Yardley",
        "Grinnell Corporation",
        "HAWK Plastics Corporation",
        "Ipex",
        "JM Eagle Manufacturing",
        "McWane Ductile",
        "National Pipe & Plastics/National PVC",
        "North American Pipe Co (NAPCO)",
        "Phillips Driscopipe/Performance Pipe",
        "Sanderson Pipe Corporation",
        "Silver-Line Plastics",
        "Universal 100 / Accord",
        "U.S. Pipe",
        "Wheatland Tube",
        "Westlake Pipe and Fittings Corporation",
        "Other",
        "Unknown"
    ],
    "Orientation": [
        "Underground",
        "Aboveground"
    ],
    "Sewer Pipe Class": [
        "CL50",
        "CL51",
        "CL52",
        "CL53",
        "CL55",
        "DR11",
        "DR14",
        "DR17",
        "DR18",
        "DR19",
        "DR25",
        "SCH40",
        "SCH80",
        "SDR21",
        "SDR35",
        "SDR26 / PR160",
        "N/A",
        "Other",
        "Unknown"
    ],
    "Sewer Pipe Lining Material": [
        "Cured in Place",
        "Epoxy",
        "Fiber Reinforced Polyester Resin",
        "Polyethylene",
        "Polyurethane",
        "N/A",
        "Unknown"
    ],
    "Size Feet": [
        "2",
        "2.67",
        "3",
        "3.5",
        "4",
        "5",
        "5.5",
        "6",
        "8",
        "10",
        "12",
        "-998",
        "-999"
    ],
    "Size Inches": [
        "0.75",
        "1",
        "1.25",
        "1.5",
        "1.75",
        "2",
        "2.25",
        "2.5",
        "3",
        "3.5",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "12",
        "14",
        "15",
        "16",
        "18",
        "20",
        "21",
        "22",
        "24",
        "27",
        "30",
        "36",
        "42",
        "48",
        "50",
        "54",
        "57",
        "60",
        "66",
        "72",
        "78",
        "84",
        "102",
        "120",
        "-998",
        "-999"
    ],
    "Valve Manufacturer": [
        "American Darling",
        "American Flow Control",
        "Ames",
        "ARI",
        "AVK",
        "Bermad",
        "Clow",
        "Dezurik",
        "H-TEC",
        "Insert-A-Valve",
        "Insta-Valve",
        "Kennedy",
        "Keystone",
        "M&H",
        "Matco-Norca",
        "Milliken",
        "Mueller",
        "NIBCO",
        "Pratt",
        "Romac",
        "US Pipe",
        "United Water Product",
        "Val-Matic",
        "Vent-O-Mat",
        "Waterous",
        "Other",
        "Unknown",
        "Crispin"
    ],
    "Valve Open Direction": [
        "Left",
        "Right",
        "N/A",
        "Unknown"
    ],
    "Valve Type": [
        "ARV",
        "BFP",
        "Ball",
        "Blow Off",
        "Butterfly",
        "Check",
        "Control Valve",
        "Corp Stop",
        "Flapper",
        "Double Disk Gate",
        "Flushing Hydrant",
        "Pitometer Gauge Point",
        "Plug",
        "Pressure Regulating",
        "Pump-Out Assembly",
        "RPDA",
        "RPZ",
        "Resilient Seat Wedge Gate",
        "Tapping",
        "Unknown"
    ],
    "Water/Reclaimed Pipe Class": [
        "CL50",
        "CL51",
        "CL52",
        "CL53",
        "CL54",
        "DR11",
        "DR14",
        "DR17",
        "DR18",
        "DR25",
        "PC150",
        "PC250",
        "PC350",
        "SCH40",
        "SCH80",
        "SDR9",
        "SDR21",
        "SDR35",
        "SDR26 / PR160",
        "N/A",
        "Other",
        "Unknown"
    ],
    "Water/Reclaimed/Chilled Pipe Lining Material": [
        "Cementitious",
        "Cured In Place",
        "N/A",
        "Unknown"
    ]
};

    const RULES = {
    "Pipe Crossing Table": [
        {
            "column": "Crossing Number",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Upper Pipe  Type",
            "rule": "Validation List: Crossing Pipe Type",
            "note": ""
        },
        {
            "column": "Upper Pipe  Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Upper Pipe  Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Cover to Top of Upper Pipe (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Upper Pipe  Bottom Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Lower Pipe  Type",
            "rule": "Validation List: Crossing Pipe Type",
            "note": ""
        },
        {
            "column": "Lower Pipe  Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Lower Pipe  Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Cover to Top of Lower Pipe (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Separation Between Pipes (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord  (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord  (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Water Pipe Run": [
        {
            "column": "Pipe Run Number (WM#)",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Subtype",
            "rule": "Validation List: Subtype Water Pipe",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Water/Reclaimed Pipe Class",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Measured Length (Feet)",
            "rule": "Decimal Value",
            "note": "Note: This Table is Optional"
        }
    ],
    "Water Points along Pipe": [
        {
            "column": "Pipe Location Number (WPOC#, WPOL#, etc)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Location",
            "rule": "Validation List: Pipe Location",
            "note": ""
        },
        {
            "column": "Pipe Subtype",
            "rule": "Validation List: Subtype Water Pipe",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Pipe Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Water/Reclaimed Pipe Class",
            "note": ""
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": ""
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Cover (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Water Fitting": [
        {
            "column": "Fitting Number (WF#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Fitting Subtype",
            "rule": "Validation List: Subtype Water Fitting",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Fitting Size Primary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Fitting Size Secondary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Manufacturer",
            "rule": "Validation List: Fitting Manufacturers",
            "note": ""
        },
        {
            "column": "Fitting Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Fitting Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Fitting Depth (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Water Valve": [
        {
            "column": "Valve Number (WV#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Valve Subtype",
            "rule": "Validation List: Subtype Water Valve",
            "note": ""
        },
        {
            "column": "Valve Type",
            "rule": "Validation List: Valve Type",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Valve Size",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Valve Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Valve Open Direction",
            "rule": "Validation List: Valve Open Direction",
            "note": ""
        },
        {
            "column": "Turns to Open",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Nut Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Depth to Nut (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Manufacturer",
            "rule": "Validation List: Valve Manufacturer",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Water Hydrants": [
        {
            "column": "Hydrant Number (WH#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Hydrant Manufacture Date (Year)",
            "rule": "Year - Whole Number > 2000",
            "note": ""
        },
        {
            "column": "Hydrant Manufacturer",
            "rule": "Validation List: Hydrant Model",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        },
        {
            "column": "RFID/Barcode Number",
            "rule": "Open Text",
            "note": ""
        }
    ],
    "Water Meter": [
        {
            "column": "Meter Box Number (WM#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Proposed Meter Size",
            "rule": "Validation List: Meter Size Inches",
            "note": ""
        },
        {
            "column": "Meter Box Subtype",
            "rule": "Validation List: Subtype Water Meter",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Meter Box Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Meter Box Manufacturer/Supplier",
            "rule": "Validation List: Meter Box Manufacturer",
            "note": ""
        },
        {
            "column": "Meter Box Material",
            "rule": "Validation List: Meter Box Material",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Water Locate Box": [
        {
            "column": "Locate Box Number (WL#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Locate Box Subtype",
            "rule": "Validation List: Subtype Locate Box",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "WW Gravity Pipe Run": [
        {
            "column": "Sewer Pipe Run Number (GM#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Sewer Pipe Subtype",
            "rule": "Validation List: Subtype Sewer Gravity Pipe",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Sewer Pipe Class",
            "note": ""
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": ""
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Sewer Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Pipe Run Length (feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Downstream Pipe Invert Elevation (feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Downstream Grade Elevation at Invert (feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Upstream Pipe Invert Elevation (feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Upstream Grade Elevation at Invert (feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Slope (percent)",
            "rule": "Decimal Value",
            "note": ""
        }
    ],
    "WW Pressure Pipe Run": [
        {
            "column": "Pipe Run Number (FM#)",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Subtype",
            "rule": "Validation List: Subtype Sewer Pressure Pipe",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Sewer Pipe Class",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Sewer Pipe Lining Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Measured Length (Feet)",
            "rule": "Decimal Value",
            "note": "Note: This Table is Optional"
        }
    ],
    "WW Points along Pipe": [
        {
            "column": "Pipe Location Number (WWPOC, WWPOL#, etc)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Location",
            "rule": "Validation List: Pipe Location",
            "note": ""
        },
        {
            "column": "Pipe Subtype",
            "rule": "Validation List: Subtype Sewer Pressure Pipe",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Pipe Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Sewer Pipe Class",
            "note": ""
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": ""
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Sewer Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Cover (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "WW Fitting": [
        {
            "column": "Fitting Number (WWF# or FMF#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Fitting Subtype",
            "rule": "Validation List: Subtype Sewer Fitting",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Fitting Size Primary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Fitting Size Secondary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Manufacturer",
            "rule": "Validation List: Fitting Manufacturers",
            "note": ""
        },
        {
            "column": "Fitting Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Lining Material",
            "rule": "Validation List: Sewer Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Fitting Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Fitting Depth (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Manhole": [
        {
            "column": "Manhole Number (MH#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Manhole Subtype",
            "rule": "Validation List: Subtype Manhole",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Manhole Type",
            "rule": "Validation List: Manhole Type",
            "note": ""
        },
        {
            "column": "Manhole Drop Type",
            "rule": "Validation List: Manhole Drop Type",
            "note": ""
        },
        {
            "column": "Manufacturer or Supplier",
            "rule": "Validation List: Manhole Manufacturer",
            "note": ""
        },
        {
            "column": "Manhole Size (Feet)",
            "rule": "Validation List: Size Feet",
            "note": ""
        },
        {
            "column": "Manhole Material",
            "rule": "Validation List: Manhole Material",
            "note": ""
        },
        {
            "column": "Manhole Lining Material",
            "rule": "Validation List: Manhole Lining Material",
            "note": ""
        },
        {
            "column": "Manhole Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Rim Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Invert Elevations (Feet) with Directions",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Lowest Invert Elevation (feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Exterior Joint Tape Type",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Exterior Joint Tape Manufacturer",
            "rule": "Validation List: Manhole Exterior Joint Tape Manufacturer",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        },
        {
            "column": "RFID/Barcode Number",
            "rule": "Open Text",
            "note": ""
        }
    ],
    "WW Service Point & Meter": [
        {
            "column": "Wastewater Service Point Number (WWSP# or WWM#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Service Point Subtype",
            "rule": "Validation List: Subtype Sewer Customer Point",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation at Service Point",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Top of Pipe Elevation at Service Point (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Depth of Cover (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "WW Valve": [
        {
            "column": "Valve Number (WWV#)",
            "rule": "Open Text (WWV-#)",
            "note": ""
        },
        {
            "column": "Valve Subtype",
            "rule": "Validation List: Subtype Sewer Valve",
            "note": ""
        },
        {
            "column": "Valve Type",
            "rule": "Validation List: Valve Type",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Valve Size",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Valve Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Valve Open Direction",
            "rule": "Validation List: Valve Open Direction",
            "note": ""
        },
        {
            "column": "Turns to Open",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Nut Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Depth to Nut (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Manufacturer",
            "rule": "Validation List: Valve Manufacturer",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "WW Locate Box": [
        {
            "column": "Locate Box Number (WWL#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Locate Box Subtype",
            "rule": "Validation List: Subtype Locate Box",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Reclaimed Pipe Run": [
        {
            "column": "Pipe Run Number (RM#)",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Subtype",
            "rule": "Validation List: Subtype Reclaimed Pipe",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Water/Reclaimed Pipe Class",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Measured Length (Feet)",
            "rule": "Decimal Value",
            "note": "Note: This Table is Optional"
        }
    ],
    "Reclaimed Points along Pipe": [
        {
            "column": "Pipe Location Number (RPOC#, RPOL#, etc)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Location",
            "rule": "Validation List: Pipe Location",
            "note": ""
        },
        {
            "column": "Pipe Subtype",
            "rule": "Validation List: Subtype Reclaimed Pipe",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Pipe Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Water/Reclaimed Pipe Class",
            "note": ""
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": ""
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Cover (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Reclaimed Fitting": [
        {
            "column": "Fitting Number (RF#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Fitting Subtype",
            "rule": "Validation List: Subtype Reclaimed Fitting",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Fitting Size Primary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Fitting Size Secondary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Manufacturer",
            "rule": "Validation List: Fitting Manufacturers",
            "note": ""
        },
        {
            "column": "Fitting Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Fitting Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Depth (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Reclaimed Valve": [
        {
            "column": "Valve Number (RV#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Valve Subtype",
            "rule": "Validation List: Subtype Reclaimed Valve",
            "note": ""
        },
        {
            "column": "Valve Type",
            "rule": "Validation List: Valve Type",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Valve Size",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Valve Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Valve Open Direction",
            "rule": "Validation List: Valve Open Direction",
            "note": ""
        },
        {
            "column": "Turns to Open",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Nut Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Depth to Nut (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Manufacturer",
            "rule": "Validation List: Valve Manufacturer",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Reclaimed Hydrant": [
        {
            "column": "Hydrant Number (RH#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Hydrant Manufacture Date (Year)",
            "rule": "Year - Whole Number > 2000",
            "note": ""
        },
        {
            "column": "Hydrant Manufacturer",
            "rule": "Validation List: Hydrant Model",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        },
        {
            "column": "RFID/Barcode Number",
            "rule": "Open Text",
            "note": ""
        }
    ],
    "Reclaimed Meter": [
        {
            "column": "Meter Box Number (RM#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Proposed Meter Size",
            "rule": "Validation List: Meter Size Inches",
            "note": ""
        },
        {
            "column": "Meter Box Subtype",
            "rule": "Validation List: Subtype Reclaimed Meter",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Meter Box Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Meter Box Manufacturer/Supplier",
            "rule": "Validation List: Meter Box Manufacturer",
            "note": ""
        },
        {
            "column": "Meter Box Material",
            "rule": "Validation List: Meter Box Material",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Reclaimed Locate Box": [
        {
            "column": "Locate Box Number (RL#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Locate Box Subtype",
            "rule": "Validation List: Subtype Locate Box",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Chilled Pipe Run": [
        {
            "column": "Pipe Run Number (CM#)",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Role",
            "rule": "Validation List: Chilled Pipe Role",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Chilled Pipe Class",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": "Note: This Table is Optional"
        },
        {
            "column": "Measured Length (Feet)",
            "rule": "Decimal Value",
            "note": "Note: This Table is Optional"
        }
    ],
    "Chilled Points along Pipe": [
        {
            "column": "Pipe Location Number (CPOC#, CPOL#, etc)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Location",
            "rule": "Validation List: Pipe Location",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Pipe Size (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Pipe Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Pipe Class",
            "rule": "Validation List: Chilled Pipe Class",
            "note": ""
        },
        {
            "column": "Pipe Manufacturer",
            "rule": "Validation List: Pipe Manufacturers",
            "note": ""
        },
        {
            "column": "Pipe Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Pipe Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Pipe Lining Material",
            "rule": "Validation List: Water/Reclaimed Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Pipe Cover (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Chilled Fitting": [
        {
            "column": "Fitting Number (CF#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Fitting Subtype",
            "rule": "Validation List: Subtype Chilled Fitting",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Fitting Size Primary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Fitting Size Secondary (Inches)",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Manufacturer",
            "rule": "Validation List: Fitting Manufacturers",
            "note": ""
        },
        {
            "column": "Fitting Material",
            "rule": "Validation List: Pipe and Fitting Material",
            "note": ""
        },
        {
            "column": "Lining Manufacturer",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Lining Material",
            "rule": "Water/Reclaimed/Chilled Pipe Lining Material",
            "note": ""
        },
        {
            "column": "Fitting Top Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Fitting Depth (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Chilled Valve": [
        {
            "column": "Valve Number (CV#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Valve Type",
            "rule": "Validation List: Valve Type",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "Valve Size",
            "rule": "Validation List: Size Inches",
            "note": ""
        },
        {
            "column": "Valve Orientation",
            "rule": "Validation List: Orientation",
            "note": ""
        },
        {
            "column": "Valve Open Direction",
            "rule": "Validation List: Valve Open Direction",
            "note": ""
        },
        {
            "column": "Turns to Open",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Nut Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Finished Grade Elevation (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Depth to Nut (Feet)",
            "rule": "Decimal Value",
            "note": ""
        },
        {
            "column": "Valve Manufacturer",
            "rule": "Validation List: Valve Manufacturer",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Chilled Meter": [
        {
            "column": "Meter Room Number (CM#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Proposed Meter Size",
            "rule": "Validation List: Meter Size Inches",
            "note": ""
        },
        {
            "column": "Facility Owner",
            "rule": "Validation List: Facility Owner",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ],
    "Chilled Locate Box": [
        {
            "column": "Locate Box Number (CL#)",
            "rule": "Open Text",
            "note": ""
        },
        {
            "column": "Locate Box Subtype",
            "rule": "Validation List: Subtype Locate Box",
            "note": ""
        },
        {
            "column": "X Coord (State Plane Easting Feet)",
            "rule": "Decimal Value > 320,000 and < 590,000",
            "note": ""
        },
        {
            "column": "Y Coord (State Plane Northing Feet)",
            "rule": "Decimal Value > 1,920,000 and < 2,370,000",
            "note": ""
        },
        {
            "column": "Latitude (Decimal Degrees)",
            "rule": "Decimal Value > 29 and < 31",
            "note": ""
        },
        {
            "column": "Longitude (Decimal Degrees)",
            "rule": "Decimal Value > -83 and < -80",
            "note": ""
        }
    ]
};

    const BLOCK_DEFS = {
        JEA_VALVE: ["SUBTYPE", "VALVE_TYPE", "SIZE", "MATERIAL", "MANUFACTURER", "OPEN_DIR", "STATUS", "ELEVATION"],
        JEA_MANHOLE: ["SUBTYPE", "MANHOLE_TYPE", "RIM_ELEV", "INVERT_IN", "INVERT_OUT", "DEPTH", "DIAMETER", "MATERIAL", "MANUFACTURER", "LINING"],
        JEA_HYDRANT: ["SUBTYPE", "MODEL", "MANUFACTURER", "VALVE_SIZE", "BURY_DEPTH", "ELEVATION"],
        JEA_FITTING: ["SUBTYPE", "SIZE", "MATERIAL", "MANUFACTURER", "ELEVATION"],
        JEA_METER: ["SUBTYPE", "SIZE", "BOX_MFR", "BOX_MAT", "ELEVATION", "ACCOUNT_NO"],
        JEA_LOCATE_BOX: ["SUBTYPE", "ELEVATION", "COLOR"],
        JEA_CROSSING: ["CROSS_NO", "UPPER_TYPE", "UPPER_SIZE", "UPPER_BOT_ELEV", "LOWER_TYPE", "LOWER_SIZE", "LOWER_TOP_ELEV", "CLEARANCE_INCHES", "COMPLIANT"]
    };

    // ═════════════════════════════════════════════════════════════════════
    // 2. Sample Demo Utility Network (Compliant with JEA 2024 specs)
    // ═════════════════════════════════════════════════════════════════════

    function getSampleNetwork() {
        return {
            projectName: "JEA San Jose Blvd Water & Sewer Realignment",
            county: "Duval",
            bounds: BOUNDS,
            pipes: [
                {
                    id: "W_PIPE_01",
                    layer: "W-MAIN",
                    system: "Water",
                    subtype: "Distribution Main",
                    diameter: "8",
                    material: "Ductile Iron",
                    pipeClass: "CL50",
                    lining: "Cementitious",
                    points: [
                        { p: 101, e: 436210.50, n: 2154320.10, z: 22.40, station: "10+00" },
                        { p: 102, e: 436350.80, n: 2154320.10, z: 22.15, station: "11+40" },
                        { p: 103, e: 436520.00, n: 2154320.10, z: 21.80, station: "13+10" }
                    ]
                },
                {
                    id: "SS_GRAV_01",
                    layer: "SS-GRAV",
                    system: "Sewer",
                    subtype: "Collection Main",
                    diameter: "8",
                    material: "Polyvinyl Chloride",
                    pipeClass: "DR26",
                    points: [
                        { p: 201, e: 436350.80, n: 2154200.00, z: 16.50, desc: "MH_101" },
                        { p: 202, e: 436350.80, n: 2154320.10, z: 15.80, desc: "CROSSING_PT" },
                        { p: 203, e: 436350.80, n: 2154480.00, z: 14.90, desc: "MH_102" }
                    ]
                }
            ],
            structures: [
                {
                    id: "V-101",
                    block: "JEA_VALVE",
                    layer: "W-VALV",
                    e: 436215.00,
                    n: 2154320.10,
                    z: 22.40,
                    attribs: {
                        SUBTYPE: "Valve",
                        VALVE_TYPE: "Resilient Seat Wedge Gate",
                        SIZE: "8",
                        MATERIAL: "Ductile Iron",
                        MANUFACTURER: "American Flow Control",
                        OPEN_DIR: "Left",
                        STATUS: "Open",
                        ELEVATION: "22.40"
                    }
                },
                {
                    id: "HYD-101",
                    block: "JEA_HYDRANT",
                    layer: "W-HYDR",
                    e: 436280.00,
                    n: 2154332.00,
                    z: 22.90,
                    attribs: {
                        SUBTYPE: "Hydrant",
                        MODEL: "American Darling",
                        MANUFACTURER: "American Flow Control",
                        VALVE_SIZE: "6",
                        BURY_DEPTH: "4.5",
                        ELEVATION: "22.90"
                    }
                },
                {
                    id: "FIT-101",
                    block: "JEA_FITTING",
                    layer: "W-FITT",
                    e: 436350.80,
                    n: 2154320.10,
                    z: 22.15,
                    attribs: {
                        SUBTYPE: "Tee",
                        SIZE: "8",
                        MATERIAL: "Ductile Iron",
                        MANUFACTURER: "American Cast Iron Pipe Company",
                        ELEVATION: "22.15"
                    }
                },
                {
                    id: "MH-101",
                    block: "JEA_MANHOLE",
                    layer: "SS-MANH",
                    e: 436350.80,
                    n: 2154200.00,
                    z: 23.50,
                    attribs: {
                        SUBTYPE: "Collection",
                        MANHOLE_TYPE: "A",
                        RIM_ELEV: "23.50",
                        INVERT_IN: "16.80",
                        INVERT_OUT: "16.50",
                        DEPTH: "7.00",
                        DIAMETER: "4",
                        MATERIAL: "Precast",
                        MANUFACTURER: "Standard Precast",
                        LINING: "Epoxy"
                    }
                },
                {
                    id: "MH-102",
                    block: "JEA_MANHOLE",
                    layer: "SS-MANH",
                    e: 436350.80,
                    n: 2154480.00,
                    z: 23.10,
                    attribs: {
                        SUBTYPE: "Collection",
                        MANHOLE_TYPE: "A",
                        RIM_ELEV: "23.10",
                        INVERT_IN: "14.90",
                        INVERT_OUT: "14.70",
                        DEPTH: "8.40",
                        DIAMETER: "4",
                        MATERIAL: "Precast",
                        MANUFACTURER: "Standard Precast",
                        LINING: "Epoxy"
                    }
                }
            ],
            crossings: [
                {
                    id: "X-01",
                    block: "JEA_CROSSING",
                    layer: "UTIL-CROSS",
                    e: 436350.80,
                    n: 2154320.10,
                    z: 22.15,
                    attribs: {
                        CROSS_NO: "CR-01",
                        UPPER_TYPE: "Potable Water",
                        UPPER_SIZE: "8",
                        UPPER_BOT_ELEV: "21.48", // 8" water pipe: bottom = 22.15 - 0.67 = 21.48
                        LOWER_TYPE: "Gravity Sewer",
                        LOWER_SIZE: "8",
                        LOWER_TOP_ELEV: "16.47", // 8" sewer: crown = 15.80 + 0.67 = 16.47
                        // Vertical separation: 21.48 - 16.47 = 5.01 ft = 60.12 inches >= 18 inches -> COMPLIANT
                        CLEARANCE_INCHES: "60.1",
                        COMPLIANT: "YES"
                    }
                }
            ]
        };
    }

    // ═════════════════════════════════════════════════════════════════════
    // 3. Civil 3D DXF Generation Engine
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Builds a full Civil 3D DXF string containing JEA layer tables,
     * block definitions with ATTDEF tags, LWPOLYLINE pipe runs, and
     * INSERT block occurrences with ATTRIB metadata.
     */
    function buildJeaDxf(model, options) {
        const net = model || getSampleNetwork();
        const out = [];
        const p = (code, val) => { out.push(String(code)); out.push(String(val)); };

        // HEADER SECTION
        p(0, "SECTION"); p(2, "HEADER");
        p(9, "$ACADVER"); p(1, "AC1018"); // AutoCAD 2004+ format
        p(9, "$INSUNITS"); p(70, 2);     // US Survey Feet
        p(9, "$MEASUREMENT"); p(70, 0);  // Imperial
        p(0, "ENDSEC");

        // TABLES SECTION
        p(0, "SECTION"); p(2, "TABLES");

        // VPORT Table
        p(0, "TABLE"); p(2, "VPORT"); p(70, 1);
        p(0, "VPORT"); p(2, "*ACTIVE"); p(70, 0);
        p(10, 0.0); p(20, 0.0);
        p(11, 1.0); p(21, 1.0);
        p(12, 436350.0); p(22, 2154320.0); // Duval / JEA footprint
        p(40, 500.0); p(41, 1.5);
        p(0, "ENDTAB");

        // LAYER Table
        p(0, "TABLE"); p(2, "LAYER"); p(70, LAYERS.length + 1);
        p(0, "LAYER"); p(2, "0"); p(70, 0); p(62, 7); p(6, "CONTINUOUS");
        LAYERS.forEach(l => {
            p(0, "LAYER"); p(2, l.name); p(70, 0); p(62, l.color); p(6, "CONTINUOUS");
        });
        p(0, "ENDTAB");
        p(0, "ENDSEC");

        // BLOCKS SECTION (Civil 3D utility symbols with JEA ATTDEF attributes)
        p(0, "SECTION"); p(2, "BLOCKS");
        Object.entries(BLOCK_DEFS).forEach(([blkName, tagList]) => {
            p(0, "BLOCK"); p(2, blkName); p(70, 2); // 2 = has attributes
            p(10, 0.0); p(20, 0.0); p(30, 0.0);
            p(3, blkName); p(1, "");

            // Geometry of the block symbol
            if (blkName === "JEA_VALVE") {
                p(0, "CIRCLE"); p(8, "0"); p(10, 0.0); p(20, 0.0); p(40, 2.0);
                p(0, "LINE"); p(8, "0"); p(10, -2.0); p(20, -2.0); p(11, 2.0); p(21, 2.0);
                p(0, "LINE"); p(8, "0"); p(10, -2.0); p(20, 2.0); p(11, 2.0); p(21, -2.0);
            } else if (blkName === "JEA_MANHOLE") {
                p(0, "CIRCLE"); p(8, "0"); p(10, 0.0); p(20, 0.0); p(40, 2.5);
                p(0, "CIRCLE"); p(8, "0"); p(10, 0.0); p(20, 0.0); p(40, 1.25);
            } else if (blkName === "JEA_HYDRANT") {
                p(0, "CIRCLE"); p(8, "0"); p(10, 0.0); p(20, 0.0); p(40, 1.8);
                p(0, "LINE"); p(8, "0"); p(10, 0.0); p(20, -2.5); p(11, 0.0); p(21, 2.5);
                p(0, "LINE"); p(8, "0"); p(10, -2.5); p(20, 0.0); p(11, 2.5); p(21, 0.0);
            } else if (blkName === "JEA_CROSSING") {
                p(0, "LINE"); p(8, "0"); p(10, -3.0); p(20, -3.0); p(11, 3.0); p(21, 3.0);
                p(0, "LINE"); p(8, "0"); p(10, -3.0); p(20, 3.0); p(11, 3.0); p(21, -3.0);
                p(0, "CIRCLE"); p(8, "0"); p(10, 0.0); p(20, 0.0); p(40, 3.0);
            } else {
                p(0, "CIRCLE"); p(8, "0"); p(10, 0.0); p(20, 0.0); p(40, 1.5);
            }

            // Attribute definitions
            tagList.forEach((tag, idx) => {
                p(0, "ATTDEF"); p(8, "0");
                p(10, 0.0); p(20, -idx * 2.0); p(30, 0.0);
                p(40, 1.2); p(1, ""); p(2, tag); p(3, tag);
                p(70, 1);
            });

            p(0, "ENDBLK");
        });
        p(0, "ENDSEC");

        // ENTITIES SECTION
        p(0, "SECTION"); p(2, "ENTITIES");

        // 1. Pipe Runs (LWPOLYLINE with 3D elevations and layer)
        (net.pipes || []).forEach(pipe => {
            p(0, "LWPOLYLINE");
            p(8, pipe.layer || "W-MAIN");
            p(90, pipe.points.length);
            p(70, 0);
            p(38, pipe.points[0]?.z || 0.0);

            pipe.points.forEach(pt => {
                p(10, Number(pt.e).toFixed(4));
                p(20, Number(pt.n).toFixed(4));
            });

            // Pipe label text at midpoint
            if (pipe.points.length >= 2) {
                const p1 = pipe.points[0], p2 = pipe.points[pipe.points.length - 1];
                const mx = (p1.e + p2.e) / 2, my = (p1.n + p2.n) / 2;
                p(0, "TEXT");
                p(8, pipe.layer || "W-MAIN");
                p(10, mx.toFixed(4)); p(20, (my + 2.0).toFixed(4)); p(30, 0.0);
                p(40, 2.0);
                p(1, `${pipe.diameter || '8'}" ${pipe.material || 'DIP'} ${pipe.pipeClass || ''} (${pipe.subtype || 'Pipe'})`.trim());
            }
        });

        // 2. Structures & Valves (INSERT with ATTRIB entities)
        (net.structures || []).forEach(st => {
            p(0, "INSERT");
            p(2, st.block || "JEA_VALVE");
            p(8, st.layer || "W-VALV");
            p(66, 1); // Attributes follow
            p(10, Number(st.e).toFixed(4));
            p(20, Number(st.n).toFixed(4));
            p(30, Number(st.z || 0.0).toFixed(4));
            p(41, 1.0); p(42, 1.0); p(43, 1.0);
            p(50, 0.0);

            const tags = BLOCK_DEFS[st.block] || Object.keys(st.attribs || {});
            tags.forEach(tag => {
                const val = st.attribs?.[tag] ?? "";
                p(0, "ATTRIB");
                p(8, st.layer || "0");
                p(10, Number(st.e).toFixed(4));
                p(20, Number(st.n).toFixed(4));
                p(30, Number(st.z || 0.0).toFixed(4));
                p(40, 1.2);
                p(1, String(val));
                p(2, tag);
                p(70, 0);
            });

            p(0, "SEQEND");

            // Text callout
            p(0, "TEXT");
            p(8, st.layer || "0");
            p(10, Number(st.e + 3.0).toFixed(4));
            p(20, Number(st.n + 3.0).toFixed(4));
            p(30, 0.0);
            p(40, 1.8);
            p(1, `${st.id}: ${st.attribs?.SUBTYPE || st.block} (Elev: ${st.z?.toFixed(2) || '0.00'}')`);
        });

        // 3. Pipe Crossings (INSERT with ATTRIB entities)
        (net.crossings || []).forEach(cr => {
            p(0, "INSERT");
            p(2, "JEA_CROSSING");
            p(8, cr.layer || "UTIL-CROSS");
            p(66, 1);
            p(10, Number(cr.e).toFixed(4));
            p(20, Number(cr.n).toFixed(4));
            p(30, Number(cr.z || 0.0).toFixed(4));
            p(41, 1.0); p(42, 1.0); p(43, 1.0);
            p(50, 0.0);

            const tags = BLOCK_DEFS.JEA_CROSSING;
            tags.forEach(tag => {
                const val = cr.attribs?.[tag] ?? "";
                p(0, "ATTRIB");
                p(8, cr.layer || "UTIL-CROSS");
                p(10, Number(cr.e).toFixed(4));
                p(20, Number(cr.n).toFixed(4));
                p(30, Number(cr.z || 0.0).toFixed(4));
                p(40, 1.2);
                p(1, String(val));
                p(2, tag);
                p(70, 0);
            });

            p(0, "SEQEND");

            // Crossing annotation callout
            const clrInches = cr.attribs?.CLEARANCE_INCHES || "0";
            const compliant = Number(clrInches) >= 18.0;
            p(0, "TEXT");
            p(8, cr.layer || "UTIL-CROSS");
            p(10, Number(cr.e + 4.0).toFixed(4));
            p(20, Number(cr.n - 4.0).toFixed(4));
            p(30, 0.0);
            p(40, 2.0);
            p(1, `X-ING ${cr.attribs?.CROSS_NO || cr.id}: ${clrInches}" CLR [${compliant ? 'PASS >=18"' : 'FAIL <18"'}]`);
        });

        p(0, "ENDSEC");
        p(0, "EOF");

        return out.join("\r\n") + "\r\n";
    }

    // ═════════════════════════════════════════════════════════════════════
    // 4. DXF Reverse-Reader & Parser
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Parses standard ASCII DXF into an object containing layers, polylines,
     * block inserts with attached attributes, text labels, and point coords.
     */
    function parseDxf(dxfString) {
        if (typeof dxfString !== "string") return { error: "Invalid DXF input (not a string)" };
        const lines = dxfString.split(/\r?\n/);
        let inEntities = false;
        let curEntity = null;
        let curInsert = null;

        const result = {
            layers: new Set(),
            polylines: [],
            inserts: [],
            texts: [],
            points: [],
            allEntities: []
        };

        for (let i = 0; i < lines.length - 1; i += 2) {
            const code = parseInt(lines[i].trim(), 10);
            const val = lines[i + 1] ? lines[i + 1].trim() : "";

            if (code === 0 && val === "SECTION") {
                if (i + 3 < lines.length && parseInt(lines[i + 2].trim(), 10) === 2 && lines[i + 3].trim() === "ENTITIES") {
                    inEntities = true;
                    i += 2;
                    continue;
                }
            }

            if (code === 0 && val === "ENDSEC") {
                inEntities = false;
                if (curEntity) flushEntity(curEntity, result);
                curEntity = null;
                continue;
            }

            if (!inEntities) continue;

            if (code === 0) {
                if (curEntity) {
                    flushEntity(curEntity, result);
                }

                if (val === "ATTRIB") {
                    curEntity = { type: "ATTRIB", attribs: {}, layer: "0" };
                } else if (val === "SEQEND") {
                    curInsert = null;
                    curEntity = null;
                } else {
                    curEntity = { type: val, layer: "0", attribs: {}, vertices: [] };
                    if (val === "INSERT") curInsert = curEntity;
                    else curInsert = null;
                }
                continue;
            }

            if (!curEntity) continue;

            if (code === 8) {
                curEntity.layer = val;
                result.layers.add(val);
            } else if (code === 2) {
                if (curEntity.type === "INSERT") curEntity.blockName = val;
                else if (curEntity.type === "ATTRIB") curEntity.tag = val;
            } else if (code === 1) {
                if (curEntity.type === "TEXT") curEntity.text = val;
                else if (curEntity.type === "ATTRIB") curEntity.val = val;
            } else if (code === 10) {
                const x = parseFloat(val);
                if (curEntity.type === "LWPOLYLINE") {
                    curEntity.vertices.push({ e: x, n: 0 });
                } else {
                    curEntity.e = x;
                }
            } else if (code === 20) {
                const y = parseFloat(val);
                if (curEntity.type === "LWPOLYLINE" && curEntity.vertices.length) {
                    curEntity.vertices[curEntity.vertices.length - 1].n = y;
                } else {
                    curEntity.n = y;
                }
            } else if (code === 30) {
                curEntity.z = parseFloat(val);
            } else if (code === 38) {
                curEntity.elevation = parseFloat(val);
            }
        }

        if (curEntity) flushEntity(curEntity, result);
        result.layers = Array.from(result.layers);
        return result;
    }

    function flushEntity(ent, res) {
        res.allEntities.push(ent);
        if (ent.type === "LWPOLYLINE") {
            res.polylines.push(ent);
        } else if (ent.type === "INSERT") {
            res.inserts.push(ent);
        } else if (ent.type === "TEXT") {
            res.texts.push(ent);
        } else if (ent.type === "ATTRIB") {
            const lastIns = res.inserts[res.inserts.length - 1];
            if (lastIns) {
                lastIns.attribs = lastIns.attribs || {};
                if (ent.tag) lastIns.attribs[ent.tag] = ent.val || "";
            }
        } else if (ent.type === "POINT" || ent.type === "CIRCLE") {
            res.points.push(ent);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // 5. JEA 2024 Audit Engine & Validation Logic
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Comprehensive QA/QC audit of a Civil 3D drawing or parsed model
     * against JEA As-Built 2024 standards:
     *   1. Bounding box & Florida State Plane East geodetic coordinates
     *   2. Picklist domains (21 of the 45 defined domains are checked below — Water block types;
     *      Sewer/Reclaimed/Chilled Water domains are defined in DOMAINS but not yet wired in here)
     *   3. Layer naming & block schema conventions
     *   4. Mandatory attribute presence
     *   5. Pipe crossing minimum 18-inch (1.5 ft) vertical clearance
     */
    function auditDrawing(dxfOrModel, options = {}) {
        const parsed = (typeof dxfOrModel === "string") ? parseDxf(dxfOrModel) : dxfOrModel;
        if (parsed.error) return { error: parsed.error, score: 0, compliant: false };

        const issues = [];
        let totalItems = 0;
        let passItems = 0;

        const bounds = options.bounds || BOUNDS;
        const checkBounds = options.checkBounds !== false;

        function logIssue(severity, rule, message, entity = "General", layer = "", e = null, n = null) {
            issues.push({
                severity,
                rule,
                message,
                entity,
                layer,
                easting: e,
                northing: n
            });
        }

        function validateDomain(domainKey, val, entityDesc, fieldName, layer = "", e = null, n = null) {
            if (!val) return true;
            const list = DOMAINS[domainKey];
            if (!list || !list.length) return true;

            const vClean = String(val).trim().toLowerCase();
            const matched = list.some(item => String(item).trim().toLowerCase() === vClean);
            if (!matched) {
                logIssue("error", `Domain: ${domainKey}`,
                    `Invalid ${fieldName} "${val}". Expected one of: ${list.slice(0, 6).join(", ")}${list.length > 6 ? '...' : ''}`,
                    entityDesc, layer, e, n);
                return false;
            }
            return true;
        }

        // 1. Audit Pipe Polyline Runs
        (parsed.polylines || []).forEach((pl, idx) => {
            totalItems++;
            const pName = `Polyline #${idx + 1} (${pl.layer})`;

            const recognized = LAYERS.some(l => l.name === pl.layer);
            if (!recognized) {
                logIssue("warning", "Layer Standards", `Pipe polyline is on non-standard JEA layer: "${pl.layer}"`, pName, pl.layer);
            }

            if (!pl.vertices || pl.vertices.length < 2) {
                logIssue("error", "Linework Geometry", "Pipe polyline has fewer than 2 vertices", pName, pl.layer);
            } else {
                pl.vertices.forEach((v, vIdx) => {
                    if (checkBounds && v.e != null && v.n != null) {
                        if (v.e < bounds.eastingMin || v.e > bounds.eastingMax ||
                            v.n < bounds.northingMin || v.n > bounds.northingMax) {
                            logIssue("error", "SPCS83 East Bounds",
                                `Vertex #${vIdx + 1} (E: ${v.e.toFixed(1)}, N: ${v.n.toFixed(1)}) is outside JEA Duval/St. Johns/Clay East Plane bounds (${bounds.eastingMin} - ${bounds.eastingMax})`,
                                pName, pl.layer, v.e, v.n);
                        } else {
                            if (window.COGO && window.COGO.statePlaneToLatLon) {
                                // COGO.statePlaneToLatLon(northing, easting, zoneKey, unit) returns
                                // {latDeg, lonDeg, zone} — this used to call it as ("EAST", v.e, v.n)
                                // (wrong argument order, and a "EAST" zone key that doesn't exist —
                                // real keys are "FL_EAST"/"FL_WEST"/"FL_NORTH") and read .lat/.lon,
                                // which don't exist on the result either. Both together silently
                                // turned this whole bounds check into a no-op: every computed
                                // lat/lon came back NaN/undefined, and undefined < / > a number is
                                // always false in JS, so no vertex could ever fail it.
                                const geo = window.COGO.statePlaneToLatLon(v.n, v.e, "FL_EAST", "sft");
                                if (geo.latDeg < bounds.latMin || geo.latDeg > bounds.latMax ||
                                    geo.lonDeg < bounds.lonMin || geo.lonDeg > bounds.lonMax) {
                                    logIssue("error", "Natural GPS Bounds",
                                        `Computed ground GPS (${geo.latDeg.toFixed(5)}° N, ${geo.lonDeg.toFixed(5)}° W) out of JEA geographic envelope`,
                                        pName, pl.layer, v.e, v.n);
                                }
                            }
                        }
                    }
                });
            }
        });

        // 2. Audit Block Inserts & Attributes
        (parsed.inserts || []).forEach((ins, idx) => {
            totalItems++;
            const blk = ins.blockName || "UNKNOWN_BLOCK";
            const bDesc = `${blk} #${idx + 1}`;
            const attr = ins.attribs || {};

            if (checkBounds && ins.e != null && ins.n != null) {
                if (ins.e < bounds.eastingMin || ins.e > bounds.eastingMax ||
                    ins.n < bounds.northingMin || ins.n > bounds.northingMax) {
                    logIssue("error", "SPCS83 East Bounds",
                        `Block origin (E: ${ins.e.toFixed(1)}, N: ${ins.n.toFixed(1)}) is outside JEA service territory bounds`,
                        bDesc, ins.layer, ins.e, ins.n);
                }
            }

            if (blk === "JEA_VALVE") {
                if (!attr.SUBTYPE) logIssue("error", "Mandatory Field", "Valve missing required SUBTYPE attribute", bDesc, ins.layer, ins.e, ins.n);
                if (!attr.SIZE) logIssue("error", "Mandatory Field", "Valve missing required SIZE attribute", bDesc, ins.layer, ins.e, ins.n);
                if (!attr.ELEVATION && ins.z == null) logIssue("error", "Mandatory Field", "Valve missing required ELEVATION attribute", bDesc, ins.layer, ins.e, ins.n);

                if (attr.SUBTYPE) validateDomain("Subtype Water Valve", attr.SUBTYPE, bDesc, "SUBTYPE", ins.layer, ins.e, ins.n);
                if (attr.VALVE_TYPE) validateDomain("Valve Type", attr.VALVE_TYPE, bDesc, "VALVE_TYPE", ins.layer, ins.e, ins.n);
                if (attr.SIZE) validateDomain("Size Inches", attr.SIZE, bDesc, "SIZE", ins.layer, ins.e, ins.n);
                if (attr.MATERIAL) validateDomain("Pipe and Fitting Material", attr.MATERIAL, bDesc, "MATERIAL", ins.layer, ins.e, ins.n);
                if (attr.MANUFACTURER) validateDomain("Valve Manufacturer", attr.MANUFACTURER, bDesc, "MANUFACTURER", ins.layer, ins.e, ins.n);
                if (attr.OPEN_DIR) validateDomain("Valve Open Direction", attr.OPEN_DIR, bDesc, "OPEN_DIR", ins.layer, ins.e, ins.n);
            } else if (blk === "JEA_MANHOLE") {
                if (!attr.SUBTYPE) logIssue("error", "Mandatory Field", "Manhole missing required SUBTYPE attribute", bDesc, ins.layer, ins.e, ins.n);
                if (!attr.RIM_ELEV) logIssue("error", "Mandatory Field", "Manhole missing required RIM_ELEV attribute", bDesc, ins.layer, ins.e, ins.n);
                if (!attr.INVERT_OUT) logIssue("error", "Mandatory Field", "Manhole missing required INVERT_OUT attribute", bDesc, ins.layer, ins.e, ins.n);

                if (attr.SUBTYPE) validateDomain("Subtype Manhole", attr.SUBTYPE, bDesc, "SUBTYPE", ins.layer, ins.e, ins.n);
                if (attr.MANHOLE_TYPE) validateDomain("Manhole Type", attr.MANHOLE_TYPE, bDesc, "MANHOLE_TYPE", ins.layer, ins.e, ins.n);
                if (attr.MATERIAL) validateDomain("Manhole Material", attr.MATERIAL, bDesc, "MATERIAL", ins.layer, ins.e, ins.n);
                if (attr.MANUFACTURER) validateDomain("Manhole Manufacturer", attr.MANUFACTURER, bDesc, "MANUFACTURER", ins.layer, ins.e, ins.n);
                if (attr.LINING) validateDomain("Manhole Lining Material", attr.LINING, bDesc, "LINING", ins.layer, ins.e, ins.n);
                if (attr.DIAMETER) validateDomain("Size Feet", attr.DIAMETER, bDesc, "DIAMETER", ins.layer, ins.e, ins.n);
            } else if (blk === "JEA_HYDRANT") {
                if (!attr.SUBTYPE) logIssue("error", "Mandatory Field", "Hydrant missing required SUBTYPE attribute", bDesc, ins.layer, ins.e, ins.n);
                if (attr.MODEL) validateDomain("Hydrant Model", attr.MODEL, bDesc, "MODEL", ins.layer, ins.e, ins.n);
                if (attr.MANUFACTURER) validateDomain("Valve Manufacturer", attr.MANUFACTURER, bDesc, "MANUFACTURER", ins.layer, ins.e, ins.n);
                if (attr.VALVE_SIZE) validateDomain("Size Inches", attr.VALVE_SIZE, bDesc, "VALVE_SIZE", ins.layer, ins.e, ins.n);
            } else if (blk === "JEA_FITTING") {
                if (!attr.SUBTYPE) logIssue("error", "Mandatory Field", "Fitting missing required SUBTYPE attribute", bDesc, ins.layer, ins.e, ins.n);
                if (attr.SUBTYPE) validateDomain("Subtype Water Fitting", attr.SUBTYPE, bDesc, "SUBTYPE", ins.layer, ins.e, ins.n);
                if (attr.SIZE) validateDomain("Size Inches", attr.SIZE, bDesc, "SIZE", ins.layer, ins.e, ins.n);
                if (attr.MATERIAL) validateDomain("Pipe and Fitting Material", attr.MATERIAL, bDesc, "MATERIAL", ins.layer, ins.e, ins.n);
                if (attr.MANUFACTURER) validateDomain("Fitting Manufacturers", attr.MANUFACTURER, bDesc, "MANUFACTURER", ins.layer, ins.e, ins.n);
            } else if (blk === "JEA_METER") {
                if (attr.SUBTYPE) validateDomain("Subtype Water Meter", attr.SUBTYPE, bDesc, "SUBTYPE", ins.layer, ins.e, ins.n);
                if (attr.SIZE) validateDomain("Meter Size Inches", attr.SIZE, bDesc, "SIZE", ins.layer, ins.e, ins.n);
                if (attr.BOX_MFR) validateDomain("Meter Box Manufacturer", attr.BOX_MFR, bDesc, "BOX_MFR", ins.layer, ins.e, ins.n);
                if (attr.BOX_MAT) validateDomain("Meter Box Material", attr.BOX_MAT, bDesc, "BOX_MAT", ins.layer, ins.e, ins.n);
            } else if (blk === "JEA_LOCATE_BOX") {
                if (attr.SUBTYPE) validateDomain("Subtype Locate Box", attr.SUBTYPE, bDesc, "SUBTYPE", ins.layer, ins.e, ins.n);
            } else if (blk === "JEA_CROSSING") {
                // Pipe Crossing Clearance Audit (>= 18 inches required)
                const cNo = attr.CROSS_NO || `CR-${idx + 1}`;
                const cDesc = `Pipe Crossing ${cNo}`;

                if (attr.UPPER_TYPE) validateDomain("Crossing Pipe Type", attr.UPPER_TYPE, cDesc, "UPPER_TYPE", ins.layer, ins.e, ins.n);
                if (attr.LOWER_TYPE) validateDomain("Crossing Pipe Type", attr.LOWER_TYPE, cDesc, "LOWER_TYPE", ins.layer, ins.e, ins.n);
                if (attr.UPPER_SIZE) validateDomain("Size Inches", attr.UPPER_SIZE, cDesc, "UPPER_SIZE", ins.layer, ins.e, ins.n);
                if (attr.LOWER_SIZE) validateDomain("Size Inches", attr.LOWER_SIZE, cDesc, "LOWER_SIZE", ins.layer, ins.e, ins.n);

                let clearanceInches = null;
                if (attr.CLEARANCE_INCHES) {
                    clearanceInches = parseFloat(attr.CLEARANCE_INCHES);
                } else if (attr.UPPER_BOT_ELEV && attr.LOWER_TOP_ELEV) {
                    const uBot = parseFloat(attr.UPPER_BOT_ELEV);
                    const lTop = parseFloat(attr.LOWER_TOP_ELEV);
                    if (!isNaN(uBot) && !isNaN(lTop)) {
                        clearanceInches = (uBot - lTop) * 12.0;
                    }
                }

                if (clearanceInches == null || isNaN(clearanceInches)) {
                    logIssue("error", "Clearance Audit", "Cannot determine crossing vertical clearance (missing elevations)", cDesc, ins.layer, ins.e, ins.n);
                } else if (clearanceInches < bounds.minCrossingClearanceInches) {
                    logIssue("error", "JEA 18-Inch Clearance Rule",
                        `VIOLATION: Pipe vertical clearance is ${clearanceInches.toFixed(1)}", which is LESS than the required 18.0" minimum separation (Shortfall: ${(bounds.minCrossingClearanceInches - clearanceInches).toFixed(1)}" / ${(((bounds.minCrossingClearanceInches - clearanceInches) / 12)).toFixed(2)}')`,
                        cDesc, ins.layer, ins.e, ins.n);
                } else {
                    passItems++;
                }
            }
        });

        const errorCount = issues.filter(i => i.severity === "error").length;
        const warnCount = issues.filter(i => i.severity === "warning").length;
        let score = Math.max(0, 100 - (errorCount * 10 + warnCount * 2));
        if (totalItems === 0) score = 0;

        const compliant = errorCount === 0 && (totalItems > 0);

        return {
            timestamp: new Date().toISOString(),
            compliant,
            score,
            summary: {
                totalEntities: (parsed.allEntities || []).length,
                polylinesCount: (parsed.polylines || []).length,
                insertsCount: (parsed.inserts || []).length,
                errorCount,
                warnCount,
                passItems
            },
            issues,
            model: parsed
        };
    }

    // ═════════════════════════════════════════════════════════════════════
    // 6. JEA As-Built Spreadsheet Tables Generator
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Generates CSV strings matching the official JEA As-Built 2024 sheets:
     *  - Pipe Crossing Table
     *  - Water Valve Table
     *  - Manhole Table
     */
    function generateJeaTables(model) {
        const net = model || getSampleNetwork();
        const tables = {};

        // 1. Pipe Crossing Table
        const crossRows = [
            ["Crossing Number", "Upper Pipe Type", "Upper Pipe Size (Inches)", "Upper Pipe Bottom Elevation (Feet)", "Lower Pipe Type", "Lower Pipe Size (Inches)", "Lower Pipe Top Elevation (Feet)", "Clearance (Inches)", "Compliant (>=18 in)"]
        ];
        (net.crossings || []).forEach(cr => {
            const a = cr.attribs || {};
            crossRows.push([
                a.CROSS_NO || cr.id,
                a.UPPER_TYPE || "",
                a.UPPER_SIZE || "",
                a.UPPER_BOT_ELEV || "",
                a.LOWER_TYPE || "",
                a.LOWER_SIZE || "",
                a.LOWER_TOP_ELEV || "",
                a.CLEARANCE_INCHES || "",
                a.COMPLIANT || ""
            ]);
        });
        tables["Pipe Crossing Table"] = crossRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

        // 2. Water Valve Table
        const valveRows = [
            ["Valve Number", "Subtype", "Valve Type", "Size (Inches)", "Material", "Manufacturer", "Open Direction", "Status", "Easting", "Northing", "Elevation"]
        ];
        (net.structures || []).filter(s => s.block === "JEA_VALVE").forEach(v => {
            const a = v.attribs || {};
            valveRows.push([
                v.id,
                a.SUBTYPE || "Valve",
                a.VALVE_TYPE || "Gate",
                a.SIZE || "",
                a.MATERIAL || "",
                a.MANUFACTURER || "",
                a.OPEN_DIR || "",
                a.STATUS || "",
                v.e.toFixed(2),
                v.n.toFixed(2),
                (v.z != null ? v.z.toFixed(2) : (a.ELEVATION || ""))
            ]);
        });
        tables["Water Valve"] = valveRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

        // 3. Manhole Table
        const mhRows = [
            ["Manhole ID", "Subtype", "Manhole Type", "Rim Elevation", "Invert In", "Invert Out", "Depth (Feet)", "Diameter (Feet)", "Material", "Manufacturer", "Lining Material", "Easting", "Northing"]
        ];
        (net.structures || []).filter(s => s.block === "JEA_MANHOLE").forEach(m => {
            const a = m.attribs || {};
            mhRows.push([
                m.id,
                a.SUBTYPE || "Collection",
                a.MANHOLE_TYPE || "A",
                a.RIM_ELEV || "",
                a.INVERT_IN || "",
                a.INVERT_OUT || "",
                a.DEPTH || "",
                a.DIAMETER || "",
                a.MATERIAL || "",
                a.MANUFACTURER || "",
                a.LINING || "",
                m.e.toFixed(2),
                m.n.toFixed(2)
            ]);
        });
        tables["Manhole"] = mhRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

        return tables;
    }

    // ═════════════════════════════════════════════════════════════════════
    // 7. PostgreSQL Database Synchronization
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Pushes the JEA 2024 template to PostgreSQL (client_templates) via the shared db-sync
     * bridge — window.DatabaseService.syncToDatabase() (plugins/db-sync/db-sync.js), the same
     * push path the Admin Dashboard's "Sync to DB" button uses, given an explicit override
     * payload instead of the whole-workspace one generateCloudSyncPayload() builds. There is no
     * window.DatabaseService.saveClientTemplate() and no /api/client_templates route — earlier
     * versions of this function called both and always fell through to a "local fallback" that,
     * in fact, never wrote anywhere.
     */
    async function syncTemplateWithDb() {
        const tenantId = (window.BoundaryQCCMS?.getCurrentUser?.() || {}).orgId || "org_kh_01";

        if (!window.DatabaseService) {
            return { success: false, note: "PostgreSQL bridge (db-sync) is not loaded.", settings: CLIENT_TEMPLATE.settings };
        }
        try {
            const res = await window.DatabaseService.syncToDatabase({
                tenantId,
                tables: {
                    client_templates: [{
                        id: CLIENT_TEMPLATE.id,
                        // No userId: this is a firm-wide reference template, not tied to one
                        // person's account, and an unrecognized id would fail the users(id) FK.
                        clientName: CLIENT_TEMPLATE.clientName,
                        label: CLIENT_TEMPLATE.label,
                        settings: CLIENT_TEMPLATE.settings
                    }]
                }
            });
            return { success: true, mode: "PostgreSQL", record: res };
        } catch (e) {
            return { success: false, note: e.message || "Database sync failed.", settings: CLIENT_TEMPLATE.settings };
        }
    }

    /**
     * Adds (or refreshes) "JEA As-Built Standards 2024" in the signed-in user's local Client
     * Master Templates (window.BoundaryQCCMS — plugins/cms-engine/cms-engine.js), through its
     * real createTemplate()/updateTemplate() API. This engine is domain-agnostic on purpose (see
     * cms-engine.js's initStorageDefaults() comment) — this plugin owns creating its own default
     * template on request, rather than it being pre-seeded for every user whether they use this
     * plugin or not. Idempotent: a second call updates the existing copy instead of duplicating it.
     */
    function addAsClientTemplate() {
        const cms = window.BoundaryQCCMS;
        if (!cms || !cms.isAuthenticated()) {
            return { success: false, note: "Sign in first to add a Client Master Template." };
        }
        const existing = cms.getTemplates().find(t => t.clientName === CLIENT_TEMPLATE.clientName && t.label === CLIENT_TEMPLATE.label);
        try {
            if (existing) {
                const tpl = cms.updateTemplate(existing.id, { settings: CLIENT_TEMPLATE.settings });
                return { success: true, mode: "updated", template: tpl };
            }
            const tpl = cms.createTemplate(CLIENT_TEMPLATE.clientName, CLIENT_TEMPLATE.label, CLIENT_TEMPLATE.settings);
            return { success: true, mode: "created", template: tpl };
        } catch (e) {
            // e.g. TEMPLATE_LIMIT — surface the real message (upsell copy included) rather than
            // swallowing it, same as the Dashboard's own "New Template" button does.
            return { success: false, note: e.message };
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // 8. User Interface Rendering & Controller
    // ═════════════════════════════════════════════════════════════════════

    let _lastAuditReport = null;
    let _activeSubTab = "gen";

    function renderUI(ctx) {
        const root = document.getElementById("tab-jea24");
        if (!root) return;

        window.setSafeHTML(root, `
          <div class="glass-panel" style="padding:1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:1rem; border-bottom:1px solid var(--border-color); padding-bottom:0.75rem;">
              <div>
                <h2 style="margin:0; display:flex; align-items:center; gap:0.5rem;">
                  <i class="fa-solid fa-faucet-drip" style="color:var(--primary);"></i>
                  JEA As-Built Standards 2024
                </h2>
                <p class="subtitle" style="margin:0.25rem 0 0 0;">Civil 3D drawing builder, reverse-read DXF auditor, and validation against 45 JEA domains & 18-inch clearance rules.</p>
              </div>
              <div style="display:flex; gap:0.5rem;">
                <span class="badge" style="background:var(--card-bg); border:1px solid var(--border-color); font-size:0.8rem; padding:0.35rem 0.6rem; border-radius:4px;">
                  <i class="fa-solid fa-location-crosshairs" style="color:var(--accent);"></i> FL East (Duval/Clay/St. Johns)
                </span>
                <span class="badge" style="background:var(--card-bg); border:1px solid var(--border-color); font-size:0.8rem; padding:0.35rem 0.6rem; border-radius:4px;">
                  <i class="fa-solid fa-shield-halved" style="color:var(--success);"></i> Min 18" Clearance
                </span>
              </div>
            </div>

            <!-- Sub-navigation buttons -->
            <div style="display:flex; gap:0.5rem; margin-bottom:1.25rem; flex-wrap:wrap;">
              <button class="btn btn-sm ${_activeSubTab === 'gen' ? 'btn-primary' : 'btn-secondary'}" id="jea-sub-gen">
                <i class="fa-solid fa-pen-ruler"></i> Drawing Builder
              </button>
              <button class="btn btn-sm ${_activeSubTab === 'audit' ? 'btn-primary' : 'btn-secondary'}" id="jea-sub-audit">
                <i class="fa-solid fa-clipboard-check"></i> Reverse-Read DXF Auditor
              </button>
              <button class="btn btn-sm ${_activeSubTab === 'domains' ? 'btn-primary' : 'btn-secondary'}" id="jea-sub-domains">
                <i class="fa-solid fa-book-atlas"></i> 45 JEA Validation Domains
              </button>
              <button class="btn btn-sm ${_activeSubTab === 'dbsync' ? 'btn-primary' : 'btn-secondary'}" id="jea-sub-dbsync">
                <i class="fa-solid fa-database"></i> PostgreSQL Template Sync
              </button>
            </div>

            <!-- Dynamic Sub-view Container -->
            <div id="jea-subview-content"></div>
          </div>
        `);

        renderSubView(ctx);
        bindEvents(root, ctx);
    }

    function renderSubView(ctx) {
        const container = document.getElementById("jea-subview-content");
        if (!container) return;

        if (_activeSubTab === "gen") {
            renderGenView(container, ctx);
        } else if (_activeSubTab === "audit") {
            renderAuditView(container, ctx);
        } else if (_activeSubTab === "domains") {
            renderDomainsView(container, ctx);
        } else if (_activeSubTab === "dbsync") {
            renderDbSyncView(container, ctx);
        }
    }

    function renderGenView(container, ctx) {
        const sample = getSampleNetwork();
        window.setSafeHTML(container, `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.25rem;">
            <div>
              <h4 style="margin:0 0 0.5rem 0;"><i class="fa-solid fa-network-wired"></i> Utility Linework & Attributes Model</h4>
              <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.75rem;">
                Constructs compliant Civil 3D drawings with JEA utility layers (<code>W-MAIN</code>, <code>SS-GRAV</code>, <code>UTIL-CROSS</code>), blocks (<code>JEA_VALVE</code>, <code>JEA_MANHOLE</code>, <code>JEA_CROSSING</code>), and <code>ATTRIB</code> metadata.
              </p>
              <div class="form-group">
                <label style="font-size:0.8rem;">Specification / Network JSON</label>
                <textarea id="jea-model-json" rows="14" style="width:100%; font-family:var(--font-mono); font-size:0.78rem;">${clean(JSON.stringify(sample, null, 2))}</textarea>
              </div>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.75rem;">
                <button class="btn btn-primary btn-sm" id="jea-btn-build-dxf">
                  <i class="fa-solid fa-download"></i> Build & Download Civil 3D DXF
                </button>
                <button class="btn btn-secondary btn-sm" id="jea-btn-export-csv">
                  <i class="fa-solid fa-file-csv"></i> Export JEA 2024 CSV Tables
                </button>
                <button class="btn btn-secondary btn-sm" id="jea-btn-send-linework">
                  <i class="fa-solid fa-share-nodes"></i> Send to Linework Editor
                </button>
              </div>
            </div>

            <div>
              <h4 style="margin:0 0 0.5rem 0;"><i class="fa-solid fa-circle-info"></i> Standard JEA As-Built Layers</h4>
              <div style="max-height:280px; overflow-y:auto; border:1px solid var(--border-color); border-radius:4px;">
                <table class="data-table" style="width:100%; font-size:0.78rem;">
                  <thead><tr><th>Layer</th><th>Color</th><th>Description</th></tr></thead>
                  <tbody>
                    ${LAYERS.map(l => `<tr><td><code>${clean(l.name)}</code></td><td>Color ${l.color}</td><td>${clean(l.desc)}</td></tr>`).join("")}
                  </tbody>
                </table>
              </div>
              <div class="card" style="margin-top:1rem; padding:0.75rem; background:var(--card-bg); border:1px solid var(--border-color);">
                <h5 style="margin:0 0 0.35rem 0; font-size:0.85rem;"><i class="fa-solid fa-triangle-exclamation" style="color:var(--warning);"></i> 18-Inch Pipe Crossing Rule</h5>
                <p style="font-size:0.78rem; color:var(--text-secondary); margin:0;">
                  Vertical clearance between the bottom elevation of the upper pipe and the crown/top elevation of the lower pipe must be strictly <strong>&ge; 18.0 inches</strong> (1.5 ft). Violations are flagged by the reverse-read audit engine.
                </p>
              </div>
            </div>
          </div>
        `);
    }

    function renderAuditView(container, ctx) {
        window.setSafeHTML(container, `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.25rem;">
            <div>
              <h4 style="margin:0 0 0.5rem 0;"><i class="fa-solid fa-upload"></i> Reverse-Read DXF File or Input</h4>
              <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.75rem;">
                Audits uploaded Civil 3D DXF files against the 45 JEA validation domains, Florida East SPCS83 bounds, and minimum 18" vertical pipe clearance.
              </p>
              <div style="display:flex; gap:0.5rem; margin-bottom:0.75rem;">
                <input type="file" id="jea-audit-file" accept=".dxf" style="font-size:0.8rem;" />
              </div>
              <div class="form-group">
                <label style="font-size:0.8rem;">Or Paste ASCII DXF Content</label>
                <textarea id="jea-audit-text" rows="12" placeholder="0\nSECTION\n2\nENTITIES\n..." style="width:100%; font-family:var(--font-mono); font-size:0.78rem;"></textarea>
              </div>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.75rem;">
                <button class="btn btn-primary btn-sm" id="jea-btn-run-audit">
                  <i class="fa-solid fa-magnifying-glass"></i> Run 2024 Standards Audit
                </button>
                <button class="btn btn-secondary btn-sm" id="jea-btn-audit-pass">
                  <i class="fa-solid fa-check"></i> Load Compliant Sample
                </button>
                <button class="btn btn-secondary btn-sm" id="jea-btn-audit-fail">
                  <i class="fa-solid fa-triangle-exclamation"></i> Load Violation Sample (&lt;18" Clearance)
                </button>
              </div>
            </div>

            <div id="jea-audit-results-panel">
              <h4 style="margin:0 0 0.5rem 0;"><i class="fa-solid fa-chart-pie"></i> Audit Results & Compliance Score</h4>
              <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:6px; padding:1rem; text-align:center; color:var(--text-secondary);">
                <i class="fa-solid fa-file-circle-question" style="font-size:2rem; margin-bottom:0.5rem; opacity:0.6;"></i>
                <p style="margin:0; font-size:0.85rem;">Run an audit or load a sample to inspect compliance results.</p>
              </div>
            </div>
          </div>
        `);

        if (_lastAuditReport) {
            renderAuditResults(document.getElementById("jea-audit-results-panel"), _lastAuditReport, ctx);
        }
    }

    function renderAuditResults(panel, rep, ctx) {
        if (!panel) return;
        const scoreColor = rep.score >= 90 ? "var(--success)" : (rep.score >= 70 ? "var(--warning)" : "var(--danger)");
        const badgeBg = rep.compliant ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)";
        const badgeColor = rep.compliant ? "var(--success)" : "var(--danger)";

        window.setSafeHTML(panel, `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <h4 style="margin:0;"><i class="fa-solid fa-chart-pie"></i> Audit Results</h4>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="badge" style="background:${badgeBg}; color:${badgeColor}; font-weight:700; font-size:0.85rem; padding:0.25rem 0.5rem; border-radius:4px;">
                ${rep.compliant ? "COMPLIANT" : "NON-COMPLIANT"}
              </span>
              <span style="font-size:1.1rem; font-weight:800; color:${scoreColor};">
                ${rep.score}%
              </span>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:0.5rem; margin-bottom:0.75rem;">
            <div class="card" style="padding:0.5rem; text-align:center; background:var(--card-bg); border:1px solid var(--border-color);">
              <div style="font-size:1.1rem; font-weight:700;">${rep.summary.totalEntities}</div>
              <div style="font-size:0.7rem; color:var(--text-secondary);">Entities Checked</div>
            </div>
            <div class="card" style="padding:0.5rem; text-align:center; background:var(--card-bg); border:1px solid var(--border-color);">
              <div style="font-size:1.1rem; font-weight:700; color:var(--danger);">${rep.summary.errorCount}</div>
              <div style="font-size:0.7rem; color:var(--text-secondary);">Errors / Violations</div>
            </div>
            <div class="card" style="padding:0.5rem; text-align:center; background:var(--card-bg); border:1px solid var(--border-color);">
              <div style="font-size:1.1rem; font-weight:700; color:var(--warning);">${rep.summary.warnCount}</div>
              <div style="font-size:0.7rem; color:var(--text-secondary);">Warnings</div>
            </div>
          </div>

          <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border-color); border-radius:4px; margin-bottom:0.75rem;">
            <table class="data-table" style="width:100%; font-size:0.75rem;">
              <thead><tr><th>Sev</th><th>Rule</th><th>Message</th><th>Entity</th></tr></thead>
              <tbody>
                ${rep.issues.length ? rep.issues.map(iss => `
                  <tr>
                    <td><span class="badge" style="background:${iss.severity === 'error' ? 'var(--danger)' : 'var(--warning)'}; color:#fff; font-size:0.65rem; padding:0.15rem 0.35rem; border-radius:3px;">${iss.severity.toUpperCase()}</span></td>
                    <td><strong>${clean(iss.rule)}</strong></td>
                    <td>${clean(iss.message)}</td>
                    <td><code>${clean(iss.entity)}</code></td>
                  </tr>
                `).join("") : '<tr><td colspan="4" style="color:var(--success); text-align:center;">✓ All 2024 JEA Standards verified without errors.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
            <button class="btn btn-secondary btn-sm" id="jea-btn-save-reports">
              <i class="fa-solid fa-box-archive"></i> Save to Reports Hub
            </button>
          </div>
        `);

        panel.querySelector("#jea-btn-save-reports")?.addEventListener("click", () => {
            exportAuditReportToReports(rep);
            if (ctx && ctx.showToast) ctx.showToast("Saved audit report to Centralized Reports Hub.");
        });
    }

    function renderDomainsView(container, ctx) {
        const domainKeys = Object.keys(DOMAINS).sort();
        window.setSafeHTML(container, `
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
              <h4 style="margin:0;"><i class="fa-solid fa-book-atlas"></i> 45 JEA Picklist Validation Domains (2024)</h4>
              <input type="text" id="jea-domain-filter" placeholder="Filter domain or value..." style="font-size:0.8rem; padding:0.3rem 0.5rem; width:220px;" />
            </div>
            <div id="jea-domains-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:0.75rem; max-height:480px; overflow-y:auto; padding-right:0.5rem;">
              ${domainKeys.map(k => `
                <div class="card domain-card" data-domain="${clean(k).toLowerCase()}" style="padding:0.75rem; background:var(--card-bg); border:1px solid var(--border-color); border-radius:4px;">
                  <div style="font-weight:700; font-size:0.82rem; margin-bottom:0.35rem; color:var(--primary); display:flex; justify-content:space-between;">
                    <span>${clean(k)}</span>
                    <span style="font-size:0.7rem; color:var(--text-muted);">${DOMAINS[k].length} items</span>
                  </div>
                  <div style="font-size:0.75rem; color:var(--text-secondary); max-height:85px; overflow-y:auto; font-family:var(--font-mono);">
                    ${DOMAINS[k].map(item => `<span style="display:inline-block; background:rgba(255,255,255,0.05); padding:0.1rem 0.3rem; margin:0.1rem; border-radius:2px;">${clean(item)}</span>`).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        `);

        const filterInput = container.querySelector("#jea-domain-filter");
        filterInput?.addEventListener("input", e => {
            const query = e.target.value.toLowerCase();
            container.querySelectorAll(".domain-card").forEach(card => {
                const dName = card.getAttribute("data-domain") || "";
                const text = card.textContent.toLowerCase();
                card.style.display = (dName.includes(query) || text.includes(query)) ? "block" : "none";
            });
        });
    }

    function renderDbSyncView(container, ctx) {
        window.setSafeHTML(container, `
          <div style="max-width:640px;">
            <h4 style="margin:0 0 0.5rem 0;"><i class="fa-solid fa-database"></i> PostgreSQL Template Sync (<code>client_templates</code>)</h4>
            <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:1rem;">
              Synchronize the JEA 2024 As-Built template with your local PostgreSQL instance (<code>localhost:5432 / fdot_survey_db</code>).
            </p>
            <div class="card" style="padding:1rem; background:var(--card-bg); border:1px solid var(--border-color); margin-bottom:1rem;">
              <table class="data-table" style="width:100%; font-size:0.8rem;">
                <tbody>
                  <tr><td><strong>Template ID</strong></td><td><code>tpl_jea_2024</code></td></tr>
                  <tr><td><strong>Client Name</strong></td><td>JEA</td></tr>
                  <tr><td><strong>Label</strong></td><td>JEA As-Built Standards 2024</td></tr>
                  <tr><td><strong>Discipline</strong></td><td>UTILITY</td></tr>
                  <tr><td><strong>Projection</strong></td><td>Florida East State Plane (US Survey Feet)</td></tr>
                  <tr><td><strong>Min Crossing Clearance</strong></td><td>18.0 inches (1.5 ft)</td></tr>
                  <tr><td><strong>Service Territory</strong></td><td>Duval, Clay, St. Johns, Nassau</td></tr>
                </tbody>
              </table>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="jea-btn-add-local-tpl">
                <i class="fa-solid fa-user-plus"></i> Add as My Client Template
              </button>
              <button class="btn btn-primary btn-sm" id="jea-btn-dbsync-run">
                <i class="fa-solid fa-rotate"></i> Sync Template to PostgreSQL
              </button>
              <span id="jea-dbsync-status" style="font-size:0.8rem; display:flex; align-items:center; color:var(--text-secondary);"></span>
            </div>
          </div>
        `);

        container.querySelector("#jea-btn-add-local-tpl")?.addEventListener("click", () => {
            const st = container.querySelector("#jea-dbsync-status");
            const res = addAsClientTemplate();
            if (st) {
                st.textContent = res.success ? `✓ ${res.mode === "created" ? "Added to" : "Updated in"} your Client Master Templates` : `Notice: ${res.note}`;
                st.style.color = res.success ? "var(--success)" : "var(--warning)";
            }
            if (ctx && ctx.showToast) ctx.showToast(res.success ? "JEA template added to your Client Master Templates." : res.note, !res.success);
        });

        container.querySelector("#jea-btn-dbsync-run")?.addEventListener("click", async () => {
            const st = container.querySelector("#jea-dbsync-status");
            if (st) st.textContent = "Syncing with PostgreSQL...";
            const res = await syncTemplateWithDb();
            if (st) {
                st.textContent = res.success ? `✓ Synchronized via ${res.mode}` : `Notice: ${res.note}`;
                st.style.color = res.success ? "var(--success)" : "var(--warning)";
            }
            if (ctx && ctx.showToast) ctx.showToast(res.success ? "JEA Template synchronized to PostgreSQL" : `Sync failed: ${res.note}`, !res.success);
        });
    }

    function exportAuditReportToReports(rep) {
        if (!window.Reports || !window.Reports.addReport) return;

        const content = [
            `# JEA As-Built 2024 Standards Audit Report`,
            `Generated: ${rep.timestamp}`,
            `Overall Status: ${rep.compliant ? 'COMPLIANT' : 'NON-COMPLIANT'} (Score: ${rep.score}%)`,
            ``,
            `## Summary Metrics`,
            `- Total Entities Checked: ${rep.summary.totalEntities}`,
            `- Pipe Polyline Runs: ${rep.summary.polylinesCount}`,
            `- Structure & Valve Inserts: ${rep.summary.insertsCount}`,
            `- Errors & Violations: ${rep.summary.errorCount}`,
            `- Warnings: ${rep.summary.warnCount}`,
            ``,
            `## Issues & Standard Checks`,
            ...(rep.issues.map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] **${i.rule}**: ${i.message} (Entity: \`${i.entity}\`, Layer: \`${i.layer}\`)`)),
            rep.issues.length === 0 ? `✓ All 45 JEA picklist domains and 18-inch clearance rules passed without violation.` : ``
        ].join("\n");

        window.Reports.addReport({
            title: `JEA 2024 Audit - Score ${rep.score}%`,
            type: "jea_audit",
            category: "audit",
            format: "markdown",
            content,
            metadata: {
                score: rep.score,
                compliant: rep.compliant,
                errorCount: rep.summary.errorCount,
                warnCount: rep.summary.warnCount
            }
        });
    }

    function bindEvents(root, ctx) {
        root.addEventListener("click", e => {
            const t = e.target.closest("button");
            if (!t) return;

            if (t.id === "jea-sub-gen") {
                _activeSubTab = "gen";
                renderUI(ctx);
                return;
            }
            if (t.id === "jea-sub-audit") {
                _activeSubTab = "audit";
                renderUI(ctx);
                return;
            }
            if (t.id === "jea-sub-domains") {
                _activeSubTab = "domains";
                renderUI(ctx);
                return;
            }
            if (t.id === "jea-sub-dbsync") {
                _activeSubTab = "dbsync";
                renderUI(ctx);
                return;
            }

            if (t.id === "jea-btn-build-dxf") {
                const txt = document.getElementById("jea-model-json")?.value;
                let model = null;
                try { model = JSON.parse(txt); } catch (err) {
                    if (ctx && ctx.showToast) ctx.showToast("Invalid JSON in network model: " + err.message, true);
                    return;
                }
                const dxf = buildJeaDxf(model);
                if (window.COGO && window.COGO.downloadText) {
                    window.COGO.downloadText("JEA_AsBuilt_2024.dxf", dxf, "application/dxf");
                }
                if (ctx && ctx.showToast) ctx.showToast("Generated and downloaded JEA Civil 3D DXF.");
                return;
            }

            if (t.id === "jea-btn-export-csv") {
                const txt = document.getElementById("jea-model-json")?.value;
                let model = null;
                try { model = JSON.parse(txt); } catch (err) {
                    if (ctx && ctx.showToast) ctx.showToast("Invalid JSON in network model", true);
                    return;
                }
                const tables = generateJeaTables(model);
                if (tables["Pipe Crossing Table"] && window.COGO && window.COGO.downloadText) {
                    window.COGO.downloadText("JEA_Pipe_Crossing_Table.csv", tables["Pipe Crossing Table"], "text/csv");
                }
                if (ctx && ctx.showToast) ctx.showToast("Exported JEA 2024 As-Built CSV tables.");
                return;
            }

            if (t.id === "jea-btn-send-linework") {
                const txt = document.getElementById("jea-model-json")?.value;
                let model = null;
                try { model = JSON.parse(txt); } catch (err) { return; }
                if (!window.Linework || !window.Linework._Ed || !window.Linework._Ed.setModel) {
                    if (ctx && ctx.showToast) ctx.showToast("Linework Editor is unavailable.", true);
                    return;
                }
                const figures = (model.pipes || []).map(p => ({
                    name: p.id,
                    code: p.subtype || "PIPE",
                    layer: p.layer || "W-MAIN",
                    closed: false,
                    pts: p.points.map(pt => ({ e: pt.e, n: pt.n, z: pt.z, name: String(pt.p) }))
                }));
                window.Linework._Ed.setModel({ figures });
                if (ctx && ctx.showToast) ctx.showToast(`Sent ${figures.length} utility run(s) to Linework Editor.`);
                document.querySelector('.nav-btn[data-tab="tab-linework"]')?.click();
                return;
            }

            if (t.id === "jea-btn-run-audit") {
                const dxfTxt = document.getElementById("jea-audit-text")?.value;
                if (!dxfTxt || !dxfTxt.trim()) {
                    if (ctx && ctx.showToast) ctx.showToast("Please upload or paste DXF text first.", true);
                    return;
                }
                _lastAuditReport = auditDrawing(dxfTxt);
                renderAuditResults(document.getElementById("jea-audit-results-panel"), _lastAuditReport, ctx);
                if (ctx && ctx.showToast) ctx.showToast(`Audit completed: Score ${_lastAuditReport.score}%`);
                return;
            }

            if (t.id === "jea-btn-audit-pass") {
                const passDxf = buildJeaDxf(getSampleNetwork());
                const area = document.getElementById("jea-audit-text");
                if (area) area.value = passDxf;
                _lastAuditReport = auditDrawing(passDxf);
                renderAuditResults(document.getElementById("jea-audit-results-panel"), _lastAuditReport, ctx);
                if (ctx && ctx.showToast) ctx.showToast("Loaded compliant JEA sample drawing (100% Score)");
                return;
            }

            if (t.id === "jea-btn-audit-fail") {
                const failNet = getSampleNetwork();
                failNet.crossings = [{
                    id: "X-FAIL",
                    block: "JEA_CROSSING",
                    layer: "UTIL-CROSS",
                    e: 436350.80,
                    n: 2154320.10,
                    z: 22.15,
                    attribs: {
                        CROSS_NO: "CR-FAIL-01",
                        UPPER_TYPE: "Potable Water",
                        UPPER_SIZE: "8",
                        UPPER_BOT_ELEV: "21.48",
                        LOWER_TYPE: "Gravity Sewer",
                        LOWER_SIZE: "8",
                        LOWER_TOP_ELEV: "20.90", // Clearance = 21.48 - 20.90 = 0.58 ft = 7.0 inches (< 18 in required!)
                        CLEARANCE_INCHES: "7.0",
                        COMPLIANT: "NO"
                    }
                }];
                failNet.structures[0].attribs.VALVE_TYPE = "Invalid Valve Type XYZ";

                const failDxf = buildJeaDxf(failNet);
                const area = document.getElementById("jea-audit-text");
                if (area) area.value = failDxf;
                _lastAuditReport = auditDrawing(failDxf);
                renderAuditResults(document.getElementById("jea-audit-results-panel"), _lastAuditReport, ctx);
                if (ctx && ctx.showToast) ctx.showToast('Loaded violation sample (<18" clearance violation detected)');
                return;
            }
        });

        const fileInput = root.querySelector("#jea-audit-file");
        fileInput?.addEventListener("change", e => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => {
                const txt = evt.target.result;
                const area = document.getElementById("jea-audit-text");
                if (area) area.value = txt;
                _lastAuditReport = auditDrawing(txt);
                renderAuditResults(document.getElementById("jea-audit-results-panel"), _lastAuditReport, ctx);
            };
            reader.readAsText(file);
        });
    }

    const Plugin = {
        init(ctx) {
            renderUI(ctx);
        },
        onTabActivate(ctx) {
            renderUI(ctx);
        }
    };

    // Public API
    window.Jea24 = {
        MANIFEST,
        BOUNDS,
        LAYERS,
        DOMAINS,
        RULES,
        BLOCK_DEFS,
        CLIENT_TEMPLATE,
        getSampleNetwork,
        buildJeaDxf,
        parseDxf,
        auditDrawing,
        generateJeaTables,
        exportAuditReportToReports,
        syncTemplateWithDb,
        addAsClientTemplate
    };

    if (window.PluginRegistry) window.PluginRegistry.register(MANIFEST, Plugin);
})();
