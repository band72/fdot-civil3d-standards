#!/usr/bin/env python3
"""
FDOT Civil3D Standards Suite - HTTP & PostgreSQL Bridge Server
Serves static web application assets and provides RESTful endpoints for local and remote PostgreSQL database sync.
"""
import os
import sys
import json
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# Try to import psycopg2
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

CONFIG_FILE = os.path.join(os.path.dirname(__file__), ".db_config.json")
DEFAULT_DB_URL = "postgresql://postgres@localhost:5432/fdot_survey_db"

def load_db_url():
    if os.environ.get("DATABASE_URL"):
        return os.environ.get("DATABASE_URL")
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if cfg.get("database_url"):
                    return cfg["database_url"]
        except Exception:
            pass
    return DEFAULT_DB_URL

def save_db_url(url):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump({"database_url": url}, f, indent=2)

ACTIVE_DB_URL = load_db_url()

def get_db_connection(db_url=None):
    if not HAS_PSYCOPG2:
        raise RuntimeError("psycopg2 is not installed on the system.")
    url = db_url or ACTIVE_DB_URL
    p = urlparse(url)
    dbname = p.path.lstrip("/") or "fdot_survey_db"
    user = p.username or "postgres"
    password = p.password or ""
    host = p.hostname or "localhost"
    port = p.port or 5432
    return psycopg2.connect(dbname=dbname, user=user, password=password, host=host, port=port, connect_timeout=4)

def mask_db_url(url):
    try:
        p = urlparse(url)
        netloc = ""
        if p.username:
            netloc += p.username
            if p.password:
                netloc += ":****"
            netloc += "@"
        netloc += p.hostname or "localhost"
        if p.port:
            netloc += f":{p.port}"
        return f"{p.scheme}://{netloc}{p.path}"
    except Exception:
        return "postgresql://***"

