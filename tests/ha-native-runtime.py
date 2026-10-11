"""HA-native migration contracts using isolated HA/provider fixtures."""

import asyncio, copy, importlib.util, json, sys, types, unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import AsyncMock

ROOT = (
    Path(__file__).parents[1] / "integrations/home-assistant/custom_components/alfred"
)
for name in (
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.http",
    "homeassistant.helpers",
    "homeassistant.helpers.storage",
    "homeassistant.helpers.event",
    "homeassistant.helpers.aiohttp_client",
    "homeassistant.helpers.area_registry",
    "homeassistant.helpers.entity_registry",
    "homeassistant.helpers.device_registry",
    "homeassistant.util",
    "homeassistant.util.dt",
):
    sys.modules[name] = types.ModuleType(name)


class Store:
    def __init__(self, *a):
        self.value = None

    async def async_save(self, d):
        self.value = copy.deepcopy(d)

    async def async_load(self):
        return self.value


sys.modules["homeassistant.helpers.storage"].Store = Store
sys.modules["homeassistant.components.http"].HomeAssistantView = object
sys.modules["homeassistant.helpers.aiohttp_client"].async_get_clientsession = (
    lambda h: None
)
sys.modules["homeassistant.helpers.event"].async_track_time_interval = lambda *a: None
sys.modules["homeassistant.util.dt"].now = lambda: datetime.now(timezone.utc)
sys.modules["homeassistant.util.dt"].get_time_zone = lambda n: ZoneInfo(n)
for n in ("area_registry", "entity_registry", "device_registry"):
    sys.modules["homeassistant.helpers." + n].async_get = lambda h: Registry()


class Registry:
    def async_get(self, k):
        return None

    def async_get_area(self, k):
        return None


spec = importlib.util.spec_from_file_location(
    "alfred", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
)
engine = importlib.util.module_from_spec(spec)
sys.modules["alfred"] = engine
spec.loader.exec_module(engine)
from alfred.runtime import Runtime
from alfred.home import rgb_xy, polygon, intersection, clamp
from alfred.providers import document, parse_feed
from alfred.assistant import validate
from alfred.commands import rules
from alfred.calendar_rules import (
    spec as calendar_spec,
    next_event,
    google_rule,
    graph_rule,
)
from alfred.web import validate_settings, ManageView, ClientView
from aiohttp import web


class State:
    def __init__(self, id, state="off", attrs=None):
        self.entity_id = id
        self.state = state
        self.attributes = attrs or {}
        self.name = id.split(".")[1]


class States:
    def __init__(self):
        self.values = {}

    def async_all(self):
        return list(self.values.values())

    def get(self, k):
        return self.values.get(k)


