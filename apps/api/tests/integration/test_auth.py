"""Auth integration tests.

Uses dependency_overrides to inject a specific AuthProvider per test, the
same pattern test_api.py uses for repositories.
"""

import jwt
import pytest
from fastapi.testclient import TestClient

from myapp.adapters.stub_auth_provider import DEV_USER_ID, StubAuthProvider
from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.entrypoints.api import app, get_auth_provider

SECRET = "test-jwt-secret-at-least-32-characters-long"


def _client_with(provider: object) -> TestClient:
    app.dependency_overrides[get_auth_provider] = lambda: provider
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_me_under_stub_auth_returns_fixed_dev_user() -> None:
    client = _client_with(StubAuthProvider())

    response = client.get("/me")

    assert response.status_code == 200
    assert response.json() == {"user_id": DEV_USER_ID}


def test_me_under_stub_auth_requires_no_authorization_header() -> None:
    client = _client_with(StubAuthProvider())

    response = client.get("/me")  # no Authorization header at all

    assert response.status_code == 200


def test_me_under_supabase_auth_requires_valid_token() -> None:
    client = _client_with(SupabaseAuthProvider(jwt_secret=SECRET))

    response = client.get("/me")

    assert response.status_code == 401


def test_me_under_supabase_auth_with_valid_token_returns_subject() -> None:
    client = _client_with(SupabaseAuthProvider(jwt_secret=SECRET))
    token = jwt.encode(
        {"sub": "user-123", "aud": "authenticated"}, SECRET, algorithm="HS256"
    )

    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": "user-123"}


def test_me_under_supabase_auth_with_invalid_token_returns_401() -> None:
    client = _client_with(SupabaseAuthProvider(jwt_secret=SECRET))

    response = client.get("/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 401
