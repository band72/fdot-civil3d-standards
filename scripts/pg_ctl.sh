#!/usr/bin/env bash
# PostgreSQL Management Helper Script for Local FDOT Survey Database
set -e

PG_DIR="${HOME}/.local/pgsql"
BIN_DIR="${PG_DIR}/usr/lib/postgresql/16/bin"
DATA_DIR="${PG_DIR}/data"
LOG_FILE="${PG_DIR}/logfile"
DB_NAME="fdot_survey_db"
DB_USER="postgres"
PORT=5432

mkdir -p "${PG_DIR}"

case "$1" in
  start)
    if "${BIN_DIR}/pg_isready" -h localhost -p "${PORT}" >/dev/null 2>&1; then
      echo "PostgreSQL is already running on port ${PORT}."
    else
      echo "Starting PostgreSQL server on port ${PORT}..."
      "${BIN_DIR}/pg_ctl" -D "${DATA_DIR}" -o "-p ${PORT} -k /tmp" -l "${LOG_FILE}" start
      "${BIN_DIR}/pg_isready" -h localhost -p "${PORT}"
      echo "PostgreSQL started successfully."
    fi
    ;;
  stop)
    echo "Stopping PostgreSQL server..."
    "${BIN_DIR}/pg_ctl" -D "${DATA_DIR}" stop -m fast || true
    echo "PostgreSQL stopped."
    ;;
  restart)
    echo "Restarting PostgreSQL server..."
    "${BIN_DIR}/pg_ctl" -D "${DATA_DIR}" restart -m fast -o "-p ${PORT} -k /tmp" -l "${LOG_FILE}"
    "${BIN_DIR}/pg_isready" -h localhost -p "${PORT}"
    ;;
  status)
    if "${BIN_DIR}/pg_isready" -h localhost -p "${PORT}"; then
      echo "✓ PostgreSQL is active and accepting connections on localhost:${PORT}."
    else
      echo "✗ PostgreSQL is NOT running on localhost:${PORT}."
      exit 1
    fi
    ;;
  psql)
    "${BIN_DIR}/psql" -h localhost -p "${PORT}" -U "${DB_USER}" -d "${DB_NAME}" "${@:2}"
    ;;
  init)
    python3 "$(dirname "$0")/../db/init_db.py" "$2"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|psql|init}"
    exit 1
    ;;
esac
