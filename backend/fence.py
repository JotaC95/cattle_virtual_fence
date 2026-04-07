import json
from shapely.geometry import Point, Polygon


class ZoneManager:
    def __init__(self, zone_file="zones.json"):
        self.zone_file = zone_file
        self.zones = self.load_zones()
        self.STATUS_COLORS = {
            "INTERNAL": (0, 255, 0),   # Green
            "WARNING":  (0, 255, 255), # Yellow
            "OUT":      (0, 0, 255)    # Red
        }

    def load_zones(self):
        try:
            with open(self.zone_file, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            return {"safe_zone": []}

    @staticmethod
    def _validate_zones(zones):
        """
        Validate zone data before saving.
        Raises ValueError with a descriptive message if data is invalid.
        """
        if not isinstance(zones, dict):
            raise ValueError("Zone data must be a JSON object")

        safe_zone = zones.get("safe_zone")
        if safe_zone is None:
            raise ValueError("Missing 'safe_zone' key")
        if not isinstance(safe_zone, list):
            raise ValueError("'safe_zone' must be an array")
        if len(safe_zone) > 0 and len(safe_zone) < 3:
            raise ValueError("'safe_zone' must have at least 3 points (or be empty)")
        if len(safe_zone) > 100:
            raise ValueError("'safe_zone' exceeds maximum of 100 points")

        VIDEO_W, VIDEO_H = 640, 480
        for i, point in enumerate(safe_zone):
            if not isinstance(point, dict):
                raise ValueError(f"Point {i} must be an object {{x, y}}")
            if "x" not in point or "y" not in point:
                raise ValueError(f"Point {i} missing 'x' or 'y' key")
            x, y = point["x"], point["y"]
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                raise ValueError(f"Point {i}: x and y must be numbers")
            if not (0 <= x <= VIDEO_W) or not (0 <= y <= VIDEO_H):
                raise ValueError(
                    f"Point {i}: coordinates ({x},{y}) out of range "
                    f"[0,{VIDEO_W}] x [0,{VIDEO_H}]"
                )

    def save_zones(self, zones):
        self._validate_zones(zones)
        # Normalize coordinates to int
        normalized = {
            "safe_zone": [
                {"x": int(p["x"]), "y": int(p["y"])}
                for p in zones.get("safe_zone", [])
            ]
        }
        self.zones = normalized
        with open(self.zone_file, "w") as f:
            json.dump(normalized, f)

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
            dist = polygon.exterior.distance(pt)
            if dist < 50:
                return "WARNING", self.STATUS_COLORS["WARNING"]
            return "INTERNAL", self.STATUS_COLORS["INTERNAL"]
        else:
            return "OUT", self.STATUS_COLORS["OUT"]
