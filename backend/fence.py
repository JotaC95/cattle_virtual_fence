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

    def check_status(self, point, frame_width=640, frame_height=480):
        """
        Check if a point (x, y) is inside the safe zone.
        Point is in absolute pixels depending on the frame.
        safe_zone points are now expected to be relative (0.0 to 1.0).
        Returns: status_string, color_bgr
        """
        safe_zone_points = self.zones.get("safe_zone", [])
        
        if len(safe_zone_points) < 3:
            return "NO_ZONE", (200, 200, 200)

        # Scale relative points to match the current frame dimensions
        poly_points = []
        for p in safe_zone_points:
            # If coordinates are already absolute (legacy), fallback gracefully.
            # But assume they are relative <= 1.0 by default.
            x_scaled = p["x"] * frame_width if p["x"] <= 1.5 else p["x"]
            y_scaled = p["y"] * frame_height if p["y"] <= 1.5 else p["y"]
            poly_points.append((x_scaled, y_scaled))

        polygon = Polygon(poly_points)
        pt = Point(point)

        if polygon.contains(pt):
            # Check distance to boundary for WARNING
            dist = polygon.exterior.distance(pt)
            # Threshold relative to frame size, e.g. 5% of width
            warning_threshold = frame_width * 0.05
            if dist < warning_threshold: 
                return "WARNING", self.STATUS_COLORS["WARNING"]
            return "INTERNAL", self.STATUS_COLORS["INTERNAL"]
        else:
            return "OUT", self.STATUS_COLORS["OUT"]
