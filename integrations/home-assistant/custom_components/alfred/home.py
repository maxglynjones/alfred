"""Native HA controls with fresh discovery, permissions and observed receipts."""

import asyncio
import colorsys
import math
import json
import time
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4
from homeassistant.helpers import (
    area_registry as ar,
    entity_registry as er,
    device_registry as dr,
)

DOMAINS = {
    "light",
    "switch",
    "scene",
    "script",
    "automation",
    "sensor",
    "binary_sensor",
    "climate",
    "cover",
    "fan",
    "media_player",
    "vacuum",
    "lock",
    "alarm_control_panel",
    "input_boolean",
    "input_number",
    "input_select",
    "button",
    "camera",
    "todo",
}


def fail(message):
    raise ValueError(message)


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def rgb_xy(rgb):
    if len(rgb) != 3 or any(
        not isinstance(x, (int, float)) or not 0 <= x <= 255 for x in rgb
    ):
        fail("Use RGB values between 0 and 255.")
    r, g, b = [
        ((v / 255 + 0.055) / 1.055) ** 2.4 if v / 255 > 0.04045 else v / 255 / 12.92
        for v in rgb
    ]
    x = r * 0.664511 + g * 0.154324 + b * 0.162028
    y = r * 0.283881 + g * 0.668433 + b * 0.047685
    z = r * 0.000088 + g * 0.07231 + b * 0.986039
    return [x / (x + y + z), y / (x + y + z)] if x + y + z else None


def polygon(gamut):
    try:
        p = (
            [[gamut[k]["x"], gamut[k]["y"]] for k in ("red", "green", "blue")]
            if isinstance(gamut, dict)
            else [list(x) for x in gamut]
        )
        if (
            len(p) != 3
            or any(len(x) != 2 or x[1] <= 0 or x[0] < 0 or sum(x) > 1.000001 for x in p)
            or abs(cross(*p)) < 1e-6
        ):
            return None
        return p if cross(*p) > 0 else p[::-1]
    except (TypeError, KeyError):
        return None


def intersection(polygons):
    out = deepcopy(polygons[0])
    for clip in polygons[1:]:
        for i, a in enumerate(clip):
            b = clip[(i + 1) % len(clip)]
            old = out
            out = []
            for j, p in enumerate(old):
                q = old[(j + 1) % len(old)]
                dp = cross(a, b, p)
                dq = cross(a, b, q)
                if dp >= -1e-10:
                    out.append(p)
                if (dp >= -1e-10) != (dq >= -1e-10):
                    t = dp / (dp - dq)
                    out.append([p[k] + t * (q[k] - p[k]) for k in (0, 1)])
    return out


def clamp(point, p):
    if len(p) < 3:
        fail("These fixtures have no usable common colour gamut.")
    if all(cross(a, p[(i + 1) % len(p)], point) >= -1e-10 for i, a in enumerate(p)):
        return point
    candidates = []
    for i, a in enumerate(p):
        b = p[(i + 1) % len(p)]
        delta = [b[k] - a[k] for k in (0, 1)]
        den = sum(x * x for x in delta)
        t = max(
            0,
            min(
                1, sum((point[k] - a[k]) * delta[k] for k in (0, 1)) / den if den else 0
            ),
        )
        candidates.append([a[k] + t * delta[k] for k in (0, 1)])
    return min(candidates, key=lambda q: sum((q[k] - point[k]) ** 2 for k in (0, 1)))


