"""Durable reminders. Claim delivery before I/O; never replay uncertain sends.

Experimental custom integration: back up HA before installing. Records and
notification attempts live in HA Store, not timers or the Alfred Mac process.
"""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import re
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util
from .calendar_rules import spec as calendar_spec, next_event

DOMAIN = "alfred"


def stamp():
    return datetime.now(timezone.utc).isoformat()


def due(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)", value
    ):
        raise ValueError("Use an RFC3339 due time with timezone.")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def quiet_now(data):
    q = data.get("preferences", {}).get("quietHours", {})
    if not q.get("enabled"):
        return False
    now = dt_util.now().strftime("%H:%M")
    a, b = q["start"], q["end"]
    return a <= now < b if a < b else now >= a or now < b


class Engine:
    def __init__(self, hass):
        self.hass = hass
        self.store = Store(hass, 1, "alfred.reminders")
        self.lock = asyncio.Lock()
        self.data = {
            "version": 1,
            "reminders": [],
            "inbox": [],
            "preferences": {},
            "phone": "",
            "imports": [],
        }

    async def tick(self, _=None):
        if not getattr(self.hass, "is_running", True):
            return
        async with self.lock:
            d = deepcopy(self.data)
            now = datetime.now(timezone.utc)
            digest = d.get("news_digest", {})
            if digest.get("enabled") and d.get("news"):
                local = now.astimezone(dt_util.get_time_zone(digest["timezone"]))
                day = local.date().isoformat()
                fresh = [
                    x
                    for x in d["news"]
                    if now - due(x["retrieved_at"]) < timedelta(hours=24)
                ]
                if (
                    local.isoweekday() in digest.get("weekdays", [1, 2, 3, 4, 5, 6, 7])
                    and fresh
                    and local.strftime("%H:%M") >= digest["time"]
                    and digest.get("last_day") != day
                    and len(d["inbox"]) < 200
                ):
                    title = "Daily headlines\n" + "\n".join(
                        x["title"] + " — " + x["url"] for x in fresh[:5]
                    )
                    d["inbox"].append(
                        {
                            "id": str(uuid4()),
                            "reminder_id": "news-digest",
                            "title": title,
                            "due_at": stamp(),
                            "delivered_at": stamp(),
                            "delivery_status": {
                                "ha": "pending",
                                "email": "pending_email",
                                "inbox": "inbox_only",
                            }.get(digest.get("delivery", "ha"), "inbox_only"),
                        }
                    )
                    digest["last_day"] = day
            for r in d["reminders"]:
                if r.get("cancelled") or r.get("paused") or due(r["due_at"]) > now:
                    continue
                if len(d["inbox"]) >= 200:
                    break
                d["inbox"].append(
                    {
                        "id": str(uuid4()),
                        "reminder_id": r["id"],
                        "title": r["title"],
                        "due_at": r["due_at"],
                        "delivered_at": stamp(),
                        "delivery_status": "pending",
                    }
                )
                if r.get("calendar_schedule"):
                    s = r["calendar_schedule"]
                    offset = timedelta(minutes=s["reminder_minutes"])
                    occurrence = next_event(s, now + offset)
                    if occurrence:
                        r["due_at"] = (occurrence - offset).isoformat()
                    else:
                        r["cancelled"] = True
                    continue
                if isinstance(r.get("remaining"), int):
                    r["remaining"] -= 1
                repeat = r.get("repeat_minutes", 0)
                if repeat and r.get("remaining", 1) > 0:
                    interval = timedelta(minutes=repeat)
                    missed = (now - due(r["due_at"])) // interval + 1
                    r["due_at"] = (due(r["due_at"]) + missed * interval).isoformat()
                else:
                    r["cancelled"] = True
            if d != self.data:
                await self.store.async_save(d)
                self.data = d
            self.data = d
            if (
                not d.get("phone")
                or not self.hass.services.has_service("notify", d["phone"])
                or quiet_now(d)
            ):
                return
            claimed = []
            for item in d["inbox"]:
                if item.get("delivery_status") != "pending":
                    continue
                item["delivery_status"] = "sending_or_uncertain"
                claimed.append(deepcopy(item))
                if len(claimed) >= 5:
                    break
            if claimed:
                await self.store.async_save(d)
            phone = d["phone"]
        # Notification I/O must not hold the storage/API lock. Reads and new
        # reminders remain responsive even if a notify service is slow.
        for item in claimed:
            status = "accepted"
            try:
                await asyncio.wait_for(
                    self.hass.services.async_call(
                        "notify",
                        phone,
                        {
                            "title": "Alfred",
                            "message": item["title"]
                            .encode("utf8")[:2500]
                            .decode("utf8", "ignore"),
                            "data": {
                                "tag": "alfred-" + item["id"],
                                "icon_url": "/alfred/app/assets/alfred-icon-192.png",
                            },
                        },
                        blocking=True,
                    ),
                    timeout=2.5,
                )
            except Exception:
                status = "failed_or_uncertain"
            async with self.lock:
                updated = deepcopy(self.data)
                current = next(
                    (x for x in updated["inbox"] if x["id"] == item["id"]), None
                )
                if current is not None:
                    current["delivery_status"] = status
                    await self.store.async_save(updated)
                    self.data = updated

    async def feedreader_event(self, event):
        data = event.data
        async with self.lock:
            if data.get("feed_url") not in self.data.get("feedreader_urls", []):
                return
            if (
                not isinstance(data.get("title"), str)
                or not isinstance(data.get("link"), str)
                or not data["link"].startswith("https://")
            ):
                return
            updated = deepcopy(self.data)
            item = {
                "feed_url": data["feed_url"],
                "title": data["title"][:250],
                "url": data["link"][:2048],
                "retrieved_at": stamp(),
            }
            updated["feedreader_items"] = [item] + [
                x
                for x in updated.get("feedreader_items", [])
                if x["url"] != item["url"]
            ]
            updated["feedreader_items"] = updated["feedreader_items"][:100]
            await self.store.async_save(updated)
            self.data = updated

    async def execute(self, action, a):
        async with self.lock:
            d = deepcopy(self.data)
            result = {"saved": True}
            if action == "publish_news":
                items = a.get("items")
                if (
                    not isinstance(items, list)
                    or len(items) > 8
                    or any(
                        not isinstance(x.get("title"), str)
                        or len(x["title"]) > 250
                        or not isinstance(x.get("url"), str)
                        or not x["url"].startswith("https://")
                        or len(x["url"]) > 2048
                        for x in items
                    )
                ):
                    raise ValueError("Invalid news cache.")
                for x in items:
                    due(x["retrieved_at"])
                d["news"] = items
            elif action == "ack_digest_email":
                item = next(
                    (
                        i
                        for i in d["inbox"]
                        if i["id"] == a.get("id")
                        and i.get("reminder_id") == "news-digest"
                    ),
                    None,
                )
                if (
                    item is None
                    or item.get("delivery_status") != "pending_email"
                    or a.get("status") not in ("accepted", "failed_or_uncertain")
                ):
                    raise ValueError("Invalid digest acknowledgement.")
                item["delivery_status"] = a["status"]
            elif action == "configure_feedreader":
                urls = a.get("urls")
                if (
                    not isinstance(urls, list)
                    or len(urls) > 12
                    or any(
                        not isinstance(u, str)
                        or not u.startswith("https://")
                        or len(u) > 2048
                        for u in urls
                    )
                ):
                    raise ValueError("Invalid feed source configuration.")
                d["feedreader_urls"] = urls
                d["feedreader_items"] = [
                    x for x in d.get("feedreader_items", []) if x["feed_url"] in urls
                ]
            elif action == "list_feedreader_news":
                return {
                    "items": d.get("feedreader_items", []),
                    "enabled": bool(d.get("feedreader_urls")),
                }
            elif action == "configure_digest":
                if (
                    not isinstance(a.get("enabled"), bool)
                    or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", a.get("time", ""))
                    or not dt_util.get_time_zone(a.get("timezone", ""))
                    or (
                        a["enabled"]
                        and a.get("delivery", "ha") == "ha"
                        and not d["phone"]
                    )
                ):
                    raise ValueError(
                        "Choose a daily time, timezone and registered iPhone."
                    )
                days = a.get("weekdays", [1, 2, 3, 4, 5, 6, 7])
                if (
                    a.get("delivery", "ha") not in ("ha", "email", "inbox")
                    or not isinstance(days, list)
                    or not days
                    or any(type(x) is not int or not 1 <= x <= 7 for x in days)
                ):
                    raise ValueError("Choose delivery and weekdays.")
                d["news_digest"] = {**d.get("news_digest", {}), **a}
            elif action == "status":
                return {
                    "version": "0.11.0",
                    "phone": d["phone"],
                    "configured": bool(
                        d["phone"]
                        and self.hass.services.has_service("notify", d["phone"])
                    ),
                    "recent": [
                        {
                            "id": i["id"],
                            "status": i.get("delivery_status", "historical"),
                        }
                        for i in d["inbox"][-10:]
                    ],
                }
            elif action == "configure":
                phone = a.get("phone", "")
                if not isinstance(phone, str) or (
                    phone
                    and (
                        not re.fullmatch(r"mobile_app_[a-z0-9_]+", phone)
                        or not self.hass.services.has_service("notify", phone)
                    )
                ):
                    raise ValueError("Choose a registered HA Companion iPhone target.")
                d["phone"] = phone
            elif action == "import":
                import_id = a.get("import_id")
                if not isinstance(import_id, str) or not re.fullmatch(
                    r"[a-f0-9]{64}", import_id
                ):
                    raise ValueError("Invalid import receipt.")
                if import_id in d["imports"]:
                    return {"saved": True, "verified": True, "already_imported": True}
                records, inbox = a.get("items", []), a.get("inbox", [])
                if (
                    not isinstance(records, list)
                    or not isinstance(inbox, list)
                    or len(records) + len(d["reminders"]) > 500
                    or len(inbox) + len(d["inbox"]) > 200
                ):
                    raise ValueError("Import exceeds reminder capacity.")
                for r in records:
                    due(r["due_at"])
                    if (
                        not isinstance(r.get("title"), str)
                        or not 0 < len(r["title"]) <= 300
                        or not isinstance(r.get("id"), str)
                    ):
                        raise ValueError("Invalid reminder import.")
                    if not any(x["id"] == r["id"] for x in d["reminders"]):
                        d["reminders"].append(deepcopy(r))
                for i in inbox:
                    if (
                        not isinstance(i.get("id"), str)
                        or not isinstance(i.get("title"), str)
                        or len(i["title"]) > 300
                    ):
                        raise ValueError("Invalid inbox import.")
                    if not any(x["id"] == i["id"] for x in d["inbox"]):
                        d["inbox"].append({**i, "delivery_status": "historical"})
                d["preferences"] = a.get("preferences", {})
                d["imports"].append(import_id)
                result["verified"] = True
            elif action == "list_reminders":
                return {
                    "items": [r for r in d["reminders"] if not r.get("cancelled")],
                    "inbox": d["inbox"],
                    "preferences": d["preferences"],
                    "delivery": "HA Companion iPhone",
                }
            elif action == "list_reminder_preferences":
                return {"preferences": d["preferences"]}
            elif action == "set_reminder_quiet_hours":
                if (
                    not isinstance(a.get("enabled"), bool)
                    or any(
                        not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", a.get(k, ""))
                        for k in ("start", "end")
                    )
                    or (a["enabled"] and a["start"] == a["end"])
                ):
                    raise ValueError("Choose valid distinct quiet-hour times.")
                d["preferences"]["quietHours"] = a
                result["preferences"] = d["preferences"]
            elif action == "create_reminder":
                at = due(a.get("due_at"))
                now = datetime.now(timezone.utc)
                repeat, count = a.get("repeat_minutes", 0), a.get("repeat_count")
                schedule = a.get("calendar_schedule")
                if schedule:
                    # Revalidate a compact typed schedule, never accept arbitrary code/RRULE.
                    validated = calendar_spec(
                        {
                            "start": (
                                schedule["start"][:10]
                                if schedule["all_day"]
                                else schedule["start"]
                            ),
                            "end": (
                                schedule["end"][:10]
                                if schedule["all_day"]
                                else schedule["end"]
                            ),
                            "all_day": schedule["all_day"],
                            "recurrence_frequency": schedule["frequency"],
                            "recurrence_interval": schedule["interval"],
                            "recurrence_count": schedule["count"],
                            "recurrence_weekdays": schedule["weekdays"],
                            "recurrence_until": schedule["until"],
                            "reminder_minutes": schedule["reminder_minutes"],
                            "reminder_delivery": schedule["reminder_delivery"],
                        },
                        schedule["timezone"],
                    )
                    if validated != schedule:
                        raise ValueError("Invalid calendar reminder schedule.")
                if a.get("source_key"):
                    existing = next(
                        (
                            x
                            for x in d["reminders"]
                            if x.get("source_key") == a["source_key"]
                            and not x.get("cancelled")
                        ),
                        None,
                    )
                    if existing:
                        return {"saved": True, "item": existing, "already_exists": True}
                if (
                    not isinstance(a.get("title"), str)
                    or not 0 < len(a["title"].strip()) <= 300
                    or not now < at <= now + timedelta(days=366)
                    or type(repeat) is not int
                    or (repeat != 0 and not 15 <= repeat <= 525600)
                    or (
                        count is not None
                        and (type(count) is not int or not 1 <= count <= 1000)
                    )
                    or len(d["reminders"]) >= 500
                ):
                    raise ValueError(
                        "Use a short reminder, future due time and valid recurrence."
                    )
                item = {
                    "id": str(uuid4()),
                    "title": a["title"].strip(),
                    "due_at": at.isoformat(),
                    "repeat_minutes": repeat,
                    "cancelled": False,
                }
                if count is not None:
                    item["remaining"] = count
                if schedule:
                    item["calendar_schedule"] = schedule
                    item["source_key"] = a.get("source_key", "")
                d["reminders"].append(item)
                result.update(
                    item=item,
                    delivery="HA Companion iPhone",
                    delivery_ready=bool(
                        d["phone"]
                        and self.hass.services.has_service("notify", d["phone"])
                    ),
                )
            elif action in (
                "pause_reminder",
                "resume_reminder",
                "cancel_reminder",
                "dismiss_reminder",
            ):
                field = "inbox" if action == "dismiss_reminder" else "reminders"
                item = next((r for r in d[field] if r["id"] == a.get("id")), None)
                if item is None:
                    raise ValueError("Read the current reminders first.")
                if action == "dismiss_reminder":
                    d[field].remove(item)
                elif action == "cancel_reminder":
                    item["cancelled"] = True
                else:
                    if item.get("cancelled"):
                        raise ValueError("Reminder is cancelled.")
                    if action == "resume_reminder":
                        at = due(a.get("due_at"))
                        if (
                            not datetime.now(timezone.utc)
                            < at
                            <= datetime.now(timezone.utc) + timedelta(days=366)
                        ):
                            raise ValueError("Choose a future time within one year.")
                        item["due_at"] = at.isoformat()
                    item["paused"] = action == "pause_reminder"
                result["item"] = item
            else:
                raise ValueError("Unknown Alfred reminder action.")
            await self.store.async_save(d)
            self.data = d
            return result


