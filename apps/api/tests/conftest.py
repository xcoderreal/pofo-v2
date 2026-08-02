"""Shared fixtures for smoke and e2e tiers.

Both smoke and e2e tests run against a real HTTP server. The `base_url`
fixture decides between two modes:

- **BYO server**: if `SKELETON_E2E_URL` is set, yield it directly. Use this
  to point at a running `just api`, a staging deploy, or prod.
- **Managed subprocess**: otherwise, spawn `uvicorn` on a random free port,
  wait for `/health`, yield the URL, and tear it down at session end.

Write tests are gated by `allow_writes`: defaults to True for localhost
targets, False for anything else (unless `SKELETON_E2E_ALLOW_WRITES=1`).
This prevents a misconfigured cron from POSTing junk into prod.

Unit and integration tiers do NOT use these fixtures — they run in-process
via `TestClient` and `FakeItemRepository`.
"""

from __future__ import annotations

import os
import socket
import subprocess
import time
from collections.abc import Iterator
from urllib.parse import urlparse

import httpx
import pytest


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(url: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    last_exc: Exception | None = None
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(f"{url}/health", timeout=1.0)
            if resp.status_code == 200:
                return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
        time.sleep(0.1)
    raise RuntimeError(f"Server at {url} never became healthy: {last_exc}")


@pytest.fixture(scope="session")
def base_url() -> Iterator[str]:
    """Yield a base URL for real-HTTP tests.

    If `SKELETON_E2E_URL` is set, use it as-is (BYO server). Otherwise spawn
    a uvicorn subprocess for the test session.
    """
    env_url = os.environ.get("SKELETON_E2E_URL")
    if env_url:
        yield env_url.rstrip("/")
        return

    port = _find_free_port()
    url = f"http://127.0.0.1:{port}"
    # Explicit MYAPP_AUTH=stub so this spawned process's own Settings()
    # can't be silently overridden by a developer's local .env.local
    # (e.g. MYAPP_AUTH=supabase, set for manual testing per
    # docs/environments.md) — real env vars outrank .env/.env.local in
    # pydantic-settings' precedence, so this wins regardless of what's
    # on disk. Without it, this fixture's behavior depends on a
    # gitignored file nobody else can see, exactly the fragility that
    # motivated adding this.
    env = {**os.environ, "MYAPP_AUTH": "stub"}
    proc = subprocess.Popen(
        [
            "uv",
            "run",
            "uvicorn",
            "myapp.entrypoints.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    try:
        _wait_for_health(url)
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


@pytest.fixture
def http_client(base_url: str) -> Iterator[httpx.Client]:
    with httpx.Client(base_url=base_url, timeout=5.0) as client:
        yield client


@pytest.fixture(scope="session")
def allow_writes(base_url: str) -> bool:
    """True if this test run is allowed to POST/DELETE against base_url.

    Defaults to True for localhost (127.x, localhost) and False otherwise.
    Override with `SKELETON_E2E_ALLOW_WRITES=1` to force-enable against a
    non-local target.
    """
    if os.environ.get("SKELETON_E2E_ALLOW_WRITES") == "1":
        return True
    host = urlparse(base_url).hostname or ""
    return host == "localhost" or host.startswith("127.")
