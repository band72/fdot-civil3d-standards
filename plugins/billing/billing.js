/**
 * BoundaryQC & FDOT Civil3D Commercial Billing, Subscription & Feature Gating Engine
 * Enterprise Edition v2.6.0
 *
 * Features:
 * - Stripe Webhook Simulation with Double-Entry ASC 606 Ledger Sync
 * - Asymmetric Cryptographic JWT License Token Generator (SubtleCrypto ECDSA P-256)
 * - Seat Metering & Dynamic Feature Gating (Auto-Fix SCR, 9-Section QC, Civil 3D Add-in)
 *
 * FIX LOG (v2.6.0):
 * - [P0] JWT signature now uses SubtleCrypto ECDSA P-256 sign() — replaces fake char-code hex
 * - [P1] JWT stored in sessionStorage (ephemeral) instead of localStorage
 * - [P2] Seat quota enforced — throws SeatQuotaExceededError if org seats exhausted
 */

class BillingPortalEngine {
    constructor() {
        this.currentTier = localStorage.getItem("bqc_user_tier") || "Free";
        this.userEmail = localStorage.getItem("bqc_user_email") || "surveyor@kimley-horn.com";
        this.companyName = localStorage.getItem("bqc_company_name") || "Kimley-Horn & Associates, Inc.";

        // `clientTemplates` = how many per-client master templates a user may keep.
        // The base plans allow 5; more requires a higher tier.
        this.tierLimits = {
            Free:       { seats: 1,  platExtractions: 3,    clientTemplates: 5,   autoFixSCR: false, fullQCReport: false, c3dPlugin: false, apiAccess: false },
            Pro:        { seats: 1,  platExtractions: 50,   clientTemplates: 5,   autoFixSCR: true,  fullQCReport: true,  c3dPlugin: false, apiAccess: false },
            Firm:       { seats: 25, platExtractions: 9999, clientTemplates: 25,  autoFixSCR: true,  fullQCReport: true,  c3dPlugin: true,  apiAccess: true  },
            Enterprise: { seats: 50, platExtractions: 9999, clientTemplates: 999, autoFixSCR: true,  fullQCReport: true,  c3dPlugin: true,  apiAccess: true  }
        };

        // Monthly price per tier — used for upsell copy.
        this.tierPrice = { Free: 0, Pro: 49, Firm: 199, Enterprise: 499 };
        this.tierOrder = ["Free", "Pro", "Firm", "Enterprise"];

        // Generate an ECDSA P-256 key pair for JWT signing on construction.
        // NOTE (demo): a fresh key pair is created per page load, so these tokens are only
        // self-consistent within one session — there is no stable published public key for an
        // external verifier to trust. Real licensing must sign server-side with a fixed key.
        this._keyPair = null;
        this._keyReady = this._initCryptoKeyPair();

        console.warn(
            "[BillingPortal] Demo build: subscription tier is read from localStorage and JWTs are " +
            "signed with an ephemeral in-browser key. Nothing here gates a feature or verifies a payment."
        );
    }

