# FDOT Civil3D Standards Suite

A **client-side, no-build** web app — a set of surveying / CADD tools for
FDOT (Florida DOT) Civil 3D workflows: DXF standards auditing, COGO
traverse math, legal-description QC, PLSS section breakdown, linework
editing, hydrology, sign QTO, plus a demo CMS / billing layer.

Everything runs in the browser. There is no server, no bundler, and no
runtime `npm` dependency — the only external resources are DOMPurify,
FontAwesome, and Google Fonts, loaded from a CDN under a strict CSP.

> ⚠ **Reference data is illustrative and unverified.** Layer colours, the
> 11 IDF-zone coefficients, Manning's `n`, pay-item mappings and similar
> values in [`core/data.js`](core/data.js) were authored for the demo and
> have **not** been checked against a current FDOT CADD Manual, Basis of
> Estimates, or Drainage Manual. Do not use any computed quantity for
> production design without confirming the inputs against the
> authoritative FDOT source.
>
> The Commercial / Enterprise / CMS tabs are **demo builds** — sign-in,
> licensing, seals and payments are browser-local and enforce nothing.

## Run it

It's static. Serve the repo root over HTTP (a `file://` open breaks the
CSP and some fetches):

```bash
python3 -m http.server 8085      # then open http://localhost:8085
```

## Test

Node-only, zero dependencies, no build:

```bash
npm test                    # everything
node tests/run.js cogo dxf  # named suites only
```

~4,000 assertions across 8 suites. `tests/_env.js` loads every
`core/*.js` and `plugins/**/*.js` file into a shimmed browser-ish global
and exposes the site globals; `tests/README.md` maps each suite.

## Architecture

- **Plugin registry** ([`core/plugin-loader.js`](core/plugin-loader.js)) —
  each plugin is an IIFE that self-registers via
  `window.PluginRegistry.register(manifest, module)` at script load;
  [`core/app.js`](core/app.js) calls `initAll(ctx)` on `DOMContentLoaded`
  and passes a shared `ctx` (state + modal/toast helpers). Init order is
  a topological sort over `manifest.dependencies`.
- **Everything is a `window.*` global.** No modules, no bundler. Script
  load order in [`index.html`](index.html) must satisfy the dependency
  graph (globals are created at eval time).
- **Shared geometry kernel** ([`core/cogo.js`](core/cogo.js)) — bearing
  parsing, `runTraverse`, Shoelace area, self-intersection, DXF builder,
  PNEZD export. Reused by the linework, legal-desc, PLSS, plat2dxf and
  traverse plugins.
- **DOM safety** ([`core/safe-dom.js`](core/safe-dom.js)) — every dynamic
  write goes through `setSafeHTML` → DOMPurify, with a text-only fallback
  if DOMPurify fails to load. A CSP `<meta>` blocks inline scripts.
- **Reference data** ([`core/data.js`](core/data.js)) — `window.FDOT_DATA`:
  layers, pay items, IDF zones, subassemblies, sheet standards, QC
  checklist. (See the caveat above.)

## Plugins (`plugins/<name>/`)

| Plugin | Tab | Does |
|---|---|---|
| `stdn-compare` | **Start** · Standards Compare + Auto-Correct | The landing tab. Check a DXF against the built-in **FDOT 2026 layer standard**, an uploaded JSON standard, and/or a master-template DXF (its LAYER/LTYPE/STYLE tables + BLOCKS); tolerance geometry diff vs. a reference drawing with a pan/zoom SVG overlay; safe **auto-correction** to a corrected `.dxf`; HTML / Markdown reports. Ported from the `standardcompare-plugin` project (server half dropped). Supersedes the old layer-table-only "Template Compare". |
| `dxf-auditor` | DXF Project Auditor | Parse an FDOT DXF, score CADD-standards compliance, flag geometry errors (bow-tie, zero-length, out-of-envelope), export an auto-fix `.scr`; canvas renderer + spatial-index telemetry. |
| `layer-stds` | Layer Standards / Pay Items / Survey Keys | Filterable reference tables. |
| `sign-qto` | Sign Assemblies & QTO | Sign catalog + MUTCD surface-area → pay-item solver. |
| `ssa-hydro` | SSA Hydrology & IDF | Rational Method `Q = CiA` from the 11 IDF zones + exfiltration-trench sizer. |
| `traverse-cogo` | QC & Traverse Auditor | Lat/dep closure, precision ratio, Shoelace area, bow-tie detection, Map Check report. |
| `linework` | Linework Editor | Import field data (PNEZD or bearing/distance), run field-data checks, edit vertices/courses on an SVG canvas, fit real curves from field codes. |
| `efbk` | Electronic Field Book | FDOT EFB point/reference naming, P/C curve geometry (3-point arc, 4+-point smooth curve, tangent-solved single-C arc), and the chain-list mini-language — builds a figures model for DXF/script export or the Linework Editor. |
| `legal-desc` | Legal Description QC | Parse metes-and-bounds, chord-trace closure, BoundaryQC QC rules, PNEZD + Map Check export. |
| `plss-breakdown` | PLSS Section Breakdown | Subdivide an ideal government section from an aliquot description. |
| `plat2dxf` | Parcel → DXF / Points / COGO | Bearing/distance call list → ASCII DXF, PNEZD, AutoCAD COGO script. |
| `spatial-engine` | — | Recursive Guttman R-tree 2D index + Euler-spiral (Fresnel) solver. |
| `security-pki` | — | Pure-JS FIPS 180-4 SHA-256, F.A.C. PKI/TSA gate checks, hash-chain verifier, WebAuthn (fail-closed). |
| `cms-engine` / `billing` | CMS / Commercial | **Demo** PBKDF2 sign-in + sessions + per-user templates + audit chain; tier UI + ephemeral ECDSA JWTs. Not a security boundary. |
| `help` | Help & User Manual | Per-tab usage, input formats, limits. |

There is also a Civil 3D C# ribbon add-in scaffold under
[`plugins/civil3d-addin/`](plugins/civil3d-addin/) — licensing/ribbon
scaffold only; the audit routines are not included in this distribution.

## Deploy

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the test
suite on every push to `master`, then deploys the static site to GitHub
Pages **only when the repo variable `DEPLOY_PAGES` is `true`** (Settings →
Pages must be enabled; a private repo needs a paid plan for Pages).

## Contributing

- Match the surrounding style: vanilla ES, IIFE per plugin, `setSafeHTML`
  for every dynamic write, `window.COGO` for geometry.
- Add a suite (or extend one) in `tests/` for anything with logic; wire
  new suites into `tests/run.js`'s `SUITES` and `tests/_env.js`'s file
  list.
- Plugin names are ≤ 15 characters (`plugin-loader.js` rejects longer).
