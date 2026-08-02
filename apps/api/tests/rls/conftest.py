"""Fixtures for the RLS enforcement proof tier.

This tier talks to PostgREST directly against a dedicated *test* Supabase
project — never dev or production, never through the FastAPI app. It's
the only seam that can prove an RLS policy actually works: the app's
stub-auth path uses the service-role key, which bypasses RLS entirely,
so no amount of testing through the app can substitute for this.

Requires three env vars, scoped to "test" by name specifically so this
can never accidentally point at dev or prod even if those happen to be
set in the same shell:

    MYAPP_SUPABASE_TEST_URL
    MYAPP_SUPABASE_TEST_ANON_KEY      (public; used to sign in as a fixture user)
    MYAPP_SUPABASE_TEST_SERVICE_KEY   (secret; used only to create/delete fixture
                                        users via the Admin API — never to read
                                        or write accounts directly, that would
                                        defeat the point of this tier)

Skips cleanly (not fails) when any are absent, so `just verify` and CI
without them still pass — this tier only activates where a maintainer
has explicitly provisioned a test project.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
import pytest

_REQUIRED_ENV = [
    "MYAPP_SUPABASE_TEST_URL",
    "MYAPP_SUPABASE_TEST_ANON_KEY",
    "MYAPP_SUPABASE_TEST_SERVICE_KEY",
]


@dataclass
class RlsTestEnv:
    url: str
    anon_key: str
    service_key: str


@dataclass
class FixtureUser:
    id: str
    email: str
    access_token: str


def _missing_env() -> list[str]:
    return [name for name in _REQUIRED_ENV if not os.environ.get(name)]


@pytest.fixture(scope="session")
def rls_test_env() -> RlsTestEnv:
    missing = _missing_env()
    if missing:
        pytest.skip(
            f"RLS test tier requires {', '.join(missing)} — set them to a "
            "dedicated test Supabase project to run this tier."
        )
    return RlsTestEnv(
        url=os.environ["MYAPP_SUPABASE_TEST_URL"].rstrip("/"),
        anon_key=os.environ["MYAPP_SUPABASE_TEST_ANON_KEY"],
        service_key=os.environ["MYAPP_SUPABASE_TEST_SERVICE_KEY"],
    )


def _admin_headers(env: RlsTestEnv) -> dict[str, str]:
    return {"apikey": env.service_key, "Authorization": f"Bearer {env.service_key}"}


def _create_user(env: RlsTestEnv, email: str, password: str) -> str:
    create = httpx.post(
        f"{env.url}/auth/v1/admin/users",
        headers=_admin_headers(env),
        json={"email": email, "password": password, "email_confirm": True},
        timeout=10,
    )
    create.raise_for_status()
    return create.json()["id"]


def _sign_in(env: RlsTestEnv, email: str, password: str) -> str:
    # Sign in with the ANON key (never the service key) to obtain a real
    # user-scoped JWT — this is what auth.uid() resolves against in RLS
    # policies, exactly like a real frontend session would produce.
    token = httpx.post(
        f"{env.url}/auth/v1/token?grant_type=password",
        headers={"apikey": env.anon_key, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=10,
    )
    token.raise_for_status()
    return token.json()["access_token"]


def _delete_user(env: RlsTestEnv, user_id: str) -> None:
    httpx.delete(
        f"{env.url}/auth/v1/admin/users/{user_id}",
        headers=_admin_headers(env),
        timeout=10,
    )


@pytest.fixture
def fixture_users(
    rls_test_env: RlsTestEnv,
) -> Iterator[tuple[FixtureUser, FixtureUser]]:
    run_id = uuid.uuid4().hex[:8]
    # Track every id the moment it's created, not after both users fully
    # succeed — a failure partway through setup (e.g. user A's admin-create
    # succeeds but user B's sign-in fails) must still clean up whatever was
    # actually created, or it leaks a real user in the test Supabase project
    # with no cleanup path.
    created_ids: list[str] = []
    try:
        user_a_id = _create_user(
            rls_test_env, f"rls-test-a-{run_id}@example.com", "Rls-Test-Password-1!"
        )
        created_ids.append(user_a_id)
        user_a_token = _sign_in(
            rls_test_env, f"rls-test-a-{run_id}@example.com", "Rls-Test-Password-1!"
        )

        user_b_id = _create_user(
            rls_test_env, f"rls-test-b-{run_id}@example.com", "Rls-Test-Password-2!"
        )
        created_ids.append(user_b_id)
        user_b_token = _sign_in(
            rls_test_env, f"rls-test-b-{run_id}@example.com", "Rls-Test-Password-2!"
        )

        yield (
            FixtureUser(
                id=user_a_id,
                email=f"rls-test-a-{run_id}@example.com",
                access_token=user_a_token,
            ),
            FixtureUser(
                id=user_b_id,
                email=f"rls-test-b-{run_id}@example.com",
                access_token=user_b_token,
            ),
        )
    finally:
        for user_id in created_ids:
            _delete_user(rls_test_env, user_id)


def account_headers(env: RlsTestEnv, user: FixtureUser) -> dict[str, str]:
    return {
        "apikey": env.anon_key,
        "Authorization": f"Bearer {user.access_token}",
        "Content-Type": "application/json",
    }