    /**
     * Generate an ECDSA P-256 key pair asynchronously.
     * The private key signs JWT tokens; the public key verifies them in the C# plugin.
     * FIX [P0]: This replaces the previous char-code hex fake "signature".
     */
    async _initCryptoKeyPair() {
        if (!window.crypto || !window.crypto.subtle) {
            console.warn('[BillingPortal] SubtleCrypto unavailable — JWT signing in simulation mode (non-HTTPS context).');
            return null;
        }
        try {
            this._keyPair = await window.crypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-256" },
                true,   // extractable — allows public key export for embedding in C# plugin
                ["sign", "verify"]
            );
            // Export the public key as JWK for embedding in the C# plugin
            const pubJwk = await window.crypto.subtle.exportKey("jwk", this._keyPair.publicKey);
            sessionStorage.setItem("bqc_ecdsa_pubkey_jwk", JSON.stringify(pubJwk));
        } catch (e) {
            console.warn('[BillingPortal] ECDSA key generation failed:', e.message);
        }
    }

    getLimits() {
        return this.tierLimits[this.currentTier] || this.tierLimits.Free;
    }

    /** Max per-client master templates allowed on the current tier. */
    getTemplateLimit() {
        return this.getLimits().clientTemplates || 5;
    }

    /** The cheapest tier above the current one that raises the template cap, for upsell copy. */
    nextTierForTemplates() {
        const current = this.getTemplateLimit();
        const idx = this.tierOrder.indexOf(this.currentTier);
        for (let i = Math.max(0, idx) + 1; i < this.tierOrder.length; i++) {
            const name = this.tierOrder[i];
            const cap = this.tierLimits[name].clientTemplates;
            if (cap > current) return { name, price: this.tierPrice[name], limit: cap };
        }
        return null;
    }

    /**
     * Check if an org has available seats before registration.
     * FIX [P2]: Enforces seat quota from billing tier. Throws if exhausted.
     * @param {Object} org The matched organization object
     */
    assertSeatAvailable(org) {
        if (!org) return; // No org constraint for individual plans
        const tierKey = org.plan
            ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1).toLowerCase()
            : "Free";
        const limit = this.tierLimits[tierKey] || this.tierLimits.Free;
        const maxSeats = org.purchasedSeats || limit.seats;
        if (org.allocatedSeats >= maxSeats) {
            throw new Error(
                `Seat quota exceeded: ${org.name} has allocated all ${maxSeats} purchased seats. ` +
                `Contact your Firm Admin to upgrade the subscription or release an inactive seat.`
            );
        }
    }

    /**
     * Activate a commercial tier, record ASC 606 billing entry, and mint a cryptographic license JWT.
     * FIX [P0]: Uses async ECDSA signing via SubtleCrypto.
     */
    async setTier(tier, company, email) {
        if (!this.tierLimits[tier]) return;
        this.currentTier = tier;
        if (company) this.companyName = company;
        if (email) this.userEmail = email;

        localStorage.setItem("bqc_user_tier", this.currentTier);
        localStorage.setItem("bqc_company_name", this.companyName);
        localStorage.setItem("bqc_user_email", this.userEmail);

        // FIX [P0]: Generate a real cryptographic JWT and store in sessionStorage (not localStorage)
        const jwtToken = await this.generateEntitlementJwt(this.currentTier, this.companyName, this.userEmail);
        // FIX [P1]: sessionStorage — ephemeral, not accessible after tab close, not in localStorage
        sessionStorage.setItem("bqc_c3d_jwt_token", jwtToken);

        // Synchronize with Enterprise CMS engine if present
        if (window.BoundaryQCCMS && window.BoundaryQCCMS.processStripeWebhook) {
            window.BoundaryQCCMS.processStripeWebhook({
                plan: tier.toLowerCase(),
                amount: tier === "Enterprise" ? 499.00 : (tier === "Firm" ? 199.00 : 49.00)
            });
        }

        this.updateUIForTier();
        return jwtToken;
    }

    /**
     * Generate an ECDSA P-256 signed JWT entitlement token.
     * FIX [P0]: Uses SubtleCrypto.sign() with actual ECDSA P-256 private key.
     * Falls back to a clearly-labeled simulated token if SubtleCrypto is unavailable.
     * @param {string} tier
     * @param {string} company
     * @param {string} email
     * @returns {Promise<string>} JWT string (header.payload.signature in base64url)
     */
    async generateEntitlementJwt(tier, company, email) {
        const headerObj = { alg: "ES256", typ: "JWT" };
        const payloadObj = {
            sub: email,
            org: company,
            tier: tier === "Enterprise" ? "B2BEnterprise" : tier,
            seats: this.tierLimits[tier]?.seats || 1,
            features: ["CMD_ADVANCED_QC", "CMD_AUTOPURGE", "CMD_FDOT_MANIFEST", "CMD_BOWTIE_SOLVER"],
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (365 * 24 * 3600) // 1-year lease
        };

        const b64url = obj => btoa(JSON.stringify(obj))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const header = b64url(headerObj);
        const payload = b64url(payloadObj);
        const signingInput = `${header}.${payload}`;

        // Wait for the one-time key generation kicked off in the constructor so the first
        // mint after page load produces a real signature rather than falling back to the sim token.
        try { await this._keyReady; } catch (e) { /* fall through to simulation */ }

        // Attempt real ECDSA P-256 signing via SubtleCrypto
        if (this._keyPair && window.crypto && window.crypto.subtle) {
            try {
                const encoder = new TextEncoder();
                const sigBytes = await window.crypto.subtle.sign(
                    { name: "ECDSA", hash: { name: "SHA-256" } },
                    this._keyPair.privateKey,
                    encoder.encode(signingInput)
                );
                // IEEE P1363 raw signature (64 bytes for P-256) → base64url
                const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                return `${signingInput}.${sigB64}`;
            } catch (e) {
                console.warn('[BillingPortal] ECDSA sign() failed:', e.message);
            }
        }

        // Fallback simulation (clearly labeled for non-HTTPS dev environments)
        const simSig = btoa(`SIM_UNSIGNED_DEV_ONLY_${tier}_${Date.now()}`)
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return `${signingInput}.${simSig}`;
    }

    /**
     * Retrieve the currently active Civil 3D JWT token from sessionStorage.
     * FIX [P1]: Reads from sessionStorage (ephemeral) not localStorage.
     * @returns {string|null}
     */
    getActiveJwt() {
        return sessionStorage.getItem("bqc_c3d_jwt_token");
    }

    isFeatureAllowed(featureName) {
        const limits = this.getLimits();
        return limits[featureName] === true || limits[featureName] > 0;
    }

    updateUIForTier() {
        const badge = document.getElementById("active-tier-badge");
        if (badge) {
            badge.textContent = `${this.currentTier.toUpperCase()} PLAN ACTIVE`;
            badge.className = `badge badge-tier-${this.currentTier.toLowerCase()}`;
        }
    }
}

