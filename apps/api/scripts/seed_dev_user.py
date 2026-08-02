#!/usr/bin/env python3
"""Re-provisions the fixed local-dev Supabase Auth login after a
`supabase db reset` — a known, stable email/password/id, so
"supabase + supabase" mode (docs/environments.md) never needs manual
recreation through the Studio dashboard after every reset.

Idempotent: running this twice in a row leaves the same login working
both times. There's no need to check for an existing user first — a
duplicate create attempt fails with 422 "email_exists", which this
treats as an already-provisioned signal and looks up the existing id.
Same shape as CashService._ensure_cash_instrument's
get-then-create-if-missing pattern, just via the error path instead of
a lookup-first, since the Admin API doesn't offer an upsert.

Discovers the local stack's URL and secret key from `supabase status
-o json` — no env vars to set. `just supabase-reset-dev` is the single
command for the steady-state case (the stack you're already developing
against); it does NOT start the stack itself, since re-running
`supabase start` against an already-started one isn't idempotent (fails
on a port conflict) — so a cold start still needs `supabase start` run
once, separately, first. This is deliberately local-only: it always
talks to whatever `supabase status` reports for the current project
directory. Never point this at a hosted project — see
MYAPP_SUPABASE_TEST_* (tests/rls/conftest.py) for the pattern that
talks to a real remote project safely, via explicit, clearly-scoped env
vars instead of CLI auto-discovery.

Usage:
    cd apps/api && uv run python scripts/seed_dev_user.py
    (or: just supabase-reset-dev, which chains a db reset first;
     or: just seed-dev-user, to re-provision without a full reset)
"""

from __future__ import annotations

import json
import subprocess
import sys

import httpx

DEV_USER_ID = "00000000-0000-0000-0000-000000000001"
DEV_EMAIL = "dev@example.com"
DEV_PASSWORD = "dev-password-not-for-prod-1!"


def _local_supabase_status() -> dict[str, str]:
    result = subprocess.run(
        ["supabase", "status", "-o", "json"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(
            "supabase status failed — is the local stack running?\n"
            "Run `supabase start` from apps/api first.\n\n" + result.stderr
        )
    return json.loads(result.stdout)


def _admin_headers(secret_key: str) -> dict[str, str]:
    return {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}


def seed_dev_user() -> str:
    status = _local_supabase_status()
    url = status["API_URL"]
    secret_key = status["SECRET_KEY"]
    headers = _admin_headers(secret_key)

    create = httpx.post(
        f"{url}/auth/v1/admin/users",
        headers=headers,
        json={
            "id": DEV_USER_ID,
            "email": DEV_EMAIL,
            "password": DEV_PASSWORD,
            "email_confirm": True,
        },
        timeout=10,
    )
    if create.status_code == 422 and create.json().get("error_code") == "email_exists":
        existing = httpx.get(
            f"{url}/auth/v1/admin/users",
            headers=headers,
            params={"email": DEV_EMAIL},
            timeout=10,
        )
        existing.raise_for_status()
        return existing.json()["users"][0]["id"]

    create.raise_for_status()
    return create.json()["id"]


if __name__ == "__main__":
    user_id = seed_dev_user()
    print(f"Dev user ready: {DEV_EMAIL} / {DEV_PASSWORD} (id={user_id})")
