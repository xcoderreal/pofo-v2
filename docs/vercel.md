# Vercel Deployment

Single Vercel project hosts both the static Expo web frontend and the Python FastAPI backend as a serverless function. This doc covers first-time setup, the mental model, common gotchas, and how to e2e test a preview deploy.

## Mental model

```
┌─────────────────────── Vercel project ──────────────────────┐
│                                                             │
│   GET /                    →  static: apps/mobile/dist/     │
│   GET /anything            →  static: apps/mobile/dist/     │
│   GET|POST /api/*          →  serverless: api/index.py      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Routing is controlled by `vercel.json`:

```json
{
  "buildCommand": "pip install -r apps/api/requirements.txt -t api/ && cd apps/mobile && npx expo export --platform web",
  "outputDirectory": "apps/mobile/dist",
  "framework": null,
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }]
}
```

The build does two things:
1. **Pip install backend deps into `api/`.** Vercel's Python runtime bundles whatever sits next to the handler as its dependency closure. `-t api/` targets that directory directly so Linux-compiled binaries end up in the Lambda.
2. **Export the Expo web build** into `apps/mobile/dist/`, which Vercel serves as static assets.

The rewrite rule sends any `/api/*` request to `api/index.py`, which is a thin shim that imports the real FastAPI app from `apps/api/src/myapp/entrypoints/api.py` and mounts it under `/api` so route paths line up.

See [`architecture.md`](architecture.md) for why the `api/` vs `apps/api/` split exists.

## First-time setup

```bash
# 1. Install the CLI once
bun add -g vercel    # or: npm i -g vercel

# 2. Log in (opens browser)
vercel login

# 3. Link this repo to a Vercel project
vercel link
#   scope         → your account
#   link existing → N (first time) or Y (linking to an existing project)
#   project name  → turbo-skeleton (or whatever)
```

`vercel link` creates `.vercel/project.json` containing `orgId` and `projectId`. This file is gitignored — each developer links their own clone.

## Environment variables

The skeleton has no required runtime secrets. `MYAPP_SECRET_KEY` in `apps/api/src/myapp/config.py` is scaffolding and nothing reads it.

When you *do* add a secret your code reads:

```bash
# Local dev
cp .env.sample .env       # .env is gitignored
# edit .env with real values

# Push to Vercel per environment
vercel env add MYAPP_FOO production
vercel env add MYAPP_FOO preview
vercel env add MYAPP_FOO development

# Pull Vercel's values into .env.local for use with `vercel dev`
vercel env pull .env.local
```

### Naming convention

The backend uses `pydantic-settings` with `env_prefix = "MYAPP_"`. Any env var you want the backend to read must start with that prefix. When you rename the project, update the prefix in `config.py` and all your env var names accordingly.

The frontend uses Expo's `EXPO_PUBLIC_*` prefix for inlined-at-build-time env vars. Only vars starting with `EXPO_PUBLIC_` are exposed to the web/mobile bundle — anything else stays server-side.

## Deploy commands

```bash
vercel            # deploy a preview (unique URL per deploy)
vercel --prod     # deploy to production (your configured domain)
```

## E2E test against a preview deploy

```bash
# 1. Deploy a preview
vercel
# → prints a URL like https://turbo-skeleton-abc123-you.vercel.app

# 2. Smoke test the deployed API
export URL=https://turbo-skeleton-abc123-you.vercel.app

curl $URL/api/health
# → {"status":"ok"}

curl -X POST $URL/api/items \
  -H "Content-Type: application/json" \
  -d '{"id":"hello","name":"Hello World","description":"deployed","tags":["welcome"]}'
# → {"id":"hello",...}

curl $URL/api/items
# → [{"id":"hello",...}]

# 3. Open $URL in a browser — the frontend should render the item
```

**Caveat: serverless cold starts wipe the in-memory repo.** The default `MemoryItemRepository` lives in RAM inside a single Lambda invocation. Between requests, Vercel may spin up a fresh function instance and your POSTed items disappear. For anything beyond a smoke test, swap in a real adapter (SQLite-on-disk won't work either — Lambdas have ephemeral storage — use Postgres, Supabase, Turso, Upstash Redis, etc.).

## CI auto-deploy

`.github/workflows/deploy-backend.yml` runs `vercel --prod` on every push to `main` that touches `apps/api/**`. For it to work, set these in GitHub → Settings → Secrets → Actions:

| Secret | Where to find it |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens — create a new token |
| `VERCEL_ORG_ID` | `.vercel/project.json` after running `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after running `vercel link` |

The workflow only runs on backend changes. Frontend changes deploy via Vercel's Git integration (if enabled in the dashboard), or manually via `vercel --prod`.

## Gotchas

### 1. Dual dependency files (backend)

Backend deps live in **two places**:

| File | Used by | Format |
|---|---|---|
| `apps/api/pyproject.toml` | Local dev (`uv sync`) | PEP 621 |
| `apps/api/requirements.txt` | Vercel build (`pip install -t api/`) | pip |

When you add a backend dependency, **add it to both**. UV doesn't auto-generate `requirements.txt`, and Vercel's Python runtime doesn't understand `pyproject.toml` with UV lockfiles.

A future `just vercel-sync` recipe could derive `requirements.txt` from `uv export`, but it's not wired up yet — keep them in sync by hand for now.

### 2. Use `npx expo export`, not `bunx --bun expo export`

Metro doesn't exit cleanly when run through bun's Node replacement. The Vercel build command uses `npx expo export` for this reason. Don't "optimize" it to bunx — builds will hang.

### 3. Node.js version

Vercel requires **Node.js 22.x**. Node 24.x is not yet supported by all Expo/Metro plugins. If you see strange build errors, check the Vercel project's Node version setting (Settings → General → Node.js Version).

### 4. First request after deploy is slow

Python cold starts on Vercel take 1–3 seconds. Subsequent requests (to a warm Lambda) are fast. This is normal for serverless Python and not something to debug.

### 5. CORS is wide open

`apps/api/src/myapp/entrypoints/api.py` sets `allow_origins=["*"]` — fine for development and same-origin production (where frontend and API share the Vercel domain), but lock it down before exposing the API to untrusted clients.

### 6. The `api/` directory pollution on local Vercel builds

If you run `vercel build` locally, pip installs packages *into* `api/` — same as the production build. These are gitignored via patterns in `.gitignore` (`api/fastapi/`, `api/pydantic/`, etc.), but if you add a new backend dep, add its install directory to `.gitignore` too.

## Moving off Vercel later

If you outgrow Vercel, the parts to replace:

| Vercel piece | Replacement |
|---|---|
| `api/index.py` shim | Delete — deploy `apps/api/` directly as a container |
| `vercel.json` | Dockerfile + platform config (Fly, Railway, Modal, Render) |
| Static frontend hosting | Cloudflare Pages, Netlify, S3+CloudFront, etc. |
| `deploy-backend.yml` | Platform-specific deploy action |

The backend (`apps/api/`) and frontend (`apps/mobile/`) themselves don't need changes — only the deployment layer does. This is the benefit of keeping Vercel-specific code isolated to `api/index.py` and `vercel.json`.
