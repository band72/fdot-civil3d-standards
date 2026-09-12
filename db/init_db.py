#!/usr/bin/env python3
"""
FDOT Civil3D Standards Suite - Database Initializer & Migration Tool
Connects to local or remote PostgreSQL database, applies schema.sql, and seeds default records.
"""
import os
import sys
import json
from urllib.parse import urlparse

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Error: psycopg2 is required. Install with 'sudo apt install python3-psycopg2' or 'pip install psycopg2-binary'", file=sys.stderr)
    sys.exit(1)

DEFAULT_DB_URL = "postgresql://postgres@localhost:5432/fdot_survey_db"

def get_connection(db_url=None):
    url = db_url or os.environ.get("DATABASE_URL") or DEFAULT_DB_URL
    p = urlparse(url)
    dbname = p.path.lstrip("/") or "fdot_survey_db"
    user = p.username or "postgres"
    password = p.password or ""
    host = p.hostname or "localhost"
    port = p.port or 5432
    return psycopg2.connect(dbname=dbname, user=user, password=password, host=host, port=port)

def init_database(db_url=None):
    url = db_url or os.environ.get("DATABASE_URL") or DEFAULT_DB_URL
    print(f"Connecting to database: {url} ...")
    try:
        conn = get_connection(url)
        conn.autocommit = True
    except Exception as e:
        print(f"Database connection failed: {e}", file=sys.stderr)
        return False

    cur = conn.cursor()

    # 1. Apply Schema
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    if os.path.exists(schema_path):
        print(f"Applying schema from {schema_path} ...")
        with open(schema_path, "r", encoding="utf-8") as f:
            cur.execute(f.read())
        print("✓ Schema applied successfully.")
    else:
        print("Warning: schema.sql not found at", schema_path)

    # 2. Seed Default Organizations
    cur.execute("SELECT COUNT(*) FROM organizations")
    if cur.fetchone()[0] == 0:
        print("Seeding organizations ...")
        orgs = [
            ("org_kh_01", "Kimley-Horn Survey & CADD Operations", "Enterprise", 50),
            ("org_fdot_d5", "FDOT District 5 CADD QA / Survey Standards", "Enterprise", 100),
            ("org_default", "General Survey & Engineering Workspace", "Professional", 10)
        ]
        cur.executemany("INSERT INTO organizations (id, name, tier, license_cap) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING", orgs)
        print("✓ Organizations seeded.")

    # 3. Seed Default Users
    cur.execute("SELECT COUNT(*) FROM users")
    if cur.fetchone()[0] == 0:
        print("Seeding users ...")
        users = [
            ("usr_admin_01", "org_kh_01", "admin@boundaryqc.com", "b863d03cb967812c", "s4lt_d3m0_adm1n", "David Vance, PE, PSM", "ADMIN_SURVEYOR", "LS6842", "FL", "Kimley-Horn & Associates"),
            ("usr_pm_02", "org_kh_01", "user@boundaryqc.com", "b863d03cb967812c", "s4lt_d3m0_usr", "Sarah Jenkins, PSM", "PROJECT_MANAGER", "LS7104", "FL", "Kimley-Horn & Associates"),
            ("usr_cadd_03", "org_kh_01", "cadd@boundaryqc.com", "b863d03cb967812c", "s4lt_d3m0_cad", "Marcus Rodriguez", "CADD_TECH", None, "FL", "Kimley-Horn & Associates"),
            ("usr_fdot_04", "org_fdot_d5", "auditor@fdot.gov", "b863d03cb967812c", "s4lt_d3m0_aud", "Elena Rostova, PE", "DISTRICT_AUDITOR", "PE84192", "FL", "FDOT District 5 DeLand")
        ]
        cur.executemany("""
            INSERT INTO users (id, org_id, email, password_hash, salt, full_name, role, license_number, license_state, company)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
        """, users)
        print("✓ Users seeded.")

    # 4. Seed Default DOT Projects
    cur.execute("SELECT COUNT(*) FROM projects")
    if cur.fetchone()[0] == 0:
        print("Seeding projects ...")
        projs = [
            ("proj_441209", "org_kh_01", "441209-1-52-01", "SR-408 Roadway Realignment & Widening", "Orange", 5, "ACTIVE", json.dumps({"milepost_start": 12.4, "milepost_end": 18.2})),
            ("proj_238410", "org_kh_01", "238410-2-52-01", "I-4 Beyond the Ultimate (Segment 2)", "Seminole", 5, "ACTIVE", json.dumps({"milepost_start": 98.0, "milepost_end": 104.5}))
        ]
        cur.executemany("INSERT INTO projects (id, org_id, fpid, name, county, district, status, metadata) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", projs)
        print("✓ Projects seeded.")

    # 5. Seed Client Master Templates
    cur.execute("SELECT COUNT(*) FROM client_templates")
    if cur.fetchone()[0] == 0:
        print("Seeding client master templates ...")
        templates = [
            ("tpl_fdot_d5", "usr_admin_01", "org_kh_01", "FDOT District 5", "District 5 Standards & Arterials", json.dumps({
                "discipline": "ROADWAY", "idfZone": 7, "sheetDwt": "RoadwayPlans.dwt", "precisionPass": 10000, "county": "Orange", "district": 5
            })),
            ("tpl_turnpike", "usr_admin_01", "org_kh_01", "Florida Turnpike", "Turnpike Mainline Widening", json.dumps({
                "discipline": "ROADWAY", "idfZone": 9, "sheetDwt": "CombinedLayers.dwt", "precisionPass": 20000, "county": "Osceola", "district": 8
            }))
        ]
        cur.executemany("INSERT INTO client_templates (id, user_id, org_id, client_name, label, settings) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", templates)
        print("✓ Client templates seeded.")

    # 6. Seed Initial Audit Genesis Block
    cur.execute("SELECT COUNT(*) FROM audit_chain")
    if cur.fetchone()[0] == 0:
        print("Seeding audit chain genesis block ...")
        cur.execute("""
            INSERT INTO audit_chain (prev_hash, hash, actor, action, details)
            VALUES (%s, %s, %s, %s, %s)
        """, (
            "0000000000000000000000000000000000000000000000000000000000000000",
            "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
            "SYSTEM",
            "POSTGRESQL_INITIALIZE",
            "PostgreSQL Relational DB cluster initialized with multi-tenant schema and RLS readiness."
        ))
        print("✓ Audit chain initialized.")

    # 7. Print stats
    print("\nDatabase initialization complete! Table counts:")
    for tbl in ["organizations", "users", "projects", "client_templates", "submittals", "transactions", "audit_chain", "linework_sessions", "survey_points"]:
        cur.execute(f"SELECT COUNT(*) FROM {tbl}")
        cnt = cur.fetchone()[0]
        print(f"  • {tbl}: {cnt}")

    cur.close()
    conn.close()
    return True

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else None
    success = init_database(url)
    sys.exit(0 if success else 1)
