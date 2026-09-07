# Functional test suite

Node-only. No dependencies, no build.

```
node tests/run.js            # everything
node tests/run.js cogo data  # named suites only
npm test
```

`_env.js` loads every `core/*.js` and `plugins/**/*.js` file into a shimmed
browser-ish global (`window`, `localStorage`, `document`, Node webcrypto) and
exposes the site globals (`COGO`, `FDOT_DATA`, `BoundaryQCCMS`, `Linework`, …).
`_assert.js` is a tiny recorder. Exit code is non-zero on any failure.

| suite | covers |
|---|---|
| `cogo`     | bearing parsing, azimuth↔bearing round-trips, advance/inverse, chord-from-arc, Shoelace, self-intersection, `runTraverse`, PNEZD, `buildDxf` (incl. round-trip through the DXF parser) |
| `data`     | `FDOT_DATA` integrity — layers, pay items, survey keys, IDF zones (+ Rational Method), blocks, subassemblies, sheets, QC checklist |
| `dxf`      | `FDOTDXFInspector` parse + `inspectProject` findings, TABLES-section bleed, bow-tie, `.scr` generation, spatial telemetry, Fresnel spiral |
| `linework` | `splitDesc` Civil 3D code set, `buildFigures` begin/continue/end/close, `checkModel` findings, headless editor ops (delete/undo/redo/untangle/setSegment/playback) |
| `auth`     | PBKDF2 login, lockout, register, change-password, impersonate, per-user client templates + the 5-template license gate, audit hash chain |
| `geo`      | pure-JS SHA-256 vs Node, PKI/TSA gates, WebAuthn fail-closed, plugin-loader topo sort, safe-dom fallback, legal-description parse/QC, PLSS aliquot table, plat2dxf |
