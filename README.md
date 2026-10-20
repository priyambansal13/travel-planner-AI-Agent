# Yatra AI — Travel Planning Multi-Agent System

An end-to-end, AI-powered travel planner for trips **within India**. A **LangGraph** supervisor coordinates
specialist agents (destination research, accommodation, transport, itinerary) that call **India-focused data
sources**, and a response aggregator assembles a personalised, budgeted plan that you refine by chat.

| Layer | Technology |
|---|---|
| Frontend | **Next.js 16.4** (App Router, React 19, Tailwind CSS v4), `@ag-ui/client`, Leaflet + OpenStreetMap |
| Agent ↔ UI protocol | **AG-UI** (Agent–User Interaction protocol) over Server-Sent Events |
| Backend | **NestJS 12** (ESM, TypeScript), REST + AG-UI + Socket.IO, **Swagger / OpenAPI** |
| Agents | **LangGraph.js 1.5** `StateGraph`, LangChain core 1.x, **OpenAI** (`gpt-4.1` by default) |
| Persistence | **PostgreSQL 17** (Docker): TypeORM (trips) + LangGraph Postgres checkpointer (agent memory) |
| Observability | LangSmith tracing (optional), per-run agent/tool traces stored in Postgres, Nest logs |

---

## Contents
1. [Quick start](#1-quick-start)
2. [Local URLs](#2-local-urls)
3. [Architecture](#3-architecture)
4. [Agents & tools](#4-agents--tools)
5. [External APIs used (all URLs)](#5-external-apis-used-all-urls)
6. [Backend API (REST, AG-UI, Socket.IO, Swagger)](#6-backend-api)
7. [Frontend](#7-frontend)
8. [Configuration (environment variables)](#8-configuration)
9. [Data model & persistence](#9-data-model--persistence)
10. [Observability](#10-observability)
11. [Project structure](#11-project-structure)
12. [Limitations & notes](#12-limitations--notes)

---

## 1. Quick start

Prerequisites: **Node.js 20+** (tested on 24), **pnpm**, **Docker**.

```bash
# 1) PostgreSQL on localhost:5433
docker compose up -d

# 2) Backend — NestJS on :4100
cd backend
cp .env.example .env          # set OPENAI_API_KEY (everything else is optional)
pnpm install
pnpm start:dev                # or: pnpm build && pnpm start:prod

# 3) Frontend — Next.js on :3100
cd ../frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL (default http://localhost:4100)
pnpm install
pnpm dev                      # or: pnpm build && pnpm start
```

Open **http://localhost:3100** and plan a trip. Only `OPENAI_API_KEY` is required; every other data source either
needs no key or falls back automatically (see [§5](#5-external-apis-used-all-urls)).

> Ports 3100/4100/5433 are used to avoid clashing with other local apps on 3000/4000/5432.

---

## 2. Local URLs

| What | URL |
|---|---|
| Web app (planner) | http://localhost:3100 |
| Saved trips | http://localhost:3100/trips |
| Trip detail | http://localhost:3100/trips/{tripId} |
| Continue a trip in chat | http://localhost:3100/?thread={threadId} |
| **Swagger UI** | **http://localhost:4100/api/docs** |
| OpenAPI JSON | http://localhost:4100/api/docs-json |
| Health / provider status | http://localhost:4100/api/health |
| AG-UI endpoint (SSE) | `POST` http://localhost:4100/api/agui |
| REST base | http://localhost:4100/api |
| Socket.IO | ws://localhost:4100 (event `trip:plan`) |
| PostgreSQL | `postgres://travel:travel@localhost:5433/travel_planner` |

---

## 3. Architecture

```
 ┌────────────┐  AG-UI over SSE (RUN/STEP/TOOL_CALL/STATE/TEXT events)  ┌──────────────────────────────────────┐
 │  Next.js   │ ──────────────── POST /api/agui ──────────────────────► │ NestJS API                           │
 │  web UI    │ ◄────────────── REST /api/trips, /api/health ─────────► │  AguiController · TripsController     │
 └────────────┘                                                         │  TripsGateway (Socket.IO) · Swagger  │
                                                                        └─────────────────┬────────────────────┘
                                                                                          │ TripsService
                ┌─────────────────────────── LangGraph StateGraph ────────────────────────▼─────────────────────┐
                │                               Supervisor Agent                                                │
                │          (intent: new_trip / refine / question / clarify, structured trip request, routing)   │
                │        ┌──────────────────────┬──────────────────────┬──────────────────────┐ parallel fan-out  │
                │        ▼                      ▼                      ▼                      │                   │
                │  Destination Research    Accommodation         Transport Booking            │                   │
                │        └──────────────────────┴───────────┬──────────┘                      │                   │
                │                                           ▼                                                     │
                │                              Itinerary Planning Agent                                           │
                │                                           ▼                                                     │
                │                             Response Aggregator Agent                                           │
                │  Shared state (messages, request, agent results, plan) checkpointed per thread in PostgreSQL    │
                └──────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                                               ▼
              External APIs: Ola Maps · OpenStreetMap · Wikipedia · Open-Meteo · IMD · erail.in · IRCTC(RapidAPI)
                             NewsData.io · Google News India · OSRM · booking deep links (IRCTC/MakeMyTrip/ixigo/redBus/Booking.com)
```

**How a turn works**
1. The UI sends the user message as an AG-UI `RunAgentInput` (`threadId` = trip thread).
2. The **Supervisor** (OpenAI structured output) classifies intent, updates the structured trip request and picks
   which agents must (re)run. Deterministic guard-rails force a full re-plan when destination/dates/travellers change.
3. **Research, Accommodation and Transport run in parallel**; the **Itinerary** planner runs once they finish;
   the **Aggregator** builds the final plan (budget, packing list, tips, chat reply).
4. Every agent step, tool call and state change streams to the UI as AG-UI events; the plan is saved to Postgres.
5. Follow-ups on the same thread (e.g. *"make day 2 relaxed"*) re-run only the affected agents — everything else
   is reused from the checkpointed state.

---

## 4. Agents & tools

| Agent | Tools | Produces |
|---|---|---|
| **Supervisor** | — (structured output) | intent (`new_trip` · `refine` · `question` · `clarify` · `book`), normalised trip request (+ assumptions), agents to run, per-agent instructions, direct reply for questions |
| **Booking approval** (human in the loop) | — | Builds the booking summary (stay, outbound, return, total) and pauses with LangGraph `interrupt()` until the user approves or rejects |
| **Destination Research** | `geocode_place`, `get_weather_forecast`, `find_places`, `get_wikipedia_summary`, `search_travel_news` | overview, best time to visit, daily weather + **IMD alerts**, 8–12 attractions with coordinates, neighbourhoods, cuisine, safety, permits, news |
| **Accommodation** | `geocode_place`, `search_hotels`, `find_places` | 4–6 real properties, area advice, tariff band, booking links, stay total |
| **Transport Booking** | `search_flights`, `search_trains`, `search_buses`, `get_road_route` | outbound/return options (recommended marked), local transport, transport total |
| **Itinerary Planning** | `optimize_day_route`, `search_places_text`, `find_places`, `get_road_route` | day-wise timeline (times, travel legs, costs), weather-aware adjustments |
| **Response Aggregator** | — (structured output) | title, summary, highlights, budget breakdown, packing list, tips, chat reply |

Each specialist runs a tool-calling loop (LLM ⇄ tools; parallel tool calls) followed by a strict structured-output
pass, so the UI always receives typed JSON (schemas in `backend/src/agents/schemas.ts`).

**Tool reference (12 tools)**

| Tool | What it does | Data source(s) |
|---|---|---|
| `geocode_place` | Place name → coordinates & state | Ola Maps Geocode → Nominatim |
| `get_weather_forecast` | Daily weather for trip dates + official IMD district warnings | Open-Meteo forecast/archive, IMD GeoServer (IMD city forecast if keyed) |
| `find_places` | Attractions / restaurants / nightlife / shopping / nature near a point | Ola Maps Text Search → Wikipedia GeoSearch / Nominatim → Overpass |
| `search_places_text` | Free-text place search ("Rajasthani thali near City Palace") | Ola Maps Text Search → category-matched OSM search |
| `get_wikipedia_summary` | Short history/significance of a sight | Wikipedia REST |
| `search_travel_news` | Recent Indian news: festivals, closures, advisories | NewsData.io → Google News India RSS |
| `search_hotels` | Real hotels/homestays + tariff guidance + booking links | Ola Maps → Nominatim → Overpass; Booking.com links |
| `get_road_route` | Driving distance/time + cab fare estimate | Ola Maps Directions → OSRM → straight-line estimate |
| `search_trains` | Trains running on the travel date, timings, classes, fares | IRCTC (RapidAPI) → **erail.in** → fare model; IRCTC link |
| `search_flights` | Nearest airports, block time, fare range | Fare model; MakeMyTrip & ixigo deep links |
| `search_buses` | Bus duration & fare range | Fare model; redBus link |
| `optimize_day_route` | Order a day's stops to minimise travel | Local nearest-neighbour optimiser (no API) |

---

## 5. External APIs used (all URLs)

Legend — **Key**: whether an API key is needed. **Role**: *primary* (used when configured), *fallback* (keyless).

### 5.1 LLM
| Service | Endpoint | Key | Used for |
|---|---|---|---|
| OpenAI Chat Completions (via `@langchain/openai`) | `https://api.openai.com/v1/chat/completions` | `OPENAI_API_KEY` | All agents: tool calling + structured outputs. Model: `OPENAI_MODEL` (default `gpt-4.1`) |

### 5.2 Maps, geocoding, places, hotels, routing
| Service | Method & URL | Key | Role / notes |
|---|---|---|---|
| **Ola Maps** (Krutrim, India) — Geocode | `GET https://api.olamaps.io/places/v1/geocode?address=…&api_key=…` | `OLA_MAPS_API_KEY` | Primary geocoder |
| Ola Maps — Text Search | `GET https://api.olamaps.io/places/v1/textsearch?input=…&location=lat,lng&radius=…&size=…&api_key=…` | `OLA_MAPS_API_KEY` | Primary places & hotels |
| Ola Maps — Directions | `POST https://api.olamaps.io/routing/v1/directions?origin=lat,lng&destination=lat,lng&api_key=…` | `OLA_MAPS_API_KEY` | Primary road routing |
| OpenStreetMap **Nominatim** — Search | `GET https://nominatim.openstreetmap.org/search?q=…&format=jsonv2&countrycodes=in[&viewbox=…&bounded=1]` | none | Fallback geocoder; hotels/restaurants/sights by category inside a bounding box. Throttled to 1 req/s (usage policy) |
| Nominatim — Reverse | `GET https://nominatim.openstreetmap.org/reverse?lat=…&lon=…&format=jsonv2&zoom=10` | none | Destination → district (for IMD warnings) |
| **Wikipedia** GeoSearch | `GET https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=lat\|lon&ggsradius=10000&prop=coordinates\|description` | none | Notable sights near a point (fallback for attractions/nature) |
| Wikipedia REST summary | `GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}` | none | Attraction descriptions |
| **Overpass API** (OSM) | `POST https://overpass-api.de/api/interpreter`, mirror `POST https://maps.mail.ru/osm/tools/overpass/api/interpreter` | none | Last-resort OSM feature search (6 s timeout) |
| **OSRM** demo server | `GET https://router.project-osrm.org/route/v1/driving/{lon},{lat};{lon},{lat}?overview=false` | none | Fallback road distance/time (+30% for Indian roads) |
| OpenStreetMap tiles (frontend map) | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | none | Map tiles in the Map tab |

### 5.3 Weather
| Service | Method & URL | Key | Role / notes |
|---|---|---|---|
| **IMD district-wise warnings** (official, public GeoServer behind IMD's warning map) | `GET https://reactjs.imd.gov.in/geoserver/wfs?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&typename=imd:district_warnings_india&propertyName=District,Date,Day_1..Day_5,Day1_Color..Day5_Color` | **none** | 5-day green/yellow/orange/red alerts per district (~760 districts). Hazard codes per IMD's map: 2 heavy rain, 4 thunderstorm, 8 strong winds, 9 heat wave, 10 hot day, 15 fog, 16/17 very/extremely heavy rain… |
| **Open-Meteo** forecast | `GET https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code&timezone=Asia/Kolkata&start_date=…&end_date=…` | none | Daily forecast for trips within 16 days |
| Open-Meteo historical archive | `GET https://archive-api.open-meteo.com/v1/archive?…` (same dates last year) | none | Seasonal reference for trips beyond 16 days |
| **IMD API** — 7-day city forecast (optional) | `GET https://api.imd.gov.in/api/v1/cityforecastloc` with headers `X-API-Key: <key>` and `Authorization: Bearer <JWT>` | `IMD_API_KEY` + `IMD_JWT` (free for non-commercial use; registration + IP whitelisting) | Official temperatures/conditions from the nearest IMD station (≤ 60 km) for trips within 7 days. Portal: https://api.imd.gov.in · whitelisting: https://city.imd.gov.in/citywx/api_request.php · reference: https://api.imd.gov.in/public/api_reference.html |

### 5.4 Transport
| Service | Method & URL | Key | Role / notes |
|---|---|---|---|
| **IRCTC via RapidAPI** (`irctc1`) | `GET https://irctc1.p.rapidapi.com/api/v3/trainBetweenStations?fromStationCode=…&toStationCode=…&dateOfJourney=YYYY-MM-DD` (headers `x-rapidapi-key`, `x-rapidapi-host`) | `RAPIDAPI_KEY` | Primary live train data when configured |
| **erail.in** public timetable | `GET https://erail.in/rail/getTrains.aspx?Station_From={code}&Station_To={code}&DataSource=0&Language=0&Cache=true` | none | Default live trains: filtered to trains running on the travel date; timings, classes, **indicative** fares. *Unofficial endpoint* — disable with `ERAIL_ENABLED=false` |
| Fare models (in code) | — | — | Flight (distance + advance purchase), train class-wise, bus and cab estimates when no live data |
| IRCTC booking (link) | `https://www.irctc.co.in/nget/train-search` | — | Train booking deep link |
| MakeMyTrip flights (link) | `https://www.makemytrip.com/flight/search?itinerary={FROM}-{TO}-{DD/MM/YYYY}&tripType=O&paxType=A-{n}_C-0_I-0&intl=false&cabinClass=E` | — | Flight booking deep link |
| ixigo flights (link) | `https://www.ixigo.com/search/result/flight?from={FROM}&to={TO}&date={DDMMYYYY}&adults={n}&children=0&infants=0&class=e` | — | Flight booking deep link |
| redBus (link) | `https://www.redbus.in/bus-tickets/{from}-to-{to}` | — | Bus booking deep link |

### 5.5 Hotels booking, news
| Service | Method & URL | Key | Role / notes |
|---|---|---|---|
| Booking.com search (link) | `https://www.booking.com/searchresults.html?ss={hotel+city}&checkin=…&checkout=…&group_adults=…&no_rooms=…` | — | "Check rates" links on stays |
| **NewsData.io** (India) | `GET https://newsdata.io/api/1/latest?apikey=…&q=…&country=in&language=en` | `NEWSDATA_API_KEY` | Primary news/events |
| **Google News RSS — India edition** | `GET https://news.google.com/rss/search?q={query}+when:30d&hl=en-IN&gl=IN&ceid=IN:en` | none | Fallback news/events |

### 5.6 Frontend assets
| Service | URL | Notes |
|---|---|---|
| Google Fonts (via `next/font`) | Inter, Fraunces | Self-hosted at build time by Next.js |

### 5.7 Fallback order summary
| Capability | Order |
|---|---|
| Geocoding | Ola Maps → Nominatim |
| Attractions / nature | Ola Maps → Wikipedia GeoSearch (+ Nominatim top-up) → Overpass |
| Hotels / restaurants / nightlife / shopping | Ola Maps → Nominatim (bounded) → Overpass |
| Road routing | Ola Maps → OSRM → straight-line × 1.3 |
| Trains | IRCTC (RapidAPI) → erail.in → fare model |
| Weather | IMD city forecast (if keyed) + Open-Meteo, plus IMD district warnings (always, ≤ 5 days ahead) |
| News | NewsData.io → Google News India RSS |

`GET /api/health` reports which provider is active for each capability. All HTTP calls use timeouts, an in-memory TTL
cache and in-flight de-duplication (`backend/src/common/http.ts`).

---

## 6. Backend API

Base URL: `http://localhost:4100/api` · Swagger UI: **`/api/docs`** · OpenAPI JSON: **`/api/docs-json`**

### 6.1 REST
| Method | Path | Description | Body / params | Response |
|---|---|---|---|---|
| `GET` | `/api/health` | DB, LLM and provider status | — | `{status, database, llm{provider,model,configured}, observability{langsmith}, providers{…}}` |
| `GET` | `/api/trips` | List saved trips (latest 100) | — | `TripSummary[]` |
| `GET` | `/api/trips/{id}` | Full trip (plan, conversation, run traces) | `id` = trip UUID **or** threadId | `Trip` · `404` if missing |
| `DELETE` | `/api/trips/{id}` | Delete a trip | `id` | `{deleted: true}` |
| `POST` | `/api/trips/plan` | Plan/refine synchronously (~30–90 s) | `{ "threadId"?: string, "message": string }` | `{tripId, threadId, reply, intent, agentsRun[], errors[], interrupt, trip}` · `{threadId, cancelled: true}` if cancelled · `400` invalid · `409` thread busy |
| `POST` | `/api/trips/{id}/cancel` | Stop the running turn (any channel) | `id` = trip UUID or threadId | `{threadId, cancelled}` |
| `POST` | `/api/trips/{id}/approval` | Approve / reject the pending booking | `{ "approved": boolean, "comment"?: string }` | Same as `/plan` · `400` if nothing awaits approval |

Example:
```bash
curl -X POST http://localhost:4100/api/trips/plan -H 'Content-Type: application/json' \
  -d '{"message":"Plan 3 nights in Jaipur from Delhi starting 2026-11-20 for 2 adults, mid-range, heritage and food."}'

# refine the same trip
curl -X POST http://localhost:4100/api/trips/plan -H 'Content-Type: application/json' \
  -d '{"threadId":"<threadId from the first call>","message":"Make day 2 more relaxed."}'
```

### 6.2 AG-UI endpoint (used by the web UI)
`POST /api/agui` — body: AG-UI `RunAgentInput`; response: `text/event-stream` of AG-UI events.

```bash
curl -N -X POST http://localhost:4100/api/agui \
  -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  -d '{"threadId":"demo-thread-0001","runId":"run-1","state":{},"tools":[],"context":[],
       "messages":[{"id":"m1","role":"user","content":"Weekend in Rishikesh from Delhi by train for 3 friends, budget ₹15,000."}]}'
```

| Graph activity | AG-UI events emitted |
|---|---|
| Run lifecycle | `RUN_STARTED` → … → `RUN_FINISHED` (`result`: `tripId, intent, agentsRun, errors, version, status`; `outcome`: `success` · `interrupt` · `cancelled`) or `RUN_ERROR` |
| Booking approval (human in the loop) | `RUN_FINISHED` outcome `interrupt` `{id, reason: 'booking_approval', message, responseSchema, metadata.summary}`; answer in the next run with `resume: [{interruptId, status: 'resolved', payload: {approved, comment}}]` (`status: 'cancelled'` dismisses it) |
| Cancellation | Client aborts the request, or `POST /api/trips/{id}/cancel` → `RUN_FINISHED` outcome `cancelled` |
| Each agent (supervisor, 4 specialists, aggregator, booking) | `STEP_STARTED` / `STEP_FINISHED` (`stepName` = agent id) |
| Every external API call | `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` (`metadata.agent`, `metadata.ok`, `metadata.durationMs`) |
| Agent statuses, intent, reasoning, final plan | Shared state: `STATE_SNAPSHOT` + `STATE_DELTA` (RFC 6902 JSON Patch) |
| Aggregator reply | `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` (streamed) / `TEXT_MESSAGE_END` |

Shared state shape:
```ts
{ threadId, tripId, status: 'running'|'done'|'error', intent, reasoning,
  agents: { supervisor|destination_research|itinerary_planner|accommodation|transport|aggregator:
            { status: 'idle'|'running'|'done'|'error'|'skipped', durationMs, tools, message } },
  plan: TravelPlan | null }
```
Any AG-UI client works (e.g. `new HttpAgent({ url: 'http://localhost:4100/api/agui' })` from `@ag-ui/client`, CopilotKit).
See **[docs/AG-UI.md](docs/AG-UI.md)** for the architecture and sequence diagrams, and the advantages and drawbacks of AG-UI versus the original HLD.

### 6.3 Socket.IO (alternative real-time channel)
| Direction | Event | Payload |
|---|---|---|
| client → server | `trip:plan` | `{ threadId?, message }` |
| client → server | `trip:cancel` | `{ threadId }` → `trip:cancel:ack {threadId, cancelled}` (runs are also cancelled when the socket disconnects) |
| client → server | `trip:resume` | `{ threadId, approved, comment? }` — answers the booking approval |
| server → client | `trip:accepted` | `{ threadId }` |
| server → client | `trip:event` | `{ type: 'agent'|'tool'|'supervisor', … }` (progress) |
| server → client | `trip:result` | `{ threadId, tripId, reply, intent, agentsRun, errors, interrupt, trip }` (`interrupt` set when a booking awaits approval) |
| server → client | `trip:cancelled` | `{ threadId }` |
| server → client | `trip:error` | `{ threadId?, message }` |

### 6.4 Swagger
Swagger UI at **http://localhost:4100/api/docs** documents every REST/AG-UI endpoint with request/response schemas
and examples (tags: *AG-UI*, *Trips*, *Health*). Swagger UI cannot render SSE streams — use `curl -N` or an AG-UI
client for `/api/agui`. Schemas live in `backend/src/common/openapi.ts`; runtime validation uses zod.

---

## 7. Frontend

Next.js App Router app in `frontend/src` (port **3100**).

| Route | Type | What it shows |
|---|---|---|
| `/` | Client (`Planner`, wrapped in `Suspense`) | Trip form + chat, **live LangGraph orchestration view** (agents & statuses), live tool-call feed, final plan. `?thread={threadId}` restores a trip for refinement |
| `/trips` | Server component (streamed) | Saved trips with status, version, dates |
| `/trips/[id]` | Server component (streamed) | Read-only plan view + run summary + "Continue refining in chat" |

| Component | Purpose |
|---|---|
| `Planner.tsx` | AG-UI `HttpAgent` client: sends runs, maps events → UI (state snapshots/deltas, tool calls, streamed text) |
| `AgentFlow.tsx` | HLD-style diagram: Supervisor → 4 specialists → Aggregator → PostgreSQL, live status/tool counts/durations |
| `ActivityFeed.tsx` | Live list of tool calls (agent, tool, args, duration, success) |
| `TripForm.tsx` | Structured inputs (origin, destination, dates, travellers, budget, pace, transport, stay, interests, dietary) |
| `ChatPanel.tsx` | Conversation with streamed assistant replies and refinement suggestions |
| `ApprovalCard.tsx` | Booking approval (AG-UI interrupt): items, totals, booking links, Approve / Reject with a note |
| `plan/PlanView.tsx` | Tabs: **Itinerary** (timeline, weather + IMD alert badges), **Stays**, **Transport**, **Destination** (weather, IMD warnings, attractions, food, safety, permits, news), **Budget & tips**, **Map** |
| `plan/MapView.tsx` | Leaflet map (client-only via `next/dynamic`, `ssr:false`): itinerary stops by day, stays, attractions |
| `lib/api.ts`, `lib/types.ts` | REST helpers, INR/date formatting, shared types mirroring the backend schemas |

Labels in the UI: **live** = real-time data from an API; **estimate** = fare/tariff model; IMD alerts are colour-coded
(yellow *be updated* · orange *be prepared* · red *take action*).

---

## 8. Configuration

Three example files are provided — copy each and fill in:

| Example file | Copy to | Used by |
|---|---|---|
| `backend/.env.example` | `backend/.env` | NestJS API (LLM, database, providers, LangSmith) |
| `frontend/.env.example` | `frontend/.env.local` | Next.js app (backend URL) |
| `.env.example` (root) | `.env` (optional) | `docker-compose.yml` PostgreSQL credentials/port |

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp .env.example .env            # optional
```

### Backend — `backend/.env`
| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | **yes** | — | OpenAI key |
| `OPENAI_MODEL` | no | `gpt-4.1` | Any chat model with tool calling + structured outputs |
| `DATABASE_URL` | **yes** | `postgres://travel:travel@localhost:5433/travel_planner` | PostgreSQL connection |
| `OLA_MAPS_API_KEY` | no | — | Enables Ola Maps (geocode, places, hotels, directions); removes the Nominatim 1 req/s bottleneck |
| `RAPIDAPI_KEY` | no | — | Enables IRCTC live trains via RapidAPI |
| `ERAIL_ENABLED` | no | `true` | Use the erail.in public timetable for live trains |
| `NEWSDATA_API_KEY` | no | — | Enables NewsData.io (else Google News India RSS) |
| `IMD_API_KEY`, `IMD_JWT` | no | — | Enables IMD 7-day city forecasts (warnings work without them) |
| `LANGSMITH_TRACING` | no | `false` | `true` to trace runs in LangSmith |
| `LANGSMITH_API_KEY` | no | — | LangSmith key |
| `LANGSMITH_PROJECT` | no | `india-travel-planner` | LangSmith project name |
| `LANGSMITH_ENDPOINT` | no | LangSmith default | Only for EU/self-hosted LangSmith |
| `PORT` | no | `4100` | API port |
| `CORS_ORIGIN` | no | `http://localhost:3100` | Allowed browser origin(s), comma-separated |

### Frontend — `frontend/.env.local`
| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4100` | Backend base URL (inlined at build time) |

### Docker — root `.env` (read by `docker-compose.yml`)
| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `travel` | Database user |
| `POSTGRES_PASSWORD` | `travel` | Database password |
| `POSTGRES_DB` | `travel_planner` | Database name |
| `POSTGRES_PORT` | `5433` | Host port mapped to Postgres 5432 |

If you change these, update `DATABASE_URL` in `backend/.env` to match. Data persists in the `travel_pg` volume.

### Scripts
| Where | Command | Description |
|---|---|---|
| backend | `pnpm start:dev` | Watch mode |
| backend | `pnpm build` / `pnpm start:prod` | Compile to `dist/` / run compiled |
| backend | `pnpm test:agui` | AG-UI event-sequence contract test (official `verifyEvents`) — run after every `@ag-ui/*` upgrade |
| frontend | `pnpm dev` | Dev server on :3100 |
| frontend | `pnpm build` / `pnpm start` | Production build / serve on :3100 |

---

## 9. Data model & persistence

**`trips` table** (TypeORM, auto-synchronised in dev):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Trip id |
| `threadId` | varchar (unique) | LangGraph / AG-UI thread |
| `title`, `destination` | varchar | From the latest plan |
| `status` | varchar | `planning` · `ready` · `needs_input` · `awaiting_approval` · `error` |
| `booking` | jsonb | Booking approval: `status` (awaiting_approval/approved/rejected/dismissed), `interruptId`, `summary{items, totalINR}`, `decidedAt`, `comment` |
| `request` | jsonb | Structured trip request |
| `plan` | jsonb | Final plan (research, stays, transport, itinerary, budget…) |
| `conversation` | jsonb | `[{role, content, at}]` |
| `runs` | jsonb | Per run: intent, agents run, duration, errors, full agent/tool event trace |
| `version` | int | Increments whenever the plan changes |
| `createdAt`, `updatedAt` | timestamptz | |

**LangGraph checkpoints** (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`) are created
by `@langchain/langgraph-checkpoint-postgres` and hold each thread's shared agent state for refinements.

---

## 10. Observability
- **LangSmith**: set `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` to trace every graph run, agent, LLM and tool call.
- **Run traces in Postgres**: every agent/tool event (timings, success, previews) is stored on the trip (`runs[]`),
  visible via `GET /api/trips/{id}` and summarised on `/trips/{id}`.
- **Live**: the AG-UI stream drives the orchestration view and tool feed in the UI.
- **Logs**: Nest logger (agent durations, provider fallbacks/warnings).

---

## 11. Project structure
```
travel-planner/
├── docker-compose.yml                # PostgreSQL 17
├── docs/
│   └── AG-UI.md                      # AG-UI flow diagrams, pros & cons vs the original HLD
├── backend/                          # NestJS 12 (ESM)
│   └── src/
│       ├── main.ts                   # bootstrap, CORS, body limit, Swagger (/api/docs)
│       ├── env.ts                    # loads .env before imports
│       ├── app.module.ts             # Config, TypeORM, Trips, AG-UI, Health
│       ├── agents/
│       │   ├── travel-graph.service.ts   # LangGraph StateGraph (supervisor, specialists, aggregator, routing)
│       │   ├── specialist.ts             # tool-calling loop + structured output
│       │   ├── tools.ts                  # 12 LangChain tools
│       │   ├── prompts.ts · schemas.ts   # prompts, zod structured-output schemas
│       │   └── state.ts                  # shared LangGraph state + progress event types
│       ├── agui/                     # AG-UI SSE endpoint + graph-event → AG-UI translation
│       ├── trips/                    # entity, REST controller, Socket.IO gateway, service
│       ├── integrations/             # geo · places · weather · imd-warnings · transport · news · india-data
│       ├── health/                   # /api/health
│       └── common/                   # http (timeouts/cache/throttle), geo utils, OpenAPI schemas
└── frontend/                         # Next.js 16.4
    └── src/
        ├── app/                      # /, /trips, /trips/[id], layout, globals.css
        ├── components/               # Planner, AgentFlow, ActivityFeed, TripForm, ChatPanel, plan/*
        └── lib/                      # api.ts, types.ts
```

---

## 12. Limitations & notes
- **Prices**: flight, bus, cab and hotel prices are estimates (no free Indian inventory APIs); erail train fares are
  *indicative* (1A fares are not shown). Always confirm on the booking site linked in the plan.
- **erail.in** is an unofficial public endpoint of a private site — it can change or block requests; use
  `ERAIL_ENABLED=false` to turn it off. Suitable for learning/demo use, not for commercial use.
- **IMD warnings** cover only the next 5 days; trips further out show none. IMD's 7-day city forecast needs
  registration (free for non-commercial use).
- **Nominatim** allows 1 request/second; without an Ola Maps key, several trips planned at once queue behind this limit.
- **Overpass** public servers are often overloaded; it is only a last resort with short timeouts.
- `synchronize: true` (TypeORM) is for development — use migrations in production.
- Destinations are limited to India by design; the supervisor asks to clarify for other countries.
- **Booking approval** confirms a booking checklist with links; no booking or payment is made automatically (no public
  booking APIs for these providers).
- `@ag-ui/*` versions are pinned exactly (`1.0.2`); run `pnpm test:agui` in `backend/` after upgrading them.
