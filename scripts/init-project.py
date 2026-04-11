#!/usr/bin/env python3
"""Rename the turbo-skeleton placeholder 'myapp' to a new project name.

Usage:
    scripts/init-project.py <slug> [--dry-run]

The slug must be a valid Python identifier (letters, digits, underscores,
not starting with a digit) and must not be 'myapp'.

Example:
    scripts/init-project.py my_app
    scripts/init-project.py my_app --dry-run

Derived names:
    Python package:      my_app       (apps/api/src/my_app/)
    Env var prefix:      MY_APP_      (pydantic-settings)
    Expo slug:           my_app       (app.json)
    iOS bundle id:       com.my_app.app
    Display name:        My App       (Title-cased, underscores → spaces)
    Root package name:   my-app       (dashes for npm/bun)

How it finds files to rewrite:
    1. Recursively scans SCAN_DIRS for any text file matching TEXT_EXTENSIONS
       (skipping __pycache__, .venv, node_modules).
    2. Adds the top-level SCAN_FILES (root configs that live outside SCAN_DIRS).
    3. Excludes NEVER_SCAN paths — docs and this script itself contain
       "myapp" as placeholder documentation and must NOT be rewritten.

This is a glob-based discovery instead of a hand-curated list, so new
files added to the skeleton (new test tiers, new modules) are picked up
automatically without editing this script.

What the script does NOT touch:
    - README.md, CLAUDE.md, docs/** — these describe the "myapp" convention
    - scripts/init-project.py itself — self-rewrites break the script
    - bun.lock, uv.lock — regenerate via install, not substitution
    - Anything under __pycache__, .venv, node_modules, .git

Prefer running this via `just new-project <slug>`, which chains the
rename + install + lint-fix + verify into one command.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Directories to recursively scan for renameable content.
SCAN_DIRS = [
    "apps/api/src",  # backend source (all layers)
    "apps/api/tests",  # backend tests (all tiers — unit/integration/smoke/e2e)
    "apps/mobile/app",  # frontend expo-router routes
    "apps/mobile/lib",  # frontend libs (api client, env resolution)
]

# Individual files to also scan — top-level configs that live outside SCAN_DIRS.
SCAN_FILES = [
    "package.json",
    "justfile",
    "api/index.py",
    "apps/api/.env.sample",
    "apps/mobile/.env.sample",
    "apps/api/pyproject.toml",
    "apps/api/package.json",
    "apps/mobile/package.json",
    "apps/mobile/app.json",
]

# File extensions we're willing to scan. Keeps us away from binaries and
# lockfiles even if they happen to live inside a SCAN_DIR.
TEXT_EXTENSIONS = {".py", ".ts", ".tsx", ".json", ".toml", ".yml", ".yaml"}

# Paths to ALWAYS skip. These contain "myapp" as documentation of the
# placeholder convention and rewriting them would break the docs.
NEVER_SCAN = {
    "CLAUDE.md",
    "README.md",
    "scripts/init-project.py",
}

# Substring filters — any path containing one of these is skipped.
NEVER_SCAN_SUBSTRINGS = ("__pycache__", ".venv", "node_modules", ".git/")


def collect_files(repo: Path) -> list[str]:
    """Discover all files that should be scanned for text substitution."""
    found: set[str] = set(SCAN_FILES)
    for scan_dir in SCAN_DIRS:
        base = repo / scan_dir
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in TEXT_EXTENSIONS:
                continue
            rel = str(path.relative_to(repo))
            if rel in NEVER_SCAN:
                continue
            if any(s in rel for s in NEVER_SCAN_SUBSTRINGS):
                continue
            found.add(rel)
    return sorted(found)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rename the 'myapp' placeholder to a new project slug",
    )
    parser.add_argument(
        "slug",
        help="New project slug (valid Python identifier, not 'myapp')",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without modifying any files",
    )
    args = parser.parse_args()

    slug = args.slug
    if not slug.isidentifier():
        print(
            f"error: {slug!r} is not a valid Python identifier "
            "(letters, digits, underscores; not starting with a digit)",
            file=sys.stderr,
        )
        return 1
    if slug == "myapp":
        print(
            "error: slug 'myapp' is the placeholder — pick something else",
            file=sys.stderr,
        )
        return 1

    repo = Path(__file__).resolve().parent.parent
    env_prefix = slug.upper() + "_"
    display_name = slug.replace("_", " ").title()
    dashed = slug.replace("_", "-")

    # Order matters: more specific patterns before less specific.
    # "MYAPP_" must be replaced before "myapp" (case-sensitive, but we
    # keep the order explicit to be safe against future patterns).
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
    if args.dry_run:
        print("  (dry run — no files will be modified)")
    print()

    files_to_scan = collect_files(repo)
    print(f"Scanning {len(files_to_scan)} file(s)…")
    print()

    changed = 0
    for rel in files_to_scan:
        path = repo / rel
        if not path.exists():
            # Can happen for SCAN_FILES entries in a stripped-down skeleton
            continue
        try:
            original = path.read_text()
        except UnicodeDecodeError:
            # A binary file slipped through the extension filter — skip
            continue
        text = original
        for old, new in replacements:
            text = text.replace(old, new)
        if text != original:
            if args.dry_run:
                print(f"  would update: {rel}")
            else:
                path.write_text(text)
                print(f"  updated: {rel}")
            changed += 1

    # Rename the Python package directory last, after all text edits land.
    old_pkg = repo / "apps" / "api" / "src" / "myapp"
    new_pkg = repo / "apps" / "api" / "src" / slug
    if old_pkg.exists():
        if new_pkg.exists():
            print(f"error: {new_pkg} already exists", file=sys.stderr)
            return 1
        if args.dry_run:
            print(f"  would rename: apps/api/src/myapp → apps/api/src/{slug}")
        else:
            old_pkg.rename(new_pkg)
            print(f"  renamed:  apps/api/src/myapp → apps/api/src/{slug}")
        changed += 1
    elif new_pkg.exists():
        print(f"  (package directory already named {slug})")
    else:
        print(
            "error: apps/api/src/myapp not found — is this a fresh skeleton?",
            file=sys.stderr,
        )
        return 1

    if args.dry_run:
        print()
        print(f"Dry run complete. {changed} change(s) would be applied.")
        return 0

    print()
    print(f"Done. {changed} file(s) updated.")
    print()
    print("Next steps:")
    print("  - Review the diff:           git diff")
    print(
        "  - (Optional) Detach history: rm -rf .git && git init && "
        "git add -A && git commit -m 'init'"
    )
    print("  - (Optional) Env overrides:  cp apps/api/.env.sample    apps/api/.env.local")
    print("                                cp apps/mobile/.env.sample apps/mobile/.env.local")
    print()
    print("If you ran this script standalone (not via `just new-project`), also run:")
    print("  just install && just lint-api-fix && just verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
