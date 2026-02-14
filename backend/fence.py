import json
import cv2
import numpy as np
from shapely.geometry import Point, Polygon

class ZoneManager:
    def __init__(self, zone_file="zones.json"):
        self.zone_file = zone_file
        self.zones = self.load_zones()
        # Default status colors
        self.STATUS_COLORS = {
            "INTERNAL": (0, 255, 0),   # Green
            "WARNING": (0, 255, 255),  # Yellow
            "OUT": (0, 0, 255)         # Red
        }

    def load_zones(self):
        try:
            with open(self.zone_file, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            # Default empty zone or a preset one for testing
            return {"safe_zone": []}

    def save_zones(self, zones):
        self.zones = zones
        with open(self.zone_file, "w") as f:
            json.dump(zones, f)

    def check_status(self, point):
        """
        Check if a point (x, y) is inside the safe zone.
        Returns: status_string, color_bgr
        """
        safe_zone_points = self.zones.get("safe_zone", [])
        
        if len(safe_zone_points) < 3:
            return "NO_ZONE", (200, 200, 200)

        poly_points = [(p["x"], p["y"]) for p in safe_zone_points]
        polygon = Polygon(poly_points)
        pt = Point(point)

        if polygon.contains(pt):
            # Check distance to boundary for WARNING
            dist = polygon.exterior.distance(pt)
            # Threshold hardcoded for now, could be dynamic
            if dist < 50: 
                return "WARNING", self.STATUS_COLORS["WARNING"]
            return "INTERNAL", self.STATUS_COLORS["INTERNAL"]
        else:
            return "OUT", self.STATUS_COLORS["OUT"]
