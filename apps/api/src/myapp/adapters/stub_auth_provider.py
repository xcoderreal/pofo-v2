from myapp.domain.auth import AuthProvider
from myapp.domain.model import User

DEV_USER_ID = "dev-user"


class StubAuthProvider(AuthProvider):
    """Always returns a fixed development user. Never valid in production —
    see Settings' production/stub guard in config.py."""

    def get_user(self, token: str | None) -> User:
        return User(id=DEV_USER_ID)