class ReminderView(HomeAssistantView):
    url = "/api/alfred/reminders"
    name = "api:alfred:reminders"
    requires_auth = True

    async def post(self, request):
        if not request["hass_user"].is_admin:
            return self.json_message(
                "Alfred reminders requires an administrator token.", status_code=403
            )
        if request.content_length is None or request.content_length > 131072:
            return self.json_message("Request exceeds limit.", status_code=413)
        try:
            body = await request.json()
            result = (
                await request.app["hass"]
                .data[DOMAIN]
                .execute(body["action"], body.get("args", {}))
            )
            return self.json(result)
        except (ValueError, KeyError, TypeError):
            return self.json_message(
                "Invalid reminder request. Check arguments and integration setup.",
                status_code=400,
            )


async def async_setup_entry(hass, entry):
    from .runtime import Runtime
    from .web import ClientView, ManageView, OAuthView, AdminVoiceView
    from homeassistant.components.http import StaticPathConfig
    from homeassistant.components.panel_custom import async_register_panel
    from pathlib import Path

    hass.config_entries.async_update_entry(entry, title="Alfred")
    engine = Engine(hass)
    engine.data = await engine.store.async_load() or engine.data
    engine.runtime = Runtime(hass, engine)
    await engine.runtime.load()
    hass.data[DOMAIN] = engine
    if not hass.data.get("alfred_routes_registered"):
        for view in (
            ReminderView(),
            ClientView(),
            ManageView(),
            OAuthView(),
            AdminVoiceView(),
        ):
            hass.http.register_view(view)
        root = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig("/alfred/panel.js", str(root / "panel.js"), False),
                StaticPathConfig(
                    "/alfred/quick-start.js", str(root / "quick-start.js"), False
                ),
                StaticPathConfig("/alfred/icons.js", str(root / "icons.js"), False),
                StaticPathConfig("/alfred/app", str(root / "app"), False),
            ]
        )
        hass.data["alfred_routes_registered"] = True
    from homeassistant.components import frontend

    frontend.add_extra_js_url(hass, "/alfred/icons.js?v=0.20.2")
    await hass.config_entries.async_forward_entry_setups(entry, ["conversation"])
    await async_register_panel(
        hass,
        frontend_url_path="alfred",
        webcomponent_name="alfred-panel",
        sidebar_title="Alfred",
        sidebar_icon="alfred:butler",
        module_url="/alfred/panel.js?v=0.20.2",
        require_admin=True,
    )
    entry.async_on_unload(hass.bus.async_listen("feedreader", engine.feedreader_event))
    entry.async_on_unload(
        async_track_time_interval(hass, engine.tick, timedelta(seconds=10))
    )
    entry.async_on_unload(
        async_track_time_interval(hass, engine.runtime.periodic, timedelta(minutes=1))
    )
    await engine.tick()
    return True


async def async_unload_entry(hass, entry):
    from homeassistant.components import frontend

    await hass.config_entries.async_unload_platforms(entry, ["conversation"])
    engine = hass.data.pop(DOMAIN, None)
    if engine:
        await engine.runtime.close()
    frontend.async_remove_panel(hass, "alfred")
    frontend.remove_extra_js_url(hass, "/alfred/icons.js?v=0.20.2")
    return True
