"""Local request gateway. Parsing never authorises an action or invents a record.

All execution reuses Alfred handlers. Only explicit delegation reaches a cloud
planner in strict mode; provider API requests are independent of that policy.
"""

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DELEGATE = re.compile(
    r"^(?:please\s+)?(?:research|ask ai|think about|search (?:the )?web)\b[,: ]*", re.I
)


def delegation(text):
    return bool(DELEGATE.match(text.strip()))


def research(text):
    return bool(
        re.match(
            r"^(?:please\s+)?(?:research|search (?:the )?web)\b", text.strip(), re.I
        )
    )


def day_window(label, zone):
    now = datetime.now(ZoneInfo(zone))
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if label == "tomorrow":
        day += timedelta(days=1)
    return day, day + timedelta(
        days=7 if label in ("this week", "next seven days") else 1
    )


class LocalOps:
    def __init__(self, runtime):
        self.r = runtime
        self.references = {}

    async def answer(self, text, device, context=""):
        if context or self.r.pending.get(device) or delegation(text):
            return None
        t = re.sub(r"^(?:please |alfred[,]? )", "", text.strip(), flags=re.I).strip(
            " .!?"
        )
        t = re.sub(r"^(?:can|could|would) you (?:please )?", "", t, flags=re.I)
        low = t.casefold()
        if re.fullmatch(
            r"(?:what (?:lighting )?scenes (?:are available|can you see)|show (?:lighting )?scenes|list scenes)",
            low,
        ):
            names = [
                x["name"] for x in self.r.home.approved() if x["domain"] == "scene"
            ] + [x["name"] for x in self.r.data.get("scenes", [])]
            return (
                "Scenes\n"
                + (
                    "\n".join("• " + x for x in dict.fromkeys(names))
                    or "No scenes available."
                ),
                "conversation",
            )
        if re.fullmatch(
            r"(?:restore|undo)(?: all)?(?: my)?(?: lights)?(?: to (?:the )?previous configuration)?|restore (?:the )?previous lighting|(?:the )?lights to (?:the )?previous configuration",
            low,
        ):
            result = await self.r.home.restore_lighting()
            return self.receipt(result)
        pending_scene = self.references.get(device, {}).get("scene_name")
        if pending_scene and re.match(
            r"(?:show|what|turn|set|make|add|remove|delete|complete|email|send|remind|research|close)\b",
            low,
        ):
            self.references.setdefault(device, {}).pop("scene_name", None)
            pending_scene = None
        save_scene = re.fullmatch(
            r"save (?:the )?(?:current )?(?:(.+?) )?lighting as (?:a )?scene(?: (?:called|named) (.+))?",
            t,
            re.I,
        )
        if save_scene or (
            pending_scene and __import__("time").monotonic() - pending_scene["at"] < 120
        ):
            target = save_scene[1] if save_scene else pending_scene["target"]
            name = (
                save_scene[2]
                if save_scene
                else re.sub(r"^(?:call it|name it|called|named) ", "", t, flags=re.I)
            )
            if not name:
                self.references.setdefault(device, {})["scene_name"] = {
                    "target": target,
                    "at": __import__("time").monotonic(),
                }
                return "What should I call the scene?", "conversation"
            rows = self.r.commands.targets(target or "all lights")
            if not rows:
                return "No approved lights match that room.", "conversation"
            await self.r.home.scenes(
                "save_home_scene",
                {"name": name[:80], "entity_ids": [x["entity_id"] for x in rows]},
            )
            self.references.setdefault(device, {}).pop("scene_name", None)
            return "Done.", "action_complete"
        match = re.fullmatch(r"what is my (.+)", low)
        if match:
            prefix = "my " + match[1] + " is "
            facts = [
                x.get("text", x.get("content", ""))
                for x in self.r.data.get("memories", [])
            ]
            found = [x for x in facts if x.casefold().startswith(prefix)]
            if len(found) == 1:
                return found[0], "conversation"
        match = re.fullmatch(r"forget (?:that )?(.+)", t, re.I)
        if match:
            facts = self.r.data.get("memories", [])
            found = [
                x
                for x in facts
                if x.get("text", x.get("content", "")).casefold().strip(" .")
                == match[1].casefold().strip(" .")
            ]
            if len(found) == 1:
                facts.remove(found[0])
                await self.r.save()
                return "Done.", "action_complete"
        if re.fullmatch(
            r"(?:delete|remove|cancel) (?:the )?(?:calendar )?event (?:we|you|i) just created",
            low,
        ):
            ref = self.references.get(device, {}).get("created_event", {})
            if not ref or __import__("time").monotonic() - ref.get("at", 0) > 600:
                return (
                    "Please name the calendar event; the recent selection has expired.",
                    "conversation",
                )
            if ref["provider"] != self.r.providers.selected("calendar"):
                return (
                    "The calendar account changed. Please name the event again.",
                    "conversation",
                )
            proposal = self.r.assistant.prepare(
                device,
                "calendar",
                {
                    "operation": "delete",
                    "event_id": ref["id"],
                    "provider": ref["provider"],
                },
            )
            return proposal["preview"], "conversation"
        delete = re.fullmatch(
            r"(?:delete|remove|cancel) (?:the )?(?:calendar )?event[, ]+(.+)", t, re.I
        )
        selected = low in (
            "delete that from the agenda",
            "delete that event",
            "delete it from my calendar",
        )
        if delete or selected:
            ref = self.references.get(device, {}).get("agenda", {})
            if not ref or __import__("time").monotonic() - ref.get("at", 0) > 600:
                return (
                    "Show the relevant agenda first, then name the event to delete.",
                    "conversation",
                )
            needle = delete[1].casefold() if delete else ""
            matches = [
                x
                for x in ref["events"]
                if not needle
                or x.get("title", x.get("subject", "")).casefold() == needle
                or needle.startswith(
                    x.get("title", x.get("subject", "")).casefold() + " "
                )
            ]
            if len(matches) != 1 or not matches[0].get("id"):
                return (
                    "Please name one event from the displayed agenda.",
                    "conversation",
                )
            if ref["provider"] != self.r.providers.selected("calendar"):
                return (
                    "The calendar account changed. Show the agenda again first.",
                    "conversation",
                )
            proposal = self.r.assistant.prepare(
                device,
                "calendar",
                {
                    "operation": "delete",
                    "event_id": matches[0]["id"],
                    "provider": ref["provider"],
                },
            )
            return proposal["preview"], "conversation"
        if low in ("no news", "night's doing", "nights doing"):
            return "Sorry, could you repeat that?", "conversation"
        if re.fullmatch(
            r"show my unread emails[, ]+(?:then|and|immediately follow with) read the first email",
            low,
        ):
            await self.answer("show my unread emails", device)
            return await self.answer("read the first email", device)
        structured = await self.structured(t, device)
        if structured is not None:
            return structured
        r = self.r
        waiting = self.references.get(device, {}).get("pending_mail")
        if waiting and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", t):
            self.references.setdefault(device, {}).pop("pending_mail", None)
            if datetime.now().timestamp() - waiting["at"] > 120:
                return (
                    "That email request expired. Please dictate it again.",
                    "conversation",
                )
            proposal = r.assistant.prepare(
                device,
                "mail",
                {
                    "to": t,
                    "subject": "Message from Alfred",
                    "body": waiting["body"],
                    "provider": r.providers.selected("mail"),
                },
            )
            return proposal["preview"], "conversation"
        # Bound references to actual read records on this device, never transcript guesses.
        match = re.fullmatch(
            r"(?:read|open)(?: email)? (?:the )?(first|second|third|\d+)(?: one| email)?",
            low,
        )
        if match:
            refs = self.references.get(device, {})
            if datetime.now().timestamp() - refs.get("at", 0) > 120:
                return (
                    "Show your emails first; that selection has expired.",
                    "conversation",
                )
            index = {"first": 0, "second": 1, "third": 2}.get(match[1])
            index = int(match[1]) - 1 if index is None else index
            if refs.get("provider") != r.providers.selected("mail"):
                return (
                    "Your mail account changed. Show emails again first.",
                    "conversation",
                )
            rows = refs.get("mail", [])
            if not 0 <= index < len(rows):
                return "That email is not in the displayed selection.", "conversation"
            mail = await r.providers.read_mail(
                {"message_id": rows[index]["id"]}, refs["provider"]
            )
            body = mail.get("body", "")
            if isinstance(body, dict):
                body = body.get("content", "")
                if mail.get("body", {}).get("contentType", "").casefold() == "html":
                    from html import unescape

                    body = unescape(re.sub("<[^>]*>", " ", body))
            return (
                f"{mail.get('subject', '(No subject)')}\n{body or mail.get('snippet', '')}",
                "conversation",
            )
        match = re.fullmatch(
            r"(?:(?:show|read)(?: me)? |(?:what is|what's)(?: (?:in|on))? |this is on )?(?:my |the )?(?:agenda|calendar|schedule)(?: (?:for )?(today|tomorrow|this week|next seven days))?",
            low,
        )
        if match:
            start, end = day_window(
                match[1] or "today", r.profile().get("timezone", "UTC")
            )
            result = await r.providers.events(
                {"start": start.isoformat(), "end": end.isoformat()}
            )
            events = result["events"]
            self.references.setdefault(device, {})["agenda"] = {
                "events": events,
                "provider": r.providers.selected("calendar"),
                "at": __import__("time").monotonic(),
            }

            def when(x):
                stamp = x.get("start", {})
                value = stamp.get("dateTime", stamp.get("date", ""))
                if not value:
                    return "Time unavailable"
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if "dateTime" not in stamp or x.get("isAllDay"):
                    return dt.strftime("%a %d %b") + " · All day"
                dt = (
                    dt.replace(tzinfo=start.tzinfo)
                    if dt.tzinfo is None
                    else dt.astimezone(start.tzinfo)
                )
                return dt.strftime("%a %H:%M")

            events = sorted(
                events,
                key=lambda x: x.get("start", {}).get(
                    "dateTime", x.get("start", {}).get("date", "")
                ),
            )
            lines = [
                when(x) + " · " + x.get("title", x.get("subject", "(Untitled)"))
                for x in events
            ]
            if result.get("more_available"):
                lines.append("More events available; this view is incomplete.")
            return (
                "Agenda\n" + ("\n".join("• " + x for x in lines) or "No events."),
                "conversation",
            )
        match = re.fullmatch(
            r"(?:show|list|read)(?: me)? (?:my |the )?(unread )?(?:emails?|inbox)(?: from (.+))?",
            low,
        )
        if match:
            provider = r.providers.selected("mail")
            if provider not in ("google", "outlook"):
                return (
                    "Connect Gmail or Outlook and choose your mail account in Alfred → Connections.",
                    "conversation",
                )
            # Provider-specific query syntax is not interchangeable.
            if match[2] and provider == "outlook":
                return (
                    "Outlook sender filtering is not available in the local route yet. Say “ask AI” to search, or show your inbox.",
                    "conversation",
                )
            if provider == "outlook" and match[1]:
                return (
                    "Unread filtering for Outlook is not available in the local route yet. You can show your inbox.",
                    "conversation",
                )
            query = ("is:unread " if match[1] else "") + (
                "from:" + match[2] if match[2] else ""
            )
            result = await r.providers.search_mail(
                {"query": query, "limit": 10}, provider
            )
            rows = result["messages"]
            self.references.setdefault(device, {}).update(
                {
                    "mail": rows,
                    "provider": provider,
                    "at": datetime.now().timestamp(),
                }
            )
            lines = [
                f"{i+1}. {x.get('subject', '(No subject)')}" for i, x in enumerate(rows)
            ]
            if result.get("more_available"):
                lines.append("More messages available.")
            return "Email\n" + ("\n".join(lines) or "No messages."), "conversation"
        match = re.fullmatch(
            r"(?:email|send)(?: me)? (?:my |the )?(shopping list|to[ -]?do list|agenda)(?: to (?:me|myself))?",
            low,
        )
        if match:
            if match[1] == "agenda":
                answer = await self.answer("show my agenda", device)
            else:
                answer = await r.commands.answer("show my " + match[1], "", device)
            if not answer:
                return None
            return await r.delivery.send(text, answer[0], device, force=True)
        if re.fullmatch(
            r"(?:email|send)(?: an email to)? me (?:a )?test (?:email )?(?:message|email)[., ]+(?:and )?make up (?:a short |the )?subject and body(?:[., ]+and send(?: it)?)?",
            low,
        ):
            recipient = r.profile().get("selfEmail", "")
            if not recipient or not r.providers.connected("mail"):
                return (
                    "Set your self-email in Profile and connect a mail account in Intelligence & accounts.",
                    "conversation",
                )
            proposal = r.assistant.prepare(
                device,
                "mail",
                {
                    "to": recipient,
                    "subject": "A quick test from Alfred",
                    "body": "Good day. This is your requested test message from Alfred. Your email connection is working.",
                    "provider": r.providers.selected("mail"),
                },
            )
            return proposal["preview"], "conversation"
        match = re.fullmatch(
            r"(?:email|send an email to) (.+?) (?:saying|with body) (.+)",
            t,
            re.I,
        )
        if match:
            if r.providers.selected("mail") not in ("google", "outlook"):
                return (
                    "Connect a sending account in Alfred → Connections first.",
                    "conversation",
                )
            recipient = (
                r.profile().get("selfEmail", "")
                if match[1].casefold() in ("me", "myself")
                else match[1]
            )
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
                self.references.setdefault(device, {})["pending_mail"] = {
                    "body": match[2],
                    "at": datetime.now().timestamp(),
                }
                return (
                    "What is the recipient’s email address? I have kept your dictated message for two minutes.",
                    "conversation",
                )
            # Literal dictation; existing preview/confirmation remains single and server-side.
            proposal = r.assistant.prepare(
                device,
                "mail",
                {
                    "to": recipient,
                    "subject": "Message from Alfred",
                    "body": match[2],
                    "provider": r.providers.selected("mail"),
                },
            )
            return proposal["preview"], "conversation"
        match = re.fullmatch(r"(?:show|list)(?: my| the)? reminders", low)
        if match:
            result = await r.engine.execute("list_reminders", {})
            rows = result.get("reminders", result.get("items", []))
            return (
                "Reminders\n"
                + (
                    "\n".join(
                        "• " + x["title"] + " · " + str(x.get("due_at", ""))
                        for x in rows
                    )
                    or "Empty."
                ),
                "conversation",
            )
        if low in (
            "what is the weather",
            "what's the weather",
            "show weather",
            "show the weather",
        ):
            d = await r.providers.weather()
            return (
                f"{d.get('city', '')}: {d.get('temperature', '')}°C, {d.get('description', '')}",
                "conversation",
            )
        if low in (
            "show news",
            "show headlines",
            "show the headlines",
            "read the news",
        ):
            d = await r.providers.news({})
            rows = d.get("articles", d.get("items", []))
            return (
                "Headlines\n"
                + (
                    "\n".join(
                        "• "
                        + x.get("title", "")
                        + "\n"
                        + x.get("url", x.get("link", ""))
                        for x in rows
                    )
                    or "No headlines available."
                ),
                "conversation",
            )
        match = re.fullmatch(
            r"(?:add|remove|complete) (.+) (?:to|from|on) (?:my |the )?(shopping list|to[ -]?do list)",
            t,
            re.I,
        )
        if match and ("," in match[1] or re.search(r"\band\b", match[1], re.I)):
            verb = low.split()[0]
            items = [x.strip() for x in re.split(r",|\s+and\s+", match[1]) if x.strip()]
            if len(items) > 20:
                return "Please give up to twenty items in one command.", "conversation"
            kind = "shopping" if match[2].casefold() == "shopping list" else "tasks"
            # Resolve all removals before executing any; never guess a partial match.
            if verb != "add":
                d = await r.home.lists(
                    "list_shopping" if kind == "shopping" else "list_todos",
                    {"status": "open"},
                )
                for item in items:
                    if (
                        sum(
                            x["title"].casefold() == item.casefold() for x in d["items"]
                        )
                        != 1
                    ):
                        return (
                            f"“{item}” does not identify one current item. Please use its exact name.",
                            "conversation",
                        )
            for item in items:
                result = await r.commands.execute(
                    {"kind": "list", "target": kind, "action": verb, "item": item}
                )
                if result[1] != "action_complete":
                    return result
            return "Done.", "action_complete"
        match = re.fullmatch(
            r"complete (.+?)(?: (?:on|from) (?:my |the )?to[ -]?do list)?", t, re.I
        )
        if match:
            from .commands import normal

            def item_key(value):
                return normal(re.sub(r"[,;]", " ", value))

            items = (await r.home.lists("list_todos", {"status": "open"}))["items"]
            matches = [x for x in items if item_key(x["title"]) == item_key(match[1])]
            if len(matches) != 1:
                return "Please name one current to-do item.", "conversation"
            return await r.commands.execute(
                {
                    "kind": "list",
                    "target": "tasks",
                    "action": "complete",
                    "item": matches[0]["title"],
                }
            )
        # Home verbs resolve approved entities/capabilities, not arbitrary service calls.
        match = re.fullmatch(
            r"(?:turn|switch) (?:the )?(.+?) (on|off)|(?:turn|switch) (on|off) (?:the )?(.+)",
            low,
        )
        if match:
            target, action = (match[1], match[2]) if match[1] else (match[4], match[3])
            rows = [
                x
                for x in r.home.approved()
                if x["domain"] in ("switch", "fan", "input_boolean", "media_player")
                and x["name"].casefold() == target
            ]
            if len(rows) == 1:
                return await self.home_action(rows[0], action)
        match = re.fullmatch(
            r"(open|close|pause|play|stop|run|activate) (?:the )?(.+)", low
        )
        if match:
            allowed = {
                "open": ["cover"],
                "close": ["cover"],
                "pause": ["media_player", "vacuum"],
                "play": ["media_player"],
                "stop": ["media_player", "vacuum", "cover"],
                "run": ["script"],
                "activate": ["scene", "script"],
            }
            rows = [
                x
                for x in r.home.approved()
                if x["domain"] in allowed[match[1]] and x["name"].casefold() == match[2]
            ]
            if len(rows) == 1:
                return await self.home_action(
                    rows[0], "run" if rows[0]["domain"] == "script" else match[1]
                )
        match = re.fullmatch(
            r"(?:(?:set|turn|make) )?(?:the )?(.+?)[, ]+(?:to )?(red|green|blue|white|yellow|purple|orange|pink|warm amber|warm white|cool white|\d{4,5} ?k)",
            low,
        )
        if match:
            target = match[1]
            if target in ("them", "the lights"):
                ref = r.commands.references.get(device, {})
                if __import__("time").monotonic() - ref.get("at", 0) < 120:
                    target = ref.get("target", target)
            rows = r.commands.targets(target)
            if rows:
                r.commands.references[device] = {
                    "target": target,
                    "at": __import__("time").monotonic(),
                }
                colours = {
                    "red": [255, 0, 0],
                    "green": [0, 255, 0],
                    "blue": [0, 0, 255],
                    "white": [255, 255, 255],
                    "yellow": [255, 255, 0],
                    "purple": [128, 0, 128],
                    "orange": [255, 165, 0],
                    "pink": [255, 192, 203],
                    "warm amber": [255, 150, 35],
                }
                value = match[2]
                args = {"targets": [x["entity_id"] for x in rows]}
                if value in colours:
                    args["rgb_color"] = colours[value]
                else:
                    args["color_temp_kelvin"] = (
                        2700
                        if value == "warm white"
                        else 6500 if value == "cool white" else int(value.rstrip("k "))
                    )
                result = await r.commands.mutate(
                    "home",
                    match[1],
                    lambda: r.home.lights("set_light_properties", args),
                )
                return self.receipt(result)
        return None

    async def home_action(self, row, action, value=None):
        result = await self.r.commands.mutate(
            "home",
            row["entity_id"],
            lambda: self.r.home.control(
                {"entity_id": row["entity_id"], "action": action, "value": value}
            ),
        )
        return self.receipt(result)

    @staticmethod
    def receipt(result):
        if result.get("verified") or result.get("verification") == "confirmed":
            return "Done.", "action_complete"
        return (
            "The service accepted the action, but its effect is not verified. Check Activity before repeating.",
            "conversation",
        )

    async def structured(self, text, device):
        """Extract bounded date/action slots; previews keep the existing safeguards."""
        r = self.r
        low = text.casefold()
        zone = ZoneInfo(r.profile().get("timezone", "UTC"))
        if low in ("what time is it", "what is the time", "what's the time"):
            return datetime.now(zone).strftime("%H:%M"), "conversation"
        if low in ("what is the date", "what's the date", "what day is it"):
            return datetime.now(zone).strftime("%A %d %B %Y"), "conversation"
        arithmetic = re.fullmatch(
            r"what(?: is|'s) (\d{1,9}) (plus|minus|times|divided by|\+|-|\*|/) (\d{1,9})",
            low,
        )
        if arithmetic:
            a, op, b = int(arithmetic[1]), arithmetic[2], int(arithmetic[3])
            if op in ("/", "divided by") and b == 0:
                return "Division by zero is undefined.", "conversation"
            value = (
                a + b
                if op in ("plus", "+")
                else (
                    a - b
                    if op in ("minus", "-")
                    else a * b if op in ("times", "*") else a / b
                )
            )
            return str(value), "conversation"
        match = re.fullmatch(
            r"(?:add|create) (?:a )?(?:calendar )?(?:entry|event) (.+?) (?:on|for) (today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d\d-\d\d) at (\d{1,2}(?::\d\d)?(?: ?[ap]m)?) for (\d+) minutes(?: (every week))?(?: (?:and )?remind me (\d+) (minutes?|hours?) before)?",
            text,
            re.I,
        )
        if match:
            date, clock = match[2].casefold(), match[3].casefold().replace(" ", "")
            now = datetime.now(zone)
            day = now.replace(hour=0, minute=0, second=0, microsecond=0)
            days = [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ]
            if date == "tomorrow":
                day += timedelta(days=1)
            elif date in days:
                day += timedelta(days=(days.index(date) - now.weekday()) % 7)
            elif date != "today":
                day = datetime.fromisoformat(date).replace(tzinfo=zone)
            stamp = (
                datetime.strptime(clock, "%I:%M%p" if ":" in clock else "%I%p")
                if clock.endswith(("am", "pm"))
                else datetime.strptime(clock, "%H:%M" if ":" in clock else "%H")
            )
            start = day.replace(hour=stamp.hour, minute=stamp.minute)
            if date in days and start <= now:
                start += timedelta(days=7)
            # Round trip through UTC rejects nonexistent DST times; ambiguous folds need clarity.
            from datetime import timezone

            if (
                start.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
                != start.replace(tzinfo=None)
                or start.replace(fold=0).utcoffset()
                != start.replace(fold=1).utcoffset()
            ):
                return (
                    "That local time crosses a daylight-saving clock change. Please specify a different time.",
                    "conversation",
                )
            if not 1 <= int(match[4]) <= 1440:
                return (
                    "Choose an event duration from one minute to one day.",
                    "conversation",
                )
            args = {
                "title": match[1],
                "start": start.isoformat(),
                "end": (start + timedelta(minutes=int(match[4]))).isoformat(),
                "recurrence_frequency": "weekly" if match[5] else "none",
            }
            if match[6]:
                args.update(
                    reminder_minutes=int(match[6])
                    * (60 if match[7].casefold().startswith("hour") else 1),
                    reminder_delivery="ha",
                )
            result = await r.assistant.tool("prepare_calendar_event", args, device)
            return result["preview"], "conversation"
        match = re.fullmatch(
            r"(cancel|pause|resume|dismiss) (?:the )?reminder (.+)", text, re.I
        )
        if match:
            rows = (await r.engine.execute("list_reminders", {}))["items"]
            matches = [x for x in rows if x["title"].casefold() == match[2].casefold()]
            if len(matches) != 1:
                return (
                    "Please use the exact name of one current reminder.",
                    "conversation",
                )
            await r.engine.execute(
                match[1].casefold() + "_reminder", {"id": matches[0]["id"]}
            )
            return "Reminder updated.", "action_complete"
        match = re.fullmatch(
            r"(?:show|what is|what\'s|read) (?:the )?(?:status of )?(.+)", low
        )
        if match:
            rows = [x for x in r.home.approved() if x["name"].casefold() == match[1]]
            if len(rows) == 1:
                row = rows[0]
                return (
                    row["name"] + ": " + str(row.get("state", "unknown")),
                    "conversation",
                )
        match = re.fullmatch(
            r"set (?:the )?(.+?) (?:temperature|position|speed|volume) to (\d+(?:\.\d+)?) ?(?:degrees|percent|%)?",
            low,
        )
        if match:
            rows = [
                x
                for x in r.home.approved()
                if x["name"].casefold() == match[1]
                and x["domain"] in ("climate", "cover", "fan", "media_player")
            ]
            if len(rows) == 1:
                row = rows[0]
                action = {
                    "climate": "temperature",
                    "cover": "position",
                    "fan": "percentage",
                    "media_player": "volume",
                }[row["domain"]]
                return await self.home_action(row, action, float(match[2]))
        match = re.fullmatch(r"remember that (.+)", text, re.I)
        if match:
            await r.assistant.tool("save_memory", {"text": match[1]}, device)
            return "Remembered.", "action_complete"
        if low in ("show memories", "show my memories"):
            return (
                "Memory\n"
                + (
                    "\n".join("• " + x["text"] for x in r.data.get("memories", []))
                    or "Empty."
                ),
                "conversation",
            )
        return None
