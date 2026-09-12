-- FDOT Civil3D Standards Suite - Relational Database Schema
-- Compatible with PostgreSQL 14, 15, 16+ (Local & Remote / Cloud)

-- Organizations / Tenants
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tier VARCHAR(64) DEFAULT 'Free',
    license_cap INT DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Users / Organization Members
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    org_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(64) NOT NULL,
    license_number VARCHAR(64),
    license_state VARCHAR(16) DEFAULT 'FL',
    company VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- DOT Projects
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    org_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    fpid VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    county VARCHAR(128) DEFAULT 'Orange',
    district INT DEFAULT 5,
    status VARCHAR(64) DEFAULT 'ACTIVE',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Client Master Templates & Standards
CREATE TABLE IF NOT EXISTS client_templates (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    org_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Submittal Vault (Sealed Drawings & QC Records)
CREATE TABLE IF NOT EXISTS submittals (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    submitted_by VARCHAR(255) NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    precision_ratio VARCHAR(64) DEFAULT '1:50,000',
    status VARCHAR(64) DEFAULT 'VERIFIED_PASSED',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Financial / Billing Transactions
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    org_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(64) DEFAULT 'COMPLETED',
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ref_id VARCHAR(128)
);

-- Hash-Chained Audit Log
CREATE TABLE IF NOT EXISTS audit_chain (
    sequence SERIAL PRIMARY KEY,
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    actor VARCHAR(255) NOT NULL,
    action VARCHAR(128) NOT NULL,
    details TEXT NOT NULL
);

-- Linework Survey Models & Sessions
CREATE TABLE IF NOT EXISTS linework_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    org_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    figure_count INT DEFAULT 0,
    point_count INT DEFAULT 0,
    model JSONB NOT NULL DEFAULT '{"figures":[]}'::jsonb,
    view JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Individual Survey Points (relational index)
CREATE TABLE IF NOT EXISTS survey_points (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64) REFERENCES linework_sessions(id) ON DELETE CASCADE,
    figure_id VARCHAR(64),
    pt_num VARCHAR(32), -- alphanumeric point IDs are allowed client-side (e.g. "PC1", "TBM-A")
    northing NUMERIC(14, 4) NOT NULL,
    easting NUMERIC(14, 4) NOT NULL,
    elevation NUMERIC(12, 4) DEFAULT 0.0000,
    raw_desc TEXT,
    code VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Fast Lookups and Multi-Tenant Query Isolation
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_fpid ON projects(fpid);
CREATE INDEX IF NOT EXISTS idx_templates_org ON client_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_templates_user ON client_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_submittals_project ON submittals(project_id);
CREATE INDEX IF NOT EXISTS idx_transactions_org ON transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_chain_seq ON audit_chain(sequence);
CREATE INDEX IF NOT EXISTS idx_linework_org ON linework_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_survey_pts_session ON survey_points(session_id);