class Home:
    def __init__(self, r):
        self.r = r
        self.hass = r.hass
        self.clear_locks = {kind: asyncio.Lock() for kind in ("shopping", "tasks")}

    def inventory(self):
        entities = er.async_get(self.hass)
        devices = dr.async_get(self.hass)
        areas = ar.async_get(self.hass)
        rows = []
        for state in self.hass.states.async_all():
            domain = state.entity_id.split(".")[0]
            if domain not in DOMAINS:
                continue
            entity = entities.async_get(state.entity_id)
            device = (
                devices.async_get(entity.device_id)
                if entity and entity.device_id
                else None
            )
            area_id = (entity.area_id if entity else None) or (
                device.area_id if device else None
            )
            area = areas.async_get_area(area_id) if area_id else None
            if entity and entity.disabled_by:
                continue
            rows.append(
                {
                    "entity_id": state.entity_id,
                    "name": (
                        state.name if isinstance(state.name, str) else state.entity_id
                    ),
                    "domain": domain,
                    "manufacturer": getattr(device, "manufacturer", "") or "",
                    "model": getattr(device, "model", "") or "",
                    "room": area.name if area and isinstance(area.name, str) else "",
                    "area_id": area_id,
                    "aliases": sorted(
                        x
                        for x in (getattr(entity, "aliases", []) or [])
                        if isinstance(x, str)
                    ),
                    "area_aliases": sorted(
                        x
                        for x in (getattr(area, "aliases", []) or [])
                        if isinstance(x, str)
                    ),
                    "state": state.state,
                    "attributes": dict(state.attributes),
                    "available": state.state not in ("unavailable", "unknown"),
                    "approved": state.entity_id
                    in self.r.config.get("homeEntities", []),
                }
            )
        return rows

    def approved(self):
        return [x for x in self.inventory() if x["approved"]]

    async def service(self, domain, service, data):
        if not self.hass.services.has_service(domain, service):
            fail(f"{domain}.{service} is not available in Home Assistant.")
        async with asyncio.timeout(5):
            return await self.hass.services.async_call(
                domain,
                service,
                data,
                blocking=True,
                return_response=(
                    self.hass.services.supports_response(domain, service).value
                    == "only"
                    if hasattr(self.hass.services, "supports_response")
                    else False
                ),
            )

    def targets(self, names, domain="light"):
        rows = [x for x in self.approved() if x["domain"] == domain]
        selected = []
        for name in names:
            if not isinstance(name, str) or not name.strip():
                fail("Name a room or device.")
            matches = [
                x
                for x in rows
                if name.casefold()
                in (
                    "all lights",
                    x["entity_id"].casefold(),
                    x["name"].casefold(),
                    x["room"].casefold(),
                )
            ]
            if not matches:
                fail(
                    f"{name} is not a current approved {domain}. Review devices in HA → Alfred."
                )
            selected.extend(matches)
        return list({x["entity_id"]: x for x in selected}.values())

    async def lists(self, name, a):
        kind = "shopping" if "shopping" in name else "tasks"
        entity = self.r.config.get("haLists", {}).get(kind)
        if not entity or not self.hass.states.get(entity):
            fail(f"Choose a Home Assistant {kind} list in HA → Alfred.")

        async def read():
            async with asyncio.timeout(4):
                d = await self.hass.services.async_call(
                    "todo",
                    "get_items",
                    {"entity_id": entity},
                    blocking=True,
                    return_response=True,
                )
            rows = d.get(entity, {}).get("items")
            if not isinstance(rows, list) or len(rows) > 1000:
                fail("Home Assistant returned an invalid list response.")
            return [
                {
                    "id": x["uid"],
                    "title": x["summary"],
                    "completed": x["status"] == "completed",
                }
                for x in rows
            ]

        before = await read()
        status = a.get("status", "needed" if kind == "shopping" else "open")
        status = {"needed": "open", "bought": "completed"}.get(status, status)
        if name.startswith("list_"):
            rows = [
                x
                for x in before
                if status == "all" or x["completed"] == (status == "completed")
            ]
            offset = a.get("offset", 0)
            if not isinstance(offset, int) or not 0 <= offset <= 1000:
                fail("Invalid list offset.")
            return {
                "items": rows[offset : offset + 100],
                "total": len(rows),
                "more_available": len(rows) > offset + 100,
                "next_offset": offset + 100 if len(rows) > offset + 100 else None,
            }
        ids = a.get("ids", [a.get("id")])
        titles = a.get("items", a.get("titles", [a.get("title")]))
        if name.startswith("add_"):
            if (
                not isinstance(titles, list)
                or not 1 <= len(titles) <= 20
                or any(
                    not isinstance(t, str) or not 0 < len(t.strip()) <= 300
                    for t in titles
                )
            ):
                fail("Use 1–20 short item titles.")
            for title in titles:
                await self.service(
                    "todo", "add_item", {"entity_id": entity, "item": title.strip()}
                )
        else:
            if not 1 <= len(ids) <= 100 or any(
                not any(x["id"] == id for x in before) for id in ids
            ):
                fail("Read the current list before changing its items.")
            for id in ids:
                if name.startswith("remove_"):
                    await self.service(
                        "todo", "remove_item", {"entity_id": entity, "item": id}
                    )
                elif name.startswith("rename_"):
                    await self.service(
                        "todo",
                        "update_item",
                        {"entity_id": entity, "item": id, "rename": a["title"]},
                    )
                else:
                    completed = a.get("completed", a.get("bought"))
                    if not isinstance(completed, bool):
                        fail("Choose complete or open.")
                    await self.service(
                        "todo",
                        "update_item",
                        {
                            "entity_id": entity,
                            "item": id,
                            "status": "completed" if completed else "needs_action",
                        },
                    )
        after = await read()
        if name.startswith("add_"):
            verified = all(
                sum(x["title"] == t.strip() for x in after)
                > sum(x["title"] == t.strip() for x in before)
                for t in titles
            )
        elif name.startswith("remove_"):
            verified = all(not any(x["id"] == id for x in after) for id in ids)
        elif name.startswith("rename_"):
            verified = any(
                x["id"] == ids[0] and x["title"] == a["title"] for x in after
            )
        else:
            verified = all(
                any(x["id"] == id and x["completed"] == completed for x in after)
                for id in ids
            )
        if not verified:
            fail(
                "The list changed partially or could not be verified. Read it before repeating."
            )
        return {"saved": True, "verified": True, "items": after}

    async def clear_list(self, kind):
        """Delete the requested snapshot, not the entity or newly concurrent items."""
        if kind not in ("shopping", "tasks"):
            fail("Choose shopping or tasks.")
        listing = "list_shopping" if kind == "shopping" else "list_todos"
        removal = "remove_shopping_items" if kind == "shopping" else "remove_todos"
        async with asyncio.timeout(25), self.clear_locks[kind]:
            entity = self.r.config.get("haLists", {}).get(kind)
            current = await self.lists(listing, {"status": "all"})
            ids = [x["id"] for x in current["items"]]
            while current.get("more_available"):
                current = await self.lists(
                    listing, {"status": "all", "offset": current["next_offset"]}
                )
                ids.extend(x["id"] for x in current["items"])
            ids = list(dict.fromkeys(ids))
            for at in range(0, len(ids), 100):
                if self.r.config.get("haLists", {}).get(kind) != entity:
                    fail("The selected list changed; clearing stopped.")
                await self.lists(removal, {"ids": ids[at : at + 100]})
            if (await self.lists(listing, {"status": "all"}))["items"]:
                fail(
                    "Items remain or the list changed while clearing. Check it before trying again."
                )
            return {"verified": True, "removed": len(ids), "kind": kind}

    async def lights(self, name, a):
        if name == "get_lights":
            return {"lights": [x for x in self.approved() if x["domain"] == "light"]}
        rows = self.targets(a.get("targets") or [a.get("target")])
        skipped = []
        commands = []
        colour_report = None
        action = a.get("state") or a.get("action", "on")
        a = {**a}
        if a.get("transition_seconds") is not None:
            a["transition"] = a["transition_seconds"]
        props = {
            k: v
            for k, v in a.items()
            if v is not None
            and k
            in (
                "brightness_percent",
                "rgb_color",
                "hs_color",
                "xy_color",
                "color_temp_kelvin",
                "effect",
                "transition",
                "flash",
            )
        }
        if name == "control_light_palette":
            colours = a.get("colours", a.get("colors", []))
            if not colours:
                fail("Choose a colour palette.")
            receipts = []
            for i, x in enumerate(rows):
                receipts.append(
                    await self.lights(
                        "set_light_properties",
                        {
                            "targets": [x["entity_id"]],
                            "rgb_color": colours[i % len(colours)],
                        },
                    )
                )
            return {
                "verification": (
                    "confirmed"
                    if all(x["verification"] == "confirmed" for x in receipts)
                    else "unconfirmed"
                ),
                "receipts": receipts,
            }
        if action not in ("on", "off", "settings"):
            fail("Choose on, off or settings.")
        if props.get("brightness_percent") == 0:
            action = "off"
        colour = any(k in props for k in ("rgb_color", "hs_color", "xy_color"))
        compatible = []
        for row in rows:
            modes = row["attributes"].get("supported_color_modes", [])
            if colour and not set(modes) & {"rgb", "rgbw", "rgbww", "hs", "xy"}:
                skipped.append({"name": row["name"], "reason": "Colour unsupported"})
                continue
            if "color_temp_kelvin" in props and "color_temp" not in modes:
                skipped.append(
                    {"name": row["name"], "reason": "White temperature unsupported"}
                )
                continue
            if "brightness_percent" in props and not set(modes) - {"onoff", "unknown"}:
                skipped.append(
                    {"name": row["name"], "reason": "Brightness unsupported"}
                )
                continue
            compatible.append(row)
        xy = None
        if colour:
            xy = props.get("xy_color") or rgb_xy(
                props["rgb_color"]
                if "rgb_color" in props
                else [
                    v * 255
                    for v in colorsys.hsv_to_rgb(
                        props["hs_color"][0] / 360, props["hs_color"][1] / 100, 1
                    )
                ]
            )
            if xy:
                if len(xy) != 2 or xy[1] <= 0 or xy[0] < 0 or sum(xy) > 1.000001:
                    fail("Invalid XY colour.")
                gamuts = [
                    polygon(x["attributes"].get("color_gamut")) for x in compatible
                ]
                known = [x for x in gamuts if x]
                applied = clamp(xy, intersection(known)) if known else xy
                colour_report = {
                    "method": (
                        "common-gamut xy" if known else "normalized xy; gamut unknown"
                    ),
                    "gamut_limited": math.dist(xy, applied) > 1e-6,
                    "unknown_gamuts": [
                        x["name"] for x, g in zip(compatible, gamuts) if not g
                    ],
                    "physical_match_verified": False,
                }
                xy = applied
            else:
                action = "off"
        for row in compatible:
            data = {"entity_id": row["entity_id"]}
            for key, val in props.items():
                if key in ("rgb_color", "hs_color", "xy_color"):
                    continue
                if key == "brightness_percent":
                    if not isinstance(val, (int, float)) or not 0 <= val <= 100:
                        fail("Brightness must be 0–100 percent.")
                    data["brightness_pct"] = val
                elif key == "transition":
                    if not isinstance(val, (int, float)) or not 0 <= val <= 30:
                        fail("Transition must be 0–30 seconds.")
                    data[key] = val
                elif key == "color_temp_kelvin":
                    low = row["attributes"].get("min_color_temp_kelvin") or 2000
                    high = row["attributes"].get("max_color_temp_kelvin") or 6500
                    if not isinstance(val, (int, float)) or not low <= val <= high:
                        skipped.append(
                            {
                                "name": row["name"],
                                "reason": f"White temperature supported only between {low} and {high} K",
                            }
                        )
                        data = None
                        break
                    data[key] = val
                elif key == "effect" and val not in row["attributes"].get(
                    "effect_list", []
                ):
                    skipped.append(
                        {"name": row["name"], "reason": "Effect unsupported"}
                    )
                    data = None
                    break
                else:
                    data[key] = val
            if data is None:
                continue
            if xy:
                data["xy_color"] = xy
            commands.append((row, data, "off" if action == "off" else "on"))
        if not commands:
            fail("No selected fixtures support the requested setting.")

        # Explicit safe power/set commands may be retried once when state verification fails.
        async def apply():
            groups = {}
            for row, data, expected in commands:
                properties = (
                    {k: v for k, v in data.items() if k != "entity_id"}
                    if expected == "on"
                    else {}
                )
                key = (expected, json.dumps(properties, sort_keys=True))
                group = groups.setdefault(key, {"entity_id": [], **properties})
                group["entity_id"].append(row["entity_id"])
            for (expected, _), data in groups.items():
                await self.service("light", "turn_" + expected, data)

        # Persist a bounded undo snapshot before the write; never infer old settings from chat.
        if not getattr(self, "restoring", False):
            self.r.data["previous_lighting"] = self.lighting_snapshot(
                [row for row, _, _ in commands]
            )
            await self.r.save()
        await apply()
        unmatched = []
        for attempt in range(2):
            for poll in range(5):
                if poll:
                    await asyncio.sleep(0.2)
                unmatched = []
                for row, data, expected in commands:
                    s = self.hass.states.get(row["entity_id"])
                    ok = bool(s and s.state == expected)
                    if ok and expected == "on":
                        at = s.attributes
                        if "brightness_pct" in data:
                            ok = (
                                abs(
                                    (
                                        at.get("brightness")
                                        if isinstance(
                                            at.get("brightness"), (int, float)
                                        )
                                        else -1000
                                    )
                                    * 100
                                    / 255
                                    - data["brightness_pct"]
                                )
                                <= 3
                            )
                        if "xy_color" in data:
                            ok = (
                                ok
                                and isinstance(at.get("xy_color"), (list, tuple))
                                and math.dist(at["xy_color"], data["xy_color"]) <= 0.025
                            )
                        if "color_temp_kelvin" in data:
                            ok = (
                                ok
                                and abs(
                                    (at.get("color_temp_kelvin") or 0)
                                    - data["color_temp_kelvin"]
                                )
                                <= 100
                            )
                        if "effect" in data:
                            ok = ok and at.get("effect") == data["effect"]
                    if not ok:
                        unmatched.append(
                            {
                                "name": row["name"],
                                "entity_id": row["entity_id"],
                                "state": s.state if s else "removed",
                                "reason": "Observed state does not match request",
                            }
                        )
                if not unmatched:
                    break
            if not unmatched:
                break
            if attempt == 0:
                await apply()
        return {
            "verification": "confirmed" if not unmatched else "unconfirmed",
            "lights": [
                {"entity_id": x[0]["entity_id"], "name": x[0]["name"]} for x in commands
            ],
            "skipped": skipped,
            "unmatched": unmatched,
            "colour_matching": colour_report,
        }

    async def control(self, a):
        entity = a.get("entity_id")
        row = next((x for x in self.approved() if x["entity_id"] == entity), None)
        if not row:
            fail("This device is removed or not approved in HA → Alfred.")
        domain = row["domain"]
        action = a.get("action")
        value = a.get("value")
        data = {"entity_id": entity}
        aliases = {
            "fan_speed": "percentage",
            "cover_position": "position",
            "hvac_mode": "mode",
            "set_value": "set",
        }
        action = aliases.get(action, action)
        if domain == "light" and action in ("brightness", "white_temperature", "rgb"):
            props = {
                "brightness": "brightness_percent",
                "white_temperature": "color_temp_kelvin",
                "rgb": "rgb_color",
            }
            if action == "rgb":
                value = json.loads(value) if isinstance(value, str) else value
            return await self.lights(
                "set_light_properties", {"targets": [entity], props[action]: value}
            )
        if domain == "script" and action == "activate":
            action = "run"
        if domain == "automation" and action == "activate":
            action = "trigger"
        allowed = {
            "scene": {"activate": "turn_on"},
            "script": {"run": "turn_on"},
            "automation": {"trigger": "trigger", "on": "turn_on", "off": "turn_off"},
            "switch": {"on": "turn_on", "off": "turn_off"},
            "input_boolean": {"on": "turn_on", "off": "turn_off"},
            "light": {"on": "turn_on", "off": "turn_off"},
            "media_player": {
                "source": "select_source",
                "seek": "media_seek",
                "play": "media_play",
                "pause": "media_pause",
                "stop": "media_stop",
                "next": "media_next_track",
                "previous": "media_previous_track",
                "volume": "volume_set",
                "mute": "volume_mute",
                "on": "turn_on",
                "off": "turn_off",
            },
            "climate": {
                "fan_mode": "set_fan_mode",
                "preset": "set_preset_mode",
                "temperature": "set_temperature",
                "mode": "set_hvac_mode",
                "on": "turn_on",
                "off": "turn_off",
            },
            "cover": {
                "open": "open_cover",
                "close": "close_cover",
                "stop": "stop_cover",
                "position": "set_cover_position",
            },
            "fan": {"on": "turn_on", "off": "turn_off", "percentage": "set_percentage"},
            "vacuum": {
                "start": "start",
                "pause": "pause",
                "stop": "stop",
                "return": "return_to_base",
            },
            "lock": {"lock": "lock", "unlock": "unlock"},
            "button": {"press": "press"},
            "input_number": {"set": "set_value"},
            "input_select": {"select": "select_option"},
        }
        service = allowed.get(domain, {}).get(action)
        if not service:
            fail("Unsupported action for this entity.")
        if action == "volume":
            if not isinstance(value, (int, float)) or not 0 <= value <= 100:
                fail("Volume must be 0–100 percent.")
            value = value / 100
        if action == "mute":
            if value not in ("on", "off"):
                fail("Choose mute on or off.")
            value = value == "on"
        if action in ("percentage", "position") and (
            not isinstance(value, (int, float)) or not 0 <= value <= 100
        ):
            fail("Use 0–100 percent.")
        if action == "temperature" and (
            not isinstance(value, (int, float))
            or not row["attributes"].get("min_temp", 5)
            <= value
            <= row["attributes"].get("max_temp", 35)
        ):
            fail("Temperature is outside device limits.")
        if action == "mode" and value not in row["attributes"].get("hvac_modes", []):
            fail("Choose a supported climate mode.")
        params = {
            "volume": "volume_level",
            "mute": "is_volume_muted",
            "temperature": "temperature",
            "mode": "hvac_mode",
            "position": "position",
            "percentage": "percentage",
            "set": "value",
            "select": "option",
            "source": "source",
            "seek": "seek_position",
            "fan_mode": "fan_mode",
            "preset": "preset_mode",
        }
        if action in ("source", "fan_mode", "preset") and value not in row[
            "attributes"
        ].get(
            {
                "source": "source_list",
                "fan_mode": "fan_modes",
                "preset": "preset_modes",
            }[action],
            [],
        ):
            fail("Choose a reported device option.")
        if action == "seek" and (
            not isinstance(value, (int, float)) or not 0 <= value <= 86400
        ):
            fail("Invalid seek time.")
        if action in params:
            data[params[action]] = value
        await self.service(domain, service, data)
        # Scenes/scripts are execution receipts, never claims that all resulting states match.
        await asyncio.sleep(0.2)
        state = self.hass.states.get(entity)
        return {
            "accepted": True,
            "state": state.state if state else None,
            "verification": (
                "confirmed"
                if action in ("on", "off") and state and state.state == action
                else "accepted_unverified"
            ),
        }

    def lighting_snapshot(self, rows):
        return [
            {
                "entity_id": row["entity_id"],
                "state": row["state"],
                "settings": {
                    k: v
                    for k, v in row["attributes"].items()
                    if k in ("brightness", "xy_color", "color_temp_kelvin", "effect")
                    and v is not None
                    and (
                        k != "xy_color"
                        or row["attributes"].get("color_mode") != "color_temp"
                    )
                    and (
                        k != "color_temp_kelvin"
                        or row["attributes"].get("color_mode") in (None, "color_temp")
                    )
                },
            }
            for row in rows
        ]

    async def restore_lighting(self):
        snapshot = self.r.data.get("previous_lighting")
        if not snapshot:
            fail("No previous lighting configuration is available yet.")
        self.restoring = True
        try:
            receipts = []
            for row in snapshot:
                settings = deepcopy(row["settings"])
                # Only restore the active colour mode, never conflicting temperature and XY.
                if settings.get("xy_color"):
                    settings.pop("color_temp_kelvin", None)
                if "brightness" in settings:
                    settings["brightness_percent"] = (
                        settings.pop("brightness") * 100 / 255
                    )
                receipts.append(
                    await self.lights(
                        "set_light_properties",
                        {
                            "targets": [row["entity_id"]],
                            "action": row["state"],
                            **settings,
                        },
                    )
                )
            return {
                "verification": (
                    "confirmed"
                    if receipts
                    and all(x.get("verification") == "confirmed" for x in receipts)
                    else "unconfirmed"
                ),
                "receipts": receipts,
            }
        finally:
            self.restoring = False

    async def scenes(self, name, a):
        if name in ("list_saved_scenes", "save_home_scene", "remove_saved_scene"):
            return await self._scenes(name, a)
        scene = next((x for x in self.r.data["scenes"] if x["id"] == a.get("id")), None)
        if not scene or not scene.get("lights"):
            fail("Read the current scenes first; this scene has no current lights.")
        approved = {x["entity_id"] for x in self.approved() if x["domain"] == "light"}
        rows = self.targets(
            [x["entity_id"] for x in scene["lights"] if x["entity_id"] in approved]
        )
        if not rows:
            fail("This scene has no current approved lights.")
        self.r.data["previous_lighting"] = self.lighting_snapshot(rows)
        await self.r.save()
        self.restoring = True
        try:
            return await self._scenes(name, a)
        finally:
            self.restoring = False

    async def _scenes(self, name, a):
        rows = self.r.data["scenes"]
        if name == "list_saved_scenes":
            return {"scenes": rows}
        if name == "save_home_scene":
            lights = self.targets(a.get("entity_ids", []))
            if (
                not lights
                or not a.get("name")
                or any(x["name"] == a["name"] for x in rows)
            ):
                fail("Use a unique scene name and current approved lights.")
            scene = {"id": str(uuid4()), "name": a["name"], "lights": []}
            for x in lights:
                at = x["attributes"]
                settings = {
                    k: at[k]
                    for k in ("brightness", "xy_color", "color_temp_kelvin", "effect")
                    if k in at
                    and at[k] is not None
                    and (k != "xy_color" or at.get("color_mode") != "color_temp")
                    and (
                        k != "color_temp_kelvin"
                        or at.get("color_mode") in (None, "color_temp")
                    )
                }
                scene["lights"].append(
                    {
                        "entity_id": x["entity_id"],
                        "state": x["state"],
                        "settings": settings,
                    }
                )
            rows.append(scene)
            await self.r.save()
            return {"saved": True, "scene": scene}
        scene = next((x for x in rows if x["id"] == a.get("id")), None)
        if not scene:
            fail("Read the current scenes first.")
        if name == "remove_saved_scene":
            rows.remove(scene)
            await self.r.save()
            return {"saved": True}
        results = []
        approved = {x["entity_id"] for x in self.approved() if x["domain"] == "light"}
        for x in scene["lights"]:
            if x["entity_id"] not in approved:
                continue
            # Legacy imports stored the actual palette under command. Preserve
            # those values rather than silently replaying every scene as turn-on.
            settings = {
                **deepcopy(x.get("command", {})),
                **deepcopy(x.get("settings", {})),
            }
            expected_state = settings.pop("expected_state", "on")
            if "brightness_pct" in settings:
                settings["brightness_percent"] = settings.pop("brightness_pct")
            settings.update(
                {
                    k: v
                    for k, v in x.items()
                    if k
                    in (
                        "xy_color",
                        "hs_color",
                        "rgb_color",
                        "color_temp_kelvin",
                        "effect",
                    )
                }
            )
            if "brightness_pct" in x:
                settings["brightness_percent"] = x["brightness_pct"]
            settings = {k: v for k, v in settings.items() if v is not None}
            if settings.get("xy_color"):
                settings.pop("color_temp_kelvin", None)
            if "brightness" in settings:
                settings["brightness_percent"] = settings.pop("brightness") * 100 / 255
            results.append(
                await self.lights(
                    "set_light_properties",
                    {
                        "targets": [x["entity_id"]],
                        "action": x.get(
                            "state", x.get("expected_state", expected_state)
                        ),
                        **settings,
                    },
                )
            )
        return {
            "verification": (
                "confirmed"
                if all(x["verification"] == "confirmed" for x in results)
                else "unconfirmed"
            ),
            "receipts": results,
        }

    async def dashboard(self, view):
        now = datetime.now(timezone.utc).isoformat()
        lights = [x for x in self.approved() if x["domain"] == "light"]
        if view == "rooms":
            return {
                "view": view,
                "rooms": [
                    {
                        "name": room,
                        "lights": [x for x in lights if x["room"] == room],
                        "on": sum(
                            x["state"] == "on" for x in lights if x["room"] == room
                        ),
                        "total": sum(x["room"] == room for x in lights),
                        "unavailable": sum(
                            x["room"] == room and not x["available"] for x in lights
                        ),
                    }
                    for room in sorted({x["room"] for x in lights if x["room"]})
                ],
                "lights": lights,
                "generated_at": now,
            }
        if view in ("tasks", "shopping"):
            d = await self.lists(
                "list_shopping" if view == "shopping" else "list_todos",
                {"status": "open"},
            )
            return {"view": view, **d, "generated_at": now}
        if view == "day":
            return {
                "view": view,
                "connected": self.r.providers.connected("calendar"),
                "events": (await self.r.providers.events({})).get("events", []),
                "generated_at": now,
            }
        tasks, shopping = None, None
        for kind in ("tasks", "shopping"):
            try:
                d = await self.lists(
                    "list_todos" if kind == "tasks" else "list_shopping",
                    {"status": "open"},
                )
                if kind == "tasks":
                    tasks = d["total"]
                else:
                    shopping = d["total"]
            except (ValueError, TimeoutError):
                pass
        weather = await self.r.providers.weather()
        result = {
            "view": "home",
            "generated_at": now,
            "tasks": tasks,
            "shopping": shopping,
            "weather": weather,
            "home": {
                "connected": True,
                "lights_on": sum(x["state"] == "on" for x in lights),
                "lights_total": len(lights),
            },
            "assistant": "Alfred",
            "date": now,
            "profile": {
                **self.r.profile(),
                "address": (
                    self.r.profile().get("addressAs", "")
                    if self.r.profile().get("addressAs") != "none"
                    else ""
                ),
            },
            "connections": {
                "ai": self.r.providers.ready(),
                "home": True,
                "google": bool(self.r.config.get("google", {}).get("refreshToken")),
                "mail_provider": self.r.config.get("mailProvider", "none"),
                "calendar_provider": self.r.config.get("calendarProvider", "none"),
            },
        }
        if self.r.config.get("dashboardAgenda") and self.r.providers.connected(
            "calendar"
        ):
            try:
                result["next_event"] = next(
                    iter((await self.r.providers.events({})).get("events", [])), None
                )
            except ValueError:
                result["agenda_error"] = "Calendar unavailable"
        return result
