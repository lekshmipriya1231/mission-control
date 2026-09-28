# MISSION CONTROL v1.0

A retro 1980s NASA-style terminal for live space data — built for TatHack '26 (Open Challenge, Asteria theme).

Type commands, get live data from orbit. Green (or amber) phosphor, monospace, boot sequence and all.

## Quick start

```bash
cd mission-control
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # optional: put a free NASA key in NASA_API_KEY
uvicorn app:app --reload
```

Open **http://localhost:8000**

> Works with NASA's `DEMO_KEY` out of the box (30 req/hr). Grab a free key at
> https://api.nasa.gov and `export NASA_API_KEY=...` for hackathon-day headroom.

## Commands

| Command      | What it does                                                        |
|--------------|---------------------------------------------------------------------|
| `help`       | List all commands                                                    |
| `iss`        | ISS lat/lon + ASCII world map                                        |
| `iss track`  | Live ISS tracking, map refreshes every 3s (`stop` to end)           |
| `crew`       | People currently in space, grouped by spacecraft                     |
| `apod`       | NASA Astronomy Picture of the Day                                    |
| `asteroids`  | Near-Earth objects for the next 7 days                               |
| `danger`     | This week's most dangerous rock, labelled LOW / MODERATE / HIGH      |
| `diary`      | Cosmo Polo's captain's log, generated from *today's* real data       |
| `theme green` / `theme amber` | Switch CRT color scheme                     |
| `clear`      | Clear the screen                                                     |

## Architecture

```
Browser (terminal.js, zero deps)  ──►  FastAPI backend (app.py)  ──►  Open Notify / NASA APIs
        DOM + <canvas> map                TTL cache, friendly 502s
```

The backend exists because Open Notify sends no CORS headers (browsers can't call
it directly) and NASA's demo key needs rate-limit headroom. All upstream failures
become friendly error lines in the terminal — the UI never crashes.

## Cosmo Polo tie-in (theme)

Cosmo Polo, the cosmic explorer of Asteria '26, logs every session: `diary`
renders his captain's log assembled from today's real ISS position, crew count,
and closest asteroid. No AI needed — string templates, real telemetry.

## Ideas for Part 2 (if time permits)

- Sound: WebAudio beeps on keystroke / command success
- `passes <city>`: ISS flyover predictions from Open Notify
- Persistence: save diary entries to localStorage, `diary --history`
- CRT flicker toggle, fullscreen "big board" mode for judges
