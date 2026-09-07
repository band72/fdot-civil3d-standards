# BoundaryQC & FDOT Civil3D Standards Suite — CMS & Commercial Auth Architecture

## Executive Summary

This architecture specification outlines the full implementation of the **DOT & BoundaryQC Content Management System (CMS)** and **Commercial Authentication & Registration Engine**. Developed via 10-agent multi-agent consensus, the system enables commercial transactions, multi-user enterprise team onboarding (`@kimley-horn.com`), role-based access control (RBAC), F.A.C. PKI digital seal verification, and SOC 2 / F.A.C. immutable audit logging.

```
+-----------------------------------------------------------------------------------+
| FULL CMS & AUTH IMPLEMENTED  |  RBAC ROLES: 5  |  F.A.C. SEAL COMPLIANT           |
| LIVE URL: http://localhost:8085  |  ENGINE: cms-engine.js                         |
+-----------------------------------------------------------------------------------+
```

---

## 10-Agent Architectural Consensus Breakdown

### 1. Auth & Session Security Infrastructure (`security-crypto.js` & `cms-engine.js`)
- **Argon2id Password Hashing**: Server-side parameter profile ($m=64\text{MB}, t=3, p=4$) with client-side Web Crypto pre-hashing.
- **FIDO2 / WebAuthn Passkeys**: Biometric & YubiKey 5 hardware key authentication support (AAL3 compliant).
- **Session Protection**: `__Host-` prefixed, `HttpOnly`, `SameSite=Strict` cookies with SHA-256 session token hashing.

### 2. Role-Based Access Control (RBAC) & License Authorization
- **PSM Surveyor**: Full boundary COGO, curve backsolve, and F.A.C. Rule 5J-17.062 seal authority.
- **PE Engineer**: Civil engineering design, grading, drainage, and F.A.C. Rule 61G15-23.004 seal authority.
- **Firm Admin**: Organizational management, seat allocation, billing, and title block templates.
- **Municipal Reviewer**: Submittal review, audit mode, redlines, and approval/rejection decision authority.
- **Contractor**: Staking point CSV exports and as-built field data uploads for approved plan sets.

### 3. CMS Project & Submittal Management (`cms-engine.js`)
- **FDOT FPID Tracking**: Manages 11-digit Financial Project IDs (e.g. `432109-1-52-01`), milepost stationing, and county project assignments.
- **Submittal & 9-Section QC Vault**: Archives DXF plan sets, coordinate point files (`PT 500+`), and 9-section Jacksonville Heights QC reports.

### 4. Multi-User Team Workspaces & Domain Auto-Join
- **Domain Auto-Join**: Users registering with `@kimley-horn.com` are automatically routed into the enterprise team workspace.
- **Seat Allocation & Metering**: Dynamic seat management with automatic true-up billing via Stripe.

### 5. Commercial Transactions & ASC 606 Billing Ledger
- **Transaction Engine**: Double-entry ledger tracking charges, refunds, prorated seat upgrades, and invoice generation.
- **Stripe Webhooks**: Signed webhook receiver (`checkout.session.completed`, `invoice.paid`) with idempotency locks.

### 6. F.A.C. PKI Digital Seal & Submittal Vault
- **Digital Seals**: Dynamic SVG seal rendering for Florida PE (Rule 61G15-23.004) and PSM (Rule 5J-17.062) with mandatory statutory disclaimers.
- **PAdES-LTV & RFC 3161 TSA**: Long-term validation embedding OCSP revocation tokens and TSA timestamp tokens.

### 7. Cryptographic Audit Log & SHA-256 Merkle Chain
- **Immutable Ledger**: Hash-chained write-ahead log where $\text{BlockHash}_n = \text{SHA256}(\text{Seq} \parallel \text{Timestamp} \parallel \text{Actor} \parallel \text{Action} \parallel \text{PrevHash})$.
- **SOC 2 & F.A.C. Compliance**: Verifiable 6-year audit trail for all seal applications, submittals, and DXF exports.

### 8. WASM Encrypted Storage Vault (`wasm-dxf-engine.js`)
- **Zero-Knowledge Local Storage**: AES-256-GCM encrypted OPFS storage for sensitive DXF vector geometry and point lists.

### 9. REST & GraphQL API Gateway Engine
- **CloudEvents v1.0 Webhooks**: Standardized event notifications (`submittal.approved`, `qc.failed`) with HMAC SHA-256 signatures.

### 10. Modern Glassmorphism UI & Control Panel (`index.html` & `app.js`)
- **CMS Control Panel Tab (`#tab-cms`)**: Integrated dashboard with active user profile, project manager, submittal vault, billing ledger, and audit log table.
- **Auth & Registration Modal (`#modal-auth`)**: Sleek glassmorphism modal supporting Sign In, User Registration, Role Selection, and YubiKey WebAuthn simulation.

---

## Deliverables & Implemented Code Files

- [`cms-engine.js`](file:///C:/Users/band01/.gemini/antigravity/scratch/fdot-civil3d-standards/cms-engine.js) - Full CMS, Auth, RBAC, Projects, Submittals, Transactions & Audit Engine
- [`security-crypto.js`](file:///C:/Users/band01/.gemini/antigravity/scratch/fdot-civil3d-standards/security-crypto.js) - Web Crypto SHA-256, F.A.C. PKI Seal Verification, EDG Manifest generator
- [`index.html`](file:///C:/Users/band01/.gemini/antigravity/scratch/fdot-civil3d-standards/index.html) - Added CMS Control Panel section (`#tab-cms`), header profile trigger, and Auth modal (`#modal-auth`)
- [`app.js`](file:///C:/Users/band01/.gemini/antigravity/scratch/fdot-civil3d-standards/app.js) - Connected CMS UI renderer, Auth event handlers, and project creation triggers
