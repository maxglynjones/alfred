"""HA-admin configuration and scoped glasses endpoints; never share HA auth."""

import asyncio
import json
import secrets
import time
from copy import deepcopy
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from aiohttp import web
from homeassistant.components.http import HomeAssistantView


async def body(request, limit=131072):
    if request.content_length is not None and request.content_length > limit:
        raise ValueError("Request exceeds limits.")
    raw = await bounded_content(request, limit)
    if len(raw) > limit:
        raise ValueError("Request exceeds limits.")
    data = json.loads(raw or b"{}")
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


async def bounded_content(request, limit):
    """StreamReader.read(n) may return early at a TCP boundary; read through EOF."""
    raw = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        raw.extend(chunk)
        if len(raw) > limit:
            raise ValueError("Request exceeds limits.")
    return bytes(raw)


def validate_settings(updates, current):
    allowed = {
        "shareConversation",
        "assistEnabled",
        "proactive",
        "appleShortcuts",
        "apiKey",
        "replyProvider",
        "replyModel",
        "claudeKey",
        "claudeModel",
        "ollamaUrl",
        "ollamaModel",
        "transcriptionProvider",
        "transcriptionModel",
        "transcriptionEntity",
        "transcriptionLanguage",
        "localSpeechUrl",
        "profile",
        "mailProvider",
        "calendarProvider",
        "weatherCity",
        "dashboardAgenda",
        "interactionProfile",
        "webSearchProvider",
        "webSearchModel",
        "newsSources",
        "newsBackend",
        "haLists",
        "homeEntities",
        "newsDigest",
        "google",
        "outlook",
        "publicOrigin",
        "clientOrigins",
        "reminderDelivery",
        "localRouter",
        "localRouterKey",
        "remoteAccessMethod",
        "cloudPolicy",
        "emailOverflow",
        "confirmActions",
    }
    if any(k not in allowed for k in updates):
        raise ValueError("Unknown configuration field.")
    candidate = {**deepcopy(current), **deepcopy(updates)}
    if candidate.get("remoteAccessMethod", "private") not in (
        "private",
        "ha-cloud",
        "custom",
    ):
        raise ValueError("Choose a supported remote connection method.")
    if candidate.get("cloudPolicy", "explicit") not in (
        "explicit",
        "automatic",
        "local-only",
    ):
        raise ValueError("Choose a supported cloud policy.")
    if type(candidate.get("confirmActions", False)) is not bool:
        raise ValueError("Action confirmation must be true or false.")
    if type(candidate.get("emailOverflow", True)) is not bool:
        raise ValueError("Email overflow must be enabled or disabled.")
    router = candidate.get("localRouter", {})
    if not isinstance(router, dict) or any(
        k not in ("enabled", "url", "model", "timeoutMs") for k in router
    ):
        raise ValueError("Invalid local command interpreter configuration.")
    if (
        type(router.get("enabled", False)) is not bool
        or type(router.get("timeoutMs", 1500)) is not int
        or not 250 <= router.get("timeoutMs", 1500) <= 3000
    ):
        raise ValueError("Choose a local interpreter timeout of 250–3000 ms.")
    if (
        not isinstance(router.get("model", ""), str)
        or len(router.get("model", "")) > 100
    ):
        raise ValueError("Choose a short local model name.")
    if router.get("url"):
        u = urlparse(router["url"])
        if (
            u.scheme not in ("http", "https")
            or not u.hostname
            or u.username
            or u.password
            or u.query
            or u.fragment
            or u.path not in ("", "/")
        ):
            raise ValueError(
                "Use a trusted local model origin, without a path or embedded credentials."
            )
    if router.get("enabled") and (not router.get("url") or not router.get("model")):
        raise ValueError(
            "Configure the local model address and name before enabling it."
        )
    for provider in ("google", "outlook"):
        if provider in updates:
            registration = updates[provider]
            if not isinstance(registration, dict) or any(
                k not in ("clientId", "clientSecret") for k in registration
            ):
                raise ValueError(
                    "Change OAuth registration fields here; connect the account to grant tokens."
                )
            if any(
                not isinstance(v, str) or len(v) > 4096 for v in registration.values()
            ):
                raise ValueError("Invalid OAuth registration.")
            candidate[provider] = {
                **deepcopy(current.get(provider, {})),
                **{k: v for k, v in registration.items() if v},
            }
    for key, options in [
        ("replyProvider", ("none", "openai", "claude", "ollama")),
        ("transcriptionProvider", ("none", "openai", "local", "ha")),
        ("mailProvider", ("none", "google", "outlook")),
        ("calendarProvider", ("none", "google", "outlook")),
        ("webSearchProvider", ("none", "openai")),
        ("newsBackend", ("alfred", "ha")),
        ("interactionProfile", ("personal", "store")),
    ]:
        if candidate.get(key) not in options:
            raise ValueError("Choose a supported " + key + ".")
    if candidate.get("transcriptionProvider") == "ha" and not candidate.get(
        "transcriptionEntity", ""
    ).startswith("stt."):
        raise ValueError("Choose an installed HA speech recognition engine.")
    for key in ("shareConversation", "assistEnabled"):
        if type(candidate.get(key, False)) is not bool:
            raise ValueError(
                "Use a checkbox for conversation sharing and Assist access."
            )
    for key in (
        "transcriptionEntity",
        "transcriptionLanguage",
    ):
        if (
            not isinstance(candidate.get(key, ""), str)
            or len(candidate.get(key, "")) > 150
        ):
            raise ValueError("Use a short speech setting.")
    proactive = candidate.get("proactive", {})
    if not isinstance(proactive, dict) or any(
        k
        not in (
            "enabled",
            "briefing",
            "time",
            "quietStart",
            "quietEnd",
            "watchEntities",
        )
        for k in proactive
    ):
        raise ValueError("Invalid proactive assistant settings.")
    import re

    for key in ("time", "quietStart", "quietEnd"):
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", proactive.get(key, "08:00")):
            raise ValueError("Use HH:MM for briefing and quiet hours.")
    if (
        not isinstance(proactive.get("watchEntities", []), list)
        or len(proactive.get("watchEntities", [])) > 30
    ):
        raise ValueError("Choose at most thirty monitored devices.")
    shortcuts = candidate.get("appleShortcuts", [])
    if (
        not isinstance(shortcuts, list)
        or len(shortcuts) > 20
        or any(
            not isinstance(x, dict)
            or not isinstance(x.get("id"), str)
            or not isinstance(x.get("name"), str)
            or not 1 <= len(x["name"]) <= 100
            or not 1 <= len(x["id"]) <= 80
            for x in shortcuts
        )
    ):
        raise ValueError("Register at most twenty named Apple shortcuts.")
    profile = candidate.get("profile", {})
    if not isinstance(profile, dict) or any(
        k not in ("name", "gender", "addressAs", "selfEmail", "timezone")
        for k in profile
    ):
        raise ValueError("Invalid profile.")
    if profile.get("addressAs", "none") not in ("none", "sir", "madam", "name"):
        raise ValueError("Choose a form of address.")
    ZoneInfo(profile.get("timezone", "UTC"))
    for key, value in profile.items():
        if (
            not isinstance(value, str)
            or len(value) > 254
            or any(ord(x) < 32 for x in value)
        ):
            raise ValueError("Use a short plain-text profile.")
    for key in (
        "apiKey",
        "claudeKey",
        "replyModel",
        "claudeModel",
        "ollamaModel",
        "transcriptionModel",
        "webSearchModel",
        "weatherCity",
    ):
        value = candidate.get(key, "")
        if not isinstance(value, str) or len(value) > 4096:
            raise ValueError("Invalid " + key + ".")
    for key in ("ollamaUrl", "localSpeechUrl"):
        if candidate.get(key):
            u = urlparse(candidate[key])
            if (
                u.scheme not in ("http", "https")
                or not u.hostname
                or u.username
                or u.password
                or u.query
                or u.fragment
            ):
                raise ValueError("Use a trusted model service base URL.")
    for origin in (
        [candidate["publicOrigin"]] if candidate.get("publicOrigin") else []
    ) + candidate.get("clientOrigins", []):
        u = urlparse(origin)
        if (
            u.scheme not in ("https", "http")
            or not u.hostname
            or u.username
            or u.password
            or u.path not in ("", "/")
            or u.query
            or u.fragment
        ):
            raise ValueError("Enter an exact server origin.")
    sources = candidate.get("newsSources", [])
    if not isinstance(sources, list) or len(sources) > 12:
        raise ValueError("Choose at most twelve feeds.")
    for source in sources:
        u = urlparse(source.get("url", ""))
        if (
            not source.get("name")
            or len(source["name"]) > 80
            or u.scheme != "https"
            or u.username
            or u.password
            or u.port not in (None, 443)
        ):
            raise ValueError("Use a named public HTTPS feed.")
    if (
        not isinstance(candidate.get("homeEntities", []), list)
        or len(candidate.get("homeEntities", [])) > 1000
    ):
        raise ValueError("Device selection exceeds limits.")
    return candidate


