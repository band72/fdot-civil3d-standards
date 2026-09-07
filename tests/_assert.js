/* Tiny zero-dependency assertion recorder for the functional test suite. */
"use strict";

let pass = 0, fail = 0, group = "(root)";
const fails = [];
const groups = {};

function bump(g, ok) {
    groups[g] = groups[g] || { pass: 0, fail: 0 };
    if (ok) groups[g].pass++; else groups[g].fail++;
}
function rec(ok, msg) {
    if (ok) { pass++; bump(group, true); }
    else { fail++; bump(group, false); fails.push(`${group} :: ${msg}`); }
}

const deepEq = (a, b) => {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
};

const t = {
    group(n) { group = n; },
    ok(v, m) { rec(!!v, m || "expected truthy"); },
    notOk(v, m) { rec(!v, m || "expected falsy"); },
    eq(a, b, m) { rec(deepEq(a, b), m || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ne(a, b, m) { rec(!deepEq(a, b), m || `unexpectedly equal: ${JSON.stringify(a)}`); },
    close(a, b, eps, m) {
        const e = eps == null ? 1e-6 : eps;
        rec(typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= e,
            m || `${a} not within ${e} of ${b}`);
    },
    gt(a, b, m) { rec(a > b, m || `${a} not > ${b}`); },
    gte(a, b, m) { rec(a >= b, m || `${a} not >= ${b}`); },
    lt(a, b, m) { rec(a < b, m || `${a} not < ${b}`); },
    lte(a, b, m) { rec(a <= b, m || `${a} not <= ${b}`); },
    match(s, re, m) { rec(re.test(String(s)), m || `${JSON.stringify(s)} !~ ${re}`); },
    throws(fn, m) { try { fn(); rec(false, m || "did not throw"); } catch (e) { rec(true, m); } },
    async rejects(fn, m) { try { await fn(); rec(false, m || "did not reject"); } catch (e) { rec(true, m); } },
    async resolves(fn, m) { try { await fn(); rec(true, m); } catch (e) { rec(false, (m || "rejected") + ": " + e.message); } }
};

function summary() { return { pass, fail, total: pass + fail, fails, groups }; }

module.exports = { t, summary };
