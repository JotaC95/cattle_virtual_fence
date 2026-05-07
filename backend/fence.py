import json
import cv2
import numpy as np
from shapely.geometry import Point, Polygon

class ZoneManager:
    def __init__(self, zone_file="zones.json"):
        self.zone_file = zone_file
        self.zones = {}
        self.fence_active = True
        self.allowed_ids = set()
        self._load()

        self.STATUS_COLORS = {
            "INTERNAL": (0, 255, 0),    # Green
            "WARNING":  (0, 255, 255),  # Yellow
            "OUT":      (0, 0, 255),    # Red
            "ALLOWED":  (100, 200, 0),  # Lime green
            "INACTIVE": (128, 128, 128),# Gray
        }

    # ------------------------------------------------------------------ #
    # Persistence                                                          #
    # ------------------------------------------------------------------ #

    def _load(self):
        try:
            with open(self.zone_file, "r") as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {}

        self.zones = {"safe_zone": data.get("safe_zone", [])}
        self.fence_active = data.get("fence_active", True)
        self.allowed_ids = set(data.get("allowed_ids", []))

    # Keep backward-compatible property used by stream.py
    @property
    def zones_dict(self):
        return self.zones

    def _persist(self):
        payload = {
            "safe_zone": self.zones.get("safe_zone", []),
            "fence_active": self.fence_active,
            "allowed_ids": list(self.allowed_ids),
        }
        with open(self.zone_file, "w") as f:
            json.dump(payload, f)

    def load_zones(self):
        self._load()
        return self.zones

    def save_zones(self, zones):
        self.zones = zones
        self._persist()

    # ------------------------------------------------------------------ #
    # Fence controls                                                       #
    # ------------------------------------------------------------------ #

    def toggle_active(self):
        self.fence_active = not self.fence_active
        self._persist()

    def set_allowed(self, cow_id: int, allow: bool):
        if allow:
            self.allowed_ids.add(cow_id)
        else:
            self.allowed_ids.discard(cow_id)
        self._persist()

    def fence_config(self) -> dict:
        return {
            "fence_active": self.fence_active,
            "allowed_ids": list(self.allowed_ids),
        }

    # ------------------------------------------------------------------ #
    # Status check                                                         #
    # ------------------------------------------------------------------ #

    def check_status(self, point, entity_id=None):
        """
        Returns (status_string, color_bgr) for a detected entity.
        entity_id: optional int tracking ID to check against allowed list.
        """
        if not self.fence_active:
            return "INACTIVE", self.STATUS_COLORS["INACTIVE"]

        safe_zone_points = self.zones.get("safe_zone", [])
        if len(safe_zone_points) < 3:
            return "NO_ZONE", (200, 200, 200)

        poly_points = [(p["x"], p["y"]) for p in safe_zone_points]
        polygon = Polygon(poly_points)
        pt = Point(point)

        if polygon.contains(pt):
            dist = polygon.exterior.distance(pt)
            if dist < 50:
                return "WARNING", self.STATUS_COLORS["WARNING"]
            return "INTERNAL", self.STATUS_COLORS["INTERNAL"]
        else:
            if entity_id is not None and entity_id in self.allowed_ids:
                return "ALLOWED", self.STATUS_COLORS["ALLOWED"]
            return "OUT", self.STATUS_COLORS["OUT"]
