#!/usr/bin/env bash
set -euo pipefail

# Ensure local SearXNG is running and healthy before use.
# Usage:
#   script/searxng/ensure-searxng.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
SERVICE_NAME="searxng"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-90}"
HOST_URL="${HOST_URL:-http://127.0.0.1:8889}"
START_RETRIES="${START_RETRIES:-4}"

started=0
for (( attempt=1; attempt<=START_RETRIES; attempt++ )); do
  if docker compose -f "${COMPOSE_FILE}" up -d; then
    started=1
    break
  fi
  if (( attempt == START_RETRIES )); then
    echo "Failed to start SearXNG after ${START_RETRIES} attempts." >&2
    exit 1
  fi
  sleep 2
done

elapsed=0
while true; do
  status="$(docker inspect "${SERVICE_NAME}" --format '{{.State.Status}}' 2>/dev/null || echo "missing")"
  health="$(docker inspect "${SERVICE_NAME}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo "missing")"

  if [[ "${status}" == "running" ]] && curl -fsS "${HOST_URL}/config" >/dev/null 2>&1; then
    echo "SearXNG is reachable at ${HOST_URL} (status=${status}, health=${health})."
    exit 0
  fi

  if (( elapsed >= MAX_WAIT_SECONDS )); then
    echo "SearXNG did not become reachable within ${MAX_WAIT_SECONDS}s (status=${status}, health=${health}, url=${HOST_URL})." >&2
    exit 1
  fi

  sleep 2
  elapsed=$((elapsed + 2))
done
