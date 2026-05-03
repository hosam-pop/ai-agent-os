# syntax=docker/dockerfile:1.7
# ai-agent-os sandbox: Python + Node + bash, hosted as an MCP server.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Runtime deps: node (for `node -e` snippets), git (for GITHUB_PAT git clone),
# curl + ca-certificates for general network calls. Keep the layer slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        nodejs \
        git \
        curl \
        ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY pyproject.toml ./
RUN pip install --upgrade pip \
 && pip install \
        "fastapi>=0.115" \
        "uvicorn[standard]>=0.30" \
        "mcp>=1.2.0" \
        "scrapling>=0.2" \
        "lxml>=5.2" \
        "curl_cffi>=0.7"

COPY app ./app

# Drop privileges. Sandbox itself runs as `sandbox` UID; subprocess code runs
# inside this same user (no further fork/exec privilege drop because Fly
# machines are already isolated VMs).
RUN useradd --system --create-home --uid 10001 sandbox \
 && chown -R sandbox:sandbox /srv
USER sandbox

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--proxy-headers"]
