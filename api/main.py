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
    # Warm up DB connection on startup
    get_supabase_client()
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
