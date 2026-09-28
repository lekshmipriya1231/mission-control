"""
Mission Control v1.0 — backend service.
Retro NASA-style terminal for live space data.

Architecture:
    Browser (terminal UI)  --HTTP-->  this FastAPI service  --HTTP-->  Open Notify / NASA APIs

Why a backend at all?
    * Open Notify sends no CORS headers, so browsers cannot call it directly.
    * NASA DEMO_KEY is rate-limited; we cache responses and let teams swap in a free key.
    * All upstream failures are converted into friendly 502s the UI can render.

Run:  uvicorn app:app --reload   (from this directory)
"""

from __future__ import annotations

import os
import time
from datetime import date, timedelta

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# --------------------------------------------------------------------------- config

NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")  # free key: https://api.nasa.gov
OPEN_NOTIFY = "http://api.open-notify.org"
NASA = "https://api.nasa.gov"

app = FastAPI(title="Mission Control", version="1.0.0", docs_url=None, redoc_url=None)

# --------------------------------------------------------------------------- caching
# Tiny TTL cache — good enough for a hackathon, no Redis needed.
_cache: dict[str, tuple[float, object]] = {}


async def fetch_json(url: str, params: dict | None = None, ttl: int = 60) -> dict:
    """GET JSON with TTL caching. Any failure -> friendly 502."""
    key = f"{url}?{params}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]  # type: ignore[return-value]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Deep-space relay unreachable. The data source may be down — try again shortly.",
        )

    _cache[key] = (time.time(), data)
    return data


# --------------------------------------------------------------------------- data sources

async def get_iss() -> dict:
    data = await fetch_json(f"{OPEN_NOTIFY}/iss-now.json", ttl=5)  # ISS moves fast
    pos = data["iss_position"]
    return {
        "latitude": float(pos["latitude"]),
        "longitude": float(pos["longitude"]),
        "timestamp": data.get("timestamp", int(time.time())),
    }


async def get_crew() -> dict:
    data = await fetch_json(f"{OPEN_NOTIFY}/astros.json", ttl=300)
    return {
        "count": data["number"],
        "people": data["people"],
    }


async def get_apod() -> dict:
    data = await fetch_json(
        f"{NASA}/planetary/apod", params={"api_key": NASA_API_KEY}, ttl=3600
    )
    # Keep only what the UI needs; some APODs are videos.
    return {
        "title": data.get("title", "Untitled"),
        "explanation": data.get("explanation", ""),
        "url": data.get("url", ""),
        "media_type": data.get("media_type", "image"),
        "date": data.get("date", ""),
    }


async def get_asteroids() -> dict:
    today = date.today()
    data = await fetch_json(
        f"{NASA}/neo/rest/v1/feed",
        params={
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=7)).isoformat(),
            "api_key": NASA_API_KEY,
        },
        ttl=600,
    )
    # Flatten the per-day buckets into one distance-sorted list — easier for UI/diary/danger.
    rocks = []
    for day in data.get("near_earth_objects", {}).values():
        for a in day:
            cad = a["close_approach_data"][0]
            rocks.append({
                "name": a["name"].lstrip("(").rstrip(")"),
                "date": cad["close_approach_date"],
                "diameter_m": round(
                    a["estimated_diameter"]["meters"]["estimated_diameter_max"]
                ),
                "speed_kmh": round(
                    float(cad["relative_velocity"]["kilometers_per_hour"])
                ),
                "distance_km": round(float(cad["miss_distance"]["kilometers"])),
                "hazardous": a["is_potentially_hazardous_asteroid"],
            })
    rocks.sort(key=lambda r: r["distance_km"])
    return {"count": len(rocks), "asteroids": rocks}


# --------------------------------------------------------------------------- API routes

@app.get("/api/iss")
async def api_iss():
    return await get_iss()


@app.get("/api/crew")
async def api_crew():
    return await get_crew()


@app.get("/api/apod")
async def api_apod():
    return await get_apod()


@app.get("/api/asteroids")
async def api_asteroids():
    return await get_asteroids()


@app.get("/api/danger")
async def api_danger():
    """Closest / most hazardous rock this week, with a labelled danger level."""
    rocks = (await get_asteroids())["asteroids"]
    if not rocks:
        raise HTTPException(status_code=404, detail="No asteroid data available this week.")

    def score(r: dict) -> float:
        proximity = 1e7 / max(r["distance_km"], 1)          # closer = higher
        size = r["diameter_m"] / 100.0                      # bigger = higher
        speed = r["speed_kmh"] / 1e5                        # faster = higher
        hazard = 2.0 if r["hazardous"] else 0.0             # NASA flag = big bonus
        return proximity + size + speed + hazard

    worst = max(rocks, key=score)
    if worst["distance_km"] < 1_000_000 or worst["hazardous"]:
        level = "HIGH"
    elif worst["distance_km"] < 5_000_000:
        level = "MODERATE"
    else:
        level = "LOW"
    return {**worst, "danger_level": level}


@app.get("/api/diary")
async def api_diary():
    """Cosmo Polo's travel diary — templated story from TODAY's real data (no AI needed)."""
    iss, crew = await get_iss(), await get_crew()
    rocks = (await get_asteroids())["asteroids"]
    count = crew["count"]
    ships = sorted({p["craft"] for p in crew["people"]})
    closest = rocks[0] if rocks else None

    lat, lon = iss["latitude"], iss["longitude"]
    lat_dir = "north" if lat >= 0 else "south"
    lon_dir = "east" if lon >= 0 else "west"

    rock_line = (
        f"I registered {closest['name']} sliding past at {closest['distance_km']:,} km "
        f"- a {closest['diameter_m']} m wanderer doing {closest['speed_kmh']:,} km/h."
        if closest else "The asteroid lanes were quiet today."
    )

    story = "\n".join([
        f"CAPTAIN'S LOG - {date.today():%d %b %Y} | Cosmo Polo, aboard the Asteria",
        "--------------------------------------------------------------",
        f"Today I watched the ISS trace its silver thread at "
        f"{abs(lat):.2f} deg {lat_dir}, {abs(lon):.2f} deg {lon_dir}, while "
        f"{count} souls circled overhead aboard {', '.join(ships)}. "
        f"{rock_line} "
        f"The void was generous today. Tomorrow, the next horizon.",
    ])
    return {"entry": story}


# --------------------------------------------------------------------------- static UI

@app.get("/")
async def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
