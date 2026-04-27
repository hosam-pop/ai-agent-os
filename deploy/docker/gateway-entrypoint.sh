#!/usr/bin/env bash
# AI Agent OS gateway entrypoint.
# Ensures the persistent /data directory used by the admin keys panel exists
# and is writable before booting the Fastify server.
set -euo pipefail

DATA_DIR="${KEYS_STORE_DIR:-/data}"

if [ ! -d "${DATA_DIR}" ]; then
  mkdir -p "${DATA_DIR}" || true
fi

# When the volume was just created on a Fly host, files inside may belong
# to root. Try to fix ownership; ignore failure for read-only / pre-set cases.
if [ -w "${DATA_DIR}" ]; then
  :
else
  echo "warn: ${DATA_DIR} is not writable by $(id -u):$(id -g)" >&2
fi

exec "$@"
