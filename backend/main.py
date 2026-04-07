import asyncio
import json
import logging
import os
import ssl
import uuid

from aiohttp import web
import socketio
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay
from aiortc.sdp import candidate_from_sdp

from stream import CattleVideoTrack
from fence import ZoneManager

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CattleBackend")

# --- Auth config (set AUTH_TOKEN env var to enable, empty = disabled) ---
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")
AUTH_ENABLED = bool(AUTH_TOKEN)
if AUTH_ENABLED:
    logger.info("Token authentication ENABLED")
else:
    logger.warning("AUTH_TOKEN not set — authentication DISABLED (set AUTH_TOKEN env var to enable)")

# Global Zone Manager (single shared instance)
zone_manager = ZoneManager()

# MediaRelay: shares one video source across all WebRTC clients
relay = MediaRelay()

# SocketIO Server (Async)
sio = socketio.AsyncServer(cors_allowed_origins="*", async_mode='aiohttp')
app = web.Application()
sio.attach(app)

async def index(request):
    return web.Response(text="Cattle Virtual Fence Backend Running OK")

app.router.add_get('/', index)

# WebRTC Connections: Map sid -> pc
pcs = {}

# Shared video track (created once, relayed to all clients)
_shared_track = None

def get_shared_track(async_emit):
    """Return the single shared CattleVideoTrack, creating it if needed."""
    global _shared_track
    if _shared_track is None:
        video_source = "cow_test.mp4" if os.path.exists("cow_test.mp4") else 0
        logger.info(f"Creating shared video track (source={video_source})")
        _shared_track = CattleVideoTrack(
            source=video_source,
            socket_emit=async_emit,
            zone_manager=zone_manager,
        )
    return _shared_track

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs.values()]
    await asyncio.gather(*coros)

app.on_shutdown.append(on_shutdown)

@sio.event
async def connect(sid, environ):
    # --- Token auth ---
    if AUTH_ENABLED:
        # Token can be passed as query param: ?token=<value>
        query_string = environ.get("QUERY_STRING", "")
        token = ""
        for part in query_string.split("&"):
            if part.startswith("token="):
                token = part[len("token="):]
                break
        if token != AUTH_TOKEN:
            logger.warning(f"Rejected connection from {sid} — invalid token")
            raise ConnectionRefusedError("Invalid or missing authentication token")

    logger.info(f"Client connected: {sid}")
    await sio.emit("message", {"status": "connected"}, room=sid)
    await sio.emit("zones", zone_manager.zones, room=sid)

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")
    if sid in pcs:
        await pcs[sid].close()
        del pcs[sid]

@sio.event
async def update_zone(sid, data):
    try:
        zone_manager.save_zones(data)
        logger.info(f"Zones updated by {sid}: {data}")
        await sio.emit("zones", zone_manager.zones)
    except ValueError as e:
        logger.warning(f"Invalid zone data from {sid}: {e}")
        await sio.emit("error", {"message": str(e)}, room=sid)

@sio.event
async def ice_candidate(sid, data):
    if sid in pcs:
        pc = pcs[sid]
        if data:
            try:
                candidate_str = data.get('candidate')
                sdpMid = data.get('sdpMid')
                sdpMLineIndex = data.get('sdpMLineIndex')

                if candidate_str:
                    can = candidate_from_sdp(candidate_str)
                    can.sdpMid = sdpMid
                    can.sdpMLineIndex = sdpMLineIndex
                    await pc.addIceCandidate(can)
            except Exception as e:
                logger.error(f"Error adding ICE candidate: {e}")

@sio.event
async def offer(sid, params):
    logger.info(f"Received offer from {sid}")
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs[sid] = pc

    async def async_emit(event, data):
        await sio.emit(event, data)

    # Trickle ICE: send candidates to client as they are gathered
    @pc.on("icecandidate")
    async def on_icecandidate(candidate):
        if candidate:
            await sio.emit("ice_candidate", {
                "candidate": candidate.to_sdp(),
                "sdpMid": candidate.sdpMid,
                "sdpMLineIndex": candidate.sdpMLineIndex,
            }, room=sid)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"[{sid}] Connection state: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed"):
            await pc.close()
            if sid in pcs:
                del pcs[sid]

    # Use the shared track (relayed so YOLO only runs once)
    track = get_shared_track(async_emit)
    pc.addTrack(relay.subscribe(track))

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    }

if __name__ == "__main__":
    # --- TLS (optional) ---
    # Set SSL_CERT and SSL_KEY env vars to enable HTTPS/WSS
    ssl_cert = os.environ.get("SSL_CERT", "")
    ssl_key = os.environ.get("SSL_KEY", "")
    ssl_context = None
    if ssl_cert and ssl_key:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(ssl_cert, ssl_key)
        logger.info("TLS enabled")
    else:
        logger.warning("SSL_CERT/SSL_KEY not set — running without TLS (HTTP/WS)")

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5001"))
    web.run_app(app, host=host, port=port, ssl_context=ssl_context)