class Services:
    def __init__(self, h):
        self.h = h
        self.calls = []
        self.items = []
        self.hold = False

    def has_service(self, d, s):
        return d != "notify" or s == "mobile_app_fixture"

    def async_services(self):
        return {"notify": {"mobile_app_fixture": {}}}

    async def async_call(self, d, s, a, **kw):
        self.calls.append((d, s, a))
        if d == "todo":
            if s == "get_items":
                return {a["entity_id"]: {"items": copy.deepcopy(self.items)}}
            if s == "add_item":
                self.items.append(
                    {
                        "uid": str(len(self.items) + 1),
                        "summary": a["item"],
                        "status": "needs_action",
                    }
                )
            if s == "remove_item":
                self.items = [x for x in self.items if x["uid"] != a["item"]]
            if s == "update_item":
                x = next(x for x in self.items if x["uid"] == a["item"])
                x.update(
                    {"summary": a["rename"]}
                    if "rename" in a
                    else {"status": a["status"]}
                )
        if d == "light" and not self.hold:
            for id in (
                a["entity_id"] if isinstance(a["entity_id"], list) else [a["entity_id"]]
            ):
                x = self.h.states.get(id)
                x.state = "on" if s == "turn_on" else "off"
                if "brightness_pct" in a:
                    x.attributes["brightness"] = a["brightness_pct"] * 255 / 100
                for k in ("xy_color", "color_temp_kelvin", "effect"):
                    if k in a:
                        x.attributes[k] = a[k]


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_speech_health_respects_selected_provider_and_not_unrelated_keys(
        self,
    ):
        r = await self.runtime()
        r.data["settings"] = {"apiKey": "fixture-key", "transcriptionProvider": "none"}
        self.assertFalse((await r.health())["speech"]["configured"])
        r.config.update(transcriptionProvider="ha", transcriptionEntity="stt.missing")
        self.assertFalse((await r.health())["speech"]["configured"])
        r.hass.states.values["stt.fixture"] = State("stt.fixture", "unknown")
        r.config["transcriptionEntity"] = "stt.fixture"
        self.assertTrue((await r.health())["speech"]["configured"])
        r.config.update(
            transcriptionProvider="openai", transcriptionModel="fixture-model"
        )
        health = await r.health()
        self.assertTrue(health["speech"]["configured"])
        self.assertIsNone(health["speech"]["ok"])
        self.assertIsNone(health["ai"]["ok"])

    async def test_clear_list_removes_all_pages_and_completed_items_but_keeps_entity(
        self,
    ):
        r = await self.runtime()
        r.hass.states.values["todo.fixture"] = State("todo.fixture")
        r.config["haLists"] = {"shopping": "todo.fixture"}
        r.hass.services.items = [
            {
                "uid": str(i),
                "summary": "Item " + str(i),
                "status": "completed" if i % 2 else "needs_action",
            }
            for i in range(150)
        ]
        result = await r.client("lists/clear", {"kind": "shopping"}, "one")
        self.assertTrue(result["verified"])
        self.assertEqual(result["removed"], 150)
        self.assertEqual(r.hass.services.items, [])
        self.assertIsNotNone(r.hass.states.get("todo.fixture"))
        self.assertEqual(r.data["activity"][-1]["device"], "one")
        with self.assertRaises(ValueError):
            await r.client("lists/clear", {"kind": "unknown"}, "one")

    async def test_purge_voice_intent_does_not_use_ai_or_remove_literal_all_items(self):
        r = await self.runtime()
        r.hass.states.values["todo.fixture"] = State("todo.fixture")
        r.config["haLists"] = {"shopping": "todo.fixture", "tasks": "todo.fixture"}
        r.providers.reply = AsyncMock(side_effect=AssertionError("No model for clear"))
        for text in (
            "Purge my shopping list",
            "Clear my to do list",
            "Remove all items from my shopping list",
        ):
            r.hass.services.items = [
                {"uid": "1", "summary": "Bread", "status": "needs_action"}
            ]
            reply, mode = await r.assistant.answer(text, "one")
            self.assertEqual(mode, "action_complete")
            self.assertFalse(r.hass.services.items)
        r.providers.reply.assert_not_awaited()

    async def test_companion_activity_is_session_scoped_and_excludes_secret_delivery_fields(
        self,
    ):
        r = await self.runtime()
        r.data["history"] = {
            "one": [{"question": "Mine", "reply": "Yes"}],
            "two": [{"question": "Private", "reply": "Other"}],
        }
        r.audit("action", "Own light", device="one")
        r.audit("action", "Other light", device="two")
        r.audit("configuration", "Admin settings")
        r.data["actions"] = [
            {
                "id": "one",
                "device": "one",
                "kind": "email_result",
                "status": "accepted",
                "key": "private-secret",
                "target": "private@example.org",
            },
            {"device": "two", "kind": "mail"},
        ]
        result = await r.client("activity", {}, "one")
        encoded = json.dumps(result)
        self.assertIn("Own light", encoded)
        for private in (
            "Other light",
            "Admin settings",
            "private-secret",
            "private@example.org",
            "Other",
        ):
            self.assertNotIn(private, encoded)

    async def test_background_research_self_delivery_after_completion(self):
        r = await self.runtime()
        r.hass.async_create_background_task = lambda coro, label: asyncio.create_task(
            coro
        )
        r.providers.search = AsyncMock(
            return_value={
                "summary": "Finding.",
                "sources": [{"url": "https://example.org"}],
            }
        )
        r.delivery.send = AsyncMock(return_value=("Accepted.", "conversation"))
        await r.assistant.job("start_research_job", {"query": "public test"})
        await asyncio.gather(*r.jobs)
        self.assertEqual(r.data["jobs"][-1]["status"], "completed")
        r.delivery.send.assert_awaited_once()
        self.assertIn("https://example.org", r.delivery.send.call_args.args[1])

    async def test_registration_dialog_preserves_existing_connected_account(self):
        r = await self.runtime()
        r.config["google"] = {
            "clientId": "existing-id",
            "clientSecret": "existing-secret",
            "refreshToken": "existing-token",
        }
        candidate = validate_settings({"google": {}}, r.config)
        self.assertEqual(candidate["google"], r.config["google"])
        changed = validate_settings({"google": {"clientId": "new-id"}}, r.config)
        self.assertEqual(changed["google"]["refreshToken"], "existing-token")
        self.assertEqual(changed["google"]["clientSecret"], "existing-secret")

    async def test_credential_presence_and_activity_never_expose_secret_values(self):
        r = await self.runtime()
        r.config.update(
            apiKey="secret-openai-value",
            google={"clientId": "private-id", "clientSecret": "secret-google-value"},
        )
        safe = r.safe_config()
        self.assertTrue(safe["credentialStatus"]["apiKey"])
        self.assertTrue(safe["credentialStatus"]["google.clientSecret"])
        self.assertNotIn("secret-openai-value", json.dumps(safe))
        self.assertNotIn("secret-google-value", json.dumps(safe))
        for i in range(110):
            r.audit("configuration", "Configuration updated", "apiKey")
        self.assertEqual(len(r.data["activity"]), 100)
        self.assertNotIn("secret-openai-value", json.dumps(r.data["activity"]))

    async def test_fragmented_voice_request_reads_all_chunks_and_enforces_limit(self):
        from alfred.web import body, bounded_content

        class Content:
            async def iter_chunked(self, size):
                for part in [b'{"pcm": "', b"abc", b'"}']:
                    yield part

        request = types.SimpleNamespace(content_length=None, content=Content())
        self.assertEqual(await body(request), {"pcm": "abc"})
        with self.assertRaisesRegex(ValueError, "exceeds limits"):
            await bounded_content(request, 5)

    async def test_ha_recognition_uses_selected_engine_without_cloud_fallback(self):
        r = await self.runtime()
        r.config.update(
            transcriptionProvider="ha",
            transcriptionEntity="stt.whisper",
            transcriptionLanguage="en",
        )
        r.hass.states.values["stt.whisper"] = State("stt.whisper")
        received = []

        async def process(metadata, stream):
            received.append((metadata.language, b"".join([x async for x in stream])))
            return types.SimpleNamespace(result="success", text=" Good evening ")

        service = types.SimpleNamespace(
            check_metadata=lambda m: True, internal_async_process_audio_stream=process
        )
        module = types.ModuleType("homeassistant.components.stt")
        module.async_get_speech_to_text_entity = lambda h, id: service
        module.SpeechMetadata = lambda **kw: types.SimpleNamespace(**kw)
        for name, field in [
            ("AudioFormats", "WAV"),
            ("AudioCodecs", "PCM"),
            ("AudioBitRates", "BITRATE_16"),
            ("AudioSampleRates", "SAMPLERATE_16000"),
            ("AudioChannels", "CHANNEL_MONO"),
        ]:
            setattr(module, name, types.SimpleNamespace(**{field: field}))
        module.SpeechResultState = types.SimpleNamespace(SUCCESS="success")
        previous = sys.modules.get(module.__name__)
        sys.modules[module.__name__] = module
        r.http = AsyncMock(
            side_effect=AssertionError("Cloud audio must never be called")
        )
        try:
            pcm = bytes(6400)
            self.assertEqual(await r.providers.transcribe(pcm), "Good evening")
            self.assertEqual(received, [("en", pcm)])
            service.check_metadata = lambda m: False
            with self.assertRaisesRegex(ValueError, "does not support"):
                await r.providers.transcribe(pcm)
            r.hass.states.values.clear()
            with self.assertRaisesRegex(ValueError, "installed HA"):
                await r.providers.transcribe(pcm)
            r.http.assert_not_called()
        finally:
            if previous is None:
                sys.modules.pop(module.__name__, None)
            else:
                sys.modules[module.__name__] = previous

    async def test_local_clear_does_not_ignore_exceptions(self):
        r = await self.runtime()
        r.config["cloudPolicy"] = "explicit"
        r.config["haLists"] = {"shopping": "todo.groceries"}
        r.hass.states.values["todo.groceries"] = State("todo.groceries")
        r.hass.services.items = [
            {"uid": "1", "summary": "milk", "status": "needs_action"}
        ]
        await r.assistant.answer("clear my shopping list except milk", "one")
        self.assertEqual(len(r.hass.services.items), 1)
        reply, _ = await r.local_ops.answer("what is 2 plus 2", "one")
        self.assertEqual(reply, "4")

    async def test_status_speech_recovery_is_read_only_and_pending_preview_does_not_block_it(
        self,
    ):
        r = await self.runtime()
        r.home.approved = lambda: [
            {
                "entity_id": "light.kitchen",
                "name": "Kitchen fixture",
                "room": "Kitchen",
                "domain": "light",
                "area_id": "kitchen",
                "state": "on",
                "attributes": {},
            }
        ]
        r.assistant.prepare(
            "one", "mail", {"to": "test@example.com", "subject": "Test", "body": "Test"}
        )
        r.assistant.llm = AsyncMock(
            side_effect=AssertionError("No cloud or action needed")
        )
        for text in [
            "to stay sort of the kitchen light.",
            "status of kitchen lights",
            "what status kitchen lights",
        ]:
            reply, mode = await r.assistant.answer(text, "one")
            self.assertIn("1 on", reply)
            self.assertEqual(mode, "conversation")
        self.assertEqual(len(r.hass.services.calls), 0)
        self.assertEqual(r.pending["one"]["kind"], "mail")

    async def test_unclear_read_has_no_action_tools_and_requests_repeat_if_model_attempts_write(
        self,
    ):
        r = await self.runtime()
        r.config.update(
            replyProvider="openai",
            apiKey="fixture",
            replyModel="fixture",
            confirmActions=False,
        )
        offered = []

        async def llm(instruction, inputs, tools, config):
            offered.extend(x["name"] for x in tools)
            return [
                {
                    "type": "function_call",
                    "name": "control_lights",
                    "call_id": "bad",
                    "arguments": '{"target":"light.kitchen","action":"off"}',
                }
            ]

        r.assistant.llm = llm
        reply, mode = await r.assistant.answer("kitchen um thing", "one")
        self.assertNotIn("control_lights", offered)
        self.assertFalse(any(x.startswith("prepare_") for x in offered))
        self.assertIn("could you repeat", reply)
        self.assertNotIn("verify", reply)
        self.assertEqual(mode, "conversation")
        self.assertEqual(len(r.hass.services.calls), 0)
        self.assertFalse(r.pending)

    async def test_empty_transcription_asks_for_repeat(self):
        r = await self.runtime()
        r.providers.transcribe = AsyncMock(return_value="")
        reply = await r.client("voice", {"pcm": bytes(6400)}, "one")
        self.assertEqual(reply["reply"], "Sorry, could you repeat that?")
        self.assertEqual(reply["presentation"], "conversation")

    async def test_automatic_fallback_and_explicit_ai_return_without_crashing(self):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        r.assistant.llm = AsyncMock(
            return_value=[
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "A concise answer."}],
                }
            ]
        )
        for text in ["When was Henry VIII born?", "ask AI when was Shakespeare born"]:
            self.assertEqual(
                await r.assistant.answer(text, "one"),
                ("A concise answer.", "conversation"),
            )
        self.assertEqual(r.assistant.llm.await_count, 2)

    async def test_spoken_status_variants_resolve_actual_approved_lights(self):
        r = await self.runtime()
        r.hass.states.values["light.bedroom"] = State("light.bedroom", "on")
        r.config["homeEntities"] = ["light.bedroom"]
        r.assistant.llm = AsyncMock(
            side_effect=AssertionError("No cloud for recognised read")
        )
        for text in [
            "This is the status of the bedroom lights.",
            "What is the state of the bedroom like?",
            "How are the bedroom lights doing?",
        ]:
            self.assertIsNotNone(rules(text))
        # Exercise resolution against discovered inventory, not just the regex.
        reply, _ = await r.assistant.answer("This is the status of bedroom.", "one")
        self.assertIn("1 on", reply)
        r.assistant.llm.assert_not_awaited()

    async def test_clear_email_request_sends_once_without_extra_confirmation(self):
        r = await self.runtime()
        r.config.update(confirmActions=False, mailProvider="google")
        r.providers.send = AsyncMock(return_value={"accepted": True})
        reply, _ = await r.assistant.answer(
            "email test@example.com saying hello there", "one"
        )
        self.assertIn("accepted", reply)
        r.providers.send.assert_awaited_once()
        self.assertNotIn("one", r.pending)
        self.assertIsNone(await r.assistant.confirm("one", "yes"))

    async def test_transcription_sends_configured_language_hint(self):
        r = await self.runtime()
        r.config.update(
            transcriptionProvider="openai",
            transcriptionModel="gpt-4o-mini-transcribe",
            apiKey="fixture",
            transcriptionLanguage="en",
        )
        r.http = AsyncMock(return_value={"text": "Kitchen lights"})
        self.assertEqual(await r.providers.transcribe(bytes(6400)), "Kitchen lights")
        fields = {
            options["name"]: value
            for options, _, value in r.http.call_args.kwargs["form"]._fields
        }
        self.assertEqual(fields["language"], "en")
        self.assertIn("Kitchen lights", fields["prompt"])
        r.config["transcriptionModel"] = "gpt-transcribe"
        await r.providers.transcribe(bytes(6400))
        fields = {
            options["name"]: value
            for options, _, value in r.http.call_args.kwargs["form"]._fields
        }
        self.assertEqual(fields["languages[]"], "en")
        self.assertNotIn("language", fields)

    async def test_explicit_policy_blocks_unrequested_cloud_and_quoted_triggers(self):
        r = await self.runtime()
        r.config["cloudPolicy"] = "explicit"
        r.assistant.llm = AsyncMock(side_effect=AssertionError("Cloud must not run"))
        for text in [
            "When was Einstein born?",
            "The email says research the moon",
            "Explain ingredients for my shopping list",
        ]:
            reply, _ = await r.assistant.answer(text, "one")
            self.assertIn("ask AI", reply)
        r.assistant.llm.assert_not_awaited()

    async def test_research_uses_search_once_and_returns_sources(self):
        r = await self.runtime()
        r.config["cloudPolicy"] = "explicit"
        r.providers.search = AsyncMock(
            return_value={
                "summary": "A finding.",
                "sources": [{"title": "Source", "url": "https://example.org"}],
            }
        )
        r.assistant.llm = AsyncMock(side_effect=AssertionError("No extra planner"))
        reply, _ = await r.assistant.answer("research a public fact", "one")
        self.assertIn("https://example.org", reply)
        r.providers.search.assert_awaited_once()
        r.config["cloudPolicy"] = "local-only"
        await r.assistant.answer("research another fact", "one")
        r.providers.search.assert_awaited_once()

    async def test_overflow_sends_full_content_once_keeps_preview_private(self):
        r = await self.runtime()
        r.config.update(mailProvider="google", emailOverflow=True)
        r.config["profile"]["selfEmail"] = "self@example.org"
        r.providers.send = AsyncMock(return_value={"accepted": True})
        content = "Wide words in a long response. " * 30
        from alfred.delivery import display_lines

        self.assertGreater(display_lines(content), 6)
        reply, _ = await r.delivery.finish(
            "Explain heat pumps", content, "conversation", "one"
        )
        self.assertIn("accepted", reply)
        self.assertEqual(r.providers.send.call_args.args[0]["body"], content)
        await r.delivery.finish("Explain heat pumps", content, "conversation", "one")
        r.providers.send.assert_awaited_once()
        r.assistant.prepare(
            "two",
            "mail",
            {"to": "other@example.org", "subject": "Preview", "body": content},
        )
        self.assertEqual(
            (await r.delivery.finish("research x", content, "conversation", "two"))[0],
            content,
        )
        r.providers.send.assert_awaited_once()

    async def test_capability_help_is_local_and_never_overflow_email(self):
        from alfred.commands import capability_question

        r = await self.runtime()
        r.config.update(mailProvider="google", emailOverflow=True)
        r.config["profile"]["selfEmail"] = "self@example.org"
        r.providers.send = AsyncMock(return_value={"accepted": True})
        for question in [
            "What can you do?",
            "What can Alfred do for me?",
            "Tell me your capabilities",
            "Help",
        ]:
            self.assertTrue(capability_question(question))
            reply, mode = await r.assistant.answer(question, "one")
            self.assertIn("Home controls", reply)
            self.assertEqual(r.request_route["one"], "rules")
            result = await r.delivery.finish(question, reply * 3, mode, "one")
            self.assertIn("Home controls", result[0])
        r.providers.send.assert_not_awaited()
        self.assertFalse(capability_question("Email me what you can do"))

    async def test_short_research_is_emailed_but_short_answer_is_not(self):
        r = await self.runtime()
        r.config.update(mailProvider="google", emailOverflow=True)
        r.config["profile"]["selfEmail"] = "self@example.org"
        r.providers.send = AsyncMock(return_value={"accepted": True})
        self.assertEqual(
            (await r.delivery.finish("show lights", "All off.", "conversation", "one"))[
                0
            ],
            "All off.",
        )
        r.providers.send.assert_not_awaited()
        await r.delivery.finish("research x", "A short finding.", "conversation", "one")
        r.providers.send.assert_awaited_once()

    async def test_failed_delivery_preserves_answer_and_does_not_retry_write(self):
        r = await self.runtime()
        r.config["mailProvider"] = "google"
        r.config["profile"]["selfEmail"] = "self@example.org"
        r.providers.send = AsyncMock(side_effect=TimeoutError())
        reply, _ = await r.delivery.finish(
            "research x", "Finding.", "conversation", "one"
        )
        self.assertIn("Finding.", reply)
        self.assertIn("uncertain", reply)
        await r.delivery.finish("research x", "Finding.", "conversation", "one")
        r.providers.send.assert_awaited_once()

    async def test_local_agenda_and_mail_references_avoid_model_and_expire(self):
        r = await self.runtime()
        r.providers.events = AsyncMock(
            return_value={
                "events": [
                    {"title": "Walk", "start": {"dateTime": "2030-01-01T09:00:00Z"}}
                ]
            }
        )
        answer = await r.local_ops.answer("show my agenda tomorrow", "one")
        self.assertIn("Walk", answer[0])
        r.config["mailProvider"] = "google"
        r.providers.search_mail = AsyncMock(
            return_value={"messages": [{"id": "real-id", "subject": "Hello"}]}
        )
        r.providers.read_mail = AsyncMock(
            return_value={"subject": "Hello", "body": "Literal text."}
        )
        await r.local_ops.answer("show my emails", "one")
        reply = await r.local_ops.answer("read the first one", "one")
        self.assertIn("Literal text.", reply[0])
        r.providers.read_mail.assert_awaited_once_with(
            {"message_id": "real-id"}, "google"
        )
        r.local_ops.references["one"]["at"] = 0
        reply = await r.local_ops.answer("read the first one", "one")
        self.assertIn("expired", reply[0])

    async def test_local_calendar_recurrence_prepares_once_without_execution(self):
        r = await self.runtime()
        reply, mode = await r.local_ops.answer(
            "add calendar event Dog daycare on friday at 8am for 30 minutes every week",
            "one",
        )
        self.assertEqual(r.pending["one"]["kind"], "calendar")
        self.assertEqual(r.pending["one"]["args"]["recurrence_frequency"], "weekly")
        self.assertEqual(r.pending["one"]["args"]["title"], "Dog daycare")
        self.assertEqual(mode, "conversation")
        self.assertEqual(r.hass.services.calls, [])

    async def test_local_batch_items_verify_result_without_cloud(self):
        r = await self.runtime()
        r.hass.states.values["todo.groceries"] = State("todo.groceries")
        r.config["haLists"] = {"shopping": "todo.groceries"}
        answer = await r.local_ops.answer(
            "add milk, bread and eggs to shopping list", "one"
        )
        self.assertEqual(answer[1], "action_complete")
        self.assertEqual(
            [x["summary"] for x in r.hass.services.items], ["milk", "bread", "eggs"]
        )
        answer = await r.local_ops.answer(
            "remove milk and missing from shopping list", "one"
        )
        self.assertIn("missing", answer[0])
        self.assertEqual(len(r.hass.services.items), 3)

    async def test_feedback_context_is_device_bound_and_read_has_no_tick(self):
        r = await self.runtime()
        r.hass.states.values["light.kitchen"] = State(
            "light.kitchen",
            "on",
            {"supported_color_modes": ["brightness"], "brightness": 200},
        )
        r.config["homeEntities"] = ["light.kitchen"]
        original = r.home.approved

        def approved():
            rows = original()
            for row in rows:
                row["room"] = "Kitchen"
            return rows

        r.home.approved = approved
        self.assertEqual(
            (await r.commands.answer("Turn the kitchen lights off", "", "one"))[1],
            "action_complete",
        )
        self.assertEqual(
            (await r.commands.answer("Turn them back on", "", "one"))[1],
            "action_complete",
        )
        self.assertEqual(
            (await r.commands.answer("And back off", "", "one"))[1], "action_complete"
        )
        self.assertEqual(r.hass.states.get("light.kitchen").state, "off")
        self.assertEqual(
            (await r.commands.answer("Are the kitchen lights off", "", "one"))[1],
            "conversation",
        )
        self.assertEqual(
            (await r.commands.answer("Turn them back on", "", "other"))[1],
            "conversation",
        )
        self.assertEqual(
            (await r.commands.answer("Lights to 40%", "", "one"))[1], "action_complete"
        )
        self.assertEqual(
            r.hass.states.get("light.kitchen").attributes["brightness"], 102
        )

    async def test_feedback_colour_keeps_explicit_room(self):
        r = await self.runtime()
        for name in ("hallway", "kitchen"):
            r.hass.states.values["light." + name] = State(
                "light." + name,
                "on",
                {"supported_color_modes": ["xy"], "xy_color": None},
            )
        r.config["homeEntities"] = ["light.hallway", "light.kitchen"]
        original = r.home.approved

        def approved():
            rows = original()
            for row in rows:
                row["room"] = row["entity_id"].split(".")[1].title()
            return rows

        r.home.approved = approved
        result = await r.local_ops.answer("Turn the hallway lights blue", "one")
        self.assertEqual(result[1], "action_complete")
        calls = [x for x in r.hass.services.calls if x[0] == "light"]
        self.assertEqual(calls[0][2]["entity_id"], ["light.hallway"])
        self.assertIsNone(r.hass.states.get("light.kitchen").attributes["xy_color"])

    async def test_feedback_missing_light_attributes_are_unverified_not_exception(self):
        r = await self.runtime()
        r.hass.states.values["light.fixture"] = State(
            "light.fixture",
            "on",
            {
                "supported_color_modes": ["color_temp"],
                "brightness": None,
                "color_temp_kelvin": None,
                "min_color_temp_kelvin": None,
                "max_color_temp_kelvin": None,
            },
        )
        r.config["homeEntities"] = ["light.fixture"]
        r.hass.services.hold = True
        result = await r.home.lights(
            "set_light_properties",
            {
                "targets": ["light.fixture"],
                "brightness_percent": 40,
                "color_temp_kelvin": 2700,
            },
        )
        self.assertEqual(result["verification"], "unconfirmed")

    async def test_feedback_restore_uses_actual_previous_state(self):
        r = await self.runtime()
        r.hass.states.values["light.fixture"] = State(
            "light.fixture",
            "on",
            {"supported_color_modes": ["brightness"], "brightness": 153},
        )
        r.config["homeEntities"] = ["light.fixture"]
        await r.home.lights(
            "control_lights", {"targets": ["light.fixture"], "action": "off"}
        )
        self.assertEqual(r.hass.states.get("light.fixture").state, "off")
        result = await r.home.restore_lighting()
        self.assertEqual(result["verification"], "confirmed")
        self.assertEqual(r.hass.states.get("light.fixture").state, "on")
        self.assertAlmostEqual(
            r.hass.states.get("light.fixture").attributes["brightness"], 153
        )

    async def test_feedback_agenda_uses_connected_default_without_model(self):
        r = await self.runtime()
        r.config.update(calendarProvider="outlook", google={"refreshToken": "fixture"})
        self.assertEqual(r.providers.selected("calendar"), "google")
        r.providers.events = AsyncMock(return_value={"events": []})
        for text in (
            "What is in my calendar this week",
            "This is on my agenda tomorrow",
            "Show my agenda tomorrow",
        ):
            reply, mode = await r.local_ops.answer(text, "one")
            self.assertEqual(reply, "Agenda\nNo events.")
            self.assertEqual(mode, "conversation")

    async def test_feedback_delete_created_event_is_not_external_instruction(self):
        import time

        r = await self.runtime()
        r.config.update(
            confirmActions=False,
            calendarProvider="google",
            google={"refreshToken": "fixture"},
        )
        r.local_ops.references["one"] = {
            "created_event": {
                "id": "known-event",
                "provider": "google",
                "at": time.monotonic(),
            }
        }
        r.providers.event_write = AsyncMock(
            return_value={"verified": True, "deleted": True}
        )
        reply, mode = await r.assistant.answer(
            "Delete the calendar event we just created", "one"
        )
        self.assertEqual(mode, "action_complete")
        self.assertEqual(
            r.providers.event_write.call_args.args[0]["event_id"], "known-event"
        )

    async def test_feedback_routine_views_do_not_send_unrequested_email(self):
        r = await self.runtime()
        r.config.update(mailProvider="google", emailOverflow=True)
        r.config["profile"]["selfEmail"] = "self@example.org"
        r.providers.send = AsyncMock(return_value={"accepted": True})
        long_reply = "• Current list item with a long name.\n" * 20
        for text in (
            "Show my agenda tomorrow",
            "Show my shopping list",
            "Read the first email",
            "Show news",
        ):
            reply, mode = await r.delivery.finish(
                text, long_reply, "conversation", "one"
            )
            self.assertIn("Current list item", reply)
        r.providers.send.assert_not_awaited()

    async def test_feedback_cloud_contract_is_scoped_to_current_room(self):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        for room in ("hallway", "kitchen"):
            r.hass.states.values["light." + room] = State("light." + room, "on")
        r.config["homeEntities"] = ["light.hallway", "light.kitchen"]
        original = r.home.approved

        def approved():
            rows = original()
            for row in rows:
                row["room"] = row["entity_id"].split(".")[1].title()
            return rows

        r.home.approved = approved
        offered = []

        async def llm(instruction, inputs, tools, config):
            offered.extend(tools)
            return [
                {
                    "type": "function_call",
                    "name": "control_lights",
                    "call_id": "bad",
                    "arguments": json.dumps(
                        {
                            "target": "All lights",
                            "action": "off",
                            "brightness_percent": None,
                        }
                    ),
                }
            ]

        r.assistant.llm = llm
        reply, mode = await r.assistant.answer(
            "Change the hallway lights to a soft blue", "one"
        )
        target = next(x for x in offered if x["name"] == "control_lights")[
            "parameters"
        ]["properties"]["target"]["enum"]
        self.assertIn("Hallway", target)
        self.assertNotIn("All lights", target)
        self.assertNotIn("Kitchen", target)
        self.assertEqual(len(r.hass.services.calls), 0)
        self.assertEqual(mode, "conversation")

    async def test_feedback_imported_scene_replays_palette_not_just_power(self):
        r = await self.runtime()
        r.hass.states.values["light.fixture"] = State(
            "light.fixture",
            "off",
            {
                "supported_color_modes": ["xy"],
                "brightness": 153,
                "xy_color": [0.3, 0.3],
            },
        )
        r.config["homeEntities"] = ["light.fixture"]
        r.data["scenes"] = [
            {
                "id": "palette",
                "name": "Test pastel colours",
                "lights": [
                    {
                        "entity_id": "light.fixture",
                        "command": {
                            "expected_state": "on",
                            "brightness_pct": 40,
                            "xy_color": [0.38, 0.32],
                        },
                    }
                ],
            }
        ]
        reply, mode = await r.commands.answer("Activate Test pastel colours", "", "one")
        self.assertEqual(mode, "action_complete")
        state = r.hass.states.get("light.fixture")
        self.assertEqual(state.state, "on")
        self.assertEqual(state.attributes["xy_color"], [0.38, 0.32])
        self.assertEqual(state.attributes["brightness"], 102)
        self.assertEqual(r.data["previous_lighting"][0]["state"], "off")

    async def test_feedback_repeat_and_lens_links(self):
        from alfred.delivery import lens_text

        r = await self.runtime()
        reply, mode = await r.delivery.finish(
            "unclear",
            "Sorry, could you repeat that?\nSorry, could you repeat that?",
            "conversation",
            "one",
        )
        self.assertEqual(reply, "Sorry, could you repeat that?")
        self.assertEqual(
            lens_text("Born in 1491. [Royal source](https://example.org)."),
            "Born in 1491. Royal source.",
        )

    async def test_0182_recorded_speech_routes(self):
        r = await self.runtime()
        r.home.restore_lighting = AsyncMock(return_value={"verification": "confirmed"})
        self.assertEqual(
            await r.local_ops.answer(
                "The lights to the previous configuration.", "one"
            ),
            ("Done.", "action_complete"),
        )
        r.home.lists = AsyncMock(
            return_value={
                "items": [{"id": "task1", "title": "test check the bedroom window"}]
            }
        )
        r.commands.execute = AsyncMock(return_value=("Done.", "action_complete"))
        self.assertEqual(
            await r.local_ops.answer("Complete test, check the bedroom window.", "one"),
            ("Done.", "action_complete"),
        )
        self.assertEqual(
            r.commands.execute.call_args.args[0]["item"],
            "test check the bedroom window",
        )
        r.commands.targets = lambda target: [{"entity_id": "light.fixture"}]
        r.commands.mutate = AsyncMock(
            return_value={
                "verification": "confirmed",
                "skipped": [{"reason": "Colour unsupported"}],
            }
        )
        self.assertEqual(
            await r.local_ops.answer("The bedroom lights, warm white.", "one"),
            ("Done.", "action_complete"),
        )

    async def test_0182_test_email_uses_self_address_and_literal_permission(self):
        r = await self.runtime()
        r.config.update(
            mailProvider="google",
            google={"refreshToken": "fixture"},
            profile={"selfEmail": "self@example.test"},
        )
        for text in (
            "Email me a test message. Make up a short subject and body and send it.",
            "Email me a test email message and make up the subject and body.",
        ):
            result = await r.local_ops.answer(text, "one")
            self.assertIn("self@example.test", result[0])
            self.assertEqual(r.pending["one"]["args"]["to"], "self@example.test")
            r.pending.clear()

    async def test_0182_agenda_delete_requires_one_named_or_selected_event(self):
        r = await self.runtime()
        r.config.update(calendarProvider="google", google={"refreshToken": "fixture"})
        r.providers.events = AsyncMock(
            return_value={
                "events": [
                    {
                        "id": "actual1",
                        "title": "Alfred test",
                        "start": {"dateTime": "2026-10-11T10:00:00Z"},
                    }
                ]
            }
        )
        await r.local_ops.answer("Show my agenda tomorrow", "one")
        await r.local_ops.answer(
            "Delete the calendar event, Alfred test tomorrow at 10 a.m.", "one"
        )
        self.assertEqual(r.pending["one"]["args"]["event_id"], "actual1")
        r.pending.clear()
        await r.local_ops.answer("Delete that from the agenda", "one")
        self.assertEqual(r.pending["one"]["args"]["event_id"], "actual1")
        r.pending.clear()
        reply = await r.local_ops.answer("Delete that from the agenda", "other")
        self.assertIn("Show the relevant agenda", reply[0])

    async def test_0182_scene_saving_with_spoken_name(self):
        r = await self.runtime()
        r.commands.targets = lambda target: [{"entity_id": "light.fixture"}]
        r.home.scenes = AsyncMock(return_value={"saved": True})
        self.assertEqual(
            (
                await r.local_ops.answer(
                    "Save current bedroom lighting as a scene", "one"
                )
            )[0],
            "What should I call the scene?",
        )
        self.assertEqual(
            await r.local_ops.answer("Call it Reading", "one"),
            ("Done.", "action_complete"),
        )
        self.assertEqual(r.home.scenes.call_args.args[1]["name"], "Reading")
        self.assertEqual(
            r.home.scenes.call_args.args[1]["entity_ids"], ["light.fixture"]
        )

    async def test_0182_dashboard_is_ui_action_without_email(self):
        r = await self.runtime()
        r.providers.send = AsyncMock()
        for text in ("Show the dashboard.", "Dashboard. Show my dashboard."):
            result = await r.client("ask", {"text": text}, "one")
            self.assertEqual(result["ui_action"], "dashboard")
            await r.delivery.finish(
                text, "A long dashboard summary. " * 100, "conversation", "one"
            )
        r.providers.send.assert_not_awaited()

    async def test_0182_weather_respects_country_qualifier(self):
        r = await self.runtime()
        r.config["weatherCity"] = "Windsor, England"
        r.http = AsyncMock(
            side_effect=[
                {
                    "results": [
                        {
                            "name": "Windsor",
                            "country_code": "CA",
                            "latitude": 42,
                            "longitude": -83,
                            "timezone": "America/Toronto",
                        },
                        {
                            "name": "Windsor",
                            "country_code": "GB",
                            "latitude": 51,
                            "longitude": -0.6,
                            "timezone": "Europe/London",
                        },
                    ]
                },
                {
                    "timezone": "Europe/London",
                    "current": {
                        "temperature_2m": 14,
                        "apparent_temperature": 13,
                        "weather_code": 0,
                        "is_day": 1,
                        "relative_humidity_2m": 50,
                        "time": 1780000000,
                    },
                    "daily": {"sunrise": [1780000000], "sunset": [1780040000]},
                },
            ]
        )
        weather = await r.providers.weather()
        self.assertTrue(weather["available"])
        self.assertEqual(weather["timezone"], "Europe/London")
        self.assertIn("latitude=51", r.http.call_args.args[1])
        self.assertIn("name=Windsor%2C+England", r.http.call_args_list[0].args[1])

    async def test_0182_scene_ignores_removed_entities_without_widening(self):
        r = await self.runtime()
        r.hass.states.values["light.fixture"] = State(
            "light.fixture",
            "on",
            {"supported_color_modes": ["brightness"], "brightness": 153},
        )
        r.config["homeEntities"] = ["light.fixture"]
        r.data["scenes"] = [
            {
                "id": "s1",
                "name": "Bedtime",
                "lights": [
                    {"entity_id": "light.removed", "state": "off", "settings": {}},
                    {"entity_id": "light.fixture", "state": "off", "settings": {}},
                ],
            }
        ]
        result = await r.home.scenes("activate_saved_scene", {"id": "s1"})
        self.assertEqual(result["verification"], "confirmed")
        self.assertEqual(r.hass.states.get("light.fixture").state, "off")
        from alfred.commands import rules

        self.assertEqual(
            rules("Activate the test pastel colours light scene")["target"],
            "test pastel colours",
        )

    async def test_html_email_is_escaped_branded_and_multipart(self):
        from alfred.email_format import email_html, plain_text
        from alfred.providers import plain_mime
        from email import policy
        from email.parser import BytesParser
        import base64

        content = "# Findings\n\n**Good news**\n- First item\n- [Official source](https://example.test/source)\n***\n<script>alert(1)</script>\n[Unsafe](javascript:alert(1))"
        html = email_html("Your report <unsafe>", content)
        self.assertIn("<strong>Good news</strong>", html)
        self.assertIn("<ul", html)
        self.assertIn("cid:alfred-logo@local", html)
        self.assertNotIn("<script>", html)
        self.assertNotIn('href="javascript:', html)
        self.assertNotIn("***", html)
        raw = plain_mime("self@example.test", "Your report", content)
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        message = BytesParser(policy=policy.default).parsebytes(decoded)
        parts = [part.get_content_type() for part in message.walk()]
        self.assertIn("text/plain", parts)
        self.assertIn("text/html", parts)
        self.assertNotIn(
            "**Good news**", message.get_body(preferencelist=("plain",)).get_content()
        )

    async def runtime(self):
        h = types.SimpleNamespace(states=States(), is_running=True)

        async def executor(fn, *a):
            return fn(*a)

        h.async_add_executor_job = executor
        h.services = Services(h)
        e = engine.Engine(h)
        r = Runtime(h, e)
        await r.load()
        # Legacy tests exercise automatic cloud planning; strict policy has dedicated cases.
        r.config["cloudPolicy"] = "automatic"
        r.config["emailOverflow"] = False
        r.config["confirmActions"] = True
        return r

    async def test_history_contract_keeps_native_replies_after_reopen(self):
        r = await self.runtime()
        r.data["history"]["one"] = [
            {"id": "uuid", "question": "Tea?", "reply": "Certainly."}
        ]
        d = await r.client("history", {}, "one")
        self.assertEqual(d["exchanges"][0]["id"], 1)
        self.assertEqual(d["exchanges"][0]["reply"], "Certainly.")

    async def test_pair_persistence_and_revocation(self):
        r = await self.runtime()
        r.pairing = {"code": "123456", "expires": 99999999999, "attempts": 0}
        d = await r.pair({"code": "123456", "name": "Test"})
        self.assertTrue(r.authenticate(d["clientToken"]))
        self.assertIsNone(r.pairing)
        r.config["pairedDevices"] = []
        self.assertIsNone(r.authenticate(d["clientToken"]))

    async def test_import_removes_ha_credentials_and_preserves_pairing(self):
        r = await self.runtime()
        a = {
            "settings": {
                "homeToken": "private-ha-admin",
                "homeUrl": "http://fixture",
                "clientToken": "private-device",
                "pairedDevices": [
                    {"id": "one", "token": "secret-device", "label": "Glasses"}
                ],
            },
            "memories": [{"id": "m", "text": "Tea"}],
        }
        d = await r.import_legacy(a)
        self.assertTrue(d["verified"])
        self.assertNotIn("homeToken", r.config)
        self.assertEqual(r.authenticate("private-device"), "migrated-device")
        self.assertEqual(r.authenticate("secret-device"), "one")
        self.assertNotIn("secret-device", json.dumps(r.safe_config()))
        self.assertTrue((await r.import_legacy(a))["already_imported"])

    async def test_partial_list_setup_and_readback(self):
        r = await self.runtime()
        r.hass.states.values["todo.groceries"] = State("todo.groceries")
        r.config["haLists"] = {"shopping": "todo.groceries"}
        await r.home.lists("add_shopping_items", {"items": ["Milk", "Bread"]})
        d = await r.home.lists("list_shopping", {"status": "open"})
        self.assertEqual(d["total"], 2)
        await r.home.lists("remove_shopping_items", {"ids": ["1", "2"]})
        self.assertEqual(
            (await r.home.lists("list_shopping", {"status": "all"}))["total"], 0
        )
        with self.assertRaisesRegex(ValueError, "tasks"):
            await r.home.lists("list_todos", {})

    async def test_light_readback_and_removed_devices(self):
        r = await self.runtime()
        r.hass.states.values["light.one"] = State(
            "light.one",
            attrs={
                "supported_color_modes": ["xy"],
                "color_gamut": [[0.7, 0.2], [0.2, 0.7], [0.1, 0.1]],
            },
        )
        r.config["homeEntities"] = ["light.one"]
        d = await r.home.lights(
            "set_light_properties",
            {
                "targets": ["light.one"],
                "brightness_percent": 45,
                "rgb_color": [255, 0, 0],
            },
        )
        self.assertEqual(d["verification"], "confirmed")
        self.assertFalse(d["colour_matching"]["physical_match_verified"])
        r.hass.states.values.clear()
        with self.assertRaises(ValueError):
            await r.home.lights(
                "control_lights", {"target": "light.one", "action": "off"}
            )

    async def test_revoked_light_does_not_fall_back_to_legacy_scope(self):
        r = await self.runtime()
        r.hass.states.values["light.one"] = State("light.one")
        r.config.update(homeEntities=[], homeLights=[{"entity_id": "light.one"}])
        self.assertEqual(r.home.approved(), [])

    async def test_readonly_question_cannot_trigger_model_mutation(self):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        r.assistant.llm = AsyncMock(
            side_effect=[
                [
                    {
                        "type": "function_call",
                        "name": "control_lights",
                        "arguments": json.dumps(
                            {
                                "target": "All lights",
                                "action": "off",
                                "brightness_percent": None,
                            }
                        ),
                        "call_id": "one",
                    }
                ],
                [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "Done."}],
                    }
                ],
            ]
        )
        reply, presentation = await r.assistant.answer(
            "What is the time in Tokyo?", "one"
        )
        self.assertNotEqual(presentation, "action_complete")
        self.assertIn("could you repeat", reply)
        self.assertEqual(len(r.hass.services.calls), 0)

    async def test_false_light_success_is_never_confirmed(self):
        r = await self.runtime()
        r.hass.states.values["light.one"] = State("light.one")
        r.config["homeEntities"] = ["light.one"]
        r.hass.services.hold = True
        d = await r.home.lights(
            "control_lights", {"target": "light.one", "action": "on"}
        )
        self.assertEqual(d["verification"], "unconfirmed")
        self.assertEqual(len(r.hass.services.calls), 2)

    async def test_sensitive_home_requires_one_preview(self):
        r = await self.runtime()
        d = await r.assistant.tool(
            "control_home_entity",
            {"entity_id": "script.test", "action": "activate", "value": None},
            "one",
        )
        self.assertTrue(d["prepared"])
        self.assertEqual(len(r.hass.services.calls), 0)
        self.assertEqual((await r.assistant.confirm("one", "no"))[0], "Cancelled.")

    async def test_email_confirm_is_consumed_before_send(self):
        r = await self.runtime()
        r.providers.send = AsyncMock(return_value={"accepted": True})
        r.assistant.prepare(
            "one", "mail", {"to": "test@example.com", "subject": "Tea", "body": "Hello"}
        )
        await r.assistant.confirm("one", "yes")
        self.assertIsNone(await r.assistant.confirm("one", "yes"))
        self.assertEqual(r.providers.send.await_count, 1)

    async def test_uncertain_send_is_journaled_and_not_retried(self):
        r = await self.runtime()
        r.providers.send = AsyncMock(side_effect=ValueError("Timeout"))
        r.assistant.prepare(
            "one", "mail", {"to": "test@example.com", "subject": "Tea", "body": "Hello"}
        )
        with self.assertRaises(ValueError):
            await r.assistant.confirm("one", "yes")
        self.assertEqual(r.data["actions"][0]["status"], "failed_or_uncertain")
        self.assertIsNone(await r.assistant.confirm("one", "yes"))
        self.assertEqual(r.providers.send.await_count, 1)

    async def test_voice_profile_update_cannot_change_credentials(self):
        r = await self.runtime()
        d = await r.assistant.tool(
            "prepare_configuration_update",
            {"name": "Jamie", "addressAs": "none"},
            "one",
        )
        self.assertTrue(d["prepared"])
        await r.assistant.confirm("one", "yes")
        self.assertEqual(r.profile()["name"], "Jamie")
        with self.assertRaises(ValueError):
            await r.assistant.tool(
                "prepare_configuration_update", {"apiKey": "injected"}, "one"
            )

    async def test_short_reminder_is_native(self):
        r = await self.runtime()
        reply, kind = await r.assistant.answer(
            "Remind me to stretch in 2 minutes", "one"
        )
        self.assertIn("saved", reply)
        self.assertEqual(len(r.engine.data["reminders"]), 1)

    async def test_ha_computed_name_sentinels_are_not_router_targets(self):
        r = await self.runtime()
        state = State("light.fixture")
        state.name = object()
        r.hass.states.values[state.entity_id] = state
        row = r.home.inventory()[0]
        self.assertEqual(row["name"], "light.fixture")
        r.config["localRouter"] = {
            "enabled": True,
            "url": "http://fixture",
            "model": "tiny",
        }
        r.home.approved = lambda: [
            {
                "entity_id": "light.fixture",
                "domain": "light",
                "name": object(),
                "room": "Study",
                "aliases": [object()],
            }
        ]
        r.http = AsyncMock(
            return_value={
                "message": {
                    "content": '{"kind":"lights","action":"off","target":"Study"}'
                }
            }
        )
        self.assertIsNotNone(await r.commands.interpret("Could you turn Study off"))

    async def test_model_is_not_used_for_plain_list(self):
        r = await self.runtime()
        r.hass.states.values["todo.groceries"] = State("todo.groceries")
        r.config["haLists"] = {"shopping": "todo.groceries"}
        r.hass.services.items = [
            {"uid": "1", "summary": "Milk", "status": "needs_action"}
        ]
        reply, _ = await r.assistant.answer("show my shopping list", "one")
        self.assertEqual(reply, "Shopping\n• Milk")

    async def test_direct_room_controls_all_approved_lights_without_ai(self):
        r = await self.runtime()
        r.home.approved = lambda: [
            {
                "entity_id": "light." + str(i),
                "domain": "light",
                "room": "Study",
                "area_id": "study",
                "name": "Spot " + str(i),
            }
            for i in range(3)
        ]
        r.home.lights = AsyncMock(return_value={"verification": "confirmed"})
        r.assistant.llm = AsyncMock(side_effect=AssertionError("LLM must not run"))
        reply, mode = await r.assistant.answer("turn the Study lights off", "one")
        self.assertEqual(mode, "action_complete")
        self.assertEqual(
            r.home.lights.call_args.args[1]["targets"],
            ["light.0", "light.1", "light.2"],
        )
        self.assertEqual(r.data["actions"][-1]["status"], "confirmed")

    async def test_light_status_reads_current_room_state_without_ai_or_writes(self):
        r = await self.runtime()
        rows = [
            {
                "entity_id": "light." + str(i),
                "domain": "light",
                "room": "Bathroom",
                "area_id": "bathroom",
                "name": "Spot " + str(i),
                "state": state,
                "attributes": {"brightness": 128},
            }
            for i, state in enumerate(("on", "off", "unavailable"))
        ]
        r.home.approved = lambda: rows
        r.assistant.llm = AsyncMock(side_effect=AssertionError("No model needed"))
        r.home.lights = AsyncMock(
            side_effect=AssertionError("State read must not write")
        )
        for question in (
            "What is the status of the bathroom lights?",
            "Are the bathroom lights on?",
            "Show me the state of bathroom",
        ):
            reply, mode = await r.assistant.answer(question, "one")
            self.assertIn("1 on, 1 off, 1 unavailable/unknown", reply)
            self.assertIn("Brightness 50%", reply)
            self.assertEqual(mode, "conversation")
        rows[0]["state"] = "off"
        reply, _ = await r.assistant.answer(
            "What is the status of bathroom lights?", "one"
        )
        self.assertIn("0 on, 2 off", reply)
        self.assertNotIn("Brightness", reply)
        self.assertEqual(r.data.get("actions", []), [])

    async def test_compound_status_request_is_not_swallowed_by_fast_read(self):
        r = await self.runtime()
        self.assertIsNone(
            await r.commands.answer(
                "Are the bathroom lights on and turn them off?", "", "one"
            )
        )
        self.assertIsNone(
            await r.commands.answer(
                "What is the status of bathroom lights?", "selected context", "one"
            )
        )

    async def test_cloud_request_metrics_do_not_break_answer(self):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        r.assistant.llm = AsyncMock(
            return_value=[
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Four."}],
                }
            ]
        )
        reply = await r.client("ask", {"text": "What is two plus two?"}, "one")
        self.assertEqual(reply["reply"], "Four.")
        self.assertEqual(r.performance[-1]["llm_calls"], 1)
        self.assertEqual(r.performance[-1]["tools"], [])
        self.assertGreaterEqual(r.performance[-1]["llm_ms"], 0)
        self.assertNotIn("one", r.request_metrics)

    async def test_failed_or_unverified_direct_action_never_falls_back_or_ticks(self):
        r = await self.runtime()
        r.home.approved = lambda: [
            {
                "entity_id": "light.spot",
                "domain": "light",
                "room": "Study",
                "name": "Spot",
            }
        ]
        r.home.lights = AsyncMock(return_value={"verification": "unconfirmed"})
        r.assistant.llm = AsyncMock(side_effect=AssertionError("No second execution"))
        _, mode = await r.assistant.answer("Study off", "one")
        self.assertEqual(mode, "conversation")
        r.home.lights.side_effect = ValueError("offline")
        with self.assertRaisesRegex(ValueError, "offline"):
            await r.assistant.answer("Study off", "one")
        self.assertEqual(r.data["actions"][-1]["status"], "failed_or_uncertain")
        self.assertEqual(r.home.lights.call_count, 2)

    async def test_duplicates_conditions_and_negation_are_not_direct_commands(self):
        r = await self.runtime()
        r.home.approved = lambda: [
            {
                "entity_id": "light." + str(i),
                "domain": "light",
                "room": "",
                "name": "Spot",
            }
            for i in range(2)
        ]
        self.assertIsNone(r.commands.targets("Spot"))
        for sentence in [
            "Don't turn Study off",
            "turn Study off tomorrow",
            "if I leave turn Study off",
            "turn Study off and Kitchen on",
            "add milk and bread to shopping list",
        ]:
            intent = rules(sentence)
            if intent:
                self.assertIsNone(r.commands.targets(intent.get("target", "")))
        self.assertIsNone(rules("add milk and bread to shopping list"))

    async def test_local_schema_and_target_are_checked_before_any_write(self):
        r = await self.runtime()
        r.config["localRouter"] = {
            "enabled": True,
            "url": "http://fixture",
            "model": "tiny",
            "timeoutMs": 1000,
        }
        r.home.approved = lambda: [
            {
                "entity_id": "light.study",
                "domain": "light",
                "room": "Study",
                "name": "Spot",
            }
        ]
        r.http = AsyncMock(
            return_value={
                "message": {
                    "content": json.dumps(
                        {
                            "kind": "lights",
                            "action": "off",
                            "target": "Kitchen",
                            "item": "",
                            "value": 0,
                        }
                    )
                }
            }
        )
        self.assertIsNone(await r.commands.interpret("Could you turn Study off"))
        r.http.return_value = {
            "message": {"content": '{"kind":"lights","action":"off"}'}
        }
        self.assertIsNone(await r.commands.interpret("Could you turn Study off"))
        self.assertGreater(r.commands.unavailable_until, 0)
        r.http.reset_mock()
        self.assertIsNone(await r.commands.interpret("Could you turn Study off"))
        r.http.assert_not_awaited()

    async def test_local_timeout_falls_back_without_executing(self):
        r = await self.runtime()
        r.config["localRouter"] = {
            "enabled": True,
            "url": "http://fixture",
            "model": "tiny",
        }
        r.home.approved = lambda: [
            {
                "entity_id": "light.study",
                "domain": "light",
                "room": "Study",
                "name": "Spot",
            }
        ]
        r.http = AsyncMock(side_effect=TimeoutError())
        self.assertIsNone(
            await r.commands.answer("Could you set Study to off", "", "one")
        )
        self.assertEqual(r.hass.services.calls, [])
        self.assertEqual(r.commands.last["status"], "unavailable")

    async def test_rules_add_and_complete_lists_with_actual_readback(self):
        r = await self.runtime()
        r.hass.states.values["todo.groceries"] = State("todo.groceries")
        r.config["haLists"] = {"shopping": "todo.groceries"}
        _, mode = await r.assistant.answer("add milk to shopping list", "one")
        self.assertEqual(mode, "action_complete")
        _, mode = await r.assistant.answer("complete milk on shopping list", "one")
        self.assertEqual(mode, "action_complete")
        self.assertEqual(
            (await r.home.lists("list_shopping", {"status": "open"}))["items"], []
        )

    async def test_calendar_recurrence_and_ha_push_keep_local_hour_across_dst(self):
        s = calendar_spec(
            {
                "start": "2026-10-23T09:00:00+01:00",
                "end": "2026-10-23T09:30:00+01:00",
                "title": "Daycare",
                "recurrence_frequency": "weekly",
                "recurrence_count": 3,
                "recurrence_weekdays": ["FR"],
                "reminder_minutes": 60,
                "reminder_delivery": "ha",
            },
            "Europe/London",
        )
        nxt = next_event(s, datetime.fromisoformat(s["start"]))
        self.assertEqual(nxt.isoformat(), "2026-10-30T09:00:00+00:00")
        self.assertIn("BYDAY=FR", google_rule(s)[0])
        self.assertEqual(graph_rule(s)["pattern"]["daysOfWeek"], ["friday"])
        self.assertEqual(graph_rule(s)["range"]["numberOfOccurrences"], 3)
        self.assertIsNone(
            next_event(s, datetime.fromisoformat("2026-11-06T09:00:00+00:00"))
        )

    async def test_monthly_recurrence_skips_missing_dates_and_honours_end(self):
        s = calendar_spec(
            {
                "start": "2027-01-31T09:00:00+00:00",
                "end": "2027-01-31T10:00:00+00:00",
                "recurrence_frequency": "monthly",
                "recurrence_count": 0,
                "recurrence_until": "2027-03-31",
            },
            "Europe/London",
        )
        nxt = next_event(s, datetime.fromisoformat(s["start"]))
        self.assertEqual(nxt.day, 31)
        self.assertEqual(nxt.month, 3)
        self.assertIsNone(next_event(s, nxt))
        self.assertEqual(graph_rule(s)["range"]["type"], "endDate")

    async def test_local_router_key_is_never_returned_by_status(self):
        r = await self.runtime()
        r.config["localRouterKey"] = "fixture-private-key"
        c = r.safe_config()
        self.assertNotIn("fixture-private-key", json.dumps(c))
        self.assertTrue(c["credentialStatus"]["localRouterKey"])

    async def test_google_recurring_event_readback_and_deduplicated_ha_notification(
        self,
    ):
        r = await self.runtime()
        r.config["google"] = {
            "scopes": ["https://www.googleapis.com/auth/calendar.events"]
        }
        r.engine.data["phone"] = "mobile_app_fixture"
        stored = {}

        async def provider(p, path, method="GET", body=None):
            if method == "POST":
                stored.update(copy.deepcopy(body), id="event-fixture")
            return copy.deepcopy(stored)

        r.providers.request = AsyncMock(side_effect=provider)
        start = (datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0)
        args = {
            "title": "Daycare",
            "start": start.isoformat(),
            "end": (start + timedelta(minutes=30)).isoformat(),
            "recurrence_frequency": "weekly",
            "recurrence_count": 6,
            "reminder_minutes": 60,
            "reminder_delivery": "ha",
        }
        result = await r.providers.event_write(args, "google")
        self.assertTrue(result["verified"])
        self.assertEqual(stored["reminders"]["overrides"], [])
        self.assertIn("COUNT=6", stored["recurrence"][0])
        self.assertEqual(len(r.engine.data["reminders"]), 1)
        item = r.engine.data["reminders"][0]
        self.assertEqual(
            datetime.fromisoformat(item["due_at"]), start - timedelta(hours=1)
        )
        repeated = await r.engine.execute(
            "create_reminder",
            {
                "title": "Daycare",
                "due_at": item["due_at"],
                "calendar_schedule": item["calendar_schedule"],
                "source_key": item["source_key"],
            },
        )
        self.assertTrue(repeated["already_exists"])

    async def test_outlook_recurrence_and_reminders_survive_graph_default_fields(self):
        r = await self.runtime()
        r.config["outlook"] = {"scopes": ["Calendars.ReadWrite"]}
        stored = {}

        async def provider(p, path, method="GET", body=None):
            if method == "POST":
                stored.update(copy.deepcopy(body), id="outlook-fixture")
            result = copy.deepcopy(stored)
            result["recurrence"]["pattern"].update(dayOfMonth=0, month=0)
            return result

        r.providers.request = AsyncMock(side_effect=provider)
        result = await r.providers.event_write(
            {
                "title": "Daycare",
                "start": "2026-10-23T09:00:00+01:00",
                "end": "2026-10-23T10:00:00+01:00",
                "recurrence_frequency": "weekly",
                "recurrence_count": 0,
                "recurrence_weekdays": ["FR"],
                "reminder_minutes": 60,
                "reminder_delivery": "calendar",
            },
            "outlook",
        )
        self.assertTrue(result["verified"])
        self.assertTrue(stored["isReminderOn"])
        self.assertEqual(stored["reminderMinutesBeforeStart"], 60)
        self.assertEqual(stored["recurrence"]["range"]["type"], "noEnd")

    async def test_calendar_uncertain_readback_does_not_retry_or_schedule_push(self):
        r = await self.runtime()
        r.config["google"] = {"scopes": ["calendar.events"]}
        r.providers.request = AsyncMock(
            side_effect=[{"id": "event-fixture"}, ValueError("Readback offline")]
        )
        result = await r.providers.event_write(
            {
                "title": "Test",
                "start": "2026-10-23T09:00:00+01:00",
                "end": "2026-10-23T10:00:00+01:00",
                "reminder_minutes": 60,
                "reminder_delivery": "ha",
            },
            "google",
        )
        self.assertFalse(result["verified"])
        self.assertIn("unverified", result["notification_error"])
        self.assertEqual(r.providers.request.await_count, 2)
        self.assertEqual(r.engine.data["reminders"], [])

    async def test_verified_cloud_tool_finishes_without_a_second_model_call(self):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        r.home.approved = lambda: [
            {
                "entity_id": "light.study",
                "name": "Study fixture",
                "room": "Study",
                "domain": "light",
                "state": "on",
                "attributes": {},
            }
        ]
        r.home.lights = AsyncMock(return_value={"verification": "confirmed"})
        r.assistant.llm = AsyncMock(
            return_value=[
                {
                    "type": "function_call",
                    "name": "control_lights",
                    "arguments": json.dumps(
                        {
                            "target": "Study",
                            "action": "off",
                            "brightness_percent": None,
                        }
                    ),
                    "call_id": "one",
                }
            ]
        )
        # The service noun chooses the home tool family, while this wording misses rules.
        _, mode = await r.assistant.answer("Please turn the lights off in Study", "one")
        self.assertEqual(mode, "action_complete")
        self.assertEqual(r.assistant.llm.await_count, 1)

    async def test_negated_and_instruction_only_requests_cannot_mutate_through_cloud(
        self,
    ):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        r.home.lights = AsyncMock(side_effect=AssertionError("No write requested"))
        r.assistant.llm = AsyncMock(
            return_value=[
                {
                    "type": "function_call",
                    "name": "control_lights",
                    "arguments": json.dumps(
                        {
                            "target": "All lights",
                            "action": "off",
                            "brightness_percent": None,
                        }
                    ),
                    "call_id": "one",
                }
            ]
        )
        for text in ("Do not turn the lights off", "How do I turn the lights off?"):
            reply, mode = await r.assistant.answer(text, "one")
            self.assertIn("could you repeat", reply)
            self.assertEqual(mode, "conversation")
        r.home.lights.assert_not_awaited()

    async def test_settings_validate_and_do_not_accept_ha_token(self):
        r = await self.runtime()
        with self.assertRaises(ValueError):
            validate_settings({"homeToken": "bad"}, r.config)
        with self.assertRaises(ValueError):
            validate_settings(
                {"newsSources": [{"name": "bad", "url": "http://127.0.0.1"}]}, r.config
            )

    async def test_schema_requires_types_not_model_claims(self):
        with self.assertRaises(ValueError):
            validate(
                {"action": "off", "extra": True},
                {
                    "type": "object",
                    "properties": {"action": {"enum": ["on", "off"]}},
                    "additionalProperties": False,
                },
            )
        with self.assertRaises(ValueError):
            validate("10", {"type": "integer"})

    async def test_generated_documents_and_safe_feed_parser(self):
        for fmt in ("text", "markdown", "pdf", "docx"):
            d = document("Report", "Tea\nhttps://example.com", fmt)
            self.assertTrue(d["bytes"])
        self.assertTrue(document("Report", "Tea", "pdf")["bytes"].startswith(b"%PDF"))
        rows = parse_feed(
            b"<rss><channel><item><title>Tea</title><link>https://example.com</link></item></channel></rss>",
            {"name": "Fixture"},
        )
        self.assertEqual(rows[0]["source"], "Fixture")

    async def test_case_insensitive_room_plans_and_area_on_off_batching(self):
        r = await self.runtime()
        r.home.approved = lambda: [
            {
                "entity_id": "light.a",
                "name": "A",
                "domain": "light",
                "room": "Bedroom",
                "area_id": "bed",
            },
            {
                "entity_id": "light.b",
                "name": "B",
                "domain": "light",
                "room": "Bedroom",
                "area_id": "bed",
            },
        ]
        plan = r.experiences.validate_plan(
            {
                "title": "Bedtime",
                "steps": [
                    {"kind": "home", "args": {"area": "bedroom", "action": "off"}}
                ],
            }
        )
        self.assertEqual(plan["steps"][0]["args"]["area"], "Bedroom")
        r.home.lights = AsyncMock(return_value={"verified": True})
        r.home.control = AsyncMock()
        result = await r.assistant.tool(
            "control_home_area", {"area": "bedroom", "action": "off"}, "fixture"
        )
        self.assertEqual(result["verification"], "confirmed")
        r.home.lights.assert_awaited_once()
        self.assertEqual(
            r.home.lights.call_args.args[1]["targets"], ["light.a", "light.b"]
        )
        r.home.control.assert_not_awaited()

    async def test_daily_schedule_receipt_prevents_repeated_execution(self):
        r = await self.runtime()
        r.config["profile"]["timezone"] = "UTC"
        clock = datetime.now(timezone.utc).strftime("%H:%M")
        r.data["routines"] = [{"id": "routine", "title": "Bedtime", "steps": []}]
        r.data["schedules"] = [
            {
                "id": "schedule",
                "routine_id": "routine",
                "title": "Bedtime",
                "trigger": "time",
                "time": clock,
                "enabled": True,
            }
        ]
        r.experiences.run = AsyncMock(return_value={"completed": True})
        await r.experiences.scheduled()
        await r.experiences.scheduled()
        r.experiences.run.assert_awaited_once()

    async def test_owner_handoff_keeps_confirmation_channel_bound(self):
        r = await self.runtime()
        r.config["shareConversation"] = True
        r.data["history"]["owner"] = [{"question": "hello", "reply": "good day"}]
        self.assertEqual(r.history_for("phone"), r.history_for("glasses"))
        r.assistant.prepare("glasses", "configuration", {"weatherCity": "Test"})
        answer, _ = await r.assistant.answer("yes", "phone")
        self.assertIn("device", answer)
        self.assertNotEqual(r.config["weatherCity"], "Test")

    async def test_reviewed_plan_stops_without_replaying_after_uncertain_step(self):
        r = await self.runtime()
        r.home.approved = lambda: [{"entity_id": "light.test", "domain": "light"}]
        r.home.control = AsyncMock(side_effect=ValueError("offline"))
        r.engine.execute = AsyncMock()
        result = await r.experiences.run(
            {
                "title": "Evening",
                "steps": [
                    {
                        "kind": "home",
                        "args": {"entity_id": "light.test", "action": "off"},
                    },
                    {"kind": "reminder", "args": {"title": "Later"}},
                ],
            },
            "fixture",
        )
        self.assertFalse(result["completed"])
        r.engine.execute.assert_not_awaited()
        self.assertEqual(r.data["plans"][-1]["status"], "partial_or_uncertain")

    async def test_plan_rechecks_removed_devices_and_schedule_scope(self):
        r = await self.runtime()
        r.home.approved = lambda: []
        with self.assertRaises(ValueError):
            r.experiences.validate_plan(
                {
                    "title": "Bedtime",
                    "steps": [
                        {
                            "kind": "home",
                            "args": {"entity_id": "light.removed", "action": "off"},
                        }
                    ],
                }
            )
        r.data["routines"] = [
            {
                "id": "routine",
                "title": "Mail",
                "steps": [
                    {
                        "kind": "mail",
                        "args": {
                            "to": "test@example.com",
                            "subject": "Tea",
                            "body": "Ready",
                        },
                    }
                ],
            }
        ]
        with self.assertRaises(ValueError):
            r.experiences.validate_schedule(
                {"routine_id": "routine", "trigger": "time", "time": "08:00"}
            )

    async def test_partial_briefing_keeps_other_sources(self):
        r = await self.runtime()
        r.providers.weather = AsyncMock(side_effect=ValueError("weather unavailable"))
        r.home.dashboard = AsyncMock(return_value={"rooms": []})
        r.engine.execute = AsyncMock(return_value={"items": []})
        r.providers.connected = lambda _: False
        result = await r.experiences.briefing()
        self.assertIn("unavailable", result["weather"])
        self.assertIn("home", result)
        self.assertIn("setup", result["agenda"])

    async def test_memory_is_used_as_preferences_not_a_new_permission(self):
        r = await self.runtime()
        r.config.update(replyProvider="openai", apiKey="fixture", replyModel="fixture")
        r.data["memories"] = [{"text": "Prefers warm light"}]
        seen = []

        async def llm(instruction, *_):
            seen.append(instruction)
            return [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Good day."}],
                }
            ]

        r.assistant.llm = llm
        await r.assistant.answer("hello", "fixture")
        self.assertIn("Prefers warm light", seen[0])
        self.assertIn("never override permission", seen[0])


class WebViewCorsTests(unittest.TestCase):
    def test_packaged_asset_origins_without_cookie_authority(self):
        runtime = types.SimpleNamespace(
            config={"clientOrigins": ["https://example.com"]}
        )
        for origin in (
            "null",
            "http://localhost:49312",
            "https://localhost",
            "capacitor://localhost",
            "https://example.com",
        ):
            request = types.SimpleNamespace(
                headers={"Origin": origin},
                app={
                    "hass": types.SimpleNamespace(
                        data={"alfred": types.SimpleNamespace(runtime=runtime)}
                    )
                },
            )
            response = ClientView().cors(request, web.Response())
            self.assertEqual(
                response.headers.get("Access-Control-Allow-Origin"), origin
            )
            self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
        for origin in (
            "https://evil.example",
            "https://localhost.evil.example",
            "https://user@localhost",
            "https://localhost/path",
        ):
            request.headers = {"Origin": origin}
            self.assertNotIn(
                "Access-Control-Allow-Origin",
                ClientView().cors(request, web.Response()).headers,
            )


if __name__ == "__main__":
    unittest.main()
