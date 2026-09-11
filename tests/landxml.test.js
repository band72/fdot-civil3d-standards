"use strict";
/**
 * Test suite: LandXML 1.2 / 2.0 Studio & Interop
 */
module.exports = async function (t, { win }) {
    const LandXML = win.LandXML;

    t.group("landxml/api presence");
    t.ok(!!LandXML, "LandXML module exists on window");
    t.eq(typeof LandXML.parseLandXML, "function", "parseLandXML is a function");
    t.eq(typeof LandXML.buildLandXML, "function", "buildLandXML is a function");
    t.eq(typeof LandXML.toFiguresModel, "function", "toFiguresModel is a function");
    t.eq(typeof LandXML.fromFiguresModel, "function", "fromFiguresModel is a function");
    t.eq(typeof LandXML.sampleLandXML, "function", "sampleLandXML is a function");

    t.group("landxml/parseLandXML sample");
    const sample = LandXML.sampleLandXML();
    const parsed = LandXML.parseLandXML(sample);
    t.eq(parsed.version, "1.2", "parsed version is 1.2");
    t.eq(parsed.units.linearUnit, "USSurveyFoot", "linearUnit is USSurveyFoot");
    t.eq(parsed.coordinateSystem.epsgCode, "2236", "coordinateSystem epsgCode is 2236");
    t.eq(parsed.project.name, "FDOT SR-50 Right-of-Way", "project name extracted");
    t.eq(parsed.points.length, 4, "parsed 4 CgPoints");
    t.eq(parsed.points[0].name, "101", "first point name is 101");
    t.eq(parsed.points[0].code, "POB", "first point code is POB");
    t.close(parsed.points[0].northing, 540120.55, 0.001, "point 101 northing");
    t.close(parsed.points[0].easting, 621450.12, 0.001, "point 101 easting");
    t.close(parsed.points[0].elev, 45.2, 0.001, "point 101 elevation");

    t.group("landxml/parcels & geometry");
    t.eq(parsed.parcels.length, 1, "parsed 1 parcel");
    const p1 = parsed.parcels[0];
    t.eq(p1.name, "PARCEL_101_FEE", "parcel name is PARCEL_101_FEE");
    t.eq(p1.lines.length, 4, "parcel has 4 lines");
    t.close(p1.area, 120000, 1.0, "parcel area is 120,000 SF");

    t.group("landxml/alignments");
    t.eq(parsed.alignments.length, 1, "parsed 1 alignment");
    const al = parsed.alignments[0];
    t.eq(al.name, "BL_SR50", "alignment name is BL_SR50");
    t.close(al.length, 2500, 0.1, "alignment length is 2500 ft");
    t.close(al.staStart, 1000, 0.1, "station start is 1000");

    t.group("landxml/buildLandXML export");
    const testModel = {
        project: { name: "Test_Project", desc: "QA Test Corridor" },
        points: [
            { name: "1", code: "POB", northing: 100000, easting: 500000, elev: 10 },
            { name: "2", code: "CORNER", northing: 100200, easting: 500000, elev: 12 },
            { name: "3", code: "CORNER", northing: 100200, easting: 500300, elev: 11 },
            { name: "4", code: "CORNER", northing: 100000, easting: 500300, elev: 10 }
        ],
        parcels: [
            {
                name: "LOT_42",
                area: 60000,
                desc: "Fee Simple Parcel",
                vertices: [
                    { n: 100000, e: 500000 },
                    { n: 100200, e: 500000 },
                    { n: 100200, e: 500300 },
                    { n: 100000, e: 500300 },
                    { n: 100000, e: 500000 }
                ]
            }
        ]
    };

    const exportedXml = LandXML.buildLandXML(testModel);
    t.ok(exportedXml.includes("<LandXML"), "exported XML contains <LandXML");
    t.ok(exportedXml.includes("LOT_42"), "exported XML contains parcel name");
    t.ok(exportedXml.includes("500300"), "exported XML contains easting coordinate");

    const reParsed = LandXML.parseLandXML(exportedXml);
    t.eq(reParsed.points.length, 4, "reparsed 4 points");
    t.eq(reParsed.parcels.length, 1, "reparsed 1 parcel");
    t.eq(reParsed.parcels[0].name, "LOT_42", "reparsed parcel name");
    t.close(reParsed.parcels[0].area, 60000, 1.0, "reparsed parcel area matches");

    t.group("landxml/linework interop");
    const figModel = LandXML.toFiguresModel(reParsed);
    t.eq(figModel.figures.length, 1, "generated 1 figure for linework editor");
    t.eq(figModel.figures[0].name, "LOT_42", "figure name matches parcel name");
    t.eq(figModel.figures[0].closed, true, "figure is closed");
    t.ok(figModel.figures[0].pts.length >= 4, "figure has at least 4 points");

    const backToXml = LandXML.fromFiguresModel(figModel.figures, "Roundtrip_Project");
    t.ok(backToXml.includes("LOT_42"), "converted back to LandXML containing LOT_42");
};