class ClientView(HomeAssistantView):
    url = "/alfred/api/{operation:.*}"
    name = "api:alfred:client"
    requires_auth = False

    def register(self, hass, app, router):
        # HA's global CORS middleware installs its own OPTIONS route. These
        # paired-device endpoints use an exact per-install origin policy instead.
        from homeassistant.components.http.view import request_handler_factory

        for method in ("get", "post", "options"):
            router.add_route(
                method.upper(),
                self.url,
                request_handler_factory(hass, self, getattr(self, method)),
            )

    async def options(self, request, operation):
        return self.cors(request, web.Response(status=204))

    def cors(self, request, response):
        r = request.app["hass"].data["alfred"].runtime
        origin = request.headers.get("Origin")
        # Installed iOS WebViews can use an opaque file origin ("null") or
        # a loopback asset server with an ephemeral port. These origins never
        # authenticate: every private operation still needs X-Alfred-Token.
        local_origin = False
        if origin:
            parsed = urlparse(origin)
            local_origin = origin == "null" or (
                parsed.scheme in ("http", "https", "capacitor", "ionic")
                and parsed.hostname in ("localhost", "127.0.0.1", "::1")
                and not parsed.username
                and not parsed.password
                and parsed.path in ("", "/")
                and not parsed.query
                and not parsed.fragment
            )
        if origin and (local_origin or origin in r.config.get("clientOrigins", [])):
            response.headers.update(
                {
                    "Access-Control-Allow-Origin": origin,
                    "Vary": "Origin",
                    "Access-Control-Allow-Headers": "X-Alfred-Token,Content-Type",
                    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                }
            )
        response.headers["Cache-Control"] = "no-store"
        return response

    async def get(self, request, operation):
        return await self.handle(request, operation)

    async def post(self, request, operation):
        return await self.handle(request, operation)

    async def handle(self, request, operation):
        r = request.app["hass"].data["alfred"].runtime
        try:
            if operation == "pair":
                if request.method != "POST":
                    raise ValueError("Pairing needs POST.")
                r.rate("pair:" + str(request.remote), 10)
                d = await r.pair(await body(request, 1024))
            else:
                device = r.authenticate(request.headers.get("X-Alfred-Token", ""))
                if not device:
                    return self.cors(
                        request,
                        web.json_response(
                            {"error": "Pair this device in Home Assistant → Alfred."},
                            status=401,
                        ),
                    )
                if (
                    operation
                    in (
                        "ask",
                        "voice",
                        "image",
                        "home/control",
                        "lists/clear",
                        "location",
                        "reset",
                        "jobs/cancel",
                    )
                    and request.method != "POST"
                ):
                    raise ValueError("This operation needs POST.")
                if operation == "voice":
                    if request.content_type != "application/octet-stream":
                        raise ValueError("Expected microphone PCM.")
                    pcm = await bounded_content(request, 960000)
                    if len(pcm) > 960000:
                        raise ValueError("Recording exceeds 30 seconds.")
                    a = {"pcm": pcm}
                else:
                    a = (
                        await body(
                            request,
                            (2200000 if operation == "image" else 16384),
                        )
                        if request.method == "POST"
                        else dict(request.query)
                    )
                d = await r.client(operation, a, device)
            return self.cors(
                request,
                web.json_response(
                    d, dumps=lambda value: json.dumps(value, default=str)
                ),
            )
        except (ValueError, KeyError, TypeError, TimeoutError) as e:
            return self.cors(
                request,
                web.json_response({"error": str(e)}, status=getattr(e, "status", 400)),
            )
        except Exception:
            return self.cors(
                request,
                web.json_response(
                    {
                        "error": "Alfred encountered a Home Assistant error. Check HA logs and Activity; do not repeat an uncertain action."
                    },
                    status=502,
                ),
            )


