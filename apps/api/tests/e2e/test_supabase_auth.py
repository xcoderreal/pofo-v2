"""Real Supabase Auth end-to-end test — closes the exact gap
test_auth.py's own docstring called out: exercising Supabase-mode JWT
verification over real HTTP needs a second server with different env
vars, which the shared `base_url` fixture (always default stub-mode)
doesn't provide. This file spawns its own, independently configured
subprocess instead.

Nothing in this test depends on .env.local — the subprocess's
MYAPP_AUTH/MYAPP_SUPABASE_URL are set explicitly, so it's self-contained
and repeatable regardless of local dev config (the exact fragility that
motivated writing this).

Skips cleanly (not a failure) when the local Supabase stack isn't
running, so `just verify`/CI without Docker still pass. Requires,
separately:
    cd apps/api && supabase start   (once; not managed by this fixture,
                                      see docs/environments.md on why)
    just supabase-reset-dev          (or just let dev_user_access_token
                                      reseed it — idempotent either way)
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

DEV_EMAIL = "dev@example.com"
DEV_PASSWORD = "dev-password-not-for-prod-1!"
DEV_USER_ID = "00000000-0000-0000-0000-000000000001"

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"


def _local_supabase_status() -> dict[str, str] | None:
    result = subprocess.run(
        ["supabase", "status", "-o", "json"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


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


@pytest.fixture(scope="module")
def supabase_status() -> dict[str, str]:
    status = _local_supabase_status()
    if status is None:
        pytest.skip(
            "requires a running local Supabase stack — "
            "run `cd apps/api && supabase start` first"
        )
    return status


@pytest.fixture(scope="module")
def supabase_auth_base_url(supabase_status: dict[str, str]) -> Iterator[str]:
    """A managed subprocess of the app, explicitly configured for
    MYAPP_AUTH=supabase against the local stack — independent of
    .env.local, so this test can't be broken by (or silently depend on)
    a developer's local dev config."""
    port = _find_free_port()
    url = f"http://127.0.0.1:{port}"
    env = {
        **os.environ,
        "MYAPP_AUTH": "supabase",
        "MYAPP_SUPABASE_URL": supabase_status["API_URL"],
    }
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


@pytest.fixture(scope="module")
def dev_user_access_token(supabase_status: dict[str, str]) -> str:
    """Reseeds the fixed dev user (idempotent — see scripts/seed_dev_user.py)
    and signs in for real: the reset -> reseed -> sign-in sequence from
    the manual walkthrough, now repeatable as a test."""
    subprocess.run(
        [sys.executable, str(_SCRIPTS_DIR / "seed_dev_user.py")],
        check=True,
        capture_output=True,
    )

    response = httpx.post(
        f"{supabase_status['API_URL']}/auth/v1/token?grant_type=password",
        headers={"apikey": supabase_status["ANON_KEY"]},
        json={"email": DEV_EMAIL, "password": DEV_PASSWORD},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def test_real_supabase_token_resolves_to_the_seeded_dev_user(
    supabase_auth_base_url: str, dev_user_access_token: str
) -> None:
    resp = httpx.get(
        f"{supabase_auth_base_url}/me",
        headers={"Authorization": f"Bearer {dev_user_access_token}"},
        timeout=5,
    )
    assert resp.status_code == 200
    assert resp.json() == {"user_id": DEV_USER_ID}


def test_missing_token_is_rejected(supabase_auth_base_url: str) -> None:
    resp = httpx.get(f"{supabase_auth_base_url}/me", timeout=5)
    assert resp.status_code == 401


def test_bogus_token_is_rejected(supabase_auth_base_url: str) -> None:
    resp = httpx.get(
        f"{supabase_auth_base_url}/me",
        headers={"Authorization": "Bearer not-a-real-token"},
        timeout=5,
    )
    assert resp.status_code == 401
