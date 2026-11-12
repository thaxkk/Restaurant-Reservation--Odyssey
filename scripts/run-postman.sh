#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ -z "${POSTMAN_ADMIN_EMAIL:-}" || -z "${POSTMAN_ADMIN_PASSWORD:-}" ]]; then
  printf 'Set POSTMAN_ADMIN_EMAIL and POSTMAN_ADMIN_PASSWORD for an existing promoted admin account.\n' >&2
  exit 2
fi

npx --yes newman run postman/full-workflow.postman_collection.json \
  --env-var "baseUrl=${POSTMAN_BASE_URL:-http://localhost:3000}" \
  --env-var "adminEmail=$POSTMAN_ADMIN_EMAIL" \
  --env-var "adminPassword=$POSTMAN_ADMIN_PASSWORD" \
  --bail failure
