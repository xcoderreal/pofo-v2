"""Integration tier fixtures.

This is the only tier that constructs the real app in-process (via
`TestClient(app)`, triggering its `lifespan` and an unfiltered
`Settings()`) without spawning a subprocess — smoke/e2e spawn a managed
subprocess instead, so they're naturally isolated from this process's
state. Without the fixture below, a developer's local `.env.local` (e.g.
`MYAPP_AUTH=supabase`, set for manual testing per docs/environments.md)
silently changes which integration tests pass, making `just verify`
non-deterministic depending on what's in a gitignored file nobody else
can see.
"""

import pytest

from myapp.config import Settings


@pytest.fixture(autouse=True)
def _isolate_from_local_env_files(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every Settings() constructed during this tier ignores .env/.env.local
    — falls back to real os.environ (still controllable via
    monkeypatch.setenv within a specific test) and field defaults only."""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
