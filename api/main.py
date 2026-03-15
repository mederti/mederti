"""
Mederti API — FastAPI application entry point
─────────────────────────────────────────────
Run locally:
    uvicorn api.main:app --reload --port 8000

Endpoints:
    GET /health
    GET /search?q=amoxicillin
    GET /drugs/{drug_id}
    GET /drugs/{drug_id}/shortages
    GET /drugs/{drug_id}/alternatives
    GET /shortages?country=AU&status=active&severity=critical&page=1&page_size=50
    GET /sources
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import drugs, shortages, search, sources, summary, data_quality, recalls, intelligence_sources
from backend.utils.db import get_supabase_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Client is lazily created on first request (sync context)
    # to avoid httpx threading issues when created in async lifespan
    yield


app = FastAPI(
    title="Mederti API",
    description="Global pharmaceutical shortage intelligence — REST API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(search.router,          prefix="/search",             tags=["Search"])
app.include_router(drugs.router,           prefix="/drugs",              tags=["Drugs"])
app.include_router(shortages.router,       prefix="/shortages",          tags=["Shortages"])
app.include_router(summary.router,         prefix="/shortages/summary",  tags=["Summary"])
app.include_router(sources.router,         prefix="/sources",            tags=["Sources"])
app.include_router(data_quality.router,    prefix="/health/data-quality", tags=["Health"])
app.include_router(recalls.router,         prefix="/recalls",             tags=["Recalls"])
app.include_router(intelligence_sources.router, prefix="/intelligence-sources", tags=["Intelligence Sources"])


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}


@app.get("/health/db", tags=["Health"])
def health_db():
    """Test Supabase connectivity — raw httpx call bypassing SDK."""
    import os
    import httpx
    import traceback

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    result = {
        "supabase_url_set": bool(url),
        "supabase_url_preview": url[:40] + "..." if len(url) > 40 else url,
        "service_key_set": bool(key),
        "service_key_length": len(key),
    }

    # Test 1: raw httpx call to PostgREST
    try:
        resp = httpx.get(
            f"{url}/rest/v1/data_sources?select=id&limit=1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            timeout=10.0,
        )
        result["raw_httpx_status"] = resp.status_code
        result["raw_httpx_rows"] = len(resp.json()) if resp.status_code == 200 else None
        result["raw_httpx_ok"] = resp.status_code == 200
    except Exception as e:
        result["raw_httpx_ok"] = False
        result["raw_httpx_error"] = str(e)

    # Test 2: new lightweight client
    try:
        db = get_supabase_client()
        resp2 = db.table("data_sources").select("id").limit(1).execute()
        result["client_ok"] = True
        result["client_rows"] = len(resp2.data or [])
    except Exception as e:
        result["client_ok"] = False
        result["client_error"] = str(e)
    return result
