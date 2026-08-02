import jwt

from myapp.domain.auth import AuthenticationError, AuthProvider
from myapp.domain.model import User


class SupabaseAuthProvider(AuthProvider):
    """Verifies a Supabase-issued JWT (HS256, shared secret) and returns its
    `sub` claim as the domain User's id."""

    def __init__(self, jwt_secret: str) -> None:
        self._jwt_secret = jwt_secret

    def get_user(self, token: str | None) -> User:
        if not token:
            raise AuthenticationError("missing bearer token")

        try:
            payload = jwt.decode(
                token,
                self._jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except jwt.InvalidTokenError as exc:
            raise AuthenticationError(str(exc)) from exc

        subject = payload.get("sub")
        if not subject:
            raise AuthenticationError("token missing sub claim")

        return User(id=subject)