class FDOTAppServer(SimpleHTTPRequestHandler):
    def end_headers(self):
        # The app is normally same-origin (this server hosts both the static assets and the
        # /api/db/* bridge), which needs no CORS header at all. This endpoint serves project,
        # submittal and audit-log data, so `*` would let any third-party site the browser has
        # open read it via fetch — only reflect Origin for a local dev origin, and only then.
        origin = self.headers.get("Origin", "")
        try:
            host = urlparse(origin).hostname
        except Exception:
            host = None
        if host in ("localhost", "127.0.0.1", "::1"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, data, status_code=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                return {}
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw)
        except Exception as e:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/db/status":
            self.handle_db_status()
        elif path == "/api/db/sync/pull":
            self.handle_sync_pull(qs)
        elif path == "/api/db/projects":
            self.handle_get_projects(qs)
        elif path == "/api/db/linework/load":
            self.handle_linework_load(qs)
        else:
            # Fallback to serving static workspace files
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/db/config":
            self.handle_db_config()
        elif path == "/api/db/sync/push":
            self.handle_sync_push()
        elif path == "/api/db/projects":
            self.handle_create_project()
        elif path == "/api/db/linework/save":
            self.handle_linework_save()
        else:
            self.send_json({"ok": False, "error": "Endpoint not found"}, 404)

    # ── Database Handlers ──────────────────────────────────────────────────

    def handle_db_status(self):
        global ACTIVE_DB_URL
        if not HAS_PSYCOPG2:
            return self.send_json({
                "ok": False,
                "connected": False,
                "error": "psycopg2 library not available on system"
            })

        try:
            conn = get_db_connection(ACTIVE_DB_URL)
            cur = conn.cursor()
            cur.execute("SELECT version();")
            pg_ver = cur.fetchone()[0]

            p = urlparse(ACTIVE_DB_URL)
            host = p.hostname or "localhost"
            port = p.port or 5432
            dbname = p.path.lstrip("/") or "fdot_survey_db"
            is_local = host in ("localhost", "127.0.0.1", "::1")

            tables = ["organizations", "users", "projects", "client_templates", "submittals", "transactions", "audit_chain", "linework_sessions", "survey_points"]
            counts = {}
            for t in tables:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {t};")
                    counts[t] = cur.fetchone()[0]
                except Exception:
                    counts[t] = 0

            cur.close()
            conn.close()

            self.send_json({
                "ok": True,
                "connected": True,
                "is_local": is_local,
                "host": host,
                "port": port,
                "database": dbname,
                "version": pg_ver,
                "database_url_masked": mask_db_url(ACTIVE_DB_URL),
                "counts": counts
            })
        except Exception as e:
            p = urlparse(ACTIVE_DB_URL)
            self.send_json({
                "ok": True,
                "connected": False,
                "is_local": (p.hostname or "localhost") in ("localhost", "127.0.0.1", "::1"),
                "host": p.hostname or "localhost",
                "port": p.port or 5432,
                "database": p.path.lstrip("/") or "fdot_survey_db",
                "database_url_masked": mask_db_url(ACTIVE_DB_URL),
                "error": str(e)
            })

    def handle_db_config(self):
        global ACTIVE_DB_URL
        payload = self.read_json_body()
        if payload is None:
            return self.send_json({"ok": False, "error": "Invalid JSON body"}, 400)

        test_url = payload.get("database_url")
        if payload.get("reset_default"):
            test_url = DEFAULT_DB_URL

        if not test_url:
            return self.send_json({"ok": False, "error": "database_url is required"}, 400)

        # Test connecting to the specified URL
        try:
            conn = get_db_connection(test_url)
            cur = conn.cursor()
            cur.execute("SELECT version();")
            ver = cur.fetchone()[0]
            cur.close()
            conn.close()

            # Save as active URL
            ACTIVE_DB_URL = test_url
            save_db_url(ACTIVE_DB_URL)

            p = urlparse(ACTIVE_DB_URL)
            self.send_json({
                "ok": True,
                "message": "Connected successfully! Database configuration updated.",
                "database_url_masked": mask_db_url(ACTIVE_DB_URL),
                "is_local": (p.hostname or "localhost") in ("localhost", "127.0.0.1", "::1"),
                "version": ver
            })
        except Exception as e:
            self.send_json({
                "ok": False,
                "error": f"Failed to connect to database: {str(e)}"
            }, 400)

    def handle_sync_push(self):
        payload = self.read_json_body()
        if not payload or not isinstance(payload, dict):
            return self.send_json({"ok": False, "error": "Invalid payload format"}, 400)

        tables = payload.get("tables", {})
        tenant_id = payload.get("tenantId", "org_kh_01")
        synced = {}

        try:
            conn = get_db_connection()
            conn.autocommit = False
            cur = conn.cursor()

            # 0a. Organizations (must land before projects/templates/transactions, which FK to it)
            if "organizations" in tables and isinstance(tables["organizations"], list):
                count = 0
                for o in tables["organizations"]:
                    cur.execute("""
                        INSERT INTO organizations (id, name, tier, license_cap)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            tier = EXCLUDED.tier,
                            license_cap = EXCLUDED.license_cap
                    """, (
                        o.get("id"),
                        o.get("name", "Organization"),
                        o.get("plan", o.get("tier", "Free")),
                        o.get("purchasedSeats", o.get("license_cap", 5))
                    ))
                    count += 1
                synced["organizations"] = count

            # 0b. Users (must land before client_templates, which FK to user_id). Demo-build note:
            # this stores whatever local credential record the client has (PBKDF2 hash/salt/iterations
            # as JSON, or a lightweight seed hash) — nothing here verifies a login server-side.
            if "users" in tables and isinstance(tables["users"], list):
                count = 0
                for u in tables["users"]:
                    creds = u.get("credentials") or {}
                    cur.execute("""
                        INSERT INTO users (id, org_id, email, password_hash, salt, full_name, role, license_number, license_state, company, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (id) DO UPDATE SET
                            full_name = EXCLUDED.full_name,
                            role = EXCLUDED.role,
                            license_number = EXCLUDED.license_number,
                            license_state = EXCLUDED.license_state,
                            company = EXCLUDED.company,
                            updated_at = CURRENT_TIMESTAMP
                    """, (
                        u.get("id"),
                        tenant_id,
                        u.get("email", ""),
                        json.dumps(creds) if creds else "unset",
                        creds.get("salt", "") if isinstance(creds, dict) else "",
                        u.get("fullName", "User"),
                        u.get("role", "CONTRACTOR"),
                        u.get("licenseNumber"),
                        u.get("licenseState", "FL"),
                        u.get("company")
                    ))
                    count += 1
                synced["users"] = count

            # 1. Projects
            if "projects" in tables and isinstance(tables["projects"], list):
                count = 0
                for p in tables["projects"]:
                    cur.execute("""
                        INSERT INTO projects (id, org_id, fpid, name, county, district, status, metadata, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            fpid = EXCLUDED.fpid,
                            county = EXCLUDED.county,
                            district = EXCLUDED.district,
                            status = EXCLUDED.status,
                            updated_at = CURRENT_TIMESTAMP
                    """, (
                        p.get("id"),
                        tenant_id,
                        p.get("fpid", "FPID-000"),
                        p.get("name", "Project"),
                        p.get("county", "Orange"),
                        p.get("district", 5),
                        p.get("status", "ACTIVE"),
                        json.dumps(p.get("metadata", {}))
                    ))
                    count += 1
                synced["projects"] = count

            # 2. Client Templates
            if "client_templates" in tables and isinstance(tables["client_templates"], list):
                count = 0
                for t in tables["client_templates"]:
                    cur.execute("""
                        INSERT INTO client_templates (id, user_id, org_id, client_name, label, settings, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (id) DO UPDATE SET
                            client_name = EXCLUDED.client_name,
                            label = EXCLUDED.label,
                            settings = EXCLUDED.settings,
                            updated_at = CURRENT_TIMESTAMP
                    """, (
                        t.get("id"),
                        t.get("userId"),
                        tenant_id,
                        t.get("clientName", "Client"),
                        t.get("label", "Template"),
                        json.dumps(t.get("settings", {}))
                    ))
                    count += 1
                synced["client_templates"] = count

            # 3. Submittals
            if "submittals" in tables and isinstance(tables["submittals"], list):
                count = 0
                for s in tables["submittals"]:
                    cur.execute("""
                        INSERT INTO submittals (id, project_id, file_name, submitted_by, sha256, precision_ratio, status, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            status = EXCLUDED.status,
                            precision_ratio = EXCLUDED.precision_ratio
                    """, (
                        s.get("id"),
                        s.get("projectId"),
                        s.get("fileName", "drawing.dxf"),
                        s.get("submittedBy", "Surveyor"),
                        s.get("sha256", "0" * 64),
                        s.get("precisionRatio", "1:50,000"),
                        s.get("status", "VERIFIED_PASSED"),
                        json.dumps(s.get("metadata", {}))
                    ))
                    count += 1
                synced["submittals"] = count

            # 3b. Transactions (billing ledger)
            if "transactions" in tables and isinstance(tables["transactions"], list):
                count = 0
                for tx in tables["transactions"]:
                    cur.execute("""
                        INSERT INTO transactions (id, org_id, description, amount, status, ref_id)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            status = EXCLUDED.status,
                            amount = EXCLUDED.amount
                    """, (
                        tx.get("id"),
                        tx.get("orgId", tenant_id),
                        tx.get("description", "Transaction"),
                        tx.get("amount", 0),
                        tx.get("status", "PAID"),
                        tx.get("receiptUrl")
                    ))
                    count += 1
                synced["transactions"] = count

            # 4. Audit Chain entries
            if "audit_chain" in tables and isinstance(tables["audit_chain"], list):
                count = 0
                for a in tables["audit_chain"]:
                    cur.execute("""
                        INSERT INTO audit_chain (sequence, prev_hash, hash, actor, action, details)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (sequence) DO UPDATE SET
                            hash = EXCLUDED.hash,
                            details = EXCLUDED.details
                    """, (
                        a.get("sequence"),
                        a.get("prevHash", "0" * 64),
                        a.get("hash", "0" * 64),
                        a.get("actor", "SYSTEM"),
                        a.get("action", "LOG"),
                        a.get("details", "")
                    ))
                    count += 1
                synced["audit_chain"] = count

            conn.commit()
            cur.close()
            conn.close()

            self.send_json({
                "ok": True,
                "message": "Successfully synchronized local state to PostgreSQL database.",
                "synced": synced
            })
        except Exception as e:
            if 'conn' in locals() and conn:
                conn.rollback()
            self.send_json({"ok": False, "error": f"Database sync error: {str(e)}"}, 500)

    def handle_sync_pull(self, qs):
        tenant_id = qs.get("tenantId", ["org_kh_01"])[0]
        try:
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("SELECT id, name, tier, license_cap, created_at FROM organizations WHERE id = %s;", (tenant_id,))
            organizations = cur.fetchall()

            cur.execute("SELECT id, org_id, fpid, name, county, district, status, metadata, created_at, updated_at FROM projects WHERE org_id = %s ORDER BY name ASC;", (tenant_id,))
            projects = cur.fetchall()

            cur.execute("SELECT id, user_id, org_id, client_name, label, settings, created_at, updated_at FROM client_templates WHERE org_id = %s ORDER BY client_name ASC;", (tenant_id,))
            templates = cur.fetchall()

            # submittals have no org_id of their own — scope to this tenant's projects.
            cur.execute("""
                SELECT s.id, s.project_id, s.file_name, s.submitted_by, s.sha256, s.precision_ratio, s.status, s.metadata, s.created_at
                FROM submittals s JOIN projects p ON p.id = s.project_id
                WHERE p.org_id = %s ORDER BY s.created_at DESC;
            """, (tenant_id,))
            submittals = cur.fetchall()

            cur.execute("SELECT id, org_id, description, amount, status, timestamp, ref_id FROM transactions WHERE org_id = %s ORDER BY timestamp DESC;", (tenant_id,))
            transactions = cur.fetchall()

            cur.execute("SELECT sequence, prev_hash, hash, timestamp, actor, action, details FROM audit_chain ORDER BY sequence ASC;")
            audit = cur.fetchall()

            cur.execute("SELECT id, email, full_name, role, license_number, license_state, company FROM users WHERE org_id = %s;", (tenant_id,))
            users = cur.fetchall()

            cur.close()
            conn.close()

            # Date/Time formatting helper
            def clean_rows(rows):
                out = []
                for r in rows:
                    d = dict(r)
                    for k, v in d.items():
                        if hasattr(v, "isoformat"):
                            d[k] = v.isoformat()
                    out.append(d)
                return out

            self.send_json({
                "ok": True,
                "tenantId": tenant_id,
                "tables": {
                    "organizations": clean_rows(organizations),
                    "projects": clean_rows(projects),
                    "client_templates": clean_rows(templates),
                    "submittals": clean_rows(submittals),
                    "transactions": clean_rows(transactions),
                    "audit_chain": clean_rows(audit),
                    "users": clean_rows(users)
                }
            })
        except Exception as e:
            self.send_json({"ok": False, "error": f"Failed to pull from database: {str(e)}"}, 500)

    def handle_get_projects(self, qs):
        tenant_id = qs.get("tenantId", ["org_kh_01"])[0]
        try:
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("SELECT id, org_id, fpid, name, county, district, status, metadata FROM projects WHERE org_id = %s ORDER BY name;", (tenant_id,))
            rows = [dict(r) for r in cur.fetchall()]
            cur.close()
            conn.close()
            self.send_json({"ok": True, "projects": rows})
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 500)

    def handle_create_project(self):
        payload = self.read_json_body()
        if not payload:
            return self.send_json({"ok": False, "error": "Invalid body"}, 400)

        p_id = payload.get("id") or f"proj_{os.urandom(4).hex()}"
        org_id = payload.get("orgId", "org_kh_01")
        fpid = payload.get("fpid", "FPID-000")
        name = payload.get("name", "New Project")
        county = payload.get("county", "Orange")
        district = payload.get("district", 5)
        status = payload.get("status", "ACTIVE")

        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO projects (id, org_id, fpid, name, county, district, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, fpid, name, status;
            """, (p_id, org_id, fpid, name, county, district, status))
            res = cur.fetchone()
            conn.commit()
            cur.close()
            conn.close()

            self.send_json({
                "ok": True,
                "project": {"id": res[0], "fpid": res[1], "name": res[2], "status": res[3]}
            }, 201)
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 500)

    def handle_linework_save(self):
        payload = self.read_json_body()
        if not payload:
            return self.send_json({"ok": False, "error": "Invalid body"}, 400)

        s_id = payload.get("id") or f"lw_{os.urandom(4).hex()}"
        name = payload.get("name") or "Survey Linework Model"
        model = payload.get("model", {"figures": []})
        view = payload.get("view", {})
        figs = model.get("figures", []) if isinstance(model, dict) else []
        pts_count = sum(len(f.get("pts", [])) for f in figs)

        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO linework_sessions (id, name, figure_count, point_count, model, view, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    figure_count = EXCLUDED.figure_count,
                    point_count = EXCLUDED.point_count,
                    model = EXCLUDED.model,
                    view = EXCLUDED.view,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id;
            """, (s_id, name, len(figs), pts_count, json.dumps(model), json.dumps(view)))

            # Clear old points and insert updated survey points
            cur.execute("DELETE FROM survey_points WHERE session_id = %s;", (s_id,))
            pt_rows = []
            for f in figs:
                f_id = f.get("id", "F1")
                for p in f.get("pts", []):
                    pt_num = p.get("ptNum")
                    pt_rows.append((
                        s_id,
                        f_id,
                        str(pt_num) if pt_num is not None else None,  # ptNum can be alphanumeric (e.g. "PC1")
                        p.get("n", 0.0),
                        p.get("e", 0.0),
                        p.get("z", 0.0),
                        p.get("desc", ""),
                        p.get("code", "")
                    ))
            if pt_rows:
                cur.executemany("""
                    INSERT INTO survey_points (session_id, figure_id, pt_num, northing, easting, elevation, raw_desc, code)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                """, pt_rows)

            conn.commit()
            cur.close()
            conn.close()

            self.send_json({
                "ok": True,
                "message": f"Saved {len(figs)} figures and {pts_count} points to PostgreSQL.",
                "id": s_id,
                "figure_count": len(figs),
                "point_count": pts_count
            })
        except Exception as e:
            self.send_json({"ok": False, "error": f"Failed to save linework to database: {str(e)}"}, 500)

    def handle_linework_load(self, qs):
        s_id = qs.get("id", [None])[0]
        try:
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            if s_id:
                cur.execute("SELECT id, name, figure_count, point_count, model, view, created_at, updated_at FROM linework_sessions WHERE id = %s;", (s_id,))
            else:
                cur.execute("SELECT id, name, figure_count, point_count, model, view, created_at, updated_at FROM linework_sessions ORDER BY updated_at DESC LIMIT 1;")
            session = cur.fetchone()
            cur.close()
            conn.close()

            if not session:
                return self.send_json({"ok": False, "error": "No linework session found in database"}, 404)

            d = dict(session)
            if hasattr(d.get("created_at"), "isoformat"):
                d["created_at"] = d["created_at"].isoformat()
            if hasattr(d.get("updated_at"), "isoformat"):
                d["updated_at"] = d["updated_at"].isoformat()

            self.send_json({"ok": True, "session": d})
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)}, 500)

def run_server(port=8085):
    server_address = ("", port)
    httpd = HTTPServer(server_address, FDOTAppServer)
    print(f"============================================================")
    print(f"  FDOT Civil3D Standards Server & PostgreSQL Bridge")
    print(f"  Local Web App:  http://localhost:{port}")
    print(f"  Database API:   http://localhost:{port}/api/db/status")
    print(f"  Active DB:      {mask_db_url(ACTIVE_DB_URL)}")
    print(f"============================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8085
    run_server(port)
