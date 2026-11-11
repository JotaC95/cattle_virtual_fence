# Cattle Virtual Fence — Experimental Livestock Monitoring

A prototype connecting Python computer vision, video streaming, zone management and a mobile interface. **It is not a validated animal-containment system.**

## What is in the repository?

| Component | Location | Responsibility |
| --- | --- | --- |
| Backend | `backend/main.py` | aiohttp, Socket.IO connections and WebRTC signaling |
| Video and detection | `backend/stream.py`, `backend/vision.py` | Video track and computer-vision processing |
| Zone model | `backend/fence.py` | Zone state and updates |
| Mobile | `mobile/` | Expo / React Native interface |
| Local orchestration | `docker-compose.yml` | Container configuration |

## System overview

```text
Camera or bundled test video
            |
            v
    Python video backend ---- ZoneManager
            |                    |
            +------ Socket.IO ---+
            |
          WebRTC
            |
    Expo / React Native app
```

## Getting started

### Backend environment

```bash
git clone https://github.com/JotaC95/cattle_virtual_fence.git
cd cattle_virtual_fence/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Review `backend/run_local.sh` and `backend/main.py` for the current startup options before launching. The code chooses `cow_test.mp4` from its working directory when available, otherwise it attempts camera index 0. Camera access, codecs and WebRTC connectivity depend on the host environment.

### Mobile environment

Open a separate terminal from the repository root:

```bash
cd mobile
npm ci
npx expo start
```

WebRTC native modules may require an Expo development build rather than Expo Go. Configure the backend host for your device; local network access and camera permissions must be available.

## Interaction flow

1. A client connects through Socket.IO and receives current zone data.
2. The client may send zone updates to the backend.
3. WebRTC signaling negotiates a video connection.
4. The backend creates a video track from a local test video or camera.

These are source-code paths, **not** a claim that the full experience has been validated on a real device.

## Security and safety

- Backend Socket.IO currently allows all origins; add authentication and restrict origins before deployment.
- Do not expose camera feeds or zone-control endpoints publicly.
- Detection errors, network failures and latency can occur. Do not rely on this prototype for animal safety or containment.
- Use only footage you are authorized to process.

## Troubleshooting

- **Mobile connection fails:** confirm IP/port, device connectivity and firewall rules.
- **No video:** check working directory, test file or camera permissions, codecs and WebRTC signaling.
- **Expo Go limitation:** use a supported development build for native WebRTC dependencies.

## Roadmap

Document reproducible startup commands, create a sanitized demonstration, add automated tests, secure signaling, and measure detection accuracy and failure cases.