// Global Singleton
window.BoundaryQCBilling = new BillingPortalEngine();

if (window.PluginRegistry) {
    window.PluginRegistry.register({
        name: "billing",
        version: "2.6.0",
        description: "Demo subscription/tier UI, ASC 606 double-entry ledger, and ephemeral ECDSA P-256 JWT minting (client-side only).",
        tab: "tab-commercial",
        icon: "fa-credit-card",
        tier: "Pro",
        dependencies: ["security-pki"]
    }, {
        init(ctx) {
            window.BoundaryQCBilling.updateUIForTier();
        },
        setupEvents(ctx) {
            const modalCheckout = document.getElementById("modal-checkout");
            const closeModal = () => {
                if (modalCheckout) modalCheckout.classList.add("hidden");
            };

            document.getElementById("btn-close-checkout")?.addEventListener("click", closeModal);
            document.getElementById("btn-cancel-checkout")?.addEventListener("click", closeModal);

            window.simCheckout = function () {
                closeModal();
                ctx.showToast("🎉 14-Day Free Trial Activated! Thank you for subscribing to BoundaryQC Commercial Suite.");
            };

            // Mint Civil 3D License Token using real async ECDSA JWT
            document.getElementById("btn-mint-c3d-jwt")?.addEventListener("click", async () => {
                const user = window.BoundaryQCCMS ? window.BoundaryQCCMS.getCurrentUser() : null;
                const companyName = user ? (user.companyName || "Kimley-Horn & Associates, Inc.") : "Kimley-Horn & Associates, Inc.";
                const email = user ? user.email : "surveyor@kimley-horn.com";

                const token = await window.BoundaryQCBilling.generateEntitlementJwt(
                    window.BoundaryQCBilling.currentTier,
                    companyName,
                    email
                );
                sessionStorage.setItem("bqc_c3d_jwt_token", token);

                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(token).then(() => {
                        ctx.showToast("Copied Civil 3D ECDSA License JWT Token to Clipboard!");
                    }).catch(() => {
                        ctx.showCopyModal("Civil 3D ECDSA License JWT Token", token);
                    });
                } else {
                    ctx.showCopyModal("Civil 3D ECDSA License JWT Token", token);
                }
            });
        }
    });
}
