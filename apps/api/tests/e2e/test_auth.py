"""Auth end-to-end tests — real HTTP against whatever base_url resolves to.

The spawned managed subprocess (see conftest.py) runs under default
settings (MYAPP_AUTH=stub), so these exercise the stub path over real
HTTP. Supabase-mode JWT verification is covered at the integration tier
(tests/integration/test_auth.py), since exercising it over real HTTP
would require spawning a second server with different env vars, which
this repo's e2e harness doesn't yet support.
"""

from __future__ import annotations

import httpx


def test_me_returns_dev_user_over_real_http(http_client: httpx.Client) -> None:
    resp = http_client.get("/me")
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "dev-user"}


def test_me_ignores_bogus_authorization_header_under_stub(
    http_client: httpx.Client,
) -> None:
    resp = http_client.get("/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "dev-user"}
