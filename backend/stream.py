import cv2
import asyncio
import time
import numpy as np
from av import VideoFrame
from aiortc import VideoStreamTrack
from vision import VisionEngine
from fence import ZoneManager
from actuator import ActuatorManager

# Colors for bounding boxes drawn on video (BGR)
PERSON_COLOR = (0, 140, 255)
ALLOWED_COLOR = (100, 200, 0)
INACTIVE_COLOR = (128, 128, 128)

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
        self.actuator = ActuatorManager()
        self.socket_emit = socket_emit

        # Performance control
        self.last_process_time = 0
        self.process_interval = 1.0 / 30  # Cap at 30 FPS processing if possible

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # Capture frame
        ret, frame = self.cap.read()
        if not ret:
            # Loop video if file
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = self.cap.read()

        if not ret:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            frame[:] = (100, 0, 0)
            cv2.putText(frame, "NO VIDEO SOURCE", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            t = int(time.time() * 10) % 640
            cv2.circle(frame, (t, 400), 20, (0, 255, 255), -1)

        # Process frame with YOLO
        processed_frame, detections = self.vision.process_frame(frame)

        # Separate cattle (cow/sheep) from persons
        cow_states = []
        person_states = []

        for det in detections:
            if det["class_type"] == "person":
                det["status"] = "DETECTED"
                person_states.append(det)
                x1, y1, x2, y2 = det["bbox"]
                cv2.rectangle(processed_frame, (x1, y1), (x2, y2), PERSON_COLOR, 2)
                cv2.putText(processed_frame, f"PERSON {det['id']}", (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, PERSON_COLOR, 2)
            else:
                status, color = self.fence.check_status(det["centroid"], entity_id=det["id"])
                det["status"] = status
                cow_states.append(det)
                x1, y1, x2, y2 = det["bbox"]
                cv2.rectangle(processed_frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(processed_frame, f"ID: {det['id']} {status}", (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Fire actuator events on fence-crossing transitions and person detections
        if self.socket_emit:
            for det in cow_states:
                await self.actuator.on_cow_status(det["id"], det["status"], self.socket_emit)
            person_ids = [p["id"] for p in person_states]
            await self.actuator.on_persons(person_ids, self.socket_emit)

        # Draw safe zone polygon
        safe_zone = self.fence.zones.get("safe_zone", [])
        if len(safe_zone) > 0:
            pts_poly = np.array([[p["x"], p["y"]] for p in safe_zone], np.int32)
            pts_poly = pts_poly.reshape((-1, 1, 2))
            cv2.polylines(processed_frame, [pts_poly], True, (0, 255, 0), 2)

        # Emit state via SocketIO
        if self.socket_emit:
            payload = {
                "cows": cow_states,
                "persons": person_states,
                "zones": self.fence.zones,
            }
            try:
                if asyncio.iscoroutinefunction(self.socket_emit):
                    await self.socket_emit("state", payload)
                else:
                    self.socket_emit("state", payload)
            except Exception as e:
                print(f"Emit Error: {e}")

        if pts % 90000 == 0:
            print(f"Sending frame PTS={pts} | cows={len(cow_states)} persons={len(person_states)}")

        new_frame = VideoFrame.from_ndarray(processed_frame, format="bgr24")
        new_frame.pts = pts
        new_frame.time_base = time_base
        return new_frame

    def stop(self):
        self.cap.release()
