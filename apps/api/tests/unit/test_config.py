import pytest
from pydantic import ValidationError

from myapp.config import Settings


def test_defaults_are_dev_friendly() -> None:
    settings = Settings(_env_file=None)

    assert settings.env == "development"
    assert settings.auth == "stub"


def test_stub_auth_in_production_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, env="production", auth="stub")


def test_supabase_auth_in_production_is_allowed() -> None:
    settings = Settings(_env_file=None, env="production", auth="supabase")

    assert settings.env == "production"
    assert settings.auth == "supabase"


def test_stub_auth_outside_production_is_allowed() -> None:
    settings = Settings(_env_file=None, env="development", auth="stub")

    assert settings.auth == "stub"
