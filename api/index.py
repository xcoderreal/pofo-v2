"""Vercel serverless entry point — re-exports the FastAPI app."""

import sys
from pathlib import Path

# Prioritize packages installed in api/ (via pip install -t api/)
sys.path.insert(0, str(Path(__file__).resolve().parent))
# Add the backend source to the Python path so `myapp` is importable
sys.path.insert(1, str(Path(__file__).resolve().parent.parent / "apps" / "api" / "src"))

from fastapi import FastAPI
from myapp.entrypoints.api import app as _app

# Vercel routes /api/* to this function, passing the full path.
# Mount the original app under /api so routes match.
app = FastAPI()
app.mount("/api", _app)
