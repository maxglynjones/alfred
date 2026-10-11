"""Alfred's HA-native backend. No Node process or administrator token at runtime.

Provider I/O is asynchronous and bounded. HA Store is the sole authority; device
credentials are separate from HA administrator credentials and can be revoked.
"""

import asyncio
import base64
import hashlib
import hmac
import io
import json
import secrets
import struct
import time
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from homeassistant.helpers.storage import Store
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .home import Home
from .providers import Providers
from .assistant import Assistant
from .experiences import Experiences
from .media import inspect_image
from .commands import Commands

ROOT = Path(__file__).parent
VERSION = "0.20.2"


class AlfredError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Runtime:
    def __init__(self, hass, engine):
        self.hass = hass
        self.engine = engine
        self.store = Store(hass, 1, "alfred.product")
        self.lock = asyncio.Lock()
        self.session = async_get_clientsession(hass)
        self.data = {
            "settings": {},
            "history": {},
            "memories": [],
            "scenes": [],
            "jobs": [],
            "news": [],
            "imports": [],
        }
        self.pairing = None
        self.pending = {}
        self.busy = set()
        self.rates = {}
        self.location = None
        self.home = Home(self)
        self.providers = Providers(self)
        self.assistant = Assistant(self)
        self.experiences = Experiences(self)
        self.jobs = set()
        self.periodic_lock = asyncio.Lock()
        self.commands = Commands(self)
        from .local_ops import LocalOps
        from .delivery import Delivery

        self.local_ops = LocalOps(self)
        self.delivery = Delivery(self)
        self.request_route = {}
        self.request_metrics = {}
        self.performance = []

    @property
    def config(self):
        return self.data["settings"]

    async def load(self):
        from .email_format import logo_bytes

        # Prime the tiny shared asset off the event loop; sends use cached bytes.
        await self.hass.async_add_executor_job(logo_bytes)
        self.data = await self.store.async_load() or self.data
        defaults = await self.hass.async_add_executor_job(
            lambda: json.loads((ROOT / "product.json").read_text())["defaults"]
        )
        defaults["profile"]["timezone"] = getattr(
            getattr(self.hass, "config", None),
            "time_zone",
            defaults["profile"].get("timezone", "UTC"),
        )
        self.contracts = await self.hass.async_add_executor_job(
            lambda: json.loads((ROOT / "tool_contracts.json").read_text())
        )
        self.preferences = await self.hass.async_add_executor_job(
            lambda: json.loads((ROOT / "preferences.json").read_text())
        )
        self.tool_routing = await self.hass.async_add_executor_job(
            lambda: json.loads((ROOT / "tool-routing.json").read_text())
        )
        self.data["settings"] = {**defaults, **self.config}
        self.config.pop("homeToken", None)
        self.config.pop("homeUrl", None)
        self.config.pop("homeLights", None)
        for plan in self.data.get("plans", []):
            if plan.get("status") == "running":
                plan["status"] = "interrupted_or_uncertain"
        for job in self.data.get("jobs", []):
            if job.get("status") in ("queued", "running"):
                job.update(
                    status="interrupted",
                    error="Home Assistant restarted; ask to research again.",
                )
        await self.save()

    def history_key(self, device):
        return "owner" if self.config.get("shareConversation") else device

    def history_for(self, device):
        return self.data["history"].get(
            self.history_key(device), self.data["history"].get("migrated-device", [])
        )

    async def save(self):
        async with self.lock:
            await self.store.async_save(deepcopy(self.data))

    async def close(self):
        for task in self.jobs:
            task.cancel()
        if self.jobs:
            await asyncio.gather(*self.jobs, return_exceptions=True)

    def authenticate(self, token):
        if not isinstance(token, str) or len(token) > 256:
            return None
        for device in self.config.get("pairedDevices", []):
            if hmac.compare_digest(token, device.get("token", "")):
                return device["id"]
        legacy = self.config.get("clientToken")
        if legacy and hmac.compare_digest(token, legacy):
            return "migrated-device"
        return None

    def rate(self, key, limit=20):
        now = time.monotonic()
        rows = [n for n in self.rates.get(key, []) if now - n < 60]
        if len(rows) >= limit:
            raise AlfredError("Too many requests. Wait a minute.", 429)
        rows.append(now)
        self.rates[key] = rows

    async def pair(self, a):
        p = self.pairing
        if not p or time.monotonic() > p["expires"] or p["attempts"] >= 10:
            raise AlfredError(
                "Create a fresh pairing code in Home Assistant → Alfred.", 403
            )
        p["attempts"] += 1
        if not hmac.compare_digest(str(a.get("code", "")), p["code"]):
            raise AlfredError("Pairing code did not match.", 403)
        name = a.get("name", "Alfred glasses")
        if not isinstance(name, str) or len(name) > 40:
            raise AlfredError("Use a short device name.")
        devices = self.config.setdefault("pairedDevices", [])
        if len(devices) >= 8:
            raise AlfredError("Revoke an old paired device first.", 409)
        d = {
            "id": str(uuid4()),
            "label": name,
            "token": secrets.token_hex(32),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        devices.append(d)
        self.pairing = None
        await self.save()
        return {"clientToken": d["token"], "device_id": d["id"]}

    async def http(
        self,
        method,
        url,
        *,
        headers=None,
        body=None,
        form=None,
        timeout=8,
        limit=1048576,
    ):
        try:
            async with asyncio.timeout(timeout):
                async with self.session.request(
                    method,
                    url,
                    headers=headers,
                    json=body,
                    data=form,
                    allow_redirects=False,
                ) as response:
                    chunks = []
                    size = 0
                    async for chunk in response.content.iter_chunked(16384):
                        size += len(chunk)
                        if size > limit:
                            raise AlfredError(
                                "Service response exceeds the supported limit.", 502
                            )
                        chunks.append(chunk)
                    raw = b"".join(chunks)
                    if response.status >= 300:
                        raise AlfredError(
                            f"{urlparse(url).hostname} returned HTTP {response.status}. Check the connection and permissions.",
                            502,
                        )
                    try:
                        return json.loads(raw)
                    except (ValueError, UnicodeDecodeError):
                        return raw.decode("utf-8", "replace")
        except TimeoutError as exc:
            raise AlfredError(
                f"{urlparse(url).hostname} did not respond within {timeout} seconds.",
                504,
            ) from exc
        except AlfredError:
            raise
        except Exception as exc:
            raise AlfredError(
                f"Cannot reach {urlparse(url).hostname}. Check that service and network.",
                502,
            ) from exc

    def profile(self):
        return self.config.get("profile", {})

    def safe_config(self):
        c = deepcopy(self.config)
        c["credentialStatus"] = {
            k: bool(self.config.get(k))
            for k in ("apiKey", "claudeKey", "localRouterKey")
        }
        for provider in ("google", "outlook"):
            for key in ("clientId", "clientSecret"):
                c["credentialStatus"][provider + "." + key] = bool(
                    self.config.get(provider, {}).get(key)
                )
        for k in list(c):
            if any(x in k.lower() for x in ("key", "token", "secret")):
                c.pop(k)
        for provider in ("google", "outlook"):
            p = c.get(provider, {})
            c[provider] = {
                "connected": bool(p.get("refreshToken")),
                "scopes": p.get("scopes", []),
                "email": p.get("email", ""),
            }
        c["pairedDevices"] = [
            {k: v for k, v in d.items() if k != "token"}
            for d in c.get("pairedDevices", [])
        ]
        return c

    def audit(self, kind, title, detail="", device=None):
        rows = self.data.setdefault("activity", [])
        rows.append(
            {
                "id": str(uuid4()),
                "kind": kind,
                "device": device,
                "title": title,
                "detail": detail,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        del rows[:-100]

    async def import_legacy(self, a):
        """A bounded, idempotent admin-only import; never import HA admin tokens."""
        digest = hashlib.sha256(json.dumps(a, sort_keys=True).encode()).hexdigest()
        if digest in self.data["imports"]:
            return {"saved": True, "already_imported": True}
        if self.data["imports"]:
            raise AlfredError(
                "An import exists. Restore the HA backup before replacing it."
            )
        c = deepcopy(a.get("settings", {}))
        c.pop("homeToken", None)
        c.pop("homeUrl", None)
        c.pop("homeLights", None)
        self.config.update(c)
        for key in ("memories", "scenes", "jobs"):
            rows = a.get(key, [])
            if not isinstance(rows, list) or len(rows) > 500:
                raise AlfredError("Import exceeds capacity.")
            self.data[key] = deepcopy(rows)
            if key == "jobs":
                for job in self.data[key]:
                    if job.get("status") in ("queued", "running"):
                        job.update(
                            status="interrupted",
                            error="Migrated; ask to research again.",
                        )
        exchanges = a.get("history", [])
        if isinstance(exchanges, dict):
            exchanges = exchanges.get("exchanges", [])
        if not isinstance(exchanges, list):
            raise AlfredError("Invalid history import.")
        self.data["history"]["migrated-device"] = exchanges[-100:]
        receipts = a.get("digest_receipts", {})
        if (
            not isinstance(receipts, dict)
            or len(receipts) > 500
            or any(
                v not in ("claimed", "accepted", "failed_or_uncertain")
                for v in receipts.values()
            )
        ):
            raise AlfredError("Invalid delivery receipt import.")
        self.data.setdefault("digest_receipts", {}).update(receipts)
        self.data["imports"].append(digest)
        await self.save()
        return {
            "saved": True,
            "verified": True,
            "paired_devices": len(c.get("pairedDevices", [])),
            "memories": len(self.data["memories"]),
            "scenes": len(self.data["scenes"]),
        }

    async def client(self, operation, a, device):
        if operation == "status":
            return {
                "configured": self.providers.ready(),
                "version": VERSION,
                "connections": await self.health(),
            }
        if operation == "preferences":
            return {
                "profile": self.profile(),
                "interactionProfile": self.config.get("interactionProfile", "store"),
                "mailProvider": self.config.get("mailProvider", "none"),
                "calendarProvider": self.config.get("calendarProvider", "none"),
                "features": self.features(),
            }
        if operation == "history":
            return {
                "exchanges": [
                    {**x, "id": i + 1} for i, x in enumerate(self.history_for(device))
                ]
            }
        if operation == "activity":
            # Ordinary paired clients see their session, not another phone's history
            # or administrator configuration log. Never expose delivery keys/targets.
            return {
                "history": self.history_for(device)[-100:],
                "actions": [
                    {k: x.get(k) for k in ("id", "kind", "status", "created_at")}
                    for x in self.data.get("actions", [])
                    if x.get("device") == device
                ][-100:],
                "activity": [
                    x
                    for x in self.data.get("activity", [])
                    if x.get("device") == device
                ][-100:],
            }
        if operation == "lists/clear":
            self.rate("list-clear:" + device, 6)
            result = await self.home.clear_list(a.get("kind"))
            self.audit(
                "list",
                "Cleared " + result["kind"] + " list",
                str(result["removed"]) + " items removed",
                device,
            )
            await self.save()
            return result
        if operation == "inbox":
            return await self.engine.execute("list_reminders", {})
        if operation == "dashboard":
            return await self.home.dashboard(a.get("view", "home"))
        if operation == "home/control":
            return await self.home.lights(
                (
                    "set_light_properties"
                    if a.get("action") == "settings"
                    else "control_lights"
                ),
                {
                    **a.get("settings", {}),
                    "targets": [a.get("target")],
                    "target": a.get("target"),
                    "action": a.get("action"),
                },
            )
        if operation == "location":
            if a.get("clear"):
                self.location = None
                return {"ok": True}
            lat, lon = a.get("latitude"), a.get("longitude")
            if (
                not isinstance(lat, (int, float))
                or not -90 <= lat <= 90
                or not isinstance(lon, (int, float))
                or not -180 <= lon <= 180
            ):
                raise AlfredError("Invalid approximate location.")
            self.location = {
                "latitude": round(lat, 2),
                "longitude": round(lon, 2),
                "expires": time.monotonic() + 3600,
            }
            return {"ok": True}
        if operation == "reset":
            self.pending.pop(device, None)
            self.data["history"][self.history_key(device)] = []
            await self.save()
            return {"ok": True}
        if operation == "jobs":
            return await self.assistant.job(
                "read_research_job" if a.get("id") else "list_research_jobs", a
            )
        if operation == "jobs/cancel":
            return await self.assistant.job("cancel_research_job", a)
        if operation == "image":
            self.rate("image:" + device, 6)
            result = await inspect_image(self, a)
            self.data["history"].setdefault(self.history_key(device), []).append(
                {
                    "id": str(uuid4()),
                    "question": "[Shared photo] " + result["transcript"],
                    "reply": result["reply"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            del self.data["history"][self.history_key(device)][:-100]
            await self.save()
            return result
        if operation == "experiences":
            return {
                "memories": self.data["memories"],
                "routines": self.data.get("routines", []),
                "plans": self.data.get("plans", [])[-20:],
            }
        if operation in ("ask", "voice"):
            self.rate(device)
            if device in self.busy:
                raise AlfredError("Wait for the current answer.", 409)
            self.busy.add(device)
            started = time.monotonic()
            self.request_route[device] = "cloud"
            timings = {}
            self.request_metrics[device] = {
                "llm_calls": 0,
                "llm_ms": 0,
                "tool_ms": 0,
                "tools": [],
            }
            try:
                async with asyncio.timeout(30):
                    text = (
                        await self.providers.transcribe(a["pcm"])
                        if operation == "voice"
                        else a.get("text", "")
                    )
                    timings["transcription_ms"] = round(
                        (time.monotonic() - started) * 1000
                    )
                    if (
                        operation == "voice"
                        and isinstance(text, str)
                        and not text.strip()
                    ):
                        return {
                            "transcript": "",
                            "reply": "Sorry, could you repeat that?",
                            "presentation": "conversation",
                        }
                    if (
                        not isinstance(text, str)
                        or not text.strip()
                        or len(text) > 4000
                    ):
                        raise AlfredError("Use a short spoken question.")
                    import re

                    ui_action = (
                        "exit"
                        if re.fullmatch(
                            r"(?:please )?(?:close|exit|goodbye) alfred[.! ]*",
                            text,
                            re.I,
                        )
                        else (
                            "passive"
                            if re.fullmatch(
                                r"(?:that.s all|thanks? alfred|thank you alfred)[.! ]*",
                                text,
                                re.I,
                            )
                            else None
                        )
                    )
                    if re.fullmatch(
                        r"(?:dashboard[., ]*)?(?:please )?(?:show|open)(?: me)?(?: my| the)? dashboard[.! ]*",
                        text,
                        re.I,
                    ):
                        ui_action = "dashboard"
                    if ui_action:
                        return {
                            "transcript": text,
                            "reply": (
                                "Goodbye."
                                if ui_action == "exit"
                                else "At your service."
                            ),
                            "presentation": "conversation",
                            "ui_action": ui_action,
                        }
                    reply, presentation = await self.assistant.answer(
                        text, device, a.get("context", "")
                    )
                    full_reply = reply
                    if presentation == "action_complete":
                        self.audit(
                            "action",
                            text,
                            "Confirmed by the service: " + reply[:240],
                            device,
                        )
                    reply, presentation = await self.delivery.finish(
                        text, reply, presentation, device
                    )
                    timings["answer_ms"] = (
                        round((time.monotonic() - started) * 1000)
                        - timings["transcription_ms"]
                    )
                    history = self.data["history"].setdefault(
                        self.history_key(device), []
                    )
                    history.append(
                        {
                            "id": str(uuid4()),
                            "question": text,
                            "reply": full_reply,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    del history[:-100]
                    await self.save()
                    return {
                        "transcript": text,
                        "reply": reply,
                        "presentation": presentation,
                    }
            except TimeoutError as exc:
                raise AlfredError(
                    "Alfred timed out. Your service may be unavailable; check Activity before repeating an action.",
                    504,
                ) from exc
            finally:
                self.performance.append(
                    {
                        "route": self.request_route.pop(device, "cloud"),
                        "total_ms": round((time.monotonic() - started) * 1000),
                        **timings,
                        **self.request_metrics.pop(device, {}),
                    }
                )
                del self.performance[:-100]
                self.busy.discard(device)
        raise AlfredError("Unknown Alfred endpoint.", 404)

    def features(self):
        return [
            {"id": id, "name": name, "configured": ready, "requires": need}
            for id, name, ready, need in [
                (
                    "routines",
                    "Routines and plans",
                    bool(self.data.get("routines")),
                    "Create a routine from approved devices, or ask Alfred to prepare a reviewed plan.",
                ),
                (
                    "conversation",
                    "Ask Alfred",
                    self.providers.ready(),
                    "Choose AI and speech providers in HA → Alfred.",
                ),
                (
                    "home",
                    "Home control",
                    bool(self.config.get("homeEntities")),
                    "Select devices in HA → Alfred.",
                ),
                (
                    "lists",
                    "Lists",
                    any(self.config.get("haLists", {}).values()),
                    "Choose tasks or shopping lists.",
                ),
                (
                    "google",
                    "Google",
                    bool(self.config.get("google", {}).get("refreshToken")),
                    "Connect Google.",
                ),
                (
                    "outlook",
                    "Outlook",
                    bool(self.config.get("outlook", {}).get("refreshToken")),
                    "Connect Outlook.",
                ),
                (
                    "weather",
                    "Weather",
                    bool(self.config.get("weatherCity") or self.location),
                    "Choose weather location.",
                ),
                (
                    "web",
                    "Research",
                    self.config.get("webSearchProvider") not in (None, "none"),
                    "Choose web search provider.",
                ),
            ]
        ]

    async def health(self):
        """Read-only configuration checks; never imply an untested provider is online."""
        c = self.config
        provider = c.get("transcriptionProvider", "none")
        entity = (
            self.hass.states.get(c.get("transcriptionEntity", ""))
            if provider == "ha"
            else None
        )
        speech = bool(
            (provider == "ha" and entity and entity.state != "unavailable")
            or (
                provider == "openai" and c.get("apiKey") and c.get("transcriptionModel")
            )
            or (provider == "local" and c.get("localSpeechUrl"))
        )
        return {
            "home": {
                "ok": True,
                "configured": True,
                "status": "online",
                "message": "Connected inside Home Assistant",
            },
            "ai": {
                "ok": None,
                "configured": self.providers.ready(),
                "status": "configured" if self.providers.ready() else "not configured",
                "message": (
                    "Configuration checked; provider reachability is verified when used."
                    if self.providers.ready()
                    else "Optional: choose an AI provider for general questions."
                ),
            },
            "speech": {
                "ok": None,
                "configured": speech,
                "status": "configured" if speech else "setup needed",
                "message": (
                    "Speech configuration present; test a short glasses request."
                    if speech
                    else "Choose a speech recogniser in Intelligence & accounts and check its credentials or HA engine."
                ),
            },
        }

    async def periodic(self, _=None):
        if self.periodic_lock.locked() or not getattr(self.hass, "is_running", True):
            return
        async with self.periodic_lock:
            try:
                await self.experiences.periodic()
            except Exception as e:
                self.data["background_error"] = {
                    "message": str(e)[:300],
                    "at": datetime.now(timezone.utc).isoformat(),
                }
                await self.save()  # Optional failures remain visible without stopping reminders.
            if self.config.get("newsSources"):
                try:
                    result = await self.providers.news({"count": 8})
                    rows = [
                        {**x, "title": x["title"][:250]}
                        for x in result.get("items", [])
                        if x.get("url", "").startswith("https://")
                    ][:8]
                    await self.engine.execute("publish_news", {"items": rows})
                except (ValueError, TimeoutError):
                    pass
            inbox = (await self.engine.execute("list_reminders", {})).get("inbox", [])
            journal = self.data.setdefault("digest_receipts", {})
            for item in inbox:
                if item.get("delivery_status") != "pending_email":
                    continue
                if item["id"] in journal:
                    await self.engine.execute(
                        "ack_digest_email",
                        {
                            "id": item["id"],
                            "status": (
                                journal[item["id"]]
                                if journal[item["id"]] == "accepted"
                                else "failed_or_uncertain"
                            ),
                        },
                    )
                    continue
                if not self.providers.connected("mail") or not self.profile().get(
                    "selfEmail"
                ):
                    continue
                journal[item["id"]] = "claimed"
                await self.save()
                try:
                    await self.providers.send(
                        {
                            "to": self.profile()["selfEmail"],
                            "subject": "Alfred daily briefing",
                            "body": item["title"],
                        }
                    )
                    journal[item["id"]] = "accepted"
                except Exception:
                    journal[item["id"]] = "failed_or_uncertain"
                await self.save()
                await self.engine.execute(
                    "ack_digest_email",
                    {"id": item["id"], "status": journal[item["id"]]},
                )
