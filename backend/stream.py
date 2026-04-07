import asyncio
import time
import cv2
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

    def __init__(self, source=0, socket_emit=None, zone_manager=None):
        super().__init__()
        self.cap = cv2.VideoCapture(source)
        self.vision = VisionEngine()
        # Accept an external ZoneManager; create a default one only as fallback
        self.fence = zone_manager if zone_manager is not None else ZoneManager()
        self.socket_emit = socket_emit

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # Read frame in a thread executor so we don't block the asyncio event loop
        loop = asyncio.get_event_loop()
        ret, frame = await loop.run_in_executor(None, self.cap.read)

        if not ret:
            # Loop video file back to start
            await loop.run_in_executor(
                None, lambda: self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            )
            ret, frame = await loop.run_in_executor(None, self.cap.read)

        if not ret:
            # Synthetic fallback frame
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            frame[:] = (100, 0, 0)
            cv2.putText(frame, "NO VIDEO SOURCE", (50, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            t = int(time.time() * 10) % 640
            cv2.circle(frame, (t, 400), 20, (0, 255, 255), -1)

        # Run YOLO inference (CPU-bound) in executor as well
        processed_frame, detections = await loop.run_in_executor(
            None, self.vision.process_frame, frame
        )

        # Check fences and annotate
        cow_states = []
        for det in detections:
            status, color = self.fence.check_status(det["centroid"])
            det["status"] = status
            cow_states.append(det)

            x1, y1, x2, y2 = det["bbox"]
            cv2.rectangle(processed_frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(processed_frame, f"ID:{det['id']} {status}",
                        (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Draw safe zone polygon
        safe_zone = self.fence.zones.get("safe_zone", [])
        if len(safe_zone) > 0:
            pts_poly = np.array([[p["x"], p["y"]] for p in safe_zone], np.int32)
            pts_poly = pts_poly.reshape((-1, 1, 2))
            cv2.polylines(processed_frame, [pts_poly], True, (0, 255, 0), 2)

        # Emit detection state via SocketIO
        if self.socket_emit:
            payload = {"cows": cow_states, "zones": self.fence.zones}
            try:
                if asyncio.iscoroutinefunction(self.socket_emit):
                    await self.socket_emit("state", payload)
                else:
                    self.socket_emit("state", payload)
            except Exception as e:
                print(f"Emit Error: {e}")

        if pts % 90000 == 0:
            print(f"Sending frame PTS={pts}")

        new_frame = VideoFrame.from_ndarray(processed_frame, format="bgr24")
        new_frame.pts = pts
        new_frame.time_base = time_base
        return new_frame

    def stop(self):
        self.cap.release()
        super().stop()
