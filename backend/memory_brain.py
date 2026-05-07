import logging
from engram import Memory

logger = logging.getLogger("CattleBrain")


class CattleBrain:
    """
    Persistent memory layer for the cattle fence system using engram-core.
    Stores fence crossings, person detections, and supports natural-language
    queries over the accumulated history.
    """

    def __init__(self):
        self.mem = Memory(namespace="cattle_fence")
        logger.info("CattleBrain initialized. Stats: %s", self.mem.stats())

    # ------------------------------------------------------------------ #
    # Recording                                                            #
    # ------------------------------------------------------------------ #

    def record_crossing(self, cow_id: int, action: str, centroid, timestamp: str):
        direction = "exited" if action == "activated" else "returned to"
        content = (
            f"Cow #{cow_id} {direction} the fence zone at {timestamp}."
            + (f" Position centroid: {centroid}." if centroid else "")
        )
        self.mem.store(
            content=content,
            memory_type="fence_crossing",
            importance=7,
            tags=[f"cow_{cow_id}", "crossing", action],
        )
        logger.info("Brain recorded: %s", content)

    def record_person(self, person_ids: list, timestamp: str):
        content = (
            f"Person detected at {timestamp}. "
            f"Tracking IDs: {person_ids}. Count: {len(person_ids)}."
        )
        self.mem.store(
            content=content,
            memory_type="person_alert",
            importance=9,
            tags=["person", "alert"],
        )
        logger.info("Brain recorded: %s", content)

    # ------------------------------------------------------------------ #
    # Querying                                                             #
    # ------------------------------------------------------------------ #

    def query(self, question: str) -> list:
        """Semantic / keyword search over stored memories."""
        try:
            results = self.mem.search(question, limit=10)
            return results if isinstance(results, list) else []
        except Exception as e:
            logger.warning("Brain query error: %s", e)
            return []

    def recent_summary(self, limit: int = 8) -> list:
        """Return most recent memories for dashboard display."""
        try:
            results = self.mem.recall(limit=limit)
            return results if isinstance(results, list) else []
        except Exception as e:
            logger.warning("Brain recall error: %s", e)
            return []

    def stats(self) -> dict:
        try:
            return self.mem.stats()
        except Exception as e:
            logger.warning("Brain stats error: %s", e)
            return {}
