import logging
import os

import aiohttp

logger = logging.getLogger("CattleBrain")

ENGRAM_BASE_URL = os.getenv("ENGRAM_URL", "http://localhost:7437")
ENGRAM_PROJECT = os.getenv("ENGRAM_PROJECT", "cattle-fence")


class CattleBrain:
    """
    Memory layer backed by the Gentleman-Programming/engram HTTP server.
    https://github.com/Gentleman-Programming/engram

    Start the server before running the backend:
        engram serve           # defaults to :7437
        ENGRAM_PORT=7437 engram serve

    All methods are async and degrade gracefully when the server is unreachable.
    """

    def __init__(self):
        self.base_url = ENGRAM_BASE_URL.rstrip("/")
        self.project = ENGRAM_PROJECT
        logger.info("CattleBrain → %s (project: %s)", self.base_url, self.project)

    # ------------------------------------------------------------------ #
    # Recording                                                            #
    # ------------------------------------------------------------------ #

    async def record_crossing(self, cow_id: int, action: str, centroid, timestamp: str):
        direction = "exited" if action == "activated" else "returned to"
        centroid_str = f" Centroid: {centroid}." if centroid else ""
        await self._post_observation(
            title=f"Cow #{cow_id} {direction} fence zone",
            content=f"Cow #{cow_id} {direction} the fence zone at {timestamp}.{centroid_str}",
            obs_type="incident",
            topic=f"cow_{cow_id}",
        )

    async def record_person(self, person_ids: list, timestamp: str):
        await self._post_observation(
            title=f"Person detected ({len(person_ids)} in frame)",
            content=f"Person detected at {timestamp}. Tracking IDs: {person_ids}. Count: {len(person_ids)}.",
            obs_type="incident",
            topic="person_detection",
        )

    # ------------------------------------------------------------------ #
    # Querying                                                             #
    # ------------------------------------------------------------------ #

    async def query(self, question: str) -> list:
        """Search observations via GET /observations?q=<question>&project=<project>."""
        try:
            params = {"project": self.project}
            if question.strip():
                params["q"] = question.strip()
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}/observations",
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    data = await resp.json()
                    items = data.get("data", data) if isinstance(data, dict) else data
                    raw = items if isinstance(items, list) else []
                    return [self._fmt(i) for i in raw]
        except Exception as e:
            logger.warning("Brain query error: %s", e)
            return []

    async def recent_summary(self, limit: int = 8) -> list:
        """Return the most recent observations (no query filter)."""
        results = await self.query("")
        return results[:limit]

    async def stats(self) -> dict:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}/projects/{self.project}/stats",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    return await resp.json()
        except Exception as e:
            logger.warning("Brain stats error: %s", e)
            return {}

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    async def _post_observation(self, title: str, content: str, obs_type: str, topic: str):
        payload = {
            "title": title,
            "type": obs_type,
            "content": content,
            "project": self.project,
            "topic": topic,
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/observations",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    logger.info("Brain saved [%s]: %s", resp.status, title)
        except Exception as e:
            logger.warning("Brain save error (engram server down?): %s", e)

    @staticmethod
    def _fmt(item: dict) -> dict:
        return {
            "content": item.get("content", item.get("title", str(item))),
            "title": item.get("title", ""),
            "timestamp": item.get("created_at", ""),
            "type": item.get("type", ""),
        }
