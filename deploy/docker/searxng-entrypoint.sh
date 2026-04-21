#!/bin/sh
# Patch the baked-in settings.yml with the runtime SEARXNG_SECRET provided
# by Fly secrets, then delegate to the upstream SearXNG entrypoint.

set -eu

SETTINGS_PATH="${SEARXNG_SETTINGS_PATH:-/etc/searxng/settings.yml}"

if [ -z "${SEARXNG_SECRET:-}" ]; then
  echo "FATAL: SEARXNG_SECRET is empty. Refusing to start without a real secret_key." >&2
  exit 1
fi

# In-place replace the placeholder token with the real secret. We use a
# python one-liner instead of sed so special chars in the secret never break
# the yaml.
python3 - "$SETTINGS_PATH" <<'PY'
import os, sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as fh:
    data = fh.read()
secret = os.environ['SEARXNG_SECRET']
marker = 'placeholder-overridden-at-runtime'
if marker not in data:
    # Already patched (container restarted) — leave the file alone.
    sys.exit(0)
with open(path, 'w', encoding='utf-8') as fh:
    fh.write(data.replace(marker, secret))
PY

# Hand off to the upstream entrypoint, which runs granian under the hood.
# Location differs between image releases — try the new path first.
if [ -x /usr/local/searxng/entrypoint.sh ]; then
  exec /usr/local/searxng/entrypoint.sh "$@"
elif [ -x /usr/local/searxng/dockerfiles/docker-entrypoint.sh ]; then
  exec /usr/local/searxng/dockerfiles/docker-entrypoint.sh "$@"
else
  echo "FATAL: cannot locate upstream SearXNG entrypoint" >&2
  exit 1
fi
