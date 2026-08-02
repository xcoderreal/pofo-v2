import jwt
import pytest

from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.domain.auth import AuthenticationError

SECRET = "test-jwt-secret-at-least-32-characters-long"


def _make_token(
    *, sub: str = "user-123", secret: str = SECRET, **claims: object
) -> str:
    payload = {"sub": sub, "aud": "authenticated", **claims}
    return jwt.encode(payload, secret, algorithm="HS256")


def test_valid_token_returns_user_with_subject_as_id() -> None:
    provider = SupabaseAuthProvider(jwt_secret=SECRET)
    token = _make_token(sub="user-123")

    user = provider.get_user(token)

    assert user.id == "user-123"


def test_missing_token_raises_authentication_error() -> None:
    provider = SupabaseAuthProvider(jwt_secret=SECRET)

    with pytest.raises(AuthenticationError):
        provider.get_user(None)


def test_token_signed_with_wrong_secret_raises_authentication_error() -> None:
    provider = SupabaseAuthProvider(jwt_secret=SECRET)
    token = _make_token(secret="a-completely-different-secret-value")

    with pytest.raises(AuthenticationError):
        provider.get_user(token)


def test_token_missing_subject_claim_raises_authentication_error() -> None:
    provider = SupabaseAuthProvider(jwt_secret=SECRET)
    token = jwt.encode({"aud": "authenticated"}, SECRET, algorithm="HS256")

    with pytest.raises(AuthenticationError):
        provider.get_user(token)


def test_expired_token_raises_authentication_error() -> None:
    provider = SupabaseAuthProvider(jwt_secret=SECRET)
    token = _make_token(exp=1)  # epoch second 1 — long expired

    with pytest.raises(AuthenticationError):
        provider.get_user(token)
