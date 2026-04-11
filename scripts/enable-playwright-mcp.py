#!/usr/bin/env python3
"""Whitelist Playwright MCP browser tools in .claude/settings.json.

Usage:
    scripts/enable-playwright-mcp.py

Idempotent — running it twice has no effect. Reads the existing
.claude/settings.json, adds the Playwright MCP tool names to the
permissions.allow list if they're not already there, writes the file back.

The Playwright MCP server (@playwright/mcp) must be installed separately
in your Claude Code environment — this script does NOT install it. It only
grants this project permission to call the tools once they're available.

See docs/philosophy.md § "MCP vs test tier" for when to use this.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Canonical tool names exposed by @playwright/mcp at the time of writing.
# Add more here if the MCP server adds new tools you want to allow.
MCP_PLAYWRIGHT_TOOLS = [
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_navigate_back",
    "mcp__playwright__browser_snapshot",
    "mcp__playwright__browser_click",
    "mcp__playwright__browser_type",
    "mcp__playwright__browser_fill_form",
    "mcp__playwright__browser_select_option",
    "mcp__playwright__browser_press_key",
    "mcp__playwright__browser_hover",
    "mcp__playwright__browser_drag",
    "mcp__playwright__browser_evaluate",
    "mcp__playwright__browser_console_messages",
    "mcp__playwright__browser_network_requests",
    "mcp__playwright__browser_take_screenshot",
    "mcp__playwright__browser_wait_for",
    "mcp__playwright__browser_resize",
    "mcp__playwright__browser_tabs",
    "mcp__playwright__browser_close",
    "mcp__playwright__browser_install",
]


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    settings_path = repo / ".claude" / "settings.json"

    if not settings_path.exists():
        print(f"error: {settings_path} does not exist", file=sys.stderr)
        return 1

    raw = settings_path.read_text()
    try:
        settings = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"error: {settings_path} is not valid JSON: {e}", file=sys.stderr)
        return 1

    permissions = settings.setdefault("permissions", {})
    allow = permissions.setdefault("allow", [])

    added: list[str] = []
    for tool in MCP_PLAYWRIGHT_TOOLS:
        if tool not in allow:
            allow.append(tool)
            added.append(tool)

    if not added:
        print("No changes — all Playwright MCP tools are already whitelisted.")
        return 0

    # Re-serialize with 2-space indent matching the existing file style.
    settings_path.write_text(json.dumps(settings, indent=2) + "\n")

    print(f"Whitelisted {len(added)} Playwright MCP tool(s) in {settings_path.relative_to(repo)}:")
    for tool in added:
        print(f"  + {tool}")
    print()
    print("You still need to install @playwright/mcp in your Claude Code")
    print("environment for these tools to actually exist. Example:")
    print()
    print("  claude mcp add playwright npx -- @playwright/mcp@latest")
    print()
    print("See docs/philosophy.md § 'MCP vs test tier' for when to use MCP")
    print("(in-session interactive debugging) vs the test tier (deterministic")
    print("regression gate in just verify).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
