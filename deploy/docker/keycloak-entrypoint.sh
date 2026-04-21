#!/bin/bash
# ============================================================================
# Keycloak entrypoint wrapper
# - Substitutes ${OIDC_CLIENT_SECRET} and ${INITIAL_ADMIN_PASSWORD}
#   placeholders in the realm JSON at container startup, using values
#   from environment (set via `flyctl secrets set ...`).
# - Then hands off to the real Keycloak entrypoint.
# ============================================================================
set -euo pipefail

REALM_TEMPLATE="/opt/keycloak/data/import/ai-agent-os-realm.json"
REALM_RENDERED="/tmp/ai-agent-os-realm.rendered.json"

if [[ -f "$REALM_TEMPLATE" ]]; then
  if [[ -z "${OIDC_CLIENT_SECRET:-}" ]]; then
    echo "[entrypoint] WARN: OIDC_CLIENT_SECRET not set — LibreChat OIDC will fail"
  fi
  if [[ -z "${INITIAL_ADMIN_PASSWORD:-}" ]]; then
    echo "[entrypoint] WARN: INITIAL_ADMIN_PASSWORD not set — admin user cannot log in"
  fi
  # Render placeholders using a here-doc with only the two variables we care about.
  OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-unset-oidc-secret}" \
  INITIAL_ADMIN_PASSWORD="${INITIAL_ADMIN_PASSWORD:-unset-admin-password}" \
    envsubst '${OIDC_CLIENT_SECRET} ${INITIAL_ADMIN_PASSWORD}' \
      < "$REALM_TEMPLATE" > "$REALM_RENDERED"
  # Overwrite the import file in place so --import-realm picks it up.
  cp "$REALM_RENDERED" "$REALM_TEMPLATE"
  echo "[entrypoint] realm placeholders substituted"
fi

exec /opt/keycloak/bin/kc.sh "$@"
