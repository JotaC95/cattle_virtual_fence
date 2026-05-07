import asyncio
import logging
import os
import time
from datetime import datetime, timezone

logger = logging.getLogger("Actuator")


class ActuatorManager:
    PERSON_COOLDOWN = 30  # seconds before re-alerting for the same person presence

    def __init__(self, webhook_url: str | None = None, brain=None):
        self.webhook_url = webhook_url or os.getenv("ACTUATOR_WEBHOOK_URL", "")
        self.brain = brain  # CattleBrain instance (optional)
        # Cow IDs currently in a breach state (OUT)
        self.active_breaches: set[int] = set()
        self._last_person_alert: float = 0.0

    # ------------------------------------------------------------------ #
    # Fence crossing                                                       #
    # ------------------------------------------------------------------ #

    async def on_cow_status(self, cow_id: int, status: str, emit_fn, centroid=None):
        """
        Call every frame with the current fence status of a tracked cow.
        Fires actuator events only on state transitions.
        """
        if status == "OUT" and cow_id not in self.active_breaches:
            self.active_breaches.add(cow_id)
            await self._dispatch(
                "breach",
                {"cow_id": cow_id, "action": "activated"},
                emit_fn,
                event_name="actuator_event",
                centroid=centroid,
            )
        elif status not in ("OUT",) and cow_id in self.active_breaches:
            self.active_breaches.discard(cow_id)
            await self._dispatch(
                "return",
                {"cow_id": cow_id, "action": "deactivated"},
                emit_fn,
                event_name="actuator_event",
                centroid=centroid,
            )

    # ------------------------------------------------------------------ #
    # Person detection alert                                               #
    # ------------------------------------------------------------------ #

    async def on_persons(self, person_ids: list[int], emit_fn):
        """
        Call every frame with the list of currently detected person tracking IDs.
        Respects cooldown to avoid flooding the client.
        """
        if not person_ids:
            return
        now = time.time()
        if now - self._last_person_alert < self.PERSON_COOLDOWN:
            return
        self._last_person_alert = now
        await self._dispatch(
            "person_alert",
            {"person_ids": person_ids, "count": len(person_ids)},
            emit_fn,
            event_name="alert",
        )

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    async def _dispatch(self, event_type: str, data: dict, emit_fn, event_name: str, centroid=None):
        payload = {
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **data,
        }
        logger.info("Actuator dispatch: %s", payload)

        # Record in persistent memory (async HTTP call to Engram server)
        if self.brain:
            try:
                ts = payload["timestamp"]
                if event_type in ("breach", "return"):
                    await self.brain.record_crossing(payload["cow_id"], payload["action"], centroid, ts)
                elif event_type == "person_alert":
                    await self.brain.record_person(payload["person_ids"], ts)
            except Exception as e:
                logger.warning("Brain record error: %s", e)

        try:
            if asyncio.iscoroutinefunction(emit_fn):
                await emit_fn(event_name, payload)
            else:
                emit_fn(event_name, payload)
        except Exception as e:
            logger.warning("Emit error: %s", e)

        if self.webhook_url:
            asyncio.create_task(self._post_webhook(payload))

    async def _post_webhook(self, payload: dict):
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                await session.post(
                    self.webhook_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=5),
                )
        except Exception as e:
            logger.warning("Webhook POST failed: %s", e)
