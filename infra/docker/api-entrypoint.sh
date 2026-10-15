#!/bin/sh
set -eu
if [ -d /run/hypernova ]; then
  pg_app_password=$(cat /run/hypernova/app-password)
  export DATABASE_URL="postgresql://hypernova_app:${pg_app_password}@postgres:5432/hypernova"
  export JWT_SECRET="$(cat /run/hypernova/jwt-secret)"
  export ISSUER_PRIVATE_KEY="$(cat /run/hypernova/issuer-key)"
  export DEMO_PASSWORD="$(cat /run/hypernova/demo-password)"
fi
export RUNTIME_DIR="${RUNTIME_DIR:-/app/runtime}"
if [ "${INITIALIZE_DATABASE:-0}" = "1" ]; then
  pg_owner_password=$(cat /run/postgres-secrets/postgres-password)
  export DATABASE_ADMIN_URL="postgresql://hypernova_owner:${pg_owner_password}@postgres:5432/hypernova"
  export DB_APP_PASSWORD="$pg_app_password"
  node dist/initialize.js
  chown -R 1000:1000 "$RUNTIME_DIR"
  exit 0
fi
exec node dist/main.js
