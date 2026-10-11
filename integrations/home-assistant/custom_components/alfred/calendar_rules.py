"""Provider-neutral daily/weekly/monthly recurrence and wall-clock HA reminders.

No fixed-minute weekly repeats: those drift across daylight saving changes.
Missing dates/local times are skipped; an ambiguous local time uses its first
occurrence. This deliberately does not implement arbitrary user-supplied RRULEs.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re

DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
GRAPH_DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


def spec(args, zone):
    tz = ZoneInfo(zone)
    all_day = args.get("all_day", False)
    values = []
    for key in ("start", "end"):
        raw = args.get(key, args.get(key + "_time", ""))
        if all_day:
            if not re.fullmatch(r"\d{4}-\d\d-\d\d", raw):
                raise ValueError("Use dates for an all-day event.")
            value = datetime.fromisoformat(raw).replace(tzinfo=tz)
        else:
            value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if value.tzinfo is None:
                raise ValueError("Use an event time with its timezone offset.")
            value = value.astimezone(tz)
        values.append(value)
    start, end = values
    if end <= start or end - start > timedelta(days=366):
        raise ValueError("Choose an end after the start and a bounded duration.")
    frequency = args.get("recurrence_frequency", "none")
    interval = args.get("recurrence_interval", 1)
    count = args.get("recurrence_count", 1 if frequency == "none" else 0)
    weekdays = args.get("recurrence_weekdays", [])
    until = args.get("recurrence_until", "")
    if (
        frequency not in ("none", "daily", "weekly", "monthly")
        or type(interval) is not int
        or not 1 <= interval <= 52
        or type(count) is not int
        or not 0 <= count <= 1000
    ):
        raise ValueError("Choose valid event recurrence and an optional bounded count.")
    if (
        not isinstance(weekdays, list)
        or any(x not in DAYS for x in weekdays)
        or len(set(weekdays)) != len(weekdays)
    ):
        raise ValueError("Choose unique weekdays MO through SU.")
    if weekdays and frequency != "weekly":
        raise ValueError("Weekday selection applies to weekly recurrence.")
    if frequency == "weekly":
        weekdays = weekdays or [DAYS[start.weekday()]]
        if DAYS[start.weekday()] not in weekdays:
            raise ValueError("The first event must fall on a selected weekday.")
    if until:
        if (
            not re.fullmatch(r"\d{4}-\d\d-\d\d", until)
            or datetime.fromisoformat(until).date() < start.date()
        ):
            raise ValueError("Choose an ending date after the first event.")
        if count:
            raise ValueError("Choose an ending date or an occurrence count, not both.")
    minutes = args.get("reminder_minutes")
    delivery = args.get(
        "reminder_delivery", "calendar" if minutes is not None else "none"
    )
    if minutes is not None and (type(minutes) is not int or not 0 <= minutes <= 40320):
        raise ValueError(
            "Choose a reminder between zero minutes and four weeks before."
        )
    if delivery not in ("none", "calendar", "ha", "both") or (
        delivery != "none" and minutes is None
    ):
        raise ValueError("Choose notification timing and delivery together.")
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "timezone": zone,
        "all_day": all_day,
        "frequency": frequency,
        "interval": interval,
        "count": count,
        "weekdays": weekdays,
        "until": until,
        "reminder_minutes": minutes,
        "reminder_delivery": delivery,
    }


def google_rule(s):
    if s["frequency"] == "none":
        return []
    parts = ["FREQ=" + s["frequency"].upper(), "INTERVAL=" + str(s["interval"])]
    if s["weekdays"]:
        parts.append("BYDAY=" + ",".join(s["weekdays"]))
    if s["count"]:
        parts.append("COUNT=" + str(s["count"]))
    if s["until"]:
        end = datetime.fromisoformat(s["until"] + "T23:59:59").replace(
            tzinfo=ZoneInfo(s["timezone"])
        )
        parts.append(
            "UNTIL="
            + (
                s["until"].replace("-", "")
                if s["all_day"]
                else end.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            )
        )
    return ["RRULE:" + ";".join(parts)]


def graph_rule(s):
    if s["frequency"] == "none":
        return None
    start = datetime.fromisoformat(s["start"])
    pattern = {
        "type": {"daily": "daily", "weekly": "weekly", "monthly": "absoluteMonthly"}[
            s["frequency"]
        ],
        "interval": s["interval"],
    }
    if s["frequency"] == "weekly":
        pattern.update(
            daysOfWeek=[GRAPH_DAYS[DAYS.index(x)] for x in s["weekdays"]],
            firstDayOfWeek="monday",
        )
    if s["frequency"] == "monthly":
        pattern["dayOfMonth"] = start.day
    range = {
        "type": "numbered" if s["count"] else "endDate" if s["until"] else "noEnd",
        "startDate": start.date().isoformat(),
        "recurrenceTimeZone": s["timezone"],
    }
    if s["count"]:
        range["numberOfOccurrences"] = s["count"]
    if s["until"]:
        range["endDate"] = s["until"]
    return {"pattern": pattern, "range": range}


def next_event(s, after):
    tz = ZoneInfo(s["timezone"])
    start = datetime.fromisoformat(s["start"]).astimezone(tz)
    # Non-ending schedules can jump directly near the requested day.
    first = (
        0
        if s["count"]
        else max(0, (after.astimezone(tz).date() - start.date()).days - 1)
    )
    seen = 0
    week_start = start.date() - timedelta(days=start.weekday())
    for offset in range(first, 36600):
        day = start.date() + timedelta(days=offset)
        if s["until"] and day.isoformat() > s["until"]:
            return None
        frequency = s["frequency"]
        matches = (
            (frequency == "none" and offset == 0)
            or (frequency == "daily" and offset % s["interval"] == 0)
            or (
                frequency == "weekly"
                and ((day - week_start).days // 7) % s["interval"] == 0
                and DAYS[day.weekday()] in s["weekdays"]
            )
            or (
                frequency == "monthly"
                and day.day == start.day
                and ((day.year - start.year) * 12 + day.month - start.month)
                % s["interval"]
                == 0
            )
        )
        if not matches:
            if frequency == "none":
                return None
            continue
        candidate = datetime.combine(day, start.timetz().replace(tzinfo=None)).replace(
            tzinfo=tz, fold=0
        )
        # Skip a nonexistent clock time, rather than silently moving it.
        if candidate.astimezone(timezone.utc).astimezone(tz).replace(
            tzinfo=None
        ) != candidate.replace(tzinfo=None):
            continue
        seen += 1
        if s["count"] and seen > s["count"]:
            return None
        if candidate.astimezone(timezone.utc) > after.astimezone(timezone.utc):
            return candidate
    return None
