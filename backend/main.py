import argparse
import asyncio
import json
import logging
import os
import ssl
import uuid

from aiohttp import web
import socketio
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer, MediaRelay
from aiortc.sdp import candidate_from_sdp

from stream import CattleVideoTrack
from fence import ZoneManager
from actuator import ActuatorManager
from memory_brain import CattleBrain

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CattleBackend")

# Global managers — shared across all WebRTC tracks
zone_manager = ZoneManager()
brain = CattleBrain()
actuator_manager = ActuatorManager(brain=brain)

# SocketIO Server (Async)
sio = socketio.AsyncServer(cors_allowed_origins="*", async_mode='aiohttp')
app = web.Application()
sio.attach(app)

async def index(request):
    return web.Response(text="Cattle Virtual Fence Backend Running OK")

app.router.add_get('/', index)

# WebRTC Connections: Map sid -> pc
pcs = {}

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs.values()]
    await asyncio.gather(*coros)

app.on_shutdown.append(on_shutdown)

@sio.event
async def connect(sid, environ):
    logger.info(f"Client connected: {sid}")
    await sio.emit("message", {"status": "connected"}, room=sid)
    await sio.emit("zones", zone_manager.zones, room=sid)
    await sio.emit("fence_config", zone_manager.fence_config(), room=sid)
    summary = await brain.recent_summary(limit=8)
    await sio.emit("memory_summary", {"items": _serialize(summary)}, room=sid)

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")
    if sid in pcs:
        await pcs[sid].close()
        del pcs[sid]

@sio.event
async def update_zone(sid, data):
    logger.info(f"Updating zones: {data}")
    zone_manager.save_zones(data)
    await sio.emit("zones", zone_manager.zones)

@sio.event
async def toggle_fence(sid, data):
    zone_manager.toggle_active()
    logger.info(f"Fence active: {zone_manager.fence_active}")
    await sio.emit("fence_config", zone_manager.fence_config())

@sio.event
async def set_cow_exception(sid, data):
    # data = {"cow_id": int, "allowed": bool}
    zone_manager.set_allowed(int(data["cow_id"]), bool(data["allowed"]))
    logger.info(f"Allowed IDs: {zone_manager.allowed_ids}")
    await sio.emit("fence_config", zone_manager.fence_config())

@sio.event
async def set_webhook(sid, data):
    # data = {"url": "https://..."}
    actuator_manager.webhook_url = data.get("url", "")
    logger.info(f"Webhook URL updated: {actuator_manager.webhook_url!r}")
    await sio.emit("message", {"status": "webhook_updated"}, room=sid)

@sio.event
async def query_memory(sid, data):
    # data = {"question": "cuántas veces cruzó la vaca 3?"}
    question = data.get("question", "")
    results = await brain.query(question)
    await sio.emit("memory_response", {"question": question, "results": _serialize(results)}, room=sid)

def _serialize(obj):
    """Convert engram result objects to plain dicts/strings for JSON emission."""
    if isinstance(obj, list):
        return [_serialize(item) for item in obj]
    if hasattr(obj, "__dict__"):
        return {k: _serialize(v) for k, v in obj.__dict__.items()}
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return obj

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
                    logger.info(f"Adding ICE candidate: {candidate_str}")
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
    pc_id = "PeerConnection(%s)" % uuid.uuid4()
    pcs[sid] = pc

    @pc.on("icecandidate")
    def on_icecandidate(candidate):
        # Trickle ICE can be handled here if client supports it
        pass

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info(f"Connection state is {pc.connectionState}")
        if pc.connectionState == "failed":
            await pc.close()
            # pcs popping handled in disconnect or here
            if sid in pcs: 
                del pcs[sid]

    # Video Track Logic
    # Check for file
    video_source = "cow_test.mp4" if os.path.exists("cow_test.mp4") else None
    
    # Define a helper to emit events from the track
    # CattleVideoTrack is synchronous in 'recv' usually, but can schedule async emits
    # We pass a thread-safe or loop-safe emit wrapper if needed, 
    # but since we are in asyncio now, we can just use sio.emit.
    # However, 'recv' in aiortc runs in a thread executor by default? 
    # Actually aiortc MediaStreamTrack.recv is async.
    
    # We need to make sure stream.py is async compatible.
    # Checking stream.py... It inherited from MediaStreamTrack and recv() is async def.
    # So we can await sio.emit inside it if we pass the async function.
    
    async def async_emit(event, data):
        await sio.emit(event, data)

    # Use webcam 0 if no file. In Docker, requires --device mapping.
    # If neither, we might fail unless we implement Synthetic.
    # For now, let's assume usage of file or cam.
    
    if video_source: 
        logger.info(f"Using video file: {video_source}")
        track = CattleVideoTrack(source=video_source, socket_emit=async_emit)
    else:
        logger.info("Using Camera (Index 0)")
        track = CattleVideoTrack(source=0, socket_emit=async_emit)
    
    track.fence = zone_manager
    track.actuator = actuator_manager
    pc.addTrack(track)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    
    logger.info(f"Generated Answer SDP: {pc.localDescription.sdp}")

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    }

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=5001)
