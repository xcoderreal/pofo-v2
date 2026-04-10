#!/usr/bin/env python3
"""Rename the turbo-skeleton placeholder 'myapp' to a new project name.

Usage:
    scripts/init-project.py <slug>

The slug must be a valid Python identifier (letters, digits, underscores,
not starting with a digit) and must not be 'myapp'.

Example:
    scripts/init-project.py my_app

Derived names:
    Python package:      my_app       (apps/api/src/my_app/)
    Env var prefix:      MY_APP_      (pydantic-settings)
    Expo slug:           my_app       (app.json)
    iOS bundle id:       com.my_app.app
    Display name:        My App       (Title-cased, underscores → spaces)
    Root package name:   my-app       (dashes for npm/bun)

The script:
    1. Does plain text substitution in a fixed list of config/source files.
    2. Renames apps/api/src/myapp/ to apps/api/src/<slug>/.
    3. Prints a short "next steps" guide.

It does NOT touch README.md or docs/ — those are content, not mechanical
renames. Review and edit them by hand after running this.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Files where text substitution is safe (configs, source, tests).
FILES = [
    "package.json",
    "justfile",
    ".env.sample",
    "api/index.py",
    "apps/api/pyproject.toml",
    "apps/api/package.json",
    "apps/api/src/myapp/__init__.py",
    "apps/api/src/myapp/config.py",
    "apps/api/src/myapp/domain/__init__.py",
    "apps/api/src/myapp/domain/model.py",
    "apps/api/src/myapp/domain/repository.py",
    "apps/api/src/myapp/service/__init__.py",
    "apps/api/src/myapp/service/item_service.py",
    "apps/api/src/myapp/adapters/__init__.py",
    "apps/api/src/myapp/adapters/memory_repository.py",
    "apps/api/src/myapp/entrypoints/__init__.py",
    "apps/api/src/myapp/entrypoints/api.py",
    "apps/api/tests/__init__.py",
    "apps/api/tests/fake_repository.py",
    "apps/api/tests/test_api.py",
    "apps/api/tests/test_item_service.py",
    "apps/mobile/package.json",
    "apps/mobile/app.json",
]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: scripts/init-project.py <slug>", file=sys.stderr)
        return 2

    slug = sys.argv[1]
    if not slug.isidentifier():
        print(
            f"error: {slug!r} is not a valid Python identifier "
            "(letters, digits, underscores; not starting with a digit)",
            file=sys.stderr,
        )
        return 1
    if slug == "myapp":
        print("error: slug 'myapp' is the placeholder — pick something else", file=sys.stderr)
        return 1

    repo = Path(__file__).resolve().parent.parent
    env_prefix = slug.upper() + "_"
    display_name = slug.replace("_", " ").title()
    dashed = slug.replace("_", "-")

    # Order matters: more specific patterns before less specific.
    # "MYAPP_" must be replaced before "myapp" (case-sensitive, no overlap here,
    # but we keep the order explicit).
    replacements = [
        ("MYAPP_", env_prefix),
        ("My App", display_name),
        ("turbo-skeleton", dashed),
        ("myapp", slug),
    ]

    print(f"Renaming 'myapp' → {slug!r} …")
    print(f"  env prefix:   {env_prefix}")
    print(f"  display name: {display_name}")
    print(f"  root pkg:     {dashed}")
    print()

    changed = 0
    for rel in FILES:
        path = repo / rel
        if not path.exists():
            print(f"  skip (missing): {rel}")
            continue
        original = path.read_text()
        text = original
        for old, new in replacements:
            text = text.replace(old, new)
        if text != original:
            path.write_text(text)
            print(f"  updated: {rel}")
            changed += 1

    # Rename the Python package directory last, after all text edits.
    old_pkg = repo / "apps" / "api" / "src" / "myapp"
    new_pkg = repo / "apps" / "api" / "src" / slug
    if old_pkg.exists():
        if new_pkg.exists():
            print(f"error: {new_pkg} already exists", file=sys.stderr)
            return 1
        old_pkg.rename(new_pkg)
        print(f"  renamed:  apps/api/src/myapp → apps/api/src/{slug}")
        changed += 1
    elif new_pkg.exists():
        print(f"  (package directory already named {slug})")
    else:
        print("error: apps/api/src/myapp not found — is this a fresh skeleton?", file=sys.stderr)
        return 1

    print()
    print(f"Done. {changed} file(s) updated.")
    print()
    print("Next steps:")
    print("  1. Review the diff:        git diff")
    print("  2. Edit README.md and docs/ by hand (content, not mechanical)")
    print("  3. Detach from skeleton:   rm -rf .git && git init && git add -A && git commit -m 'init'")
    print("  4. Reinstall dependencies: just install")
    print("  5. Verify everything:      just test && just check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
