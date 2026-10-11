"""Briefings, routines and reviewed plans share existing HA controls and receipts."""

import asyncio
import json
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo


class Experiences:
    def __init__(self, runtime):
        self.r = runtime

    async def briefing(self, meeting=False):
        r = self.r

        async def optional(label, fn):
            try:
                async with asyncio.timeout(5):
                    return await fn()
            except Exception as e:
                return {"unavailable": str(e)[:200], "feature": label}

        parts = await asyncio.gather(
            optional("weather", r.providers.weather),
            optional("home", lambda: r.home.dashboard("home")),
            optional("reminders", lambda: r.engine.execute("list_reminders", {})),
            (
                optional("agenda", lambda: r.providers.events({}))
                if r.providers.connected("calendar")
                else asyncio.sleep(
                    0, result={"setup": "Connect a calendar to include appointments."}
                )
            ),
        )
        result = dict(zip(("weather", "home", "reminders", "agenda"), parts))
        if r.providers.connected("mail"):
            query = (
                "is:unread"
                if r.config.get("mailProvider") == "google"
                else "isread:false"
            )
            result["unread_email"] = await optional(
                "mail", lambda: r.providers.search_mail({"query": query, "limit": 3})
            )
        else:
            result["unread_email"] = {
                "setup": "Connect mail to include unread messages."
            }
        if meeting:
            rows = result["agenda"].get("items", result["agenda"].get("events", []))
            now = datetime.now(timezone.utc)
            upcoming = []
            for row in rows:
                value = row.get("start", {})
                start = (
                    value.get("dateTime", value.get("date", ""))
                    if isinstance(value, dict)
                    else value
                )
                try:
                    at = datetime.fromisoformat(start.replace("Z", "+00:00"))
                    if at.tzinfo is None:
                        at = at.replace(
                            tzinfo=ZoneInfo(r.profile().get("timezone", "UTC"))
                        )
                    if at >= now:
                        upcoming.append((at, row))
                except (ValueError, AttributeError):
                    pass
            next_event = (
                sorted(upcoming, key=lambda x: x[0])[0][1] if upcoming else None
            )
            result["next_meeting"] = next_event or {
                "none": "No upcoming appointment today."
            }
            if next_event and r.providers.connected("mail"):
                title = str(
                    next_event.get(
                        "title",
                        next_event.get("summary", next_event.get("subject", "")),
                    )
                )[:120].replace('"', "")
                if title:
                    result["related_email"] = await optional(
                        "mail",
                        lambda: r.providers.search_mail({"query": title, "limit": 3}),
                    )
        return result

    def validate_plan(self, args):
        title, steps = args.get("title", ""), args.get("steps", [])
        if (
            not isinstance(title, str)
            or not 1 <= len(title) <= 100
            or not isinstance(steps, list)
            or not 1 <= len(steps) <= 12
        ):
            raise ValueError("Give a plan a short title and 1–12 steps.")
        permitted = {"home", "shopping", "task", "reminder", "mail", "calendar"}
        approved = {x["entity_id"] for x in self.r.home.approved()}
        for step in steps:
            if (
                not isinstance(step, dict)
                or step.get("kind") not in permitted
                or not isinstance(step.get("args"), dict)
            ):
                raise ValueError(
                    "Use home, shopping, task, reminder, mail or calendar steps."
                )
            a = step["args"]
            if step["kind"] == "home":
                inventory = self.r.home.approved()
                rooms = {
                    x.get("room", "").casefold(): x.get("room")
                    for x in inventory
                    if x.get("room")
                    and x.get("domain") in ("light", "switch", "fan", "input_boolean")
                }
                area = a.get("area", a.get("room", ""))
                if not area and a.get("area_id"):
                    area = next(
                        (
                            x.get("room", "")
                            for x in inventory
                            if x.get("area_id") == a["area_id"]
                        ),
                        "",
                    )
                if isinstance(area, str) and area.casefold() in rooms:
                    a["area"] = rooms[area.casefold()]
                    a.pop("room", None)
                    a.pop("area_id", None)
                    a.pop("entity_id", None)
                elif a.get("entity_id") not in approved:
                    raise ValueError(
                        "A plan contains a removed or unapproved home device. Use an approved entity_id or a discovered room name in area."
                    )
                if not isinstance(a.get("action"), str):
                    raise ValueError(
                        "Home plan steps need an action such as on or off."
                    )
            if step["kind"] in ("task", "shopping", "reminder") and (
                not isinstance(a.get("title"), str) or not 1 <= len(a["title"]) <= 200
            ):
                raise ValueError("List and reminder steps need a short title.")
            if step["kind"] == "mail" and (
                not a.get("to") or not a.get("subject") or not a.get("body")
            ):
                raise ValueError("Mail steps need recipient, subject and body.")
            if step["kind"] == "calendar" and not a.get("title", a.get("summary")):
                raise ValueError("Calendar steps need a title and event details.")
        if len(json.dumps(args)) > 20000:
            raise ValueError("The plan is too large.")
        return {"title": title, "steps": deepcopy(steps)}

    async def run(self, args, device):
        plan = self.validate_plan(args)  # Recheck scope after the preview.
        record = {
            "id": str(uuid4()),
            "title": plan["title"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "running",
            "steps": [],
        }
        self.r.data.setdefault("plans", []).append(record)
        self.r.data["plans"] = self.r.data["plans"][-50:]
        await self.r.save()
        for step in plan["steps"]:
            row = {"kind": step["kind"], "status": "claimed"}
            record["steps"].append(row)
            await self.r.save()  # Claim before external I/O; never replay a plan.
            a, kind = step["args"], step["kind"]
            try:
                if kind == "home":
                    result = (
                        await self.r.assistant.tool("control_home_area", a, device)
                        if a.get("area")
                        else await self.r.home.control(a)
                    )
                    if result.get("verification") not in (
                        "confirmed",
                        "accepted_unverified",
                    ) and not result.get("verified"):
                        raise ValueError("Home action was not verified.")
                elif kind in ("shopping", "task"):
                    result = await self.r.home.lists(
                        "add_shopping_item" if kind == "shopping" else "add_todo", a
                    )
                elif kind == "reminder":
                    result = await self.r.engine.execute("create_reminder", a)
                elif kind == "mail":
                    result = await self.r.providers.send(a, a.get("provider"))
                else:
                    result = await self.r.providers.event_write(
                        a, a.get("provider"), "create"
                    )
                row.update(status="accepted", result=result)
                await self.r.save()
            except Exception as e:
                row.update(status="failed_or_uncertain", error=str(e)[:300])
                record["status"] = "partial_or_uncertain"
                await self.r.save()
                return {
                    "completed": False,
                    "title": plan["title"],
                    "steps": record["steps"],
                    "message": "Stopped at an unsuccessful or uncertain step. Earlier steps may have completed; check Activity. It will not be repeated automatically.",
                }
        record["status"] = "completed"
        await self.r.save()
        return {
            "completed": True,
            "title": plan["title"],
            "steps": record["steps"],
            "message": "Plan executed. Provider acceptance is not proof of email delivery or script effects.",
        }

    async def periodic(self):
        r = self.r
        await self.scheduled()
        settings = r.config.get("proactive", {})
        if not settings.get("enabled"):
            return
        now = datetime.now(ZoneInfo(r.profile().get("timezone", "UTC")))
        quiet_start, quiet_end = settings.get("quietStart", "22:00"), settings.get(
            "quietEnd", "07:00"
        )
        clock = now.strftime("%H:%M")
        quiet = (
            (quiet_start <= clock < quiet_end)
            if quiet_start < quiet_end
            else (
                (clock >= quiet_start or clock < quiet_end)
                if quiet_start != quiet_end
                else False
            )
        )
        if quiet:
            return
        receipts = r.data.setdefault("proactive_receipts", {})
        messages = []
        stamp = now.date().isoformat()
        if (
            settings.get("briefing")
            and clock >= settings.get("time", "08:00")
            and receipts.get("briefing_date") != stamp
        ):
            receipts["briefing_date"] = stamp
            await r.save()  # At-most-once rather than duplicate announcements.
            info = await self.briefing()
            rows = info["agenda"].get("items", info["agenda"].get("events", []))
            weather = info["weather"]
            text = "Daily briefing: " + str(len(rows)) + " appointments. "
            if weather.get("available"):
                text += (
                    str(weather.get("temperature"))
                    + "°C, "
                    + str(weather.get("description"))
                    + ". "
                )
            text += "Ask Alfred to brief you for the full details."
            messages.append(text)
        for entity in settings.get("watchEntities", []):
            if entity not in {x["entity_id"] for x in r.home.approved()}:
                continue
            state = r.hass.states.get(entity)
            if not state:
                continue
            value = state.state
            key = "watch:" + entity
            previous = receipts.get(key)
            receipts[key] = value
            # First observation establishes a baseline instead of alarming about every device.
            if (
                previous is not None
                and previous != value
                and value in ("unavailable", "unknown", "triggered")
            ):
                messages.append((state.name or entity) + ": " + value)
        await r.save()
        for message in messages[:5]:
            await r.engine.execute(
                "create_reminder",
                {
                    "title": message[:200],
                    "due_at": (
                        datetime.now(timezone.utc) + timedelta(seconds=2)
                    ).isoformat(),
                },
            )

    def validate_schedule(self, args):
        import re

        routine = next(
            (
                x
                for x in self.r.data.get("routines", [])
                if x["id"] == args.get("routine_id")
            ),
            None,
        )
        if not routine:
            raise ValueError("Read and choose a saved routine first.")
        self.validate_plan(routine)
        for step in routine["steps"]:
            if step["kind"] != "home" or (
                not step["args"].get("area")
                and step["args"].get("entity_id", "").split(".")[0]
                not in (
                    "light",
                    "switch",
                    "scene",
                    "fan",
                    "media_player",
                    "input_boolean",
                )
            ):
                raise ValueError(
                    "Scheduled routines currently support ordinary home devices only. Mail, calendar, locks and scripts require an interactive preview."
                )
        trigger = args.get("trigger")
        if trigger not in ("time", "sunrise", "sunset"):
            raise ValueError("Choose daily time, sunrise or sunset.")
        if trigger in ("sunrise", "sunset") and not self.r.hass.states.get("sun.sun"):
            raise ValueError(
                "Enable HA Sun before scheduling sunrise or sunset routines."
            )
        clock = args.get("time", "")
        if trigger == "time" and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", clock):
            raise ValueError("Give a daily time as HH:MM.")
        if len(self.r.data.get("schedules", [])) >= 30:
            raise ValueError("Review existing schedules before adding more.")
        return {
            "id": str(uuid4()),
            "routine_id": routine["id"],
            "title": routine["title"],
            "trigger": trigger,
            "time": clock,
            "enabled": True,
        }

    async def scheduled(self):
        now = datetime.now(ZoneInfo(self.r.profile().get("timezone", "UTC")))
        day = now.date().isoformat()
        receipts = self.r.data.setdefault("schedule_receipts", {})
        sun = self.r.hass.states.get("sun.sun")
        for schedule in self.r.data.get("schedules", []):
            if not schedule.get("enabled"):
                continue
            key = schedule["id"] + ":" + day
            if key in receipts:
                continue
            trigger = schedule["trigger"]
            ready = trigger == "time" and now.strftime("%H:%M") == schedule["time"]
            if trigger in ("sunrise", "sunset") and sun:
                expected = "above_horizon" if trigger == "sunrise" else "below_horizon"
                last = receipts.get("sun-state:" + schedule["id"])
                receipts["sun-state:" + schedule["id"]] = sun.state
                ready = last is not None and last != sun.state and sun.state == expected
            if not ready:
                continue
            receipts[key] = "claimed"
            await self.r.save()
            try:
                routine = next(
                    (
                        x
                        for x in self.r.data.get("routines", [])
                        if x["id"] == schedule["routine_id"]
                    ),
                    None,
                )
                if not routine:
                    raise ValueError("Scheduled routine was removed.")
                result = await self.run(routine, "scheduled-routine")
                receipts[key] = (
                    "completed" if result["completed"] else "partial_or_uncertain"
                )
            except Exception:
                receipts[key] = "failed_or_uncertain"
            await self.r.save()
        # Bound the journal, retaining several weeks of claims without replaying them.
        if len(receipts) > 1200:
            self.r.data["schedule_receipts"] = dict(list(receipts.items())[-1000:])
            await self.r.save()

    async def apple_shortcut(self, id):
        shortcut = next(
            (x for x in self.r.config.get("appleShortcuts", []) if x["id"] == id), None
        )
        if not shortcut:
            raise ValueError(
                "Register your iPhone shortcut in Alfred → Connections first."
            )
        phone = self.r.engine.data.get("phone")
        if not phone or not self.r.hass.services.has_service("notify", phone):
            raise ValueError(
                "Connect the HA iPhone app and choose your notification target first."
            )
        async with asyncio.timeout(5):
            await self.r.hass.services.async_call(
                "notify",
                phone,
                {
                    "title": "Alfred",
                    "message": "Tap to run " + shortcut["name"],
                    "data": {"shortcut": {"name": shortcut["name"]}},
                },
                blocking=True,
            )
        return {
            "accepted": True,
            "executed": False,
            "message": "Shortcut prompt sent to your iPhone. Tap it to run; it has not executed automatically.",
        }
