# CLAUDE.md

Guidance for working in this repo. See `README.md` for the full picture.

## What this is

A **static, client-side, no-build** web app: FDOT Civil 3D surveying/CADD
tools. No server, no bundler, no runtime npm deps. Every plugin is a
vanilla-ES IIFE that self-registers with `window.PluginRegistry`.

## Commands

```bash
npm test                     # full functional suite (~4,000 assertions, Node-only, no install)
node tests/run.js cogo dxf   # run named suites only
python3 -m http.server 8085  # serve the app (open http://localhost:8085 — file:// breaks the CSP)
```

There is no lint step and no build.

## Architecture essentials

- **Plugins** live in `plugins/<name>/<name>.js`. Each is
  `(function(){ ... window.PluginRegistry.register(MANIFEST, module); })()`.
  `MANIFEST.name` must be ≤ 15 chars. Lifecycle hooks: `init(ctx)`,
  `setupEvents(ctx)`, `onTabActivate(ctx)`.
- `core/app.js` runs on `DOMContentLoaded`, builds `ctx`
  (`state, showToast, showInputModal, showConfirmModal, showCopyModal,
  updateBadges`), calls `PluginRegistry.initAll(ctx)`. It also owns the
  `PAGE_TITLES` map (add an entry when you add a tab) and the tab router.
- Script load order in `index.html` matters — `window.*` globals are
  created at eval time, so a dependency's `<script>` must come first.
- `core/cogo.js` (`window.COGO`) is the shared geometry kernel — use it,
  don't reimplement bearing/traverse/area/self-intersection math.
- `core/data.js` (`window.FDOT_DATA`) is **illustrative, unverified**
  reference data. Never present a computed quantity as design-ready.

## Conventions (match these)

- **Every dynamic DOM write goes through `window.setSafeHTML(el, html)`**
  (DOMPurify + text-only fallback). Never assign `el.innerHTML` directly.
  For `<tr>` rows use `window.setSafeRows(tbody, rowsHtml)`.
- DOMPurify's config strips `<svg>` — build SVG with `createElementNS`
  (see `linework.js`) or parse a trusted, numbers-only SVG string with
  `DOMParser` (see `stdn-compare.js`), never through `setSafeHTML`.
- File downloads: `window.COGO.downloadText(name, text, mime)`.
- Plugins expose their pure functions on a `window.<Name>` object for the
  test suite; keep render/DOM code private.
- No inline `onclick` — CSP blocks it; wire listeners in `setupEvents`.

## Testing

- `tests/run.js` — `SUITES` array lists the suites; each is
  `tests/<name>.test.js` exporting `function(t, env)`.
- `tests/_env.js` evals every `core/*.js` + listed `plugins/**/*.js` into
  a shimmed `window`/`document`/`localStorage`. Its `FILES` list and
  `run.js`'s "N source files loaded" count must stay in sync when you add
  a source file.
- `tests/_assert.js` — `t.eq/ok/close/match/throws/...`. Prefer many
  small assertions; the DOM shim is thin, so most coverage is on pure
  functions (a plugin that needs render coverage installs its own
  Map-backed `getElementById` + pass-through DOMPurify for the group and
  restores after — see `tests/stdn-cmp.test.js`).

## Gotchas

- `pkill -f 'http.server ...'` can match the shell running it — kill by
  PID instead.
- The DXF parsers use a **resilient tokenizer** (find-next-code-line, not
  fixed `+= 2`); keep it that way when editing `dxf-parser.js` or
  `stdn-compare/stdn-engine.js`.
- CI (`.github/workflows/pages.yml`) only triggers on push to `master`
  (and `workflow_dispatch`) — there's no `pull_request` trigger.
