"""Code-execution sandbox exposed to LibreChat as an MCP server.

The Manager Agent calls `run_code(language, code, timeout)` through the
`code-sandbox` MCP server registered in `deploy/librechat/librechat.yaml`.
The server is gated by a shared bearer token (`SANDBOX_TOKEN`) and only
accepts the `streamable-http` MCP transport on `/mcp`.

Optional environment variables that are passed through to the executed
process when present:

* `GITHUB_PAT`  — enables `git clone/push` to private repos.
* `GEMINI_API_KEY` — enables Google Generative AI SDK calls inside the code.

Both are read from the Fly secrets that the user sets directly; this server
never asks for them at request time.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings


SUPPORTED_LANGUAGES: dict[str, list[str]] = {
    "python": ["python3", "-c"],
    "bash": ["bash", "-c"],
    "node": ["node", "-e"],
    "shell": ["sh", "-c"],
}

DEFAULT_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 120
MAX_CODE_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 8 * 1024


def _build_child_env() -> dict[str, str]:
    """Pass through only a vetted set of variables to the executed code.

    Whitelist approach: never inherit the full server environment because that
    would leak `SANDBOX_TOKEN` and other operational secrets. Only PATH, HOME,
    LANG, plus the optional integration tokens.
    """
    env: dict[str, str] = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": "/tmp",
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    for passthrough in ("GITHUB_PAT", "GEMINI_API_KEY"):
        value = os.environ.get(passthrough)
        if value:
            env[passthrough] = value
    return env


def _truncate(buf: str) -> str:
    if len(buf.encode("utf-8")) <= MAX_OUTPUT_BYTES:
        return buf
    return buf.encode("utf-8")[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace") + "\n…[truncated]"


def _allowed_hosts() -> list[str]:
    """Hosts the MCP server accepts in the `Host` header.

    DNS-rebinding protection is on by default in `TransportSecuritySettings`;
    the ALLOWED_HOSTS env var lets the operator extend the list (comma-separated)
    without redeploying the image. We always allow the default Fly hostname plus
    localhost for local smoke testing.
    """
    base = ["ai-agent-os-sandbox.fly.dev", "localhost", "127.0.0.1"]
    extra = os.environ.get("ALLOWED_HOSTS", "")
    base.extend(h.strip() for h in extra.split(",") if h.strip())
    return base


mcp = FastMCP(
    "code-sandbox",
    stateless_http=True,
    transport_security=TransportSecuritySettings(allowed_hosts=_allowed_hosts()),
)


@mcp.tool()
def run_code(language: str, code: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    """Run a short snippet of code in a disposable sandbox.

    Args:
        language: One of ``python``, ``bash``, ``node``, ``shell``.
        code: The source/command to execute. Capped at 64 KiB.
        timeout: Hard wall-clock limit in seconds (1..120).

    Returns:
        A dict with ``stdout``, ``stderr``, ``exitCode``, ``language``,
        and ``timedOut``. Output streams are truncated to 8 KiB each.
    """
    if language not in SUPPORTED_LANGUAGES:
        return {
            "error": f"unsupported language: {language}",
            "supported": sorted(SUPPORTED_LANGUAGES.keys()),
        }
    if not isinstance(code, str) or not code.strip():
        return {"error": "code must be a non-empty string"}
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        return {"error": f"code exceeds {MAX_CODE_BYTES} bytes"}

    try:
        timeout_int = int(timeout) if timeout is not None else DEFAULT_TIMEOUT_SECONDS
    except (TypeError, ValueError):
        timeout_int = DEFAULT_TIMEOUT_SECONDS
    timeout_int = max(1, min(timeout_int, MAX_TIMEOUT_SECONDS))

    cmd = SUPPORTED_LANGUAGES[language] + [code]
    with tempfile.TemporaryDirectory(prefix="aaos-sandbox-") as cwd:
        try:
            proc = subprocess.run(
                cmd,
                cwd=cwd,
                env=_build_child_env(),
                capture_output=True,
                text=True,
                timeout=timeout_int,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            return {
                "language": language,
                "stdout": _truncate(exc.stdout or ""),
                "stderr": _truncate(exc.stderr or ""),
                "exitCode": None,
                "timedOut": True,
                "timeoutSeconds": timeout_int,
            }

    return {
        "language": language,
        "stdout": _truncate(proc.stdout),
        "stderr": _truncate(proc.stderr),
        "exitCode": proc.returncode,
        "timedOut": False,
    }


@mcp.tool()
def integrations_status() -> dict[str, bool]:
    """Report which optional integration env vars are wired into the sandbox.

    Useful for the agent to decide whether GitHub or Gemini calls will work
    before attempting them — surfaces ``github`` and ``gemini`` as booleans.
    """
    return {
        "github": bool(os.environ.get("GITHUB_PAT")),
        "gemini": bool(os.environ.get("GEMINI_API_KEY")),
    }


def _expected_token() -> str | None:
    return os.environ.get("SANDBOX_TOKEN")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title="ai-agent-os sandbox",
    description="Code-execution MCP worker (streamable-http).",
    version="1.0.0",
    lifespan=_lifespan,
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.middleware("http")
async def _bearer_auth(request: Request, call_next):
    if request.url.path == "/healthz":
        return await call_next(request)
    expected = _expected_token()
    if not expected:
        return Response("server unconfigured: SANDBOX_TOKEN missing", status_code=503)
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return Response("unauthorized", status_code=401)
    presented = auth.split(" ", 1)[1].strip()
    if not _constant_time_eq(presented, expected):
        return Response("unauthorized", status_code=401)
    return await call_next(request)


def _constant_time_eq(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a.encode("utf-8"), b.encode("utf-8")):
        diff |= x ^ y
    return diff == 0


# Mount the streamable-http MCP transport at root — the inner app already
# registers its own `/mcp` route, so the public URL ends up as
# `https://ai-agent-os-sandbox.fly.dev/mcp` (which is what
# `mcpServers.code-sandbox.url` points at). FastAPI resolves explicit routes
# (`/healthz`) before mounts, so the health endpoint stays reachable.
app.mount("/", mcp.streamable_http_app())
