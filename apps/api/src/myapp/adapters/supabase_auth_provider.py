from collections.abc import Callable

import jwt
from jwt import PyJWKClient

from myapp.domain.auth import AuthenticationError, AuthProvider
from myapp.domain.model import User


class SupabaseAuthProvider(AuthProvider):
    """Verifies a Supabase-issued JWT and returns its `sub` claim as the
    domain User's id.

    Supabase signs session tokens asymmetrically (ES256, a per-project
    keypair) and publishes the public half at
    `{project_url}/auth/v1/.well-known/jwks.json` — verification needs
    only that public key, never a shared secret. `PyJWKClient` fetches
    and caches it, matched to the token's `kid` header.

    `get_signing_key` is the injectable seam (default: a real
    PyJWKClient's `.get_signing_key_from_jwt(token).key`) — tests supply
    a fake returning a known test public key instead of a real network
    fetch.
    """

    def __init__(
        self,
        project_url: str,
        get_signing_key: Callable[[str], str | bytes] | None = None,
    ) -> None:
        if get_signing_key is not None:
            self._get_signing_key = get_signing_key
        else:
            jwk_client = PyJWKClient(
                f"{project_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            )
            self._get_signing_key = lambda token: (
                jwk_client.get_signing_key_from_jwt(token).key
            )

    def get_user(self, token: str | None) -> User:
        if not token:
            raise AuthenticationError("missing bearer token")

        try:
            key = self._get_signing_key(token)
            payload = jwt.decode(
                token,
                key,
                algorithms=["ES256"],
                audience="authenticated",
            )
        except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
            raise AuthenticationError(str(exc)) from exc

        subject = payload.get("sub")
        if not subject:
            raise AuthenticationError("token missing sub claim")

        return User(id=subject)
