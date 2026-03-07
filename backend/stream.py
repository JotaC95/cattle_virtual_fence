import cv2
import asyncio
import time
import numpy as np
from av import VideoFrame
from aiortc import VideoStreamTrack
from vision import VisionEngine
from fence import ZoneManager

class CattleVideoTrack(VideoStreamTrack):
    """
    A video stream track that captures from a webcam/file, 
    processes it with YOLO, and emits state via SocketIO.
    """
    kind = "video"

    def __init__(self, source=0, socket_emit=None):
        super().__init__()
        self.cap = cv2.VideoCapture(source)
        self.vision = VisionEngine()
        self.fence = ZoneManager()
        self.socket_emit = socket_emit
        
        # Performance control
        self.last_process_time = 0
        self.process_interval = 1.0 / 30  # Cap at 30 FPS processing if possible

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # Capture frame (blocking call, ideal to run in executor but ok for MVP)
        ret, frame = self.cap.read()
        if not ret:
            # Loop video if file
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = self.cap.read()
            
        if not ret:
            # Generate Synthetic Frame (Blue Background with bouncing Text)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            frame[:] = (100, 0, 0) # Blue background
            cv2.putText(frame, "NO VIDEO SOURCE", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            # Add moving element to prove stream is alive
            t = int(time.time() * 10) % 640
            cv2.circle(frame, (t, 400), 20, (0, 255, 255), -1)

        # Process frame
        current_time = time.time()
        
        # Process logic
        processed_frame, detections = self.vision.process_frame(frame)
        frame_h, frame_w = processed_frame.shape[:2]
        
        # Check fences and prepare payload
        cow_states = []
        for det in detections:
            status, color = self.fence.check_status(det["centroid"], frame_width=frame_w, frame_height=frame_h)
            det["status"] = status
            cow_states.append(det)
            
            # Optional: Draw zones/status on frame if requested "processed video"
            # Draw bbox with status color
            x1, y1, x2, y2 = det["bbox"]
            cv2.rectangle(processed_frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(processed_frame, f"ID: {det['id']} {status}", (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Draw Zone on video for visual confirmation
        safe_zone = self.fence.zones.get("safe_zone", [])
        if len(safe_zone) > 0:
            pts_scaled = []
            for p in safe_zone:
                px = int(p["x"] * frame_w if p["x"] <= 1.5 else p["x"])
                py = int(p["y"] * frame_h if p["y"] <= 1.5 else p["y"])
                pts_scaled.append([px, py])
                
            pts_poly = np.array(pts_scaled, np.int32)
            pts_poly = pts_poly.reshape((-1, 1, 2))
            cv2.polylines(processed_frame, [pts_poly], True, (0, 255, 0), 2)

        # Emit state via SocketIO
        if self.socket_emit:
            payload = {
                "cows": cow_states,
                "zones": self.fence.zones
            }
            try:
                # In asyncio mode, this must be awaited
                if asyncio.iscoroutinefunction(self.socket_emit):
                    await self.socket_emit("state", payload)
                else:
                    self.socket_emit("state", payload)
            except Exception as e:
                print(f"Emit Error: {e}")

        # logging to confirm frame flow (once every 30 frames to avoid spam)
        if pts % 90000 == 0: # approx every 1 sec since default timebase is 1/90000
             print(f"Sending frame PTS={pts}")

        # Convert to av.VideoFrame
        new_frame = VideoFrame.from_ndarray(processed_frame, format="bgr24")
        new_frame.pts = pts
        new_frame.time_base = time_base
        return new_frame

    def stop(self):
        self.cap.release()
