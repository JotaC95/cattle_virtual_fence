# Cattle Virtual Fence — CLAUDE.md

## What This Project Does

Real-time virtual fence system for cattle monitoring. A backend Python server processes a live video feed (webcam or MP4) with YOLOv8m to detect cows, sheep, and people. It enforces configurable GPS-like polygon zones, fires actuator events on fence crossings, and streams annotated video to a React Native mobile app over WebRTC. Persistent memory of all events is stored in [Engram](https://github.com/Gentleman-Programming/engram) (Go HTTP server).

---

## Architecture

```
Camera / MP4
    │
    ▼
vision.py  ─── YOLOv8m (ultralytics) ───► detections: id, bbox, centroid, class_type
    │
    ▼
stream.py  ─── fence.check_status() ────► status: INTERNAL / WARNING / OUT / ALLOWED / INACTIVE
    │
    ├──► actuator.py ── state transitions ──► "breach" / "return" events
    │         │
    │         └──► memory_brain.py ── HTTP POST → Engram server (:7437)
    │
    └──► SocketIO "state" event (every frame)
              │
              ▼
        Mobile App (React Native / Expo)
        ├── RTCView (WebRTC video stream)
        ├── SVG AR overlay (zone polygon, bounding boxes)
        ├── Alert banners (breach, person, return)
        └── 🧠 Memory panel (query Engram via SocketIO)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Detection | YOLOv8m via `ultralytics` — classes 0 (person), 18 (sheep), 19 (cow) |
| Geofencing | `shapely` polygon containment + 50 px warning threshold |
| Streaming | `aiortc` WebRTC video track + `python-socketio` async events |
| Memory | [Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram) — Go HTTP server, SQLite FTS5 |
| Mobile | React Native 0.81 + Expo 54, NativeWind (Tailwind), Zustand, socket.io-client |
| Video | `react-native-webrtc` for live WebRTC stream display |

---

## Dev Setup

### 1. Start Engram memory server (required)

```bash
# Install (macOS)
brew install gentleman-programming/tap/engram

# Start HTTP server on port 7437
engram serve

# Verify
curl http://localhost:7437/observations
```

### 2. Start Python backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py
# Listens on :5001
```

Or via Docker:
```bash
docker compose up
```

### 3. Start React Native app

```bash
cd mobile
npm install
npx expo start
```

Update the server IP in `mobile/src/store/useStore.js` → `serverUrl` to match your machine's LAN IP.

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/main.py` | aiohttp web server + all SocketIO event handlers |
| `backend/stream.py` | `CattleVideoTrack` — async aiortc video track, YOLO inference per frame |
| `backend/vision.py` | `VisionEngine` — YOLOv8m wrapper, returns detections with class_type |
| `backend/fence.py` | `ZoneManager` — polygon geofence, status checks, allowed_ids whitelist, JSON persistence |
| `backend/actuator.py` | `ActuatorManager` — fires events only on state transitions, 30 s person cooldown, optional webhook |
| `backend/memory_brain.py` | `CattleBrain` — async HTTP client to Engram server, saves/queries observations |
| `backend/requirements.txt` | Python dependencies |
| `mobile/src/components/MonitorScreen.js` | Main screen: AR overlay, fence editor, alerts, memory panel |
| `mobile/src/hooks/useCattleConnection.js` | WebRTC + SocketIO client logic |
| `mobile/src/store/useStore.js` | Zustand state (cows, zones, alerts, memorySummary, etc.) |
| `zones.json` | Persisted fence zone polygon + fence_active + allowed_ids (auto-created) |

---

## SocketIO Events

### Backend → Mobile

| Event | Payload | When |
|-------|---------|------|
| `state` | `{cows, persons, zones}` | Every frame (~30 fps) |
| `zones` | `{safe_zone: [{x,y}...]}` | On connect / zone update |
| `fence_config` | `{fence_active, allowed_ids}` | On connect / toggle / exception change |
| `actuator_event` | `{type, cow_id, action, timestamp}` | On breach or return transition |
| `alert` | `{type: "person_alert", person_ids, count, timestamp}` | On person detection (cooldown 30 s) |
| `memory_summary` | `{items: [{content, title, timestamp, type}]}` | On client connect |
| `memory_response` | `{question, results: [...]}` | After `query_memory` |

### Mobile → Backend

| Event | Payload | Effect |
|-------|---------|--------|
| `update_zone` | `{safe_zone: [{x,y}...]}` | Saves zone to `zones.json`, broadcasts to all clients |
| `toggle_fence` | `{}` | Toggles `fence_active`, broadcasts `fence_config` |
| `set_cow_exception` | `{cow_id, allowed}` | Add/remove from allowed_ids whitelist |
| `set_webhook` | `{url}` | Set actuator HTTP webhook URL at runtime |
| `query_memory` | `{question}` | Search Engram, reply with `memory_response` |
| `offer` | `{sdp, type}` | WebRTC SDP offer — returns answer |
| `ice_candidate` | ICE candidate object | WebRTC ICE negotiation |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGRAM_URL` | `http://localhost:7437` | Engram HTTP server base URL |
| `ENGRAM_PROJECT` | `cattle-fence` | Engram project scope for observations |
| `ACTUATOR_WEBHOOK_URL` | _(empty)_ | Optional HTTP webhook for breach/person events |

---

## Fence Status States

| Status | Color | Meaning |
|--------|-------|---------|
| `INTERNAL` | Green | Inside zone, >50 px from boundary |
| `WARNING` | Yellow | Inside zone, ≤50 px from boundary |
| `OUT` | Red | Outside zone — triggers actuator |
| `ALLOWED` | Lime | Outside zone but cow is whitelisted |
| `INACTIVE` | Gray | Fence is globally disabled |
| `NO_ZONE` | Light gray | No zone polygon defined yet |

---

## Active Branch

```
claude/improve-yolo-detection-emQtB
```

All development for YOLO upgrades, fence features, actuator system, and Engram memory integration lives on this branch.

---

## Common Tasks

**Add a new SocketIO event (backend):**
Add `@sio.event async def my_event(sid, data):` in `backend/main.py`.

**Change YOLO model:**
Edit `model_path` default in `backend/vision.py` `VisionEngine.__init__`.

**Change detection confidence threshold:**
Edit `conf=0.4` in `backend/vision.py` `process_frame()`.

**Add a new mobile state field:**
Add to `mobile/src/store/useStore.js`, destructure in the relevant hook or component.

**Query Engram directly:**
```bash
engram search "cow exited"
curl "http://localhost:7437/observations?q=person&project=cattle-fence"
```