class ManageView(HomeAssistantView):
    url = "/api/alfred/manage"
    name = "api:alfred:manage"
    requires_auth = True

    async def post(self, request):
        user = request.get("hass_user")
        if not user or not user.is_admin:
            return web.json_response(
                {"error": "Administrator access required."}, status=403
            )
        r = request.app["hass"].data["alfred"].runtime
        try:
            a = await body(request, 2200000)
            action = a.get("action")
            args = a.get("args", {})
            if not isinstance(args, dict):
                raise ValueError("Expected structured action arguments.")
            if action == "status":
                d = {
                    "version": "0.20.2",
                    "activity": r.data.get("activity", [])[-100:],
                    "history": r.history_for("ha:" + user.id)[-100:],
                    "experiences": {
                        "routines": r.data.get("routines", []),
                        "memories": r.data["memories"],
                        "plans": r.data.get("plans", [])[-20:],
                        "schedules": r.data.get("schedules", []),
                    },
                    "diagnostics": {
                        "background_error": r.data.get("background_error"),
                        "schedule_receipts": r.data.get("schedule_receipts", {}),
                        "voice_error": r.data.get("voice_error"),
                    },
                    "stt_entities": [
                        {"id": x.entity_id, "name": x.name}
                        for x in r.hass.states.async_all()
                        if x.entity_id.startswith("stt.")
                    ],
                    "settings": r.safe_config(),
                    "connections": await r.health(),
                    "features": r.features(),
                    "inventory": r.home.inventory(),
                    "performance": r.performance,
                    "local_interpreter": r.commands.last,
                    "reminders": await r.engine.execute("status", {}),
                    "actions": r.data.get("actions", [])[-20:],
                    "jobs": r.data["jobs"][-20:],
                }
            elif action == "lists":

                async def read_list(kind):
                    try:
                        return await r.home.lists(
                            "list_shopping" if kind == "shopping" else "list_todos",
                            {"status": "all"},
                        )
                    except Exception as e:
                        return {"items": [], "error": str(e)[:200]}

                tasks, shopping = await asyncio.gather(
                    read_list("tasks"), read_list("shopping")
                )
                d = {
                    "tasks": tasks,
                    "shopping": shopping,
                    "reminders": await r.engine.execute("list_reminders", {}),
                }
            elif action == "list/edit":
                kind = args.get("kind")
                operation = args.get("operation")
                if kind not in ("tasks", "shopping") or operation not in (
                    "add",
                    "complete",
                ):
                    raise ValueError("Choose an item to add or complete.")
                d = await r.home.lists(operation + "_" + kind, args)
                r.audit("list", "Updated " + kind + " list", operation)
                await r.save()
            elif action == "configure":
                candidate = validate_settings(args, r.config)
                inventory = {x["entity_id"] for x in r.home.inventory()}
                if any(x not in inventory for x in candidate.get("homeEntities", [])):
                    raise ValueError("Choose currently discovered devices.")
                for kind, id in candidate.get("haLists", {}).items():
                    if kind not in ("tasks", "shopping") or (
                        id and (not id.startswith("todo.") or id not in inventory)
                    ):
                        raise ValueError("Choose discovered HA lists.")
                c = candidate.get("haLists", {})
                if c.get("tasks") and c.get("tasks") == c.get("shopping"):
                    raise ValueError("Tasks and shopping need separate lists.")
                if "reminderDelivery" in args:
                    pref = args["reminderDelivery"]
                    if pref.get("provider") not in ("none", "ha"):
                        raise ValueError("Choose inbox or iPhone notifications.")
                    await r.engine.execute(
                        "configure",
                        {
                            "phone": (
                                pref.get("service", "")
                                if pref.get("provider") == "ha"
                                else ""
                            )
                        },
                    )
                if "newsDigest" in args:
                    digest = candidate["newsDigest"]
                    await r.engine.execute(
                        "configure_digest",
                        {
                            **digest,
                            "timezone": candidate["profile"].get("timezone", "UTC"),
                        },
                    )
                if "newsSources" in args and candidate.get("newsBackend") == "ha":
                    await r.engine.execute(
                        "configure_feedreader",
                        {
                            "urls": [
                                x["url"]
                                for x in candidate["newsSources"]
                                if x.get("enabled", True)
                            ]
                        },
                    )
                if any(
                    x not in candidate.get("homeEntities", [])
                    for x in candidate.get("proactive", {}).get("watchEntities", [])
                ):
                    raise ValueError("Monitor only approved home devices.")
                if (
                    candidate.get("shareConversation")
                    and not r.config.get("shareConversation")
                    and not r.data["history"].get("owner")
                ):
                    history = [x for rows in r.data["history"].values() for x in rows]
                    unique = {x.get("id", str(i)): x for i, x in enumerate(history)}
                    r.data["history"]["owner"] = sorted(
                        unique.values(), key=lambda x: x.get("created_at", "")
                    )[-100:]
                changed = [k for k in args if candidate.get(k) != r.config.get(k)]
                r.data["settings"] = candidate
                if changed:
                    r.audit(
                        "configuration", "Configuration updated", ", ".join(changed)
                    )
                await r.save()
                d = {"saved": True}
            elif action == "pair":
                r.pairing = {
                    "code": str(secrets.randbelow(900000) + 100000),
                    "expires": time.monotonic() + 300,
                    "attempts": 0,
                }
                d = {
                    "code": r.pairing["code"],
                    "expires_in_seconds": 300,
                    "backend": r.config.get("publicOrigin", "") + "/alfred",
                }
            elif action == "revoke":
                if args.get("id") == "migrated-device":
                    r.config.pop("clientToken", None)
                else:
                    r.config["pairedDevices"] = [
                        x
                        for x in r.config.get("pairedDevices", [])
                        if x["id"] != args.get("id")
                    ]
                await r.save()
                d = {"saved": True}
            elif action == "import":
                d = await r.import_legacy(args)
            elif action == "news":
                d = await r.providers.news({"count": 10})
            elif action == "phones":
                d = {
                    "targets": [
                        s
                        for s in r.hass.services.async_services().get("notify", {})
                        if s.startswith("mobile_app_")
                    ]
                }
            elif action == "oauth":
                d = await r.providers.oauth_start(
                    args["provider"],
                    r.config.get("publicOrigin") or str(request.url.origin()),
                )
            elif action == "disconnect":
                p = args["provider"]
                if p not in ("google", "outlook"):
                    raise ValueError("Unknown account.")
                r.config.setdefault(p, {}).pop("refreshToken", None)
                r.providers.tokens.pop(p, None)
                await r.save()
                d = {"saved": True}
            elif action == "export":
                d = deepcopy(r.data)  # Admin-only recovery download contains secrets.
            elif action == "image":
                d = await r.client("image", args, "ha:" + user.id)
            elif action == "voice":
                import base64

                pcm = base64.b64decode(args.get("pcm", ""), validate=True)
                if not 3200 <= len(pcm) <= 960000 or len(pcm) % 2:
                    raise ValueError("Speak for 0.1–30 seconds.")
                d = await r.client("voice", {"pcm": pcm}, "ha:" + user.id)
            elif action == "memory":
                r.audit("memory", "Memory updated", args.get("operation", "saved"))
                items = r.data["memories"]
                if args.get("operation") == "remove":
                    r.data.setdefault("removed_memories", []).extend(
                        x for x in items if x["id"] == args.get("id")
                    )
                    r.data["memories"] = [x for x in items if x["id"] != args.get("id")]
                elif args.get("operation") == "restore":
                    found = next(
                        (
                            x
                            for x in r.data.get("removed_memories", [])
                            if x["id"] == args.get("id")
                        ),
                        None,
                    )
                    if not found:
                        raise ValueError("That memory is not in recovery.")
                    items.append(found)
                    r.data["removed_memories"].remove(found)
                else:
                    text = args.get("text", "").strip()
                    if not text or len(text) > 2000 or len(items) >= 100:
                        raise ValueError(
                            "Use a short personal preference; at most 100 memories."
                        )
                    found = next((x for x in items if x["id"] == args.get("id")), None)
                    if found:
                        found.update(text=text, content=text)
                    else:
                        from uuid import uuid4

                        items.append(
                            {"id": str(uuid4()), "text": text, "content": text}
                        )
                r.data["removed_memories"] = r.data.get("removed_memories", [])[-100:]
                await r.save()
                d = {"saved": True}
            elif action == "schedule":
                if args.get("operation") == "remove":
                    r.data["schedules"] = [
                        x
                        for x in r.data.get("schedules", [])
                        if x["id"] != args.get("id")
                    ]
                else:
                    r.data.setdefault("schedules", []).append(
                        r.experiences.validate_schedule(args)
                    )
                await r.save()
                d = {"saved": True}
            elif action == "routine":
                if args.get("operation") == "remove":
                    r.data["routines"] = [
                        x
                        for x in r.data.get("routines", [])
                        if x["id"] != args.get("id")
                    ]
                else:
                    from uuid import uuid4

                    routine = r.experiences.validate_plan(args)
                    alias = args.get("alias", "").strip()
                    if (
                        not alias
                        or len(alias) > 150
                        or len(r.data.get("routines", [])) >= 30
                    ):
                        raise ValueError(
                            "Give your routine a short spoken alias; at most 30 routines."
                        )
                    routine.update(id=str(uuid4()), alias=alias)
                    r.data.setdefault("routines", []).append(routine)
                await r.save()
                d = {"saved": True}
            elif action == "briefing":
                d = await r.experiences.briefing(args.get("meeting", False))
            elif action == "test":
                d = await r.client(
                    "ask", {"text": args.get("text", "")}, "ha:" + user.id
                )
                d["pending_review"] = "ha:" + user.id in r.pending
            else:
                raise ValueError("Unknown management action.")
            return web.json_response(
                d,
                dumps=lambda value: json.dumps(value, default=str),
                headers={"Cache-Control": "no-store"},
            )
        except (ValueError, TypeError, KeyError) as e:
            return web.json_response({"error": str(e)}, status=400)


