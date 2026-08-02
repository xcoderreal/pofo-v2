"""Demo-seed end-to-end tests — real HTTP against the managed
subprocess's default settings (MYAPP_AUTH=stub).

Stub auth resolves to one fixed dev user shared by every e2e test in the
run, and other modules create accounts against it. So these tests cannot
assume they are seeding a fresh user — they assert the endpoint's
contract (idempotent, leaves the user with a portfolio) rather than a
specific seeded/not-seeded outcome, which depends on test order.
"""

from __future__ import annotations

import httpx
import pytest


def test_seed_leaves_the_user_with_a_portfolio(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    resp = http_client.post("/demo/seed")

    assert resp.status_code == 200
    assert isinstance(resp.json()["seeded"], bool)

    accounts = http_client.get("/accounts")
    assert accounts.status_code == 200
    assert accounts.json(), "user has no accounts after seeding"


def test_seed_is_idempotent(http_client: httpx.Client, allow_writes: bool) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    http_client.post("/demo/seed")
    before = http_client.get("/accounts").json()

    resp = http_client.post("/demo/seed")

    assert resp.json() == {"seeded": False}
    assert http_client.get("/accounts").json() == before


def test_seeded_portfolio_answers_the_dashboard_default_query(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    """The dashboard's landing view is whole-portfolio equity. After
    seeding it must resolve over real HTTP, not just in-process."""
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    http_client.post("/demo/seed")

    resp = http_client.get(
        "/portfolio/query",
        params={
            "metric": "equity",
            "group_by": "none",
            "start": "2024-01-01",
            "end": "2026-12-31",
            "granularity": "monthly",
            "mode": "point_in_time",
        },
    )

    assert resp.status_code == 200
