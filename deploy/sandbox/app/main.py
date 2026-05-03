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
        "scrapling": _scrapling_available(),
    }


def _scrapling_available() -> bool:
    try:
        import scrapling  # noqa: F401
        return True
    except Exception:
        return False


SCRAPE_MAX_BYTES = 64 * 1024


@mcp.tool()
def scrape_url(
    url: str,
    selectors: dict[str, str] | None = None,
    js: bool = False,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Fetch a page and return cleaned text + values for any CSS selectors.

    Powered by Scrapling (https://github.com/D4Vinci/Scrapling). The default
    mode uses the lightweight HTTP Fetcher; when ``js=True`` the agent asks
    for the StealthyFetcher (Playwright-based) which only works on images
    that have ``playwright install`` baked in.

    Args:
        url: Absolute URL to fetch.
        selectors: Optional ``{name: css_selector}`` map; the response includes
            ``selectors`` with the first matching text per name.
        js: When true, render the page through a headless browser to handle
            JS-heavy sites. Falls back to the HTTP fetcher with a clear note
            if the browser runtime isn't installed.
        timeout: Hard wall-clock limit in seconds (1..120).
    """
    try:
        timeout_int = max(1, min(int(timeout), MAX_TIMEOUT_SECONDS))
    except (TypeError, ValueError):
        timeout_int = DEFAULT_TIMEOUT_SECONDS

    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return {"error": "url must be an absolute http(s) URL"}

    note = ""
    status: int | None = None
    body = ""
    tree = None

    # JS mode tries Scrapling's StealthyFetcher (Playwright-backed). The slim
    # image doesn't ship a browser runtime, so this raises and we fall back to
    # the plain HTTP path with a clear note. Plain HTTP uses httpx + lxml so we
    # never touch Scrapling's import-time playwright dependency.
    if js:
        try:
            from scrapling.fetchers import StealthyFetcher  # type: ignore
            page = StealthyFetcher.fetch(url, headless=True, timeout=timeout_int * 1000)
            status = getattr(page, "status", None) or getattr(page, "status_code", None)
            text_attr = getattr(page, "text", None)
            body = (text_attr() if callable(text_attr) else (text_attr or "")) or ""
            try:
                from lxml import html as lxml_html  # type: ignore
                tree = lxml_html.fromstring(body) if body else None
            except Exception:
                tree = None
        except Exception as exc:
            note = f"js mode unavailable ({exc.__class__.__name__}); fell back to HTTP fetcher"

    if tree is None and not body:
        try:
            import httpx  # type: ignore
            with httpx.Client(follow_redirects=True, timeout=timeout_int) as client:
                resp = client.get(url, headers={"User-Agent": "ai-agent-os-sandbox/1.0"})
                status = resp.status_code
                body = resp.text or ""
            try:
                from lxml import html as lxml_html  # type: ignore
                tree = lxml_html.fromstring(body) if body else None
            except Exception:
                tree = None
        except Exception as exc:
            return {"error": f"http fetch failed: {exc.__class__.__name__}: {exc}"}

    selector_results: dict[str, str | None] = {}
    if selectors and tree is not None:
        try:
            from lxml.cssselect import CSSSelector  # type: ignore
        except Exception:
            CSSSelector = None  # type: ignore

        for name, sel in selectors.items():
            if not isinstance(sel, str) or CSSSelector is None:
                selector_results[name] = None
                continue
            try:
                hits = CSSSelector(sel)(tree)
                selector_results[name] = (hits[0].text_content().strip() if hits else None)
            except Exception:
                selector_results[name] = None

    return {
        "url": url,
        "status": status,
        "selectors": selector_results,
        "text": _truncate(body[: SCRAPE_MAX_BYTES * 4]),
        "note": note,
    }


CLI_TOOL_ALLOWLIST = {
    "git",
    "gh",
    "curl",
    "wget",
    "ls",
    "cat",
    "head",
    "tail",
    "grep",
    "find",
    "jq",
    "node",
    "npm",
    "npx",
    "python3",
    "pip",
    "uv",
    "bun",
    "pnpm",
    "yarn",
}


@mcp.tool()
def cli_run(
    tool: str,
    args: list[str] | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    stdin: str | None = None,
) -> dict[str, Any]:
    """Run an allow-listed CLI tool with explicit args (no shell expansion).

    Inspired by https://github.com/jackwener/OpenCLI — gives the agent a
    deterministic CLI surface that's safer than ``run_code(language='bash')``
    because the binary name is checked against ``CLI_TOOL_ALLOWLIST`` and
    arguments are passed through ``execvp`` (no shell metacharacters).
    """
    if tool not in CLI_TOOL_ALLOWLIST:
        return {
            "error": f"tool not allow-listed: {tool}",
            "allowed": sorted(CLI_TOOL_ALLOWLIST),
        }
    cleaned_args: list[str] = []
    for a in args or []:
        if not isinstance(a, str):
            return {"error": "all args must be strings"}
        if any(ch in a for ch in ("\x00",)):
            return {"error": "args must not contain NUL bytes"}
        cleaned_args.append(a)
    try:
        timeout_int = max(1, min(int(timeout), MAX_TIMEOUT_SECONDS))
    except (TypeError, ValueError):
        timeout_int = DEFAULT_TIMEOUT_SECONDS

    with tempfile.TemporaryDirectory(prefix="aaos-cli-") as cwd:
        try:
            proc = subprocess.run(
                [tool, *cleaned_args],
                cwd=cwd,
                env=_build_child_env(),
                input=stdin,
                capture_output=True,
                text=True,
                timeout=timeout_int,
                check=False,
            )
        except FileNotFoundError:
            return {"error": f"tool not installed in sandbox: {tool}"}
        except subprocess.TimeoutExpired as exc:
            return {
                "tool": tool,
                "stdout": _truncate(exc.stdout or ""),
                "stderr": _truncate(exc.stderr or ""),
                "exitCode": None,
                "timedOut": True,
                "timeoutSeconds": timeout_int,
            }
    return {
        "tool": tool,
        "args": cleaned_args,
        "stdout": _truncate(proc.stdout),
        "stderr": _truncate(proc.stderr),
        "exitCode": proc.returncode,
        "timedOut": False,
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