class OAuthView(HomeAssistantView):
    url = "/alfred/oauth/{provider}"
    name = "api:alfred:oauth"
    requires_auth = False

    async def get(self, request, provider):
        r = request.app["hass"].data["alfred"].runtime
        try:
            if provider not in ("google", "outlook"):
                raise ValueError("Unknown account.")
            await r.providers.oauth_finish(provider, dict(request.query))
            return web.Response(
                text="Connected. Return to Home Assistant → Alfred.",
                headers={
                    "Content-Type": "text/plain",
                    "Cache-Control": "no-store",
                    "Referrer-Policy": "no-referrer",
                },
            )
        except ValueError as e:
            return web.Response(text=str(e), status=400)


class AdminVoiceView(HomeAssistantView):
    url = "/api/alfred/voice"
    name = "api:alfred:admin_voice"
    requires_auth = True

    async def post(self, request):
        user = request.get("hass_user")
        if not user or not user.is_admin:
            return web.json_response(
                {"error": "Administrator access required."}, status=403
            )
        if request.content_type != "application/octet-stream":
            return web.json_response({"error": "Expected microphone PCM."}, status=400)
        try:
            pcm = await bounded_content(request, 960000)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        if not 3200 <= len(pcm) <= 960000 or len(pcm) % 2:
            return web.json_response({"error": "Speak for 0.1–30 seconds."}, status=400)
        r = request.app["hass"].data["alfred"].runtime
        try:
            d = await r.client("voice", {"pcm": pcm}, "ha:" + user.id)
            return web.json_response(d, headers={"Cache-Control": "no-store"})
        except Exception as e:
            return web.json_response(
                {"error": str(e)[:500]},
                status=getattr(e, "status", 502),
                headers={"Cache-Control": "no-store"},
            )
