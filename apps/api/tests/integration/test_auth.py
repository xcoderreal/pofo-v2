"""Auth integration tests.

Uses dependency_overrides to inject a specific AuthProvider per test, the
same pattern test_api.py uses for repositories.
"""

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from myapp.adapters.stub_auth_provider import DEV_USER_ID, StubAuthProvider
from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.entrypoints.api import app, get_auth_provider


def _es256_keypair() -> tuple[str, str]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    return private_pem, public_pem


PRIVATE_KEY, PUBLIC_KEY = _es256_keypair()


def _supabase_provider() -> SupabaseAuthProvider:
    return SupabaseAuthProvider(
        project_url="https://test.supabase.co",
        get_signing_key=lambda token: PUBLIC_KEY,
    )


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
    client = _client_with(_supabase_provider())

    response = client.get("/me")

    assert response.status_code == 401


def test_me_under_supabase_auth_with_valid_token_returns_subject() -> None:
    client = _client_with(_supabase_provider())
    token = jwt.encode(
        {"sub": "user-123", "aud": "authenticated"}, PRIVATE_KEY, algorithm="ES256"
    )

    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": "user-123"}


def test_me_under_supabase_auth_with_invalid_token_returns_401() -> None:
    client = _client_with(_supabase_provider())

    response = client.get("/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 401
