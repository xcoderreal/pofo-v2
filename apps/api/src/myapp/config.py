from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "change-me"
    port: int = 8090

    # "development" (default) allows MYAPP_AUTH=stub. "production" never
    # does — see _guard_stub_auth_in_production below.
    env: Literal["development", "production"] = "development"

    # "stub" (default) returns a fixed dev user — fine for local dev and
    # CI, never for production. "supabase" verifies a real Supabase JWT.
    auth: Literal["stub", "supabase"] = "stub"

    # Required when auth="supabase". Verifies Supabase-issued JWTs.
    supabase_jwt_secret: str | None = None

    # NOTE: MYAPP_REPOSITORY (memory|supabase) + MYAPP_SUPABASE_URL/KEY are
    # deliberately not added here yet — nothing in this codebase constructs
    # a Supabase-backed repository to select between. They land with the
    # first ticket that actually builds one (see docs/environments.md for
    # the full target design), not speculatively ahead of it.

    model_config = {
        "env_file": (".env", ".env.local"),
        "env_prefix": "MYAPP_",
    }

    @model_validator(mode="after")
    def _guard_stub_auth_in_production(self) -> "Settings":
        if self.env == "production" and self.auth == "stub":
            raise ValueError(
                "MYAPP_AUTH=stub is not allowed when MYAPP_ENV=production — "
                "stub auth bypasses Row Level Security via the service-role "
                "key. Set MYAPP_AUTH=supabase for production."
            )
        return self
