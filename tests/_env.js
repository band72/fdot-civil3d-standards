/* Loads the site's source files into a Node-side browser-ish environment. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

function makeStorage() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(String(k), String(v)),
        removeItem: k => m.delete(String(k)),
        clear: () => m.clear(),
        key: i => Array.from(m.keys())[i] || null,
        get length() { return m.size; },
        _map: m
    };
}

function fakeEl() {
    const noop = () => {};
    const el = {
        style: {}, dataset: {},
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        setAttribute: noop, removeAttribute: noop, getAttribute: () => null, hasAttribute: () => false,
        addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
        appendChild: x => x, removeChild: x => x, append: noop, prepend: noop,
        insertBefore: x => x, replaceChildren: noop, remove: noop,
        querySelector: () => null, querySelectorAll: () => [], closest: () => null,
        focus: noop, blur: noop, click: noop, select: noop,
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480 }),
        get firstChild() { return null; }, get children() { return []; }, childNodes: [],
        get innerHTML() { return this._h || ""; }, set innerHTML(v) { this._h = String(v); },
        get textContent() { return this._t || ""; }, set textContent(v) { this._t = String(v); },
        value: "", checked: false, disabled: false, hidden: false, files: [], parentNode: null,
        content: { querySelector: () => null, querySelectorAll: () => [], childNodes: [] }
    };
    return el;
}

let loadedOnce = null;

function load() {
    if (loadedOnce) return loadedOnce;
    const realWarn = console.warn, realInfo = console.info;
    console.warn = () => {}; console.info = () => {};

    const win = {};
    for (const k of ["crypto", "TextEncoder", "TextDecoder", "btoa", "atob", "performance",
        "URL", "Blob", "structuredClone", "queueMicrotask", "setTimeout", "clearTimeout",
        "setInterval", "clearInterval", "console", "fetch"]) {
        try { if (globalThis[k] !== undefined) win[k] = globalThis[k]; } catch (e) {}
    }
    win.window = win;
    win.self = win;
    win.localStorage = makeStorage();
    win.sessionStorage = makeStorage();
    win.location = { hostname: "localhost", href: "file:///t/index.html", protocol: "file:", origin: "null" };
    win.navigator = { credentials: undefined, userAgent: "node-test" };
    win.PublicKeyCredential = undefined;
    win.requestAnimationFrame = cb => setTimeout(cb, 0);
    win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

    const doc = {
        readyState: "complete",
        addEventListener: () => {}, removeEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null, querySelectorAll: () => [],
        createElement: () => fakeEl(),
        createElementNS: () => fakeEl(),
        createTextNode: v => ({ nodeValue: String(v) }),
        body: fakeEl(), head: fakeEl(), documentElement: fakeEl()
    };
    win.document = doc;

    global.window = win;
    global.self = win;
    global.document = doc;
    global.localStorage = win.localStorage;
    global.sessionStorage = win.sessionStorage;
    // Source code reads a bare `navigator` (not window.navigator). Node < 21 has no
    // global navigator; Node >= 21 exposes a getter-only one. defineProperty works either way.
    Object.defineProperty(global, "navigator", { value: win.navigator, configurable: true, writable: true });

    const FILES = [
        "core/data.js",
        "core/safe-dom.js",
        "core/cogo.js",
        "core/plugin-loader.js",
        "plugins/spatial-engine/spatial-engine.js",
        "plugins/security-pki/security-pki.js",
        "plugins/billing/billing.js",
        "plugins/cms-engine/cms-engine.js",
        "plugins/dxf-auditor/dxf-parser.js",
        "plugins/dxf-auditor/dxf-auditor.js",
        "plugins/stdn-compare/stdn-engine.js",
        "plugins/stdn-compare/stdn-compare.js",
        "plugins/layer-stds/layer-stds.js",
        "plugins/sign-qto/sign-qto.js",
        "plugins/ssa-hydro/ssa-hydro.js",
        "plugins/traverse-cogo/traverse-cogo.js",
        "plugins/legal-desc/legal-desc.js",
        "plugins/plss-breakdown/plss-breakdown.js",
        "plugins/plat2dxf/plat2dxf.js",
        "plugins/linework/linework.js",
        "plugins/help/help.js"
    ];

    const loaded = [], errors = [];
    const indirectEval = eval;
    for (const f of FILES) {
        try {
            indirectEval(fs.readFileSync(path.join(ROOT, f), "utf8") + "\n//# sourceURL=" + f);
            loaded.push(f);
        } catch (e) {
            errors.push(`${f}: ${e && e.message}`);
        }
    }

    console.warn = realWarn; console.info = realInfo;
    loadedOnce = { win, loaded, errors, makeStorage, fakeEl };
    return loadedOnce;
}

module.exports = { load, makeStorage, fakeEl };
