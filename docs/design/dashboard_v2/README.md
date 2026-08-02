# Dashboard v2 design prototype

The reference design for the portfolio dashboard, and the source of the
behaviour that tickets #13–#29 implement.

## Read this first

| File | What it is |
|---|---|
| [`behaviour.md`](behaviour.md) | **Start here.** The binding behaviour, digested. Acceptance criteria for the dashboard tickets. |
| [`prototype-source.js`](prototype-source.js) | The prototype's actual logic — 640 readable lines. Ground truth when the digest is ambiguous. |
| `portfolio-app-v2.html` | The runnable prototype. 425KB, self-contained, **not readable directly** (two of its lines exceed 300KB). |
| [`extract-prototype.py`](extract-prototype.py) | Regenerates `prototype-source.js` from the HTML. |

Behaviour is **binding**; copy and visuals are **directional**. See
[ADR-0001](../../adr/0001-dashboard-v2.md) § Q2 for why that line was
drawn there.

## Running it

```bash
cd docs/design/dashboard_v2
python3 -m http.server 8899
# then open http://localhost:8899/portfolio-app-v2.html
```

It is a real React app with working state, not a static mockup — you can
drill into accounts, scrub the chart, build search chips and open the
transaction sheet. Its data is generated from a seeded RNG with a frozen
"today" of 2026-08-01, so figures are stable between reloads.

Intended viewport is 438×892 (a phone). At a desktop width it renders in
a centred phone frame.

## Reading the logic

Don't try to read the HTML. Run:

```bash
python3 docs/design/dashboard_v2/extract-prototype.py
```

The HTML is a bundle — a manifest of gzipped base64 payloads (React,
runtime, fonts) plus a JSON-escaped template. The app's own code is an
inline `<script type="text/x-dc">` inside that template, which is what
the script pulls out.

`prototype-source.js` is committed, so you only need this if you suspect
drift. Re-run and diff.

## What the prototype does *not* cover

No screen exists for login, Account creation, Instrument creation,
transaction edit/delete, price loading or failure, or an empty portfolio.
Those were specified during the design interview and live in tickets
#13–#29 — the prototype is silent on them, so don't read its silence as
a decision.

## Where it diverges from what's being built

The prototype predates several decisions and is knowingly wrong in these
places. Follow the docs, not the prototype:

| Prototype | Built |
|---|---|
| Cash unaffected by trades | Trades auto-post a CASH leg ([ADR-0001](../../adr/0001-dashboard-v2.md) § 1) |
| `2Y` maximum range | `Max`, from the earliest Transaction |
| `YTD` hardcoded to 213 days | Computed from Jan 1 |
| Ignores metric/scope mismatches | Resolves them; the API rejects them ([ADR-0001](../../adr/0001-dashboard-v2.md) § 6) |
| Matrix capped at 7 × 4 | Every held instrument; every account holding one |
| Row % is lifetime, header % is range | Both range-scoped; `—` when there's no denominator |
| Search is client-side over mock data | Same grammar, real endpoints |
