#!/usr/bin/env python3
"""Re-derive `prototype-source.js` from `portfolio-app-v2.html`.

The HTML is a self-contained bundle: a manifest of gzipped, base64-encoded
payloads (React, a runtime, fonts) plus a JSON-escaped HTML template. The
app's own logic is NOT in the payloads — it is an inline
`<script type="text/x-dc">` inside that template.

Reading the raw HTML is not useful (425KB, two lines of it are 300KB+).
Run this instead, then read the emitted .js.

    python3 docs/design/dashboard_v2/extract-prototype.py

Writes `prototype-source.js` next to the HTML. The committed copy is the
output of this script — if you suspect `behaviour.md` has drifted from the
prototype, re-run and diff rather than trusting either.
"""

import base64
import gzip
import html
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
SOURCE = HERE / "portfolio-app-v2.html"
OUT = HERE / "prototype-source.js"


def main() -> None:
    raw = SOURCE.read_text()

    template_match = re.search(
        r'<script type="__bundler/template">(.*?)</script>', raw, re.S
    )
    if template_match is None:
        raise SystemExit("no bundler template found — has the export format changed?")

    # The template is a JSON string literal containing the real document.
    page = json.loads(template_match.group(1))

    scripts = re.findall(
        r'<script type="text/x-dc"[^>]*>(.*?)</script>', page, re.S
    )
    if not scripts:
        raise SystemExit("no x-dc script found in the template")

    OUT.write_text(html.unescape(scripts[0]))
    print(f"wrote {OUT} ({len(OUT.read_text().splitlines())} lines)")


def _payloads() -> dict[str, bytes]:
    """Unused by the extraction above, kept because it is the only record
    of how the manifest is encoded — needed if a future export moves the
    app logic into a payload rather than the template."""
    raw = SOURCE.read_text()
    manifest = json.loads(
        re.search(r'<script type="__bundler/manifest">(.*?)</script>', raw, re.S).group(1)
    )
    out = {}
    for key, entry in manifest.items():
        data = base64.b64decode(entry["data"])
        if entry.get("compressed"):
            data = gzip.decompress(data)
        out[key] = data
    return out


if __name__ == "__main__":
    main()
