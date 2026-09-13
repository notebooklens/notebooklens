#!/bin/sh

set -eu

run_migrations() {
  attempts=0
  until alembic -c apps/api/alembic.ini upgrade head; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 12 ]; then
      echo "Timed out waiting for PostgreSQL migrations to succeed." >&2
      exit 1
    fi
    sleep 5
  done
}

run_api() {
  exec uvicorn apps.api.main:app --host 0.0.0.0 --port 8000
}

run_worker() {
  exec python -m apps.api.worker_loop
}

case "${1:-}" in
  api)
    run_migrations
    run_api
    ;;
  worker)
    run_worker
    ;;
  *)
    echo "Usage: run-managed-service.sh [api|worker]" >&2
    exit 1
    ;;
esac
