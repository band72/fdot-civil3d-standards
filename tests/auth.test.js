"use strict";
/* Functional tests for auth + client templates (cms-engine.js + billing.js) */
module.exports = async function (t, env) {
    const W = env.win;
    const CMS = W.BoundaryQCCMS;
    const BILL = W.BoundaryQCBilling;

    // Wipe CMS storage so we exercise a fresh seed each run.
    ["bqc_cms_users", "bqc_cms_current_user", "bqc_cms_session", "bqc_cms_login_attempts",
        "bqc_cms_organizations", "bqc_cms_projects", "bqc_cms_submittals", "bqc_cms_transactions",
        "bqc_cms_templates", "bqc_cms_active_template", "bqc_cms_audit_logs",
        "bqc_cms_idempotency_keys", "bqc_cms_schema_version"].forEach(k => W.localStorage.removeItem(k));
    CMS.initStorageDefaults();
    CMS._migrate();

    t.group("auth/seed + session");
    t.ok(CMS.isAuthenticated(), "seed auto-login");
    t.eq(CMS.getCurrentUser().email, "jane.doe@kimley-horn.com", "default seed user");
    t.eq(CMS.getUsers().length, 3, "3 seed accounts");
    t.ok(CMS.getUsers().every(u => u.credentials && u.credentials.hash && u.credentials.salt), "every seed account has a salted hash, no plaintext");
    t.notOk(JSON.stringify(CMS.getUsers()).includes(CMS.AUTH.DEMO_PASSWORD), "plaintext demo password not stored");

    t.group("auth/login");
    await t.rejects(() => CMS.loginUser("jane.doe@kimley-horn.com", "wrong-password"), "wrong password rejected");
    await t.rejects(() => CMS.loginUser("nobody@nowhere.com", "whatever"), "unknown account rejected");
    await t.resolves(() => CMS.loginUser("robert.vance@kimley-horn.com", CMS.AUTH.DEMO_PASSWORD), "correct demo password accepted");
    t.eq(CMS.getCurrentUser().email, "robert.vance@kimley-horn.com", "session switched to Robert");

    t.group("auth/lockout after repeated failures");
    W.localStorage.removeItem("bqc_cms_login_attempts");
    let lockedMsg = "";
    for (let i = 0; i < 6; i++) {
        try { await CMS.loginUser("jane.doe@kimley-horn.com", "nope" + i); }
        catch (e) { if (i === 5) lockedMsg = e.message; }
    }
    t.match(lockedMsg, /lock|too many/i, "6th attempt reports lockout");
    await t.rejects(() => CMS.loginUser("jane.doe@kimley-horn.com", CMS.AUTH.DEMO_PASSWORD), "correct password still blocked while locked");
    W.localStorage.removeItem("bqc_cms_login_attempts");

    t.group("auth/register");
    await t.rejects(() => CMS.registerUser("Bad", "not-an-email", "PSM_SURVEYOR", "", "", "Passw0rd1"), "invalid email rejected");
    await t.rejects(() => CMS.registerUser("Weak", "weak@x.com", "PSM_SURVEYOR", "", "", "short"), "weak password rejected");
    await t.rejects(() => CMS.registerUser("NoDigit", "nd@x.com", "PSM_SURVEYOR", "", "", "abcdefgh"), "password without digit rejected");
    const nu = await CMS.registerUser("Test Smith, PE", "test.smith@newfirm.example", "PE_ENGINEER", "PE55555", "New Firm", "Passw0rd1");
    t.eq(nu.credentials.algo, "pbkdf2", "new account uses PBKDF2");
    t.eq(CMS.getCurrentUser().id, nu.id, "auto-signed-in after register");
    await t.rejects(() => CMS.registerUser("Dup", "test.smith@newfirm.example", "PE_ENGINEER", "", "", "Passw0rd1"), "duplicate email rejected");

    t.group("auth/changePassword");
    await t.rejects(() => CMS.changePassword("wrong-old", "NewPass99"), "wrong current password rejected");
    await t.resolves(() => CMS.changePassword("Passw0rd1", "NewPass99"), "change with correct current password");
    await t.rejects(() => CMS.loginUser("test.smith@newfirm.example", "Passw0rd1"), "old password no longer works");
    await t.resolves(() => CMS.loginUser("test.smith@newfirm.example", "NewPass99"), "new password works");

    t.group("auth/impersonate (team switch)");
    const before = CMS.getCurrentUser().email;
    const imp = CMS.impersonate("jane.doe@kimley-horn.com");
    t.eq(imp.email, "jane.doe@kimley-horn.com", "impersonate switched session");
    t.ne(before, CMS.getCurrentUser().email, "current user changed without a password");
    CMS.logoutUser();
    t.notOk(CMS.isAuthenticated(), "logout clears session");
    t.throws(() => CMS.impersonate("jane.doe@kimley-horn.com"), "impersonate requires an authenticated session");
    await CMS.loginUser("jane.doe@kimley-horn.com", CMS.AUTH.DEMO_PASSWORD);

    t.group("templates/per-user isolation");
    t.ok(CMS.getTemplates().length >= 1, "Jane sees her seeded template(s)");
    await CMS.loginUser("test.smith@newfirm.example", "NewPass99");
    t.eq(CMS.getTemplates().length, 0, "new user sees none of Jane's templates");

    t.group("templates/license gate (base plan = 5)");
    BILL.currentTier = "Pro";
    t.eq(CMS.getTemplateLimit(), 5, "Pro template limit = 5");
    const made = [];
    for (let i = 1; i <= 5; i++) made.push(CMS.createTemplate("Client " + i, "tpl " + i, { idfZone: 7, precisionPass: 10000 }));
    t.eq(CMS.getTemplates().length, 5, "5 templates created");
    let gateErr = null;
    try { CMS.createTemplate("Client 6", "tpl 6", {}); } catch (e) { gateErr = e; }
    t.ok(gateErr, "6th template blocked");
    t.eq(gateErr && gateErr.code, "TEMPLATE_LIMIT", "error carries TEMPLATE_LIMIT code");
    t.match(gateErr && gateErr.message, /Firm|upgrade/i, "message points at an upgrade");
    t.ok(new Set(made.map(x => x.id)).size === 5, "template ids are unique (no Date.now collision)");

    t.group("templates/upgrade raises the cap");
    BILL.currentTier = "Firm";
    t.eq(CMS.getTemplateLimit(), 25, "Firm limit = 25");
    const six = CMS.createTemplate("Client 6", "tpl 6", { discipline: "DRAIN" });
    t.eq(CMS.getTemplates().length, 6, "6th now allowed on Firm");
    BILL.currentTier = "Enterprise";
    t.eq(CMS.getTemplateLimit(), 999, "Enterprise ~ unlimited");

    t.group("templates/active selection + settings read");
    const list = CMS.getTemplates();
    CMS.setActiveTemplate(list[2].id);
    t.eq(CMS.getActiveTemplate().id, list[2].id, "setActiveTemplate selects the right record");
    t.eq(CMS.getActiveTemplateSetting("discipline", "X"), list[2].settings.discipline, "getActiveTemplateSetting reads through");
    t.eq(CMS.getActiveTemplateSetting("nonexistent", "fallback"), "fallback", "missing setting -> fallback");
    CMS.updateTemplate(list[2].id, { settings: { precisionPass: 7500 } });
    t.eq(CMS.getActiveTemplateSetting("precisionPass", 0), 7500, "updateTemplate merges settings");
    CMS.deleteTemplate(list[2].id);
    t.eq(CMS.getTemplates().length, 5, "deleteTemplate removed one");
    t.ok(CMS.getActiveTemplateId() && CMS.getActiveTemplateId() !== list[2].id, "active moved off the deleted template");
    t.eq(CMS.getActiveTemplate().ownerId, six.ownerId, "active template still belongs to current user");

    t.group("templates/settings normalization");
    const norm = CMS.createTemplate("Norm", "n", { discipline: "road", idfZone: 99, precisionPass: 10, district: 50, fpidPrefix: "abc123-x!" });
    t.eq(norm.settings.discipline, "ROAD", "discipline upper-cased");
    t.lte(norm.settings.idfZone, 11, "idfZone clamped to 11");
    t.gte(norm.settings.idfZone, 1, "idfZone >= 1");
    t.gte(norm.settings.precisionPass, 1000, "precisionPass floored at 1000");
    t.lte(norm.settings.district, 8, "district clamped to 8");
    t.match(norm.settings.fpidPrefix, /^[\d-]*$/, "fpidPrefix stripped to digits/dashes");

    t.group("billing/tier limits + upsell");
    ["Free", "Pro", "Firm", "Enterprise"].forEach(tier => {
        BILL.currentTier = tier;
        const lim = BILL.getLimits();
        t.ok(lim && typeof lim.seats === "number", tier + " has a limits row");
        t.ok(typeof lim.clientTemplates === "number", tier + " has clientTemplates");
    });
    BILL.currentTier = "Free";
    t.eq(BILL.getTemplateLimit(), 5, "Free template limit 5");
    const up = BILL.nextTierForTemplates();
    t.ok(up && up.name === "Firm" && up.limit > 5, "next tier for templates is Firm");
    BILL.currentTier = "Enterprise";
    t.eq(BILL.nextTierForTemplates(), null, "no upgrade beyond Enterprise");
    BILL.currentTier = "Pro";

    t.group("cms/submittals — live-upload results integrated with the demo project data");
    // Be explicit about who's signed in — earlier groups end on a per-user-isolation
    // test account with its own (project-less) org, which would make the "own org"
    // assertion below meaningless.
    await CMS.loginUser("jane.doe@kimley-horn.com", CMS.AUTH.DEMO_PASSWORD);
    const subsBefore = CMS.getSubmittals().length;
    const rec = CMS.addSubmittal(null, "MyProject_ROW.dxf", "PASSED", 92, null, false, "a".repeat(64));
    t.eq(CMS.getSubmittals().length, subsBefore + 1, "addSubmittal appends a record");
    t.eq(CMS.getSubmittals()[0].id, rec.id, "…most recent first");
    t.eq(rec.fileName, "MyProject_ROW.dxf", "filename recorded");
    t.eq(rec.score, 92, "real score recorded");
    t.eq(rec.submittedBy, CMS.getCurrentUser().fullName, "submitter is the actual signed-in user, not a hardcoded default");
    t.ok(CMS.getProjects().some(p => p.id === rec.projectId), "no projectId given -> auto-assigned to a real project on file");
    t.eq(CMS.getProjects().find(p => p.id === rec.projectId).orgId, CMS.getCurrentUser().orgId, "…specifically one in the current user's own org");

    // REGRESSION: score 0 must not be swallowed by a `score || 95` fallback.
    const zero = CMS.addSubmittal(null, "Failing.dxf", "FAILED", 0, null, false, "b".repeat(64));
    t.eq(zero.score, 0, "REGRESSION: a real score of 0 is preserved, not defaulted to 95");

    // REGRESSION: no fabricated precision ratio when the caller has none to report.
    t.eq(zero.precisionRatio, "n/a", "REGRESSION: unspecified precisionRatio is 'n/a', not the old fake '1:307,958'");

    // an explicit projectId is honoured as given
    const explicit = CMS.addSubmittal("prj_fdot_882019", "Explicit.dxf", "PASSED", 100, "1:12,000", false, "c".repeat(64));
    t.eq(explicit.projectId, "prj_fdot_882019", "an explicit projectId is used as-is");

    t.group("cms/audit hash chain");
    const chain = await CMS.verifyAuditIntegrity();
    t.ok(chain.isValid, "seeded + appended audit chain verifies");
    const logs = CMS.getAuditLogs();
    t.gt(logs.length, 1, "audit log grew from the activity above");
    t.ok(logs.every(l => /^[0-9a-f]{64}$/.test(l.hash)), "every block hash is a 64-hex digest (no placeholder)");
    // tamper
    const raw = JSON.parse(W.localStorage.getItem("bqc_cms_audit_logs"));
    raw[1].details = "TAMPERED";
    W.localStorage.setItem("bqc_cms_audit_logs", JSON.stringify(raw));
    const bad = await CMS.verifyAuditIntegrity();
    t.notOk(bad.isValid, "tampered block detected");
    t.match(bad.errorType || "", /TAMPER|MISMATCH/i, "reports a tamper error type");

    // ── Stripe Billing & Webhook Integration ────────────────────────────
    t.group("billing/stripe config & checkout");
    const cfg = BILL.getStripeConfig();
    t.ok(cfg && cfg.publishableKey && cfg.paymentLinks, "Stripe config default object intact");
    BILL.saveStripeConfig({ mode: "live", publishableKey: "pk_test_live_12345" });
    t.eq(BILL.getStripeConfig().mode, "live", "Stripe mode update persisted");
    t.eq(BILL.getStripeConfig().publishableKey, "pk_test_live_12345", "Stripe publishable key persisted");

    const checkoutRes = await BILL.processCheckout({
        plan: "Firm",
        company: "Kimley-Horn",
        email: "jane.doe@kimley-horn.com",
        cardLast4: "4242"
    });
    t.ok(checkoutRes.success, "processCheckout returns success");
    t.eq(BILL.currentTier, "Firm", "currentTier updated to Firm");
    t.eq(W.localStorage.getItem("bqc_user_tier"), "Firm", "localStorage tier updated to Firm");
    t.ok(W.sessionStorage.getItem("bqc_c3d_jwt_token"), "sessionStorage ECDSA JWT minted");
    const sub = BILL.getSubscription();
    t.ok(sub && sub.status === "active" && sub.customerId && sub.subscriptionId, "active Stripe subscription recorded");

    t.group("billing/stripe webhook processing");
    const stripeEvt = {
        id: "evt_test_" + Date.now(),
        type: "invoice.payment_succeeded",
        data: {
            object: {
                id: "in_test_123",
                amount_total: 19900,
                metadata: { plan: "firm" }
            }
        }
    };
    const hookRes1 = CMS.processStripeWebhook(stripeEvt, "whsec_test", stripeEvt.id);
    t.ok(hookRes1.success, "Stripe standard invoice event processed");
    t.eq(hookRes1.amount, 199, "Stripe amount parsed from amount_total in cents");

    // Idempotency lock verification
    const hookRes2 = CMS.processStripeWebhook(stripeEvt, "whsec_test", stripeEvt.id);
    t.notOk(hookRes2.success, "duplicate Stripe webhook event blocked by idempotency key");
    t.eq(hookRes2.reason, "IDEMPOTENT_REQUEST_ALREADY_PROCESSED", "returns idempotency reason");

    // Cancellation test
    const cancelRes = await BILL.cancelSubscription();
    t.ok(cancelRes.success, "cancelSubscription returns success");
    t.eq(BILL.currentTier, "Free", "tier downgraded to Free");
    t.eq(CMS.getOrganizations()[0].plan, "free", "org plan downgraded to free in CMS");
};
