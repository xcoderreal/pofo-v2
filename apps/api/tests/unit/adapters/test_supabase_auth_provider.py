import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from myapp.adapters.supabase_auth_provider import SupabaseAuthProvider
from myapp.domain.auth import AuthenticationError


def _es256_keypair() -> tuple[str, str]:
    """A real ES256 keypair — Supabase signs session tokens this way (an
    asymmetric, per-project keypair published via JWKS), so tests must
    verify against real EC key material, not a shared-secret stand-in."""
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
_OTHER_PRIVATE_KEY, _ = _es256_keypair()


def _make_token(
    *, sub: str = "user-123", private_key: str = PRIVATE_KEY, **claims: object
) -> str:
    payload = {"sub": sub, "aud": "authenticated", **claims}
    return jwt.encode(payload, private_key, algorithm="ES256")


def _provider(public_key: str = PUBLIC_KEY) -> SupabaseAuthProvider:
    # get_signing_key is the injectable seam — real usage fetches this
    # from PyJWKClient against a project's JWKS endpoint; tests supply a
    # known key directly instead of a network fetch.
    return SupabaseAuthProvider(
        project_url="https://test.supabase.co",
        get_signing_key=lambda token: public_key,
    )


def test_valid_token_returns_user_with_subject_as_id() -> None:
    provider = _provider()
    token = _make_token(sub="user-123")

    user = provider.get_user(token)

    assert user.id == "user-123"


def test_missing_token_raises_authentication_error() -> None:
    provider = _provider()

    with pytest.raises(AuthenticationError):
        provider.get_user(None)


def test_token_signed_with_a_different_key_raises_authentication_error() -> None:
    provider = _provider()
    token = _make_token(private_key=_OTHER_PRIVATE_KEY)

    with pytest.raises(AuthenticationError):
        provider.get_user(token)


def test_token_missing_subject_claim_raises_authentication_error() -> None:
    provider = _provider()
    token = jwt.encode({"aud": "authenticated"}, PRIVATE_KEY, algorithm="ES256")

    with pytest.raises(AuthenticationError):
        provider.get_user(token)


def test_expired_token_raises_authentication_error() -> None:
    provider = _provider()
    token = _make_token(exp=1)  # epoch second 1 — long expired

    with pytest.raises(AuthenticationError):
        provider.get_user(token)


def test_malformed_token_raises_authentication_error() -> None:
    provider = _provider()

    with pytest.raises(AuthenticationError):
        provider.get_user("not-a-real-token")
