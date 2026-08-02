"""Portfolio summary end-to-end — real HTTP against the managed
subprocess's default settings (MYAPP_AUTH=stub).

Network-free: the earliest transaction date is read off the ledger and
needs no price lookup.

The e2e stub user is shared across this whole tier, so this asserts a
*relation* — the summary date is at or before a transaction this test
just wrote — rather than an exact value another test could move.
"""

from __future__ import annotations

import uuid

import httpx
import pytest


def test_summary_reports_a_date_no_later_than_the_ledgers_first_row(
    http_client: httpx.Client, allow_writes: bool
) -> None:
    if not allow_writes:
        pytest.skip("writes disabled for this target (set SKELETON_E2E_ALLOW_WRITES=1)")

    account_id = f"e2e-summary-acc-{uuid.uuid4().hex[:8]}"
    resp = http_client.post(
        "/accounts",
        json={
            "id": account_id,
            "name": "E2E Summary Brokerage",
            "institution": "E2E Bank",
            "account_type": "brokerage",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = http_client.post(
        "/transactions/deposit",
        json={
            "account_id": account_id,
            "amount": "5000",
            "timestamp": "2021-04-05T00:00:00",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = http_client.get("/portfolio/summary")

    assert resp.status_code == 200, resp.text
    earliest = resp.json()["earliest_transaction_date"]
    assert earliest is not None
    assert earliest <= "2021-04-05"


def test_summary_is_readable_without_writing_anything(
    http_client: httpx.Client,
) -> None:
    """Read-only, so it runs against every target — including one where
    writes are disabled. Either shape is legitimate: a date for a target
    with a ledger, null for a pristine one."""
    resp = http_client.get("/portfolio/summary")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"earliest_transaction_date"}
    assert body["earliest_transaction_date"] is None or isinstance(
        body["earliest_transaction_date"], str
    )
