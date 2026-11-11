# Cattle Virtual Fence — Computer Vision Prototype

**Exploring real-time livestock monitoring with a Python video backend and React Native mobile client.**

This is an experimental project, **not** a proven virtual fence or animal-containment system. The repository combines video processing, a configurable zone model and mobile interaction.

## Architecture at a glance

```text
Video file / camera
       |
       v
Python backend (aiohttp + Socket.IO + aiortc)
       |                 \\
       v                  v
Computer-vision track   ZoneManager
       |                  |
       +--------+---------+
                |
         WebRTC / Socket.IO
                |
        Expo mobile client
```

The backend has handlers for connections, zone updates, WebRTC offers and ICE candidates. It selects `backend/cow_test.mp4` if available, otherwise attempts camera index 0. The project also includes a YOLO model file; detection accuracy and live deployment behavior have not been independently verified.

## Repository structure

- `backend/main.py` — aiohttp app, Socket.IO events and WebRTC session handling.
- `backend/stream.py`, `vision.py`, `fence.py` — video, vision and zone-related logic.
- `backend/requirements.txt`, `Dockerfile` — backend dependencies and container configuration.
- `mobile/` — Expo / React Native app, WebRTC and Socket.IO client dependencies.
- `docker-compose.yml` — local orchestration configuration.

## Local setup

Backend dependencies:

```bash
git clone https://github.com/JotaC95/cattle_virtual_fence.git
cd cattle_virtual_fence/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Mobile app (second terminal):

```bash
cd cattle_virtual_fence/mobile
npm ci
npx expo start
```

WebRTC native modules may require a development build rather than Expo Go. Backend startup, device connectivity, video permissions and host configuration must be checked in your environment.

## Security and safety notes

- Current Socket.IO backend configuration permits all CORS origins; restrict this and add authentication before any public deployment.
- Never expose unprotected camera feeds or zone-control endpoints to the internet.
- Prototype detection is not sufficient to keep animals contained or safe. No field performance, false-positive rate or animal welfare validation is claimed.

## Next milestones

1. Record reproducible setup and verified device demo.
2. Add sanitized architecture screenshots and sample zone interaction.
3. Add backend and mobile tests, authentication and restrictive CORS.
4. Measure detection performance and failure cases in controlled conditions.

## Engineering value

Demonstrates integration across Python, real-time video, WebRTC, mobile applications and experimental computer vision.
