"""Isolated HA engine contract checks; not a live Home Assistant certification."""

import asyncio
import copy
import importlib.util
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

for name in [
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.http",
    "homeassistant.helpers",
    "homeassistant.helpers.storage",
    "homeassistant.helpers.event",
    "homeassistant.util",
    "homeassistant.util.dt",
]:
    sys.modules[name] = types.ModuleType(name)
sys.modules["homeassistant.components.http"].HomeAssistantView = object


class Store:
    def __init__(self, *args):
        self.value = None

    async def async_save(self, data):
        self.value = copy.deepcopy(data)


sys.modules["homeassistant.helpers.storage"].Store = Store
sys.modules["homeassistant.helpers.event"].async_track_time_interval = lambda *a: None
dt = sys.modules["homeassistant.util.dt"]
dt.now = lambda: datetime.now(timezone.utc)
dt.get_time_zone = lambda name: ZoneInfo(name)
spec = importlib.util.spec_from_file_location(
    "alfred_engine",
    Path(__file__).parents[1]
    / "integrations/home-assistant/custom_components/alfred/__init__.py",
    submodule_search_locations=[
        str(
            Path(__file__).parents[1]
            / "integrations/home-assistant/custom_components/alfred"
        )
    ],
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Services:
    def __init__(self):
        self.calls = []
        self.fail = False

    def has_service(self, domain, name):
        return domain == "notify" and name == "mobile_app_fixture"

    async def async_call(self, *args, **kwargs):
        self.calls.append(args)
        if self.fail:
            raise RuntimeError("uncertain")


class EngineTests(unittest.IsolatedAsyncioTestCase):
    def engine(self):
        hass = types.SimpleNamespace(services=Services())
        return module.Engine(hass)

    async def add(self, e, count=1):
        return await e.execute(
            "create_reminder",
            {
                "title": "Tea",
                "due_at": (
                    datetime.now(timezone.utc) + timedelta(minutes=2)
                ).isoformat(),
                "repeat_minutes": 15 if count > 1 else 0,
                "repeat_count": count,
            },
        )

    async def test_receipt_survives_restart_and_uncertainty(self):
        e = self.engine()
        await e.execute("configure", {"phone": "mobile_app_fixture"})
        await self.add(e)
        e.data["reminders"][0]["due_at"] = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        ).isoformat()
        e.hass.services.fail = True
        await e.tick()
        self.assertEqual(len(e.hass.services.calls), 1)
        self.assertEqual(e.hass.services.calls[0][2]["title"], "Alfred")
        restarted = self.engine()
        restarted.data = copy.deepcopy(e.store.value)
        await restarted.tick()
        self.assertEqual(len(restarted.hass.services.calls), 0)
        self.assertEqual(
            restarted.data["inbox"][0]["delivery_status"], "failed_or_uncertain"
        )

    async def test_pause_resume_and_bounded_recurrence(self):
        e = self.engine()
        r = (await self.add(e, 3))["item"]
        await e.execute("pause_reminder", {"id": r["id"]})
        self.assertTrue(e.data["reminders"][0]["paused"])
        await e.execute(
            "resume_reminder",
            {
                "id": r["id"],
                "due_at": (
                    datetime.now(timezone.utc) + timedelta(minutes=2)
                ).isoformat(),
            },
        )
        for _ in range(3):
            e.data["reminders"][0]["due_at"] = (
                datetime.now(timezone.utc) - timedelta(seconds=1)
            ).isoformat()
            await e.tick()
        self.assertEqual(len(e.data["inbox"]), 3)
        self.assertTrue(e.data["reminders"][0]["cancelled"])

    async def test_calendar_schedule_delivers_once_then_advances_without_minute_drift(
        self,
    ):
        e = self.engine()
        await e.execute("configure", {"phone": "mobile_app_fixture"})
        start = datetime.now(timezone.utc) + timedelta(days=7)
        from alfred_engine.calendar_rules import spec as calendar_spec

        schedule = calendar_spec(
            {
                "start": start.isoformat(),
                "end": (start + timedelta(minutes=30)).isoformat(),
                "recurrence_frequency": "weekly",
                "recurrence_count": 3,
                "reminder_minutes": 60,
                "reminder_delivery": "ha",
            },
            "Europe/London",
        )
        result = await e.execute(
            "create_reminder",
            {
                "title": "Daycare",
                "due_at": (start - timedelta(hours=1)).isoformat(),
                "calendar_schedule": schedule,
                "source_key": "google:fixture",
            },
        )
        e.data["reminders"][0]["due_at"] = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        ).isoformat()
        await e.tick()
        future = e.data["reminders"][0]["due_at"]
        await e.tick()
        self.assertEqual(len(e.data["inbox"]), 1)
        self.assertEqual(len(e.hass.services.calls), 1)
        self.assertEqual(e.data["reminders"][0]["due_at"], future)
        self.assertIn("calendar_schedule", e.store.value["reminders"][0])

    async def test_due_record_does_not_depend_on_mac(self):
        e = self.engine()
        await e.execute("configure", {"phone": "mobile_app_fixture"})
        await self.add(e)
        e.data["reminders"][0]["due_at"] = (
            datetime.now(timezone.utc) - timedelta(days=1)
        ).isoformat()
        await e.tick()
        await e.tick()
        self.assertEqual(len(e.hass.services.calls), 1)
        self.assertEqual(len(e.data["inbox"]), 1)

    async def test_import_idempotency_and_historical_inbox(self):
        e = self.engine()
        item = {
            "id": "one",
            "title": "Tea",
            "due_at": (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(),
            "repeat_minutes": 0,
        }
        a = {
            "import_id": "a" * 64,
            "items": [item],
            "inbox": [{"id": "old", "title": "Old alert"}],
            "preferences": {},
        }
        await e.execute("import", a)
        await e.execute("import", a)
        self.assertEqual(len(e.data["reminders"]), 1)
        self.assertEqual(e.data["inbox"][0]["delivery_status"], "historical")

    async def test_daily_digest_claim_and_restart(self):
        e = self.engine()
        await e.execute("configure", {"phone": "mobile_app_fixture"})
        await e.execute(
            "configure_digest",
            {"enabled": True, "time": "00:00", "timezone": "Europe/London"},
        )
        await e.execute(
            "publish_news",
            {
                "items": [
                    {
                        "title": "Story",
                        "url": "https://example.org/story",
                        "retrieved_at": module.stamp(),
                    }
                ]
            },
        )
        await e.tick()
        await e.tick()
        self.assertEqual(len(e.hass.services.calls), 1)
        restart = self.engine()
        restart.data = copy.deepcopy(e.store.value)
        await restart.tick()
        self.assertEqual(len(restart.hass.services.calls), 0)

    async def test_inbox_reminder_without_phone(self):
        e = self.engine()
        await e.execute("configure", {"phone": ""})
        r = await self.add(e)
        self.assertFalse(r["delivery_ready"])
        e.data["reminders"][0]["due_at"] = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        ).isoformat()
        await e.tick()
        self.assertEqual(len(e.data["inbox"]), 1)
        self.assertEqual(len(e.hass.services.calls), 0)

    async def test_unregistered_notify_target_refused(self):
        with self.assertRaises(ValueError):
            await self.engine().execute("configure", {"phone": "all_devices"})

    async def test_weekday_and_inbox_only_digest(self):
        e = self.engine()
        tomorrow = (
            datetime.now(timezone.utc)
            .astimezone(ZoneInfo("Europe/London"))
            .isoweekday()
            % 7
            + 1
        )
        await e.execute(
            "configure_digest",
            {
                "enabled": True,
                "time": "00:00",
                "timezone": "Europe/London",
                "weekdays": [tomorrow],
                "delivery": "inbox",
            },
        )
        await e.execute(
            "publish_news",
            {
                "items": [
                    {
                        "title": "Story",
                        "url": "https://example.org",
                        "retrieved_at": module.stamp(),
                    }
                ]
            },
        )
        await e.tick()
        self.assertEqual(len(e.data["inbox"]), 0)
        await e.execute(
            "configure_digest",
            {
                "enabled": True,
                "time": "00:00",
                "timezone": "Europe/London",
                "weekdays": [1, 2, 3, 4, 5, 6, 7],
                "delivery": "inbox",
            },
        )
        await e.tick()
        self.assertEqual(e.data["inbox"][0]["delivery_status"], "inbox_only")
        self.assertEqual(len(e.hass.services.calls), 0)

    async def test_email_digest_waits_for_backend_receipt(self):
        e = self.engine()
        await e.execute(
            "configure_digest",
            {
                "enabled": True,
                "time": "00:00",
                "timezone": "Europe/London",
                "delivery": "email",
            },
        )
        await e.execute(
            "publish_news",
            {
                "items": [
                    {
                        "title": "Story",
                        "url": "https://example.org",
                        "retrieved_at": module.stamp(),
                    }
                ]
            },
        )
        await e.tick()
        item = e.data["inbox"][0]
        self.assertEqual(item["delivery_status"], "pending_email")
        await e.execute("ack_digest_email", {"id": item["id"], "status": "accepted"})
        self.assertEqual(e.data["inbox"][0]["delivery_status"], "accepted")

    async def test_feedreader_accepts_only_explicitly_selected_sources(self):
        e = self.engine()
        await e.execute("configure_feedreader", {"urls": ["https://example.org/feed"]})
        await e.feedreader_event(
            types.SimpleNamespace(
                data={
                    "feed_url": "https://private.example.org/feed",
                    "title": "Private",
                    "link": "https://private.example.org/item",
                }
            )
        )
        self.assertEqual((await e.execute("list_feedreader_news", {}))["items"], [])
        await e.feedreader_event(
            types.SimpleNamespace(
                data={
                    "feed_url": "https://example.org/feed",
                    "title": "Public",
                    "link": "https://example.org/item",
                }
            )
        )
        self.assertEqual(len((await e.execute("list_feedreader_news", {}))["items"]), 1)

    async def test_slow_notify_does_not_block_read_api(self):
        e = self.engine()
        await e.execute("configure", {"phone": "mobile_app_fixture"})
        await self.add(e)
        e.data["reminders"][0]["due_at"] = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        ).isoformat()
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow(*a, **k):
            started.set()
            await release.wait()

        e.hass.services.async_call = slow
        task = asyncio.create_task(e.tick())
        await started.wait()
        result = await asyncio.wait_for(e.execute("list_reminders", {}), 0.1)
        self.assertEqual(len(result["inbox"]), 1)
        release.set()
        await task


if __name__ == "__main__":
    unittest.main()
