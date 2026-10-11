"""Authenticated LAN adapter for a localhost-only Ollama command model.

Run with a private JSON configuration path, never with a token on the command
line. Keep this port on a trusted LAN or behind TLS; it is not a public API.
"""

import asyncio
import hmac
import json
import sys
from pathlib import Path
from aiohttp import web, ClientSession, ClientTimeout


def application(config):
    if len(config.get("key", "")) < 32 or not config.get("allow_addresses"):
        raise ValueError("Configure a strong key and permitted HA addresses.")
    app = web.Application(client_max_size=16384)
    busy = asyncio.Lock()

    async def keep_warm(app):
        async def warm():
            while True:
                try:
                    async with ClientSession(
                        timeout=ClientTimeout(total=90)
                    ) as session:
                        async with session.post(
                            "http://127.0.0.1:11434/api/chat",
                            json={
                                "model": config.get("model", "qwen3:1.7b"),
                                "messages": [],
                                "think": False,
                                "stream": False,
                                "keep_alive": "15m",
                                "options": {"num_ctx": 2048},
                            },
                        ) as response:
                            await response.read()
                    await asyncio.sleep(600)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    await asyncio.sleep(60)

        task = asyncio.create_task(warm())
        yield
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    app.cleanup_ctx.append(keep_warm)

    async def chat(request):
        if request.remote not in config["allow_addresses"] or not hmac.compare_digest(
            request.headers.get("Authorization", ""), "Bearer " + config["key"]
        ):
            raise web.HTTPForbidden()
        if busy.locked():
            raise web.HTTPServiceUnavailable(text="Local interpreter busy")
        body = await request.json()
        if (
            not isinstance(body, dict)
            or body.get("model") != config.get("model", "qwen3:1.7b")
            or len(body.get("messages", [])) > 2
        ):
            raise web.HTTPBadRequest()
        # No arbitrary URL, tools, model loading or long-running inference API.
        body = {k: body[k] for k in ("model", "messages", "format") if k in body}
        body.update(
            think=False,
            stream=False,
            keep_alive="15m",
            options={"temperature": 0, "num_predict": 100, "num_ctx": 2048},
        )
        async with busy:
            async with ClientSession(timeout=ClientTimeout(total=4)) as session:
                try:
                    async with session.post(
                        "http://127.0.0.1:11434/api/chat", json=body
                    ) as response:
                        raw = await response.content.read(32769)
                        if len(raw) > 32768:
                            raise web.HTTPBadGateway()
                        return web.Response(
                            body=raw,
                            status=response.status,
                            content_type="application/json",
                        )
                except (TimeoutError, OSError):
                    raise web.HTTPServiceUnavailable(
                        text="Local interpreter unavailable"
                    )

    app.router.add_post("/api/chat", chat)
    return app


if __name__ == "__main__":
    config = json.loads(Path(sys.argv[1]).read_text())
    web.run_app(
        application(config),
        host=config["bind"],
        port=config.get("port", 11435),
        access_log=None,
    )
