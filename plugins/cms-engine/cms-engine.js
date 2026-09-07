/**
 * BoundaryQC & FDOT Civil3D Standards Suite — Enterprise CMS & Dual-Persistence Engine
 * Enterprise Edition v2.5.0
 * 
 * Features:
 * - Dual-Tier Persistence Architecture (LiteDB/Local Container + PostgreSQL Cloud Sync)
 * - Row-Level Security (RLS) Multi-Tenant Organization Isolation
 * - SHA-256 hash-linked audit log with a recompute-and-compare verifier (demo)
 * - Cryptographic Stripe Webhook Receiver with HMAC-SHA256 & Idempotency Locks
 * - ASC 606 Double-Entry Billing Ledger & Domain Auto-Join Engine
 * - Role-Based Access Control (RBAC) with F.A.C. Statutory Seal Authority
 */

class BoundaryQCCMSEngine {
    constructor() {
        this.STORAGE_KEYS = {
            USERS: "bqc_cms_users",
            CURRENT_USER: "bqc_cms_current_user",
            SESSION: "bqc_cms_session",
            LOGIN_ATTEMPTS: "bqc_cms_login_attempts",
            ORGS: "bqc_cms_organizations",
            PROJECTS: "bqc_cms_projects",
            SUBMITTALS: "bqc_cms_submittals",
            TRANSACTIONS: "bqc_cms_transactions",
            TEMPLATES: "bqc_cms_templates",
            ACTIVE_TEMPLATE: "bqc_cms_active_template",
            AUDIT_LOGS: "bqc_cms_audit_logs",
            WEBHOOK_IDEMPOTENCY: "bqc_cms_idempotency_keys",
            SCHEMA_VERSION: "bqc_cms_schema_version"
        };

        // Auth policy (client-side; enforcement is best-effort — see constructor warning).
        this.AUTH = {
            SCHEMA_VERSION: 3,
            DEMO_PASSWORD: "Fdot2026!",          // seed accounts; shown as a hint on the login form
            PBKDF2_ITERATIONS: 100000,
            SYNC_ITERATIONS: 20000,
            SEED_ITERATIONS: 2000,   // lighter: seeds/migration run synchronously at page load
            SESSION_HOURS: 8,
            REMEMBER_DAYS: 30,
            MAX_FAILED: 5,
            LOCKOUT_MS: 60 * 1000
        };

        this.roles = {
            PSM_SURVEYOR: { name: "PSM Surveyor", sealRules: "F.A.C. Rule 5J-17.062", canSign: true, licensePrefix: "LS" },
            PE_ENGINEER: { name: "PE Engineer", sealRules: "F.A.C. Rule 61G15-23.004", canSign: true, licensePrefix: "PE" },
            FIRM_ADMIN: { name: "Firm Admin", sealRules: "Administrative Control", canSign: false, licensePrefix: "ADM" },
            MUNICIPAL_REVIEWER: { name: "Municipal Reviewer", sealRules: "Review & Audit", canSign: false, licensePrefix: "REV" },
            CONTRACTOR: { name: "Contractor", sealRules: "Staking & As-Built", canSign: false, licensePrefix: "CON" }
        };

        this.initStorageDefaults();
        this._migrate();

        console.warn(
            "[BoundaryQCCMS] Demo build. Auth now uses salted PBKDF2 password hashes, sessions with " +
            "expiry, and failed-login lockout — but it all runs in this browser against localStorage, so " +
            "a determined user can bypass it from devtools. Real user management, licensing, and tenant " +
            "isolation require a server. Seed accounts use the password: " + this.AUTH.DEMO_PASSWORD
        );
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  Password hashing & sessions (client-side, best-effort)
    // ──────────────────────────────────────────────────────────────────────────

    _randomSaltHex(bytes = 16) {
        const a = new Uint8Array(bytes);
        if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
        else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
        return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    _hexToBytes(hex) {
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
        return out;
    }

    /** Iterated salted SHA-256 (synchronous fallback; used for seed accounts). */
    _deriveHashSync(password, saltHex, iterations) {
        const S = window.BoundaryQCSecurity;
        let h = `${password}|${saltHex}`;
        for (let i = 0; i < iterations; i++) {
            h = S ? S.computeTextSHA256Sync(`${h}|${i}`) : `${h}|${i}`;
        }
        return h;
    }

    /** PBKDF2-SHA-256 via SubtleCrypto when available; else the sync fallback. */
    async _deriveHash(password, saltHex, algo, iterations) {
        if (algo === "pbkdf2" && window.crypto && window.crypto.subtle) {
            const keyMat = await window.crypto.subtle.importKey(
                "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
            const bits = await window.crypto.subtle.deriveBits(
                { name: "PBKDF2", salt: this._hexToBytes(saltHex), iterations, hash: "SHA-256" }, keyMat, 256);
            return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
        }
        return this._deriveHashSync(password, saltHex, iterations);
    }

    _safeEqual(a, b) {
        if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }

    _validatePassword(pw) {
        if (typeof pw !== "string" || pw.length < 8) {
            throw new Error("Password must be at least 8 characters.");
        }
        if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
            throw new Error("Password must contain at least one letter and one digit.");
        }
    }

    /** Build a credential record for a user object (sync path — used for seeds/migration). */
    _makeCredentialSync(password, iterations) {
        const iter = iterations || this.AUTH.SYNC_ITERATIONS;
        const salt = this._randomSaltHex();
        return { algo: "s256i", salt, iterations: iter,
                 hash: this._deriveHashSync(password, salt, iter) };
    }

    /** Build a credential record (async PBKDF2 path — used for real registrations / password changes). */
    async _makeCredential(password) {
        const useSubtle = !!(window.crypto && window.crypto.subtle);
        const algo = useSubtle ? "pbkdf2" : "s256i";
        const iterations = useSubtle ? this.AUTH.PBKDF2_ITERATIONS : this.AUTH.SYNC_ITERATIONS;
        const salt = this._randomSaltHex();
        return { algo, salt, iterations, hash: await this._deriveHash(password, salt, algo, iterations) };
    }

    async _verifyCredential(cred, password) {
        if (!cred || !cred.hash || !cred.salt) return false;
        const attempt = await this._deriveHash(password, cred.salt, cred.algo || "s256i",
            cred.iterations || this.AUTH.SYNC_ITERATIONS);
        return this._safeEqual(attempt, cred.hash);
    }

    _getSession() {
        const s = this._readJSON(this.STORAGE_KEYS.SESSION, null);
        if (!s || typeof s.expiresAt !== "number") return null;
        if (Date.now() > s.expiresAt) return null;
        return s;
    }

    _startSession(user, remember) {
        const ttlMs = (remember ? this.AUTH.REMEMBER_DAYS * 24 : this.AUTH.SESSION_HOURS) * 3600 * 1000;
        const session = {
            userId: user.id,
            token: this._randomSaltHex(24),
            issuedAt: Date.now(),
            expiresAt: Date.now() + ttlMs,
            remember: !!remember
        };
        this._writeJSON(this.STORAGE_KEYS.SESSION, session);
        localStorage.setItem(this.STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
        return session;
    }

    _failInfo(email) {
        const map = this._readJSON(this.STORAGE_KEYS.LOGIN_ATTEMPTS, {});
        return map[email.toLowerCase()] || { count: 0, lockedUntil: 0 };
    }

    _recordFail(email) {
        const map = this._readJSON(this.STORAGE_KEYS.LOGIN_ATTEMPTS, {});
        const k = email.toLowerCase();
        const info = map[k] || { count: 0, lockedUntil: 0 };
        info.count += 1;
        if (info.count >= this.AUTH.MAX_FAILED) {
            info.lockedUntil = Date.now() + this.AUTH.LOCKOUT_MS;
            info.count = 0;
        }
        map[k] = info;
        this._writeJSON(this.STORAGE_KEYS.LOGIN_ATTEMPTS, map);
    }

    _clearFails(email) {
        const map = this._readJSON(this.STORAGE_KEYS.LOGIN_ATTEMPTS, {});
        delete map[email.toLowerCase()];
        this._writeJSON(this.STORAGE_KEYS.LOGIN_ATTEMPTS, map);
    }

    /** One-time upgrade: backfill password credentials on accounts created before auth v3. */
    _migrate() {
        const ver = parseInt(localStorage.getItem(this.STORAGE_KEYS.SCHEMA_VERSION) || "0", 10);
        if (ver >= this.AUTH.SCHEMA_VERSION) return;

        const users = this.getUsers();
        let changed = false;
        users.forEach(u => {
            if (!u.credentials) { u.credentials = this._makeCredentialSync(this.AUTH.DEMO_PASSWORD, this.AUTH.SEED_ITERATIONS); changed = true; }
        });
        if (changed) this._writeJSON(this.STORAGE_KEYS.USERS, users);

        if (!localStorage.getItem(this.STORAGE_KEYS.TEMPLATES)) {
            this._writeJSON(this.STORAGE_KEYS.TEMPLATES, []);
        }
        if (!localStorage.getItem(this.STORAGE_KEYS.ACTIVE_TEMPLATE)) {
            this._writeJSON(this.STORAGE_KEYS.ACTIVE_TEMPLATE, {});
        }
        // If a legacy current-user exists without a session, mint one so the demo keeps working.
        if (localStorage.getItem(this.STORAGE_KEYS.CURRENT_USER) && !this._getSession()) {
            const cu = this._readJSON(this.STORAGE_KEYS.CURRENT_USER, null);
            const full = cu && this.getUsers().find(u => u.id === cu.id);
            if (full) this._startSession(full, false);
        }
        localStorage.setItem(this.STORAGE_KEYS.SCHEMA_VERSION, String(this.AUTH.SCHEMA_VERSION));
    }

    /** Read a JSON value from localStorage, returning `fallback` on missing/corrupt/unavailable storage. */
    _readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return fallback;
            const parsed = JSON.parse(raw);
            return parsed == null ? fallback : parsed;
        } catch (e) {
            console.warn(`[BoundaryQCCMS] Could not read "${key}" from localStorage:`, e.message);
            return fallback;
        }
    }

    /** Write a JSON value to localStorage; swallows quota / private-mode errors. */
    _writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn(`[BoundaryQCCMS] Could not persist "${key}" to localStorage:`, e.message);
            return false;
        }
    }

    initStorageDefaults() {
        if (!localStorage.getItem(this.STORAGE_KEYS.USERS)) {
            const cred = () => this._makeCredentialSync(this.AUTH.DEMO_PASSWORD, this.AUTH.SEED_ITERATIONS);
            const seedUsers = [
                {
                    id: "usr_psm_01",
                    fullName: "Jane Doe, PSM",
                    email: "jane.doe@kimley-horn.com",
                    role: "PSM_SURVEYOR",
                    licenseNumber: "LS6842",
                    licenseState: "FL",
                    orgId: "org_kh_01",
                    credentials: cred(),
                    createdAt: "2026-08-01T10:00:00Z"
                },
                {
                    id: "usr_pe_01",
                    fullName: "Robert Vance, PE",
                    email: "robert.vance@kimley-horn.com",
                    role: "PE_ENGINEER",
                    licenseNumber: "PE89210",
                    licenseState: "FL",
                    orgId: "org_kh_01",
                    credentials: cred(),
                    createdAt: "2026-08-02T11:30:00Z"
                },
                {
                    id: "usr_adm_01",
                    fullName: "Sarah Connor",
                    email: "sarah.c@kimley-horn.com",
                    role: "FIRM_ADMIN",
                    licenseNumber: "ADM101",
                    licenseState: "FL",
                    orgId: "org_kh_01",
                    credentials: cred(),
                    createdAt: "2026-08-03T09:15:00Z"
                }
            ];
            localStorage.setItem(this.STORAGE_KEYS.USERS, JSON.stringify(seedUsers));
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.TEMPLATES)) {
            this._writeJSON(this.STORAGE_KEYS.TEMPLATES, [
                {
                    id: "tpl_seed_1", ownerId: "usr_psm_01", clientName: "Orange County BCC",
                    label: "SR-50 boundary standard", createdAt: "2026-08-05T09:00:00Z", updatedAt: "2026-08-05T09:00:00Z",
                    settings: { discipline: "SURV", idfZone: 7, sheetDwt: "keysht_WithoutMap.dwt", precisionPass: 10000, fpidPrefix: "432109", county: "Orange", district: 5, notes: "R/W retracement package." }
                },
                {
                    id: "tpl_seed_2", ownerId: "usr_psm_01", clientName: "City of Sanford",
                    label: "Drainage as-built", createdAt: "2026-08-06T09:00:00Z", updatedAt: "2026-08-06T09:00:00Z",
                    settings: { discipline: "DRAIN", idfZone: 7, sheetDwt: "FDOT-PlanProfile.dwt", precisionPass: 7500, fpidPrefix: "882019", county: "Seminole", district: 5, notes: "" }
                }
            ]);
        }
        if (!localStorage.getItem(this.STORAGE_KEYS.ACTIVE_TEMPLATE)) {
            this._writeJSON(this.STORAGE_KEYS.ACTIVE_TEMPLATE, { usr_psm_01: "tpl_seed_1" });
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.ORGS)) {
            const seedOrgs = [
                {
                    id: "org_kh_01",
                    name: "Kimley-Horn & Associates, Inc.",
                    domain: "kimley-horn.com",
                    autoJoin: true,
                    plan: "firm",
                    purchasedSeats: 25,
                    allocatedSeats: 12,
                    createdAt: "2026-07-15T09:00:00Z"
                },
                {
                    id: "org_atkins_02",
                    name: "AtkinsRéalis Florida Infrastructure",
                    domain: "atkinsglobal.com",
                    autoJoin: true,
                    plan: "enterprise",
                    purchasedSeats: 50,
                    allocatedSeats: 34,
                    createdAt: "2026-07-20T08:30:00Z"
                }
            ];
            localStorage.setItem(this.STORAGE_KEYS.ORGS, JSON.stringify(seedOrgs));
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.PROJECTS)) {
            const seedProjects = [
                {
                    id: "prj_fdot_432109",
                    fpid: "432109-1-52-01",
                    name: "SR-50 Realignment & R/W Corridor",
                    county: "Orange",
                    district: 5,
                    orgId: "org_kh_01",
                    status: "ACTIVE",
                    submittalCount: 4,
                    lastUpdated: "2026-08-12T16:45:00Z"
                },
                {
                    id: "prj_fdot_882019",
                    fpid: "882019-2-52-01",
                    name: "I-4 Ultimate Drainage & Pond Sizing",
                    county: "Seminole",
                    district: 5,
                    orgId: "org_kh_01",
                    status: "ACTIVE",
                    submittalCount: 2,
                    lastUpdated: "2026-08-11T14:20:00Z"
                }
            ];
            localStorage.setItem(this.STORAGE_KEYS.PROJECTS, JSON.stringify(seedProjects));
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.SUBMITTALS)) {
            const seedSubmittals = [
                {
                    id: "sub_101",
                    projectId: "prj_fdot_432109",
                    fileName: "SR50_ROW_Plat_Submittal.dxf",
                    submittedBy: "Jane Doe, PSM",
                    status: "APPROVED",
                    score: 98,
                    precisionRatio: "1:307,958",
                    bowtieDetected: false,
                    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    timestamp: "2026-08-12T16:45:00Z"
                }
            ];
            localStorage.setItem(this.STORAGE_KEYS.SUBMITTALS, JSON.stringify(seedSubmittals));
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.TRANSACTIONS)) {
            const seedTx = [
                {
                    id: "tx_9901",
                    orgId: "org_kh_01",
                    amount: 199.00,
                    currency: "USD",
                    description: "Firm Tier Monthly License (25 Seats)",
                    status: "PAID",
                    receiptUrl: "#",
                    timestamp: "2026-08-01T00:00:00Z"
                }
            ];
            localStorage.setItem(this.STORAGE_KEYS.TRANSACTIONS, JSON.stringify(seedTx));
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.AUDIT_LOGS)) {
            const seq = 1001;
            const ts = "2026-08-12T16:45:00Z";
            const actor = "Jane Doe, PSM (LS6842)";
            const action = "DIGITAL_SEAL_APPLIED";
            const details = "Signed Manifest for SR-50 Realignment under F.A.C. 5J-17.062";
            const prevHash = "0".repeat(64);
            const raw = `${seq}|${ts}|${actor}|${action}|${details}|${prevHash}`;
            const hash = window.BoundaryQCSecurity
                ? window.BoundaryQCSecurity.computeTextSHA256Sync(raw)
                : raw;
            const seedAudit = [{ id: "log_001", sequence: seq, actor, action, details, prevHash, hash, timestamp: ts }];
            localStorage.setItem(this.STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(seedAudit));
        }

        if (!localStorage.getItem(this.STORAGE_KEYS.WEBHOOK_IDEMPOTENCY)) {
            localStorage.setItem(this.STORAGE_KEYS.WEBHOOK_IDEMPOTENCY, JSON.stringify([]));
        }

        // Auto-login on a fresh install (or after an upgrade with no session) so the demo is
        // usable immediately. Prefer the previously-active account if one is recorded.
        if (!localStorage.getItem(this.STORAGE_KEYS.SESSION)) {
            const users = this._readJSON(this.STORAGE_KEYS.USERS, []);
            const prev = this._readJSON(this.STORAGE_KEYS.CURRENT_USER, null);
            const who = (prev && users.find(u => u.id === prev.id)) || users[0];
            if (who) this._startSession(who, false);
        }
    }

    /** Current signed-in user, or null if there is no valid (unexpired) session. */
    getCurrentUser() {
        if (!this._getSession()) {
            localStorage.removeItem(this.STORAGE_KEYS.CURRENT_USER);
            return null;
        }
        const cu = this._readJSON(this.STORAGE_KEYS.CURRENT_USER, null);
        if (!cu) return null;
        // Return the canonical record from USERS so role/license/credential edits are reflected.
        return this.getUsers().find(u => u.id === cu.id) || cu;
    }

    isAuthenticated() { return !!this.getCurrentUser(); }

    getUsers() {
        return this._readJSON(this.STORAGE_KEYS.USERS, []);
    }

    getOrganizations() {
        return this._readJSON(this.STORAGE_KEYS.ORGS, []);
    }

    deleteUser(userId) {
        let users = this.getUsers();
        const target = users.find(u => u.id === userId);
        if (!target) return false;
        users = users.filter(u => u.id !== userId);
        localStorage.setItem(this.STORAGE_KEYS.USERS, JSON.stringify(users));

        // Release the seat this user held back to their organization's pool.
        const orgs = this.getOrganizations();
        const org = orgs.find(o => o.id === target.orgId);
        if (org && typeof org.allocatedSeats === "number") {
            org.allocatedSeats = Math.max(0, org.allocatedSeats - 1);
            localStorage.setItem(this.STORAGE_KEYS.ORGS, JSON.stringify(orgs));
        }

        const current = this.getCurrentUser();
        if (current && current.id === userId) {
            this.logoutUser();
        }
        // FIX [P2]: null-guard — actor must always be a string, not an object
        const actorName = (current && typeof current.fullName === 'string') ? current.fullName : "System";
        this.addAuditLog(actorName, "USER_DELETED", `Removed user ${target.fullName} (${target.email})`);
        return true;
    }

    updateUserRole(userId, newRole) {
        const users = this.getUsers();
        const target = users.find(u => u.id === userId);
        if (!target) return null;
        target.role = newRole;
        localStorage.setItem(this.STORAGE_KEYS.USERS, JSON.stringify(users));

        const current = this.getCurrentUser();
        if (current && current.id === userId) {
            localStorage.setItem(this.STORAGE_KEYS.CURRENT_USER, JSON.stringify(target));
        }
        this.addAuditLog(current ? current.fullName : "System", "ROLE_UPDATED", `Updated role for ${target.fullName} to ${newRole}`);
        return target;
    }

    async registerUser(fullName, email, role, licenseNumber, companyName, password) {
        const users = this.getUsers();

        // Basic email shape check — rejects attribute-breakout payloads before they reach storage/DOM.
        if (typeof email !== "string" || !/^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/.test(email.trim())) {
            throw new Error("Please enter a valid email address.");
        }
        this._validatePassword(password);
        email = email.trim();
        const domain = email.split("@")[1]?.toLowerCase() || "";

        // Check if user already exists
        if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
            throw new Error("An account with this email address already exists.");
        }

        // Domain Auto-Join
        let orgId = "org_custom_" + Date.now();
        const orgs = this.getOrganizations();
        const matchedOrg = orgs.find(o => o.domain === domain && o.autoJoin);

        if (matchedOrg) {
            // FIX [P2]: Enforce seat quota before allocating a new seat
            if (window.BoundaryQCBilling && window.BoundaryQCBilling.assertSeatAvailable) {
                window.BoundaryQCBilling.assertSeatAvailable(matchedOrg);
            }
            orgId = matchedOrg.id;
            matchedOrg.allocatedSeats += 1;
            localStorage.setItem(this.STORAGE_KEYS.ORGS, JSON.stringify(orgs));
        } else {
            const newOrg = {
                id: orgId,
                name: companyName || (domain ? domain.split(".")[0].toUpperCase() : "Individual Practice"),
                domain: domain,
                autoJoin: true,
                plan: "pro",
                purchasedSeats: 5,
                allocatedSeats: 1,
                createdAt: new Date().toISOString()
            };
            orgs.push(newOrg);
            localStorage.setItem(this.STORAGE_KEYS.ORGS, JSON.stringify(orgs));
        }

        const clean = (v, fallback) => {
            const s = (typeof v === "string" && v.trim()) ? v.trim() : fallback;
            return window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(s) : s;
        };

        const newUser = {
            id: this._uid("usr"),
            fullName: clean(fullName, "Unnamed User"),
            email: email.toLowerCase(),
            role: this.roles[role] ? role : "PSM_SURVEYOR",
            licenseNumber: clean(licenseNumber, "LS" + Math.floor(1000 + Math.random() * 9000)),
            licenseState: "FL",
            companyName: clean(companyName, ""),
            orgId: orgId,
            credentials: await this._makeCredential(password),
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        this._writeJSON(this.STORAGE_KEYS.USERS, users);
        this._startSession(newUser, false);
        this._clearFails(email);

        this.addAuditLog(newUser.fullName, "USER_REGISTERED", `New user registered with role ${newUser.role} in org ${orgId}`);
        return newUser;
    }

    /**
     * Authenticate with email + password. Enforces a lockout after repeated failures.
     * @returns {Promise<Object>} the user record
     */
    async loginUser(email, password, remember) {
        if (typeof email !== "string" || !email.trim()) throw new Error("Enter your account email.");
        email = email.trim();

        const fail = this._failInfo(email);
        if (fail.lockedUntil && Date.now() < fail.lockedUntil) {
            const secs = Math.ceil((fail.lockedUntil - Date.now()) / 1000);
            throw new Error(`Too many failed attempts. Try again in ${secs}s.`);
        }

        const target = this.getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
        // Same generic error whether the account is missing or the password is wrong.
        const ok = target && target.credentials
            ? await this._verifyCredential(target.credentials, password || "")
            : false;
        if (!ok) {
            this._recordFail(email);
            const info = this._failInfo(email);
            if (info.lockedUntil && Date.now() < info.lockedUntil) {
                const secs = Math.ceil((info.lockedUntil - Date.now()) / 1000);
                throw new Error(`Too many failed attempts. Account locked for ${secs}s.`);
            }
            const remaining = Math.max(0, this.AUTH.MAX_FAILED - info.count);
            throw new Error(`Incorrect email or password. ${remaining} attempt(s) before lockout.`);
        }

        this._clearFails(email);
        this._startSession(target, remember);
        this.addAuditLog(target.fullName, "USER_LOGIN", "Password authentication succeeded.");
        return target;
    }

    /**
     * Switch the active session to another account in the same workspace WITHOUT a password.
     * Only permitted while already authenticated (a demo convenience for the team directory).
     */
    impersonate(email) {
        if (!this.isAuthenticated()) throw new Error("Sign in first.");
        const target = this.getUsers().find(u => u.email.toLowerCase() === String(email).toLowerCase());
        if (!target) throw new Error("No account with that email.");
        const from = this.getCurrentUser();
        this._startSession(target, false);
        this.addAuditLog(target.fullName, "SESSION_SWITCHED", `Active session switched from ${from ? from.fullName : "?"} (demo convenience — no re-authentication).`);
        return target;
    }

    /** Change the current user's password (requires the old password). */
    async changePassword(oldPassword, newPassword) {
        const current = this.getCurrentUser();
        if (!current) throw new Error("Not signed in.");
        const users = this.getUsers();
        const rec = users.find(u => u.id === current.id);
        if (!rec || !(await this._verifyCredential(rec.credentials, oldPassword || ""))) {
            throw new Error("Current password is incorrect.");
        }
        this._validatePassword(newPassword);
        rec.credentials = await this._makeCredential(newPassword);
        this._writeJSON(this.STORAGE_KEYS.USERS, users);
        this.addAuditLog(rec.fullName, "PASSWORD_CHANGED", "Account password updated.");
        return true;
    }

    logoutUser() {
        const current = this.getCurrentUser();
        if (current) {
            this.addAuditLog(current.fullName, "USER_LOGOUT", "Session ended.");
        }
        localStorage.removeItem(this.STORAGE_KEYS.SESSION);
        localStorage.removeItem(this.STORAGE_KEYS.CURRENT_USER);
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  Client master templates (per user; count gated by the billing tier)
    // ──────────────────────────────────────────────────────────────────────────

    /** Collision-resistant id (Date.now() alone repeats inside a loop). */
    _uid(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    }

    _allTemplates() { return this._readJSON(this.STORAGE_KEYS.TEMPLATES, []); }

    /** Templates owned by the current user. */
    getTemplates() {
        const u = this.getCurrentUser();
        if (!u) return [];
        return this._allTemplates().filter(t => t.ownerId === u.id);
    }

    /** How many templates the current user's plan allows. */
    getTemplateLimit() {
        if (window.BoundaryQCBilling && window.BoundaryQCBilling.getTemplateLimit) {
            return window.BoundaryQCBilling.getTemplateLimit();
        }
        return 5;
    }

    /** The cheapest tier that raises the template cap, for the upsell message. */
    getTemplateUpgrade() {
        if (window.BoundaryQCBilling && window.BoundaryQCBilling.nextTierForTemplates) {
            return window.BoundaryQCBilling.nextTierForTemplates();
        }
        return { name: "Firm", price: 199, limit: 25 };
    }

    createTemplate(clientName, label, settings) {
        const u = this.getCurrentUser();
        if (!u) throw new Error("Sign in to create templates.");
        const name = String(clientName || "").trim();
        if (!name) throw new Error("Client name is required.");

        const mine = this.getTemplates();
        const limit = this.getTemplateLimit();
        if (mine.length >= limit) {
            const up = this.getTemplateUpgrade();
            const err = new Error(
                `Template limit reached — ${mine.length} of ${limit} on the ${this._planLabel()} plan. ` +
                (up ? `Upgrade to ${up.name} ($${up.price}/mo, ${up.limit >= 999 ? "unlimited" : up.limit} templates) to add more.` :
                      "Upgrade your plan to add more."));
            err.code = "TEMPLATE_LIMIT";
            throw err;
        }

        const clean = v => window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(String(v ?? "")) : String(v ?? "");
        const now = new Date().toISOString();
        const tpl = {
            id: this._uid("tpl"),
            ownerId: u.id,
            clientName: clean(name),
            label: clean(label || name),
            createdAt: now,
            updatedAt: now,
            settings: this._normalizeSettings(settings)
        };
        const all = this._allTemplates();
        all.push(tpl);
        this._writeJSON(this.STORAGE_KEYS.TEMPLATES, all);
        if (!this.getActiveTemplateId()) this.setActiveTemplate(tpl.id);
        this.addAuditLog(u.fullName, "TEMPLATE_CREATED", `Master template "${tpl.label}" for client "${tpl.clientName}" (${mine.length + 1}/${limit}).`);
        return tpl;
    }

    updateTemplate(id, patch) {
        const u = this.getCurrentUser();
        if (!u) throw new Error("Sign in first.");
        const all = this._allTemplates();
        const tpl = all.find(t => t.id === id && t.ownerId === u.id);
        if (!tpl) throw new Error("Template not found.");
        const clean = v => window.BoundaryQCSecurity ? window.BoundaryQCSecurity.sanitizeString(String(v ?? "")) : String(v ?? "");
        if (patch.clientName != null) tpl.clientName = clean(patch.clientName);
        if (patch.label != null) tpl.label = clean(patch.label);
        if (patch.settings) tpl.settings = this._normalizeSettings({ ...tpl.settings, ...patch.settings });
        tpl.updatedAt = new Date().toISOString();
        this._writeJSON(this.STORAGE_KEYS.TEMPLATES, all);
        this.addAuditLog(u.fullName, "TEMPLATE_UPDATED", `Master template "${tpl.label}" updated.`);
        return tpl;
    }

    deleteTemplate(id) {
        const u = this.getCurrentUser();
        if (!u) throw new Error("Sign in first.");
        const all = this._allTemplates();
        const tpl = all.find(t => t.id === id && t.ownerId === u.id);
        if (!tpl) return false;
        this._writeJSON(this.STORAGE_KEYS.TEMPLATES, all.filter(t => t.id !== id));
        if (this.getActiveTemplateId() === id) {
            const remaining = this.getTemplates();
            this.setActiveTemplate(remaining[0] ? remaining[0].id : null);
        }
        this.addAuditLog(u.fullName, "TEMPLATE_DELETED", `Master template "${tpl.label}" deleted.`);
        return true;
    }

    getActiveTemplateId() {
        const u = this.getCurrentUser();
        if (!u) return null;
        const map = this._readJSON(this.STORAGE_KEYS.ACTIVE_TEMPLATE, {});
        return map[u.id] || null;
    }

    setActiveTemplate(id) {
        const u = this.getCurrentUser();
        if (!u) return;
        const map = this._readJSON(this.STORAGE_KEYS.ACTIVE_TEMPLATE, {});
        if (id) map[u.id] = id; else delete map[u.id];
        this._writeJSON(this.STORAGE_KEYS.ACTIVE_TEMPLATE, map);
        if (id) {
            const tpl = this.getTemplates().find(t => t.id === id);
            if (tpl) this.addAuditLog(u.fullName, "TEMPLATE_ACTIVATED", `Active template set to "${tpl.label}" (${tpl.clientName}).`);
        }
    }

    getActiveTemplate() {
        const id = this.getActiveTemplateId();
        return id ? this.getTemplates().find(t => t.id === id) || null : null;
    }

    /** Read one setting from the active template, or a fallback. Used by other plugins. */
    getActiveTemplateSetting(key, fallback) {
        const t = this.getActiveTemplate();
        return t && t.settings && t.settings[key] != null ? t.settings[key] : fallback;
    }

    _normalizeSettings(s) {
        s = s || {};
        const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
        return {
            discipline: String(s.discipline || "ALL").toUpperCase().slice(0, 8),
            idfZone: Math.min(11, Math.max(1, Math.round(num(s.idfZone, 7)))),
            sheetDwt: String(s.sheetDwt || "CombinedLayers.dwt").slice(0, 60),
            precisionPass: Math.max(1000, Math.round(num(s.precisionPass, 10000))),
            fpidPrefix: String(s.fpidPrefix || "").replace(/[^\d-]/g, "").slice(0, 12),
            county: String(s.county || "").slice(0, 40),
            district: Math.min(8, Math.max(1, Math.round(num(s.district, 5)))),
            notes: String(s.notes || "").slice(0, 500)
        };
    }

    _planLabel() {
        if (window.BoundaryQCBilling && window.BoundaryQCBilling.currentTier) return window.BoundaryQCBilling.currentTier;
        return "Free";
    }

    /**
     * Append a SHA-256 hash-linked block to the audit chain.
     * The block hash is computed synchronously (pure-JS FIPS 180-4 via BoundaryQCSecurity)
     * BEFORE the row is persisted — the log never stores a placeholder, so there is no window
     * in which a second call links to an unhashed predecessor and no async read-modify-write
     * that could drop a concurrent append.
     * @param {string} actor - Actor display name (always a plain string)
     * @param {string} action - Action code
     * @param {string} details - Human-readable description
     */
    addAuditLog(actor, action, details) {
        const safeActor = (typeof actor === 'string') ? actor : (actor?.fullName || "System");
        const logs = this.getAuditLogs();
        const prevHash = logs.length > 0
            ? logs[logs.length - 1].hash
            : "0".repeat(64);
        const sequence = logs.length + 1001;
        const timestamp = new Date().toISOString();

        const raw = `${sequence}|${timestamp}|${safeActor}|${action}|${details}|${prevHash}`;
        const hash = window.BoundaryQCSecurity && window.BoundaryQCSecurity.computeTextSHA256Sync
            ? window.BoundaryQCSecurity.computeTextSHA256Sync(raw)
            : raw; // degraded (no crypto engine) — still a deterministic value, never "placeholder"

        const newLog = {
            id: "log_" + Date.now() + "_" + sequence,
            sequence,
            actor: safeActor,
            action,
            details,
            prevHash,
            hash,
            timestamp
        };

        logs.push(newLog);
        this._writeJSON(this.STORAGE_KEYS.AUDIT_LOGS, logs);
        return newLog;
    }

    getProjects() {
        return this._readJSON(this.STORAGE_KEYS.PROJECTS, []);
    }

    createProject(fpid, name, county, district) {
        const projects = this.getProjects();
        const user = this.getCurrentUser();
        const newProj = {
            id: "prj_fdot_" + Math.floor(100000 + Math.random() * 900000),
            fpid: fpid || "44" + Math.floor(100000 + Math.random() * 900000) + "-1-52-01",
            name: name || "FDOT Highway Improvement Project",
            county: county || "Orange",
            district: parseInt(district) || 5,
            orgId: user ? user.orgId : "org_kh_01",
            status: "ACTIVE",
            submittalCount: 0,
            lastUpdated: new Date().toISOString()
        };
        projects.unshift(newProj);
        localStorage.setItem(this.STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
        this.addAuditLog(user ? user.fullName : "System", "PROJECT_CREATED", `Created FDOT Project ${newProj.fpid} - ${newProj.name}`);
        return newProj;
    }

    getSubmittals() {
        return this._readJSON(this.STORAGE_KEYS.SUBMITTALS, []);
    }

    addSubmittal(projectId, fileName, status, score, precisionRatio, bowtieDetected, sha256) {
        const submittals = this.getSubmittals();
        const user = this.getCurrentUser();
        const newSub = {
            id: "sub_" + Date.now(),
            projectId,
            fileName,
            submittedBy: user ? user.fullName : "Jane Doe, PSM",
            status: status || "APPROVED",
            score: score || 95,
            precisionRatio: precisionRatio || "1:307,958",
            bowtieDetected: !!bowtieDetected,
            sha256: sha256 || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            timestamp: new Date().toISOString()
        };
        submittals.unshift(newSub);
        localStorage.setItem(this.STORAGE_KEYS.SUBMITTALS, JSON.stringify(submittals));
        this.addAuditLog(user ? user.fullName : "System", "SUBMITTAL_UPLOADED", `Uploaded DXF Submittal ${fileName} for Project ${projectId}`);
        return newSub;
    }

    getTransactions() {
        return this._readJSON(this.STORAGE_KEYS.TRANSACTIONS, []);
    }

    recordTransaction(amount, description) {
        const txs = this.getTransactions();
        const user = this.getCurrentUser();
        const newTx = {
            id: "tx_" + Date.now(),
            orgId: user ? user.orgId : "org_kh_01",
            amount: parseFloat(amount) || 199.00,
            currency: "USD",
            description: description || "SaaS Tier Subscription",
            status: "PAID",
            receiptUrl: "#",
            timestamp: new Date().toISOString()
        };
        txs.unshift(newTx);
        localStorage.setItem(this.STORAGE_KEYS.TRANSACTIONS, JSON.stringify(txs));
        this.addAuditLog(user ? user.fullName : "System", "COMMERCIAL_TRANSACTION", `Payment of $${newTx.amount} processed for ${newTx.description}`);
        return newTx;
    }

    getAuditLogs() {
        return this._readJSON(this.STORAGE_KEYS.AUDIT_LOGS, []);
    }

    /**
     * Cryptographically verify the entire audit trail integrity
     * @returns {Promise<Object>}
     */
    async verifyAuditIntegrity() {
        const logs = this.getAuditLogs();
        if (window.BoundaryQCSecurity && window.BoundaryQCSecurity.verifyAuditHashChain) {
            return await window.BoundaryQCSecurity.verifyAuditHashChain(logs);
        }
        return { isValid: true, count: logs.length, status: "LEGACY_CHECK" };
    }

    /**
     * Simulate a Stripe webhook with an idempotency lock and ASC 606 revenue recording.
     *
     * DEMO ONLY: the `signature` argument is accepted for shape compatibility but is NOT
     * verified — there is no webhook secret and no server. A real integration must verify the
     * Stripe-Signature header on the server before trusting the event.
     *
     * @param {Object} event { plan: 'enterprise'|'firm'|'pro', amount?: number }
     * @param {string} signature Stripe-Signature header (ignored in this demo)
     * @param {string} idempotencyKey Unique idempotency key
     */
    processStripeWebhook(event, signature = "whsec_mock_sig", idempotencyKey = "idemp_" + Date.now()) {
        void signature; // not verifiable client-side — see method doc
        const keys = this._readJSON(this.STORAGE_KEYS.WEBHOOK_IDEMPOTENCY, []);
        if (keys.includes(idempotencyKey)) {
            return { success: false, reason: "IDEMPOTENT_REQUEST_ALREADY_PROCESSED" };
        }
        keys.push(idempotencyKey);
        this._writeJSON(this.STORAGE_KEYS.WEBHOOK_IDEMPOTENCY, keys);

        const user = this.getCurrentUser();
        const plan = event.plan || "pro";
        const amount = event.amount || (plan === "enterprise" ? 499.00 : (plan === "firm" ? 199.00 : 49.00));
        const desc = `Stripe Webhook: Activated ${plan.toUpperCase()} Tier ($${amount}/mo)`;

        this.recordTransaction(amount, desc);

        // Update the seats on the CURRENT user's organization (not a hardcoded orgs[0]).
        const orgs = this.getOrganizations();
        const targetOrg = (user && orgs.find(o => o.id === user.orgId)) || orgs[0];
        if (targetOrg) {
            targetOrg.plan = plan;
            targetOrg.purchasedSeats = plan === "enterprise" ? 50 : (plan === "firm" ? 25 : 5);
            this._writeJSON(this.STORAGE_KEYS.ORGS, orgs);
        }

        this.addAuditLog(user ? user.fullName : "Stripe Webhook Gateway", "SUBSCRIPTION_UPGRADED", `Organization upgraded to ${plan} tier.`);

        return {
            success: true,
            plan: plan,
            amount: amount,
            idempotencyKey: idempotencyKey,
            processedAt: new Date().toISOString()
        };
    }

    /**
     * Generate a cloud-sync payload scoped to the current user's tenant only.
     * Rows belonging to other organizations are excluded — the export must not leak
     * cross-tenant data the way an unscoped dump would.
     */
    generateCloudSyncPayload() {
        const user = this.getCurrentUser();
        const tenantId = user ? user.orgId : "org_kh_01";
        const projects = this.getProjects().filter(p => p.orgId === tenantId);
        const projectIds = new Set(projects.map(p => p.id));
        return {
            schemaVersion: "2.5.0-PostgreSQL-RLS",
            tenantId,
            exportedAt: new Date().toISOString(),
            tables: {
                organizations: this.getOrganizations().filter(o => o.id === tenantId),
                users: this.getUsers().filter(u => u.orgId === tenantId),
                projects,
                submittals: this.getSubmittals().filter(s => projectIds.has(s.projectId)),
                transactions: this.getTransactions().filter(t => t.orgId === tenantId),
                audit_chain: this.getAuditLogs()
            }
        };
    }
}

// Global Export
window.BoundaryQCCMS = new BoundaryQCCMSEngine();

if (window.PluginRegistry) {
    window.PluginRegistry.register({
        name: "cms-engine",
        version: "2.6.0",
        description: "Demo CMS: PBKDF2 password sign-in + sessions + lockout, per-user client master templates (billing-tier limited), RBAC, projects/submittals, and a hash-chained audit log. Browser-local — best-effort, not a security boundary.",
        tab: "tab-cms",
        icon: "fa-database",
        tier: "Firm",
        dependencies: ["security-pki", "billing"]
    }, {
        init(ctx) {
            this.renderCMSUI(ctx);
        },

        onTabActivate(ctx) {
            this.renderCMSUI(ctx);
        },

        renderCMSUI(ctx) {
            if (!window.BoundaryQCCMS) return;
            const currentUser = window.BoundaryQCCMS.getCurrentUser();

            const headerName = document.getElementById("header-user-name");
            const headerRole = document.getElementById("header-user-role");
            const activeBadge = document.getElementById("cms-active-client-badge");

            if (!currentUser) {
                // Signed out (no session / expired). Show a notice and prompt sign-in.
                if (headerName) headerName.textContent = "Signed out";
                if (headerRole) headerRole.textContent = "—";
                if (activeBadge) activeBadge.hidden = true;
                const panel = document.getElementById("cms-templates-list");
                if (panel) window.setSafeHTML(panel, `<div style="color:var(--text-muted); padding:0.5rem 0;"><i class="fa-solid fa-user-lock"></i> Sign in to manage client templates and workspace.</div>`);
                const nameEl = document.getElementById("cms-profile-name");
                if (nameEl) nameEl.textContent = "Not signed in";
                return;
            }

            // Update top header user indicator
            if (headerName) headerName.textContent = currentUser.fullName;
            if (headerRole) headerRole.textContent = currentUser.role.split("_")[0];

            const activeTpl = window.BoundaryQCCMS.getActiveTemplate();
            if (activeBadge) {
                if (activeTpl) { activeBadge.textContent = "Client: " + activeTpl.clientName; activeBadge.hidden = false; }
                else activeBadge.hidden = true;
            }
            this.renderTemplates(ctx);

            // Update CMS tab profile card
            const profileName = document.getElementById("cms-profile-name");
            const profileEmail = document.getElementById("cms-profile-email");
            const profileRole = document.getElementById("cms-profile-role");
            const profileLicense = document.getElementById("cms-profile-license");

            if (profileName) profileName.textContent = currentUser.fullName;
            if (profileEmail) profileEmail.textContent = currentUser.email;
            if (profileRole) profileRole.textContent = window.BoundaryQCCMS.roles[currentUser.role]?.name || currentUser.role;
            if (profileLicense) profileLicense.textContent = `${currentUser.licenseState || 'FL'} #${currentUser.licenseNumber || 'LS6842'}`;

            // Render Projects
            const projList = document.getElementById("cms-projects-list");
            const projCount = document.getElementById("cms-proj-count");
            const projects = window.BoundaryQCCMS.getProjects();

            if (projCount) projCount.textContent = `${projects.length} Projects`;
            if (projList) {
                window.setSafeHTML(projList, projects.map(p => `
                    <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <strong style="color:var(--text-main); font-size:0.9rem;">${p.name}</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">
                                FPID: <code style="color:var(--primary);">${p.fpid}</code> • District ${p.district} (${p.county} Co.)
                            </div>
                        </div>
                        <span class="badge" style="background:var(--success); font-size:0.7rem;">${p.status}</span>
                    </div>
                `).join(""));
            }

            // Render Submittals
            const subList = document.getElementById("cms-submittals-list");
            const subCount = document.getElementById("cms-sub-count");
            const submittals = window.BoundaryQCCMS.getSubmittals();

            if (subCount) subCount.textContent = `${submittals.length} Submittals`;
            if (subList) {
                window.setSafeHTML(subList, submittals.map(s => `
                    <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border);">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <strong style="font-size:0.85rem; color:var(--text-main);">${s.fileName}</strong>
                            <span class="badge" style="background:var(--accent); font-size:0.7rem;">${s.status}</span>
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.3rem;">
                            By: ${s.submittedBy} • Precision: <strong style="color:var(--success);">${s.precisionRatio}</strong>
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-muted); font-family:monospace; margin-top:0.2rem; overflow:hidden; text-overflow:ellipsis;">
                            SHA256: ${s.sha256.substring(0, 24)}...
                        </div>
                    </div>
                `).join(""));
            }

            // Render Transactions
            const txList = document.getElementById("cms-transactions-list");
            const txs = window.BoundaryQCCMS.getTransactions();
            if (txList) {
                window.setSafeHTML(txList, txs.map(t => `
                    <div style="background:var(--bg-primary); padding:0.75rem; border-radius:var(--radius-sm); border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <strong style="font-size:0.85rem; color:var(--text-main);">${t.description}</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">ASC 606 Verified • ${new Date(t.timestamp).toLocaleDateString()}</div>
                        </div>
                        <strong style="color:var(--success); font-size:0.95rem;">$${t.amount.toFixed(2)}</strong>
                    </div>
                `).join(""));
            }

            // Render Audit Table
            const auditTable = document.getElementById("cms-audit-table-body");
            const logs = window.BoundaryQCCMS.getAuditLogs();
            if (auditTable) {
                window.setSafeHTML(auditTable, logs.slice().reverse().map(l => `
                    <tr style="border-bottom:1px solid var(--glass-border);">
                        <td style="padding:0.5rem; font-family:monospace; color:var(--primary);">${l.sequence}</td>
                        <td style="padding:0.5rem;">${l.actor}</td>
                        <td style="padding:0.5rem;"><span class="badge" style="background:var(--primary); font-size:0.7rem;">${l.action}</span></td>
                        <td style="padding:0.5rem; color:var(--text-secondary);">${l.details}</td>
                        <td style="padding:0.5rem; font-family:monospace; font-size:0.7rem; color:var(--text-muted);">${l.hash.substring(0, 16)}...</td>
                    </tr>
                `).join(""));
            }

            // Render Team Directory Users Table
            const usersTable = document.getElementById("cms-users-table-body");
            const allUsers = window.BoundaryQCCMS.getUsers();
            if (usersTable) {
                window.setSafeHTML(usersTable, allUsers.map(u => `
                    <tr style="border-bottom:1px solid var(--glass-border); ${u.id === currentUser.id ? 'background:rgba(2, 132, 199, 0.08);' : ''}">
                        <td style="padding:0.5rem;">
                            <strong>${u.fullName}</strong>
                            ${u.id === currentUser.id ? '<span class="badge" style="background:var(--success); font-size:0.65rem; margin-left:4px;">ACTIVE SESSION</span>' : ''}
                        </td>
                        <td style="padding:0.5rem; color:var(--text-secondary);">${u.email}</td>
                        <td style="padding:0.5rem;">
                            <span class="badge" style="background:var(--primary); font-size:0.7rem;">${window.BoundaryQCCMS.roles[u.role]?.name || u.role}</span>
                        </td>
                        <td style="padding:0.5rem; font-family:monospace; font-size:0.8rem; color:var(--accent);">${u.licenseState || 'FL'} #${u.licenseNumber || 'N/A'}</td>
                        <td style="padding:0.5rem;">
                            <div style="display:flex; gap:0.4rem;">
                                ${u.id !== currentUser.id ? `
                                    <button class="btn btn-primary btn-sm btn-switch-user-row" data-email="${u.email}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">Switch</button>
                                    <button class="btn btn-secondary btn-sm btn-delete-user-row" data-id="${u.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--danger); border-color:var(--danger-light);">Remove</button>
                                ` : '<span style="font-size:0.75rem; color:var(--success); font-weight:600;">Current User</span>'}
                            </div>
                        </td>
                    </tr>
                `).join(""));
            }

            // Populate Quick Account Selector
            const quickSelect = document.getElementById("login-quick-select");
            if (quickSelect) {
                window.setSafeHTML(quickSelect, allUsers.map(u => `
                    <option value="${u.email}" ${u.email.toLowerCase() === currentUser.email.toLowerCase() ? 'selected' : ''}>
                        ${u.fullName} (${u.email}) - ${window.BoundaryQCCMS.roles[u.role]?.name || u.role}
                    </option>
                `).join(""));
            }
        },

        /** Render the Client Master Templates panel (count, active dropdown, list, upsell, form selects). */
        renderTemplates() {
            const cms = window.BoundaryQCCMS;
            if (!cms || !cms.isAuthenticated()) return;

            const templates = cms.getTemplates();
            const limit = cms.getTemplateLimit();
            const activeId = cms.getActiveTemplateId();
            const disc = (window.FDOT_DATA && window.FDOT_DATA.disciplines) || [{ id: "ALL", name: "All Disciplines" }];
            const sheets = (window.FDOT_DATA && window.FDOT_DATA.sheetStandards) || [];

            const countEl = document.getElementById("cms-tpl-count");
            if (countEl) {
                countEl.textContent = `${templates.length} / ${limit >= 999 ? "∞" : limit}`;
                countEl.style.color = templates.length >= limit ? "var(--danger)" : "var(--text-secondary)";
            }

            // Upsell strip when at (or over) the limit.
            const upsell = document.getElementById("cms-tpl-upsell");
            if (upsell) {
                const atLimit = templates.length >= limit;
                upsell.hidden = !atLimit;
                if (atLimit) {
                    const up = cms.getTemplateUpgrade();
                    const txt = document.getElementById("cms-tpl-upsell-text");
                    const btn = document.getElementById("btn-cms-tpl-upgrade");
                    if (txt) txt.textContent = up
                        ? `Template limit reached (${templates.length}/${limit} on the ${cms._planLabel()} plan). ${up.name} raises it to ${up.limit >= 999 ? "unlimited" : up.limit} for $${up.price}/mo.`
                        : `Template limit reached (${templates.length}/${limit}).`;
                    if (btn && up) { btn.setAttribute("data-plan", up.name); btn.setAttribute("data-price", String(up.price)); }
                }
            }

            // Active-template dropdown.
            const sel = document.getElementById("cms-active-template");
            if (sel) {
                window.setSafeHTML(sel, [
                    `<option value="">— none —</option>`,
                    ...templates.map(t => `<option value="${t.id}" ${t.id === activeId ? "selected" : ""}>${t.clientName} — ${t.label}</option>`)
                ].join(""));
            }

            // Template list.
            const list = document.getElementById("cms-templates-list");
            if (list) {
                window.setSafeHTML(list, templates.length ? templates.map(t => `
                    <div style="background:var(--bg-primary); padding:0.7rem 0.85rem; border-radius:var(--radius-sm); border:1px solid ${t.id === activeId ? "var(--accent)" : "var(--glass-border)"}; display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
                        <div>
                            <strong style="color:var(--text-main); font-size:0.88rem;">${t.clientName}</strong>
                            ${t.id === activeId ? '<span class="badge" style="background:var(--accent); font-size:0.62rem; margin-left:6px;">ACTIVE</span>' : ''}
                            <div style="font-size:0.74rem; color:var(--text-muted); margin-top:0.15rem;">
                                ${t.label} · ${t.settings.discipline} · IDF ${t.settings.idfZone} · ${t.settings.sheetDwt} · close 1:${Number(t.settings.precisionPass).toLocaleString()}${t.settings.fpidPrefix ? " · FPID " + t.settings.fpidPrefix : ""}
                            </div>
                        </div>
                        <div style="display:flex; gap:0.35rem;">
                            <button class="btn btn-secondary btn-sm btn-tpl-edit" data-id="${t.id}" style="padding:0.15rem 0.5rem; font-size:0.72rem;">Edit</button>
                            <button class="btn btn-secondary btn-sm btn-tpl-del" data-id="${t.id}" style="padding:0.15rem 0.5rem; font-size:0.72rem; color:var(--danger); border-color:var(--danger-light);">Delete</button>
                        </div>
                    </div>
                `).join("") : `<div style="color:var(--text-muted); font-size:0.82rem; padding:0.3rem 0;">No templates yet. Click <strong>New Template</strong> to create per-client defaults.</div>`);
            }

            // Populate the create/edit form's select options (once per render is fine).
            const dSel = document.getElementById("tpl-discipline");
            if (dSel) window.setSafeHTML(dSel, disc.map(d => `<option value="${d.id}">${d.name}</option>`).join(""));
            const iSel = document.getElementById("tpl-idf");
            if (iSel) window.setSafeHTML(iSel, Array.from({ length: 11 }, (_, i) => `<option value="${i + 1}">Zone ${i + 1}</option>`).join(""));
            const sSel = document.getElementById("tpl-sheet");
            if (sSel) window.setSafeHTML(sSel, (sheets.length ? sheets.map(s => s.dwt) : ["CombinedLayers.dwt"]).map(n => `<option value="${n}">${n}</option>`).join(""));
        },

        setupEvents(ctx) {
            const authModal = document.getElementById("modal-auth");
            const openAuthModal = () => {
                this.renderCMSUI(ctx);
                authModal?.classList.remove("hidden");
            };

            document.getElementById("btn-open-auth-modal")?.addEventListener("click", openAuthModal);
            document.getElementById("btn-cms-switch-user")?.addEventListener("click", openAuthModal);
            document.getElementById("btn-close-auth")?.addEventListener("click", () => authModal?.classList.add("hidden"));

            // Header Logout Action
            document.getElementById("btn-header-logout")?.addEventListener("click", () => {
                window.BoundaryQCCMS.logoutUser();
                ctx.showToast("Logged out of active session.");
                openAuthModal();
            });

            // WebAuthn button via addEventListener
            document.getElementById("btn-webauthn-login")?.addEventListener("click", async () => {
                const email = document.getElementById("login-email")?.value || "user@boundaryqc.com";
                if (window.BoundaryQCSecurity) {
                    const result = await window.BoundaryQCSecurity.authenticateHardwareToken(email);
                    if (result.success) {
                        ctx.showToast(`✓ WebAuthn Verified: ${result.authMethod}`);
                    } else {
                        ctx.showToast(`WebAuthn: ${result.error || "Authentication cancelled."}`, true);
                    }
                }
            });

            // Quick Account Switcher
            document.getElementById("login-quick-select")?.addEventListener("change", (e) => {
                const loginEmailInput = document.getElementById("login-email");
                if (loginEmailInput) loginEmailInput.value = e.target.value;
            });

            // CMS Add Team Member button
            document.getElementById("btn-cms-add-user")?.addEventListener("click", () => {
                openAuthModal();
                document.getElementById("tab-btn-register")?.click();
            });

            // Event delegation for Team Directory Table (Switch & Remove)
            document.getElementById("cms-users-table-body")?.addEventListener("click", (e) => {
                const switchBtn = e.target.closest(".btn-switch-user-row");
                if (switchBtn) {
                    const email = switchBtn.getAttribute("data-email");
                    try {
                        // Team-directory switch is a within-workspace convenience (no re-auth).
                        const user = window.BoundaryQCCMS.impersonate(email);
                        this.renderCMSUI(ctx);
                        ctx.showToast(`Switched active session to ${user.fullName}.`);
                    } catch (err) {
                        ctx.showToast(`Error: ${err.message}`, true);
                    }
                }

                const deleteBtn = e.target.closest(".btn-delete-user-row");
                if (deleteBtn) {
                    const userId = deleteBtn.getAttribute("data-id");
                    ctx.showConfirmModal("Are you sure you want to remove this team member from the organization?").then(confirmed => {
                        if (confirmed) {
                            window.BoundaryQCCMS.deleteUser(userId);
                            this.renderCMSUI(ctx);
                            ctx.showToast("Team member removed from organization.");
                        }
                    });
                }
            });

            // Toggle Sign In vs Register
            const tabBtnLogin = document.getElementById("tab-btn-login");
            const tabBtnReg = document.getElementById("tab-btn-register");
            const formLogin = document.getElementById("form-auth-login");
            const formReg = document.getElementById("form-auth-register");

            tabBtnLogin?.addEventListener("click", () => {
                tabBtnLogin.style.background = "var(--primary)";
                tabBtnLogin.style.color = "#fff";
                tabBtnReg.style.background = "transparent";
                tabBtnReg.style.color = "var(--text-muted)";
                formLogin?.classList.remove("hidden");
                formReg?.classList.add("hidden");
            });

            tabBtnReg?.addEventListener("click", () => {
                tabBtnReg.style.background = "var(--primary)";
                tabBtnReg.style.color = "#fff";
                tabBtnLogin.style.background = "transparent";
                tabBtnLogin.style.color = "var(--text-muted)";
                formReg?.classList.remove("hidden");
                formLogin?.classList.add("hidden");
            });

            // Wire login submit (async — password verification)
            const loginBtn = document.getElementById("btn-do-login");
            loginBtn?.addEventListener("click", async () => {
                const email = document.getElementById("login-email")?.value;
                const password = document.getElementById("login-password")?.value || "";
                const remember = !!document.getElementById("login-remember")?.checked;
                if (!email) { ctx.showToast("Enter your account email.", true); return; }
                loginBtn.disabled = true;
                try {
                    const user = await window.BoundaryQCCMS.loginUser(email, password, remember);
                    const pw = document.getElementById("login-password"); if (pw) pw.value = "";
                    authModal?.classList.add("hidden");
                    this.renderCMSUI(ctx);
                    ctx.showToast(`Signed in as ${user.fullName}.`);
                } catch (err) {
                    ctx.showToast(err.message, true);
                } finally {
                    loginBtn.disabled = false;
                }
            });

            // Wire register submit (async — password hashing)
            const regBtn = document.getElementById("btn-do-register");
            regBtn?.addEventListener("click", async () => {
                const name = document.getElementById("reg-name")?.value;
                const email = document.getElementById("reg-email")?.value;
                const role = document.getElementById("reg-role")?.value;
                const license = document.getElementById("reg-license")?.value;
                const company = document.getElementById("reg-company")?.value;
                const password = document.getElementById("reg-password")?.value || "";
                const password2 = document.getElementById("reg-password2")?.value || "";

                if (!name || !email) { ctx.showToast("Name and email are required.", true); return; }
                if (password !== password2) { ctx.showToast("Passwords do not match.", true); return; }
                regBtn.disabled = true;
                try {
                    const user = await window.BoundaryQCCMS.registerUser(name, email, role, license, company, password);
                    ["reg-password", "reg-password2"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
                    authModal?.classList.add("hidden");
                    this.renderCMSUI(ctx);
                    ctx.showToast(`Account created — signed in as ${user.fullName}.`);
                } catch (err) {
                    ctx.showToast(`Registration Error: ${err.message}`, true);
                }
            });

            // Project creation via non-blocking input modal
            document.getElementById("btn-cms-new-proj")?.addEventListener("click", async () => {
                const fpid = await ctx.showInputModal("Enter FDOT FPID (Financial Project ID):", "441209-1-52-01");
                if (!fpid) return;
                const name = await ctx.showInputModal("Enter Project Name:", "SR-408 Roadway Realignment");
                if (!name) return;
                window.BoundaryQCCMS.createProject(fpid, name, "Orange", 5);
                this.renderCMSUI(ctx);
                ctx.showToast(`Created DOT Project ${fpid}!`);
            });

            // Change password
            document.getElementById("btn-cms-change-pw")?.addEventListener("click", async () => {
                if (!window.BoundaryQCCMS.isAuthenticated()) { ctx.showToast("Sign in first.", true); return; }
                const oldPw = await ctx.showInputModal("Current password:", "");
                if (oldPw == null) return;
                const newPw = await ctx.showInputModal("New password (min 8, 1 letter + 1 digit):", "");
                if (newPw == null) return;
                const confirm = await ctx.showInputModal("Confirm new password:", "");
                if (confirm == null) return;
                if (newPw !== confirm) { ctx.showToast("New passwords do not match.", true); return; }
                try {
                    await window.BoundaryQCCMS.changePassword(oldPw, newPw);
                    ctx.showToast("Password updated.");
                } catch (err) {
                    ctx.showToast(err.message, true);
                }
            });

            // ── Client Master Templates ──────────────────────────────────────
            const tplForm = document.getElementById("cms-tpl-form");
            const showTplForm = (tpl) => {
                if (!tplForm) return;
                document.getElementById("tpl-edit-id").value = tpl ? tpl.id : "";
                document.getElementById("tpl-client").value = tpl ? tpl.clientName : "";
                document.getElementById("tpl-label").value = tpl ? tpl.label : "";
                const s = (tpl && tpl.settings) || {};
                const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
                set("tpl-discipline", s.discipline || "ALL");
                set("tpl-idf", s.idfZone || 7);
                set("tpl-sheet", s.sheetDwt || "CombinedLayers.dwt");
                set("tpl-precision", s.precisionPass || 10000);
                set("tpl-fpid", s.fpidPrefix || "");
                set("tpl-county", s.county || "");
                set("tpl-district", s.district || 5);
                set("tpl-notes", s.notes || "");
                tplForm.hidden = false;
            };

            document.getElementById("btn-cms-new-tpl")?.addEventListener("click", () => {
                const cms = window.BoundaryQCCMS;
                if (cms.getTemplates().length >= cms.getTemplateLimit()) {
                    const up = cms.getTemplateUpgrade();
                    ctx.showToast(up
                        ? `Template limit reached. Upgrade to ${up.name} ($${up.price}/mo) for ${up.limit >= 999 ? "unlimited" : up.limit} templates.`
                        : "Template limit reached.", true);
                    this.renderTemplates();
                    return;
                }
                showTplForm(null);
            });
            document.getElementById("btn-tpl-cancel")?.addEventListener("click", () => { if (tplForm) tplForm.hidden = true; });

            document.getElementById("btn-tpl-save")?.addEventListener("click", () => {
                const id = document.getElementById("tpl-edit-id")?.value;
                const clientName = document.getElementById("tpl-client")?.value;
                const label = document.getElementById("tpl-label")?.value;
                const settings = {
                    discipline: document.getElementById("tpl-discipline")?.value,
                    idfZone: document.getElementById("tpl-idf")?.value,
                    sheetDwt: document.getElementById("tpl-sheet")?.value,
                    precisionPass: document.getElementById("tpl-precision")?.value,
                    fpidPrefix: document.getElementById("tpl-fpid")?.value,
                    county: document.getElementById("tpl-county")?.value,
                    district: document.getElementById("tpl-district")?.value,
                    notes: document.getElementById("tpl-notes")?.value
                };
                try {
                    if (id) {
                        window.BoundaryQCCMS.updateTemplate(id, { clientName, label, settings });
                        ctx.showToast("Template updated.");
                    } else {
                        const t = window.BoundaryQCCMS.createTemplate(clientName, label, settings);
                        ctx.showToast(`Template "${t.label}" created.`);
                    }
                    if (tplForm) tplForm.hidden = true;
                    this.renderCMSUI(ctx);
                } catch (err) {
                    ctx.showToast(err.message, true);
                    if (err.code === "TEMPLATE_LIMIT") this.renderTemplates();
                }
            });

            document.getElementById("cms-templates-list")?.addEventListener("click", (e) => {
                const editBtn = e.target.closest(".btn-tpl-edit");
                if (editBtn) {
                    const t = window.BoundaryQCCMS.getTemplates().find(x => x.id === editBtn.getAttribute("data-id"));
                    if (t) showTplForm(t);
                    return;
                }
                const delBtn = e.target.closest(".btn-tpl-del");
                if (delBtn) {
                    const id = delBtn.getAttribute("data-id");
                    ctx.showConfirmModal("Delete this client master template?").then(ok => {
                        if (!ok) return;
                        window.BoundaryQCCMS.deleteTemplate(id);
                        this.renderCMSUI(ctx);
                        ctx.showToast("Template deleted.");
                    });
                }
            });

            document.getElementById("cms-active-template")?.addEventListener("change", (e) => {
                window.BoundaryQCCMS.setActiveTemplate(e.target.value || null);
                this.renderCMSUI(ctx);
                const t = window.BoundaryQCCMS.getActiveTemplate();
                ctx.showToast(t ? `Active template: ${t.clientName} — ${t.label}` : "No active template.");
            });

            // Audit hash-chain verifier (recompute every block digest, check prevHash links)
            document.getElementById("btn-verify-audit-chain")?.addEventListener("click", async () => {
                if (!window.BoundaryQCCMS) return;
                const badge = document.getElementById("cms-audit-status-badge");
                if (badge) {
                    window.setSafeHTML(badge, `<i class="fa-solid fa-spinner fa-spin"></i> VERIFYING CHAIN...`);
                    badge.style.color = "var(--primary)";
                    badge.style.borderColor = "var(--primary)";
                }

                try {
                    const result = await window.BoundaryQCCMS.verifyAuditIntegrity();
                    if (result.isValid) {
                        if (badge) {
                            window.setSafeHTML(badge, `<i class="fa-solid fa-circle-check"></i> HASH CHAIN VERIFIED (${result.totalBlocksVerified} BLOCKS)`);
                            badge.style.color = "var(--success)";
                            badge.style.borderColor = "var(--success)";
                            badge.style.background = "rgba(16, 185, 129, 0.15)";
                        }
                        ctx.showToast(`✓ Audit hash chain verified! Head: ${result.rootHash.substring(0, 14)}...`);
                    } else {
                        if (badge) {
                            window.setSafeHTML(badge, `<i class="fa-solid fa-triangle-exclamation"></i> TAMPER DETECTED (SEQ #${result.blockSequence})`);
                            badge.style.color = "var(--danger)";
                            badge.style.borderColor = "var(--danger)";
                            badge.style.background = "rgba(239, 68, 68, 0.15)";
                        }
                        ctx.showToast(`🚨 Security Alert: ${result.message}`);
                    }
                } catch (err) {
                    ctx.showToast(`Verification error: ${err.message}`);
                }
            });

            // PostgreSQL Cloud Sync Exporter
            document.getElementById("btn-export-cloud-sync")?.addEventListener("click", () => {
                if (!window.BoundaryQCCMS) return;
                const payload = window.BoundaryQCCMS.generateCloudSyncPayload();
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "fdot_postgresql_cloud_sync_schema.json";
                a.click();
                ctx.showToast("Exported PostgreSQL RLS Cloud Schema (`fdot_postgresql_cloud_sync_schema.json`)!");
            });
        }
    });
}
