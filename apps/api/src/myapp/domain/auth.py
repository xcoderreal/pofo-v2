from abc import ABC, abstractmethod

from myapp.domain.model import User


class AuthenticationError(Exception):
    """A token could not be resolved to a valid user."""


class AuthProvider(ABC):
    @abstractmethod
    def get_user(self, token: str | None) -> User:
        """Resolve a bearer token (or None) to a User.

        Raises AuthenticationError if the token is missing, invalid, or
        expired.
        """
        ...
