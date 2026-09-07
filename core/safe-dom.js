/**
 * BoundaryQC / FDOT Civil3D Standards — Safe DOM helper
 * core/safe-dom.js
 *
 * Every dynamic HTML write in this app goes through setSafeHTML(), which runs the
 * markup through DOMPurify before it touches the DOM. DOMPurify is loaded in <head>
 * (see index.html) so window.DOMPurify is available before any plugin script runs.
 *
 * If DOMPurify somehow failed to load, setSafeHTML falls back to textContent — it
 * will never inject unsanitized markup.
 */
(function () {
    "use strict";

    const PURIFY_CONFIG = {
        USE_PROFILES: { html: true },
        // Form controls are used by the modal helpers in core/app.js
        ADD_TAGS: ["input", "button", "textarea", "select", "option"],
        ADD_ATTR: ["target", "data-plan", "data-price", "data-tab", "data-layer",
                   "data-email", "data-id", "data-discipline", "value", "readonly", "rows", "type"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onanimationstart"]
    };

    /**
     * Sanitize an HTML string. Returns a string safe to assign to innerHTML.
     * @param {string} html
     * @returns {string}
     */
    function safeHTML(html) {
        const str = html == null ? "" : String(html);
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
            return window.DOMPurify.sanitize(str, PURIFY_CONFIG);
        }
        // Fallback: no HTML at all rather than an XSS hole.
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }

    /**
     * Sanitize `html` and assign it to `el.innerHTML`. No-op if `el` is null.
     * @param {Element|null} el
     * @param {string} html
     */
    function setSafeHTML(el, html) {
        if (!el) return;
        el.innerHTML = safeHTML(html);
    }

    window.safeHTML = safeHTML;
    window.setSafeHTML = setSafeHTML;
})();
