"""Proves the accounts RLS policy (apps/api/supabase/migrations/0001_accounts.sql)
actually denies cross-user access, talking to PostgREST directly with two
real fixture users' JWTs. See conftest.py's module docstring for why this
tier exists and can't be substituted by testing through the app.
"""

from __future__ import annotations

import uuid

import httpx

from .conftest import FixtureUser, RlsTestEnv, account_headers


def _create_account(
    env: RlsTestEnv, as_user: FixtureUser, *, account_id: str, owner: FixtureUser
) -> httpx.Response:
    return httpx.post(
        f"{env.url}/rest/v1/accounts",
        headers={**account_headers(env, as_user), "Prefer": "return=representation"},
        json={
            "id": account_id,
            "user_id": owner.id,
            "name": "RLS test account",
            "institution": "Test Bank",
            "account_type": "brokerage",
        },
        timeout=10,
    )


def test_user_can_read_their_own_account(
    rls_test_env: RlsTestEnv, fixture_users: tuple[FixtureUser, FixtureUser]
) -> None:
    user_a, _ = fixture_users
    account_id = f"rls-{uuid.uuid4().hex[:8]}"

    created = _create_account(rls_test_env, user_a, account_id=account_id, owner=user_a)
    assert created.status_code in (200, 201), created.text

    read = httpx.get(
        f"{rls_test_env.url}/rest/v1/accounts",
        headers=account_headers(rls_test_env, user_a),
        params={"id": f"eq.{account_id}"},
        timeout=10,
    )
    assert read.status_code == 200
    assert len(read.json()) == 1


def test_user_cannot_read_another_users_account(
    rls_test_env: RlsTestEnv, fixture_users: tuple[FixtureUser, FixtureUser]
) -> None:
    """RLS filters the row out silently — same 'invisible, not an error'
    semantics AccountService.get_account implements in the app layer."""
    user_a, user_b = fixture_users
    account_id = f"rls-{uuid.uuid4().hex[:8]}"

    created = _create_account(rls_test_env, user_a, account_id=account_id, owner=user_a)
    assert created.status_code in (200, 201), created.text

    read_as_b = httpx.get(
        f"{rls_test_env.url}/rest/v1/accounts",
        headers=account_headers(rls_test_env, user_b),
        params={"id": f"eq.{account_id}"},
        timeout=10,
    )
    assert read_as_b.status_code == 200
    assert read_as_b.json() == []


def test_user_cannot_insert_an_account_owned_by_another_user(
    rls_test_env: RlsTestEnv, fixture_users: tuple[FixtureUser, FixtureUser]
) -> None:
    """The accounts_insert_own policy's WITH CHECK (auth.uid() = user_id)
    must reject an impersonation attempt, not merely hide it."""
    user_a, user_b = fixture_users
    account_id = f"rls-{uuid.uuid4().hex[:8]}"

    resp = _create_account(rls_test_env, user_b, account_id=account_id, owner=user_a)
    # 403 specifically (not 401): user_b's JWT is valid, so this must be
    # PostgREST's normal WITH CHECK violation response, not an auth
    # rejection — a 401 here would mean a different, wrong failure mode.
    assert resp.status_code == 403, resp.text
