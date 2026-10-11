# Models, mail and calendar

Configure providers in HA → Alfred → **Intelligence & accounts**. Conversation, transcription and web search are separate choices. Keys are saved only in HA private storage; a blank password box keeps an existing configured secret. Never put keys in app.json, config defaults, Vite environment variables or Git.

## Conversation / speech

| Option | Setup | Validation |
| --- | --- | --- |
| OpenAI | Create API project/key and enable API billing. Select an available tool-capable Responses model; enter its exact ID and key. Choose an available transcription model independently. | Exercised on the reference setup; availability and billing vary by account |
| Claude | Create Anthropic API credentials; choose Claude and an exact available model ID. | Adapter implemented; account-specific live validation required |
| Ollama | Install model server separately; pull a tool-capable model. Enter a trusted private URL reachable **from HA**, plus exact model ID. | Experimental, model-specific; do not assume every model handles tools |
| HA speech | Install/configure a supported HA STT engine, for example the official Whisper/Wyoming route. Select the discovered `stt.*` entity and language. | Exercised locally; measured recognition latency may dominate voice responses |
| Local compatible speech | Supply a private service implementing multipart `/v1/audio/transcriptions` with a JSON `text` result. | Experimental; no speech server is bundled. Keep it on a trusted private network |

Use API dashboard budgets/alerts. A ChatGPT/Claude consumer subscription does not configure Alfred's API account. Model suggestions are examples, not guaranteed future availability or equal performance. The configured model field is editable; don't switch a working installation just because a newer name exists.

Official references: [OpenAI API setup](https://developers.openai.com/api/docs/quickstart), [Claude API](https://platform.claude.com/docs/en/api/overview), [Ollama](https://docs.ollama.com/quickstart), [HA Whisper](https://www.home-assistant.io/integrations/whisper/).

## Optional tiny command interpreter

Rules handle supported common commands before a model. An optional tiny model interprets alternative wording; it does not grant device permission or execute arbitrary tools. Enable only if benchmarks show an improvement. On an 8 GB Mac, do not run several large resident models beside an oversized VM.

1. Install Ollama on the Mac and pull a model you can run, for example `ollama pull qwen3:1.7b`. Start `ollama serve` on loopback.
2. Create a dedicated Python 3.12+ environment outside the protected Documents folder and install `aiohttp`. Copy `scripts/local-router-server.py` there.
3. Copy `examples/local-router.json` to private application storage. Replace bind/allowed HA addresses/model, and generate a random key using `secrets.token_urlsafe(32)`. Keep the file mode `600`; do not paste its contents into issues.
4. Run `python local-router-server.py /private/path/router.json`. Configure the same private endpoint/key/model under Local command engine in the intelligence modal. It authenticates and bounds requests; model access itself stays loopback.
5. Keep the adapter on a trusted LAN or behind TLS/VPN; never publicly forward Ollama/adapter ports. Use the headless templates for login startup if needed. Model warm-up, CPU and RAM determine latency; cloud fallback remains configurable.

Conversation Ollama can use a separate larger server/model. An unauthenticated Ollama origin should never be exposed to the internet; use network isolation/authenticating proxy appropriate to your deployment.

## Google — Gmail and Calendar

1. Create your own Google Cloud project. Enable Gmail API and Google Calendar API for the features you want.
2. Configure Google Auth branding/audience. Use Internal only for an eligible organisation account; otherwise External with appropriate testing/publishing status and test users. Workspace policy may restrict consent; external testing credentials may expire according to Google policy.
3. Create a **Web application** OAuth client. Add the exact redirect URI shown in Alfred, normally `https://YOUR_HA_ORIGIN/alfred/oauth/google`.
4. Enter client ID/secret in Alfred's Google setup, then sign in. Review permissions yourself. Optional sending/event writes need their own enabled scopes; reconnect when those permissions change.
5. Choose Google as the default for mail/calendar. Set Profile → self-email for “email me”. Research/long-answer delivery needs that address and a sending connection.

Google token refresh uses server-side offline access. An app registered for one domain cannot be copied to every self-hoster unchanged. [Official OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

## Microsoft — Outlook and Calendar (experimental)

Register your own application in Microsoft Entra ID with a Web redirect matching `/alfred/oauth/outlook`. Choose supported account types for your intended users. Configure delegated Graph permissions matching Alfred's requested read/send/calendar scopes and offline access; tenant administrators may need to approve them. Enter client ID/secret in Alfred and use the sign-in flow. Select Outlook as your default only after it is connected. Account-specific Outlook behaviour has not been validated on the reference setup. [Official registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

## News, search and weather

News sources are selected RSS feeds, not a hardwired BBC requirement. Web research currently uses a configured OpenAI search-capable model/key; this is independent of a Claude/Ollama conversation choice. Configure the key through the OpenAI provider fields even if another provider handles replies. Set weather to `Town, Country`; approximate iPhone location is opt-in and expires after one hour.

Test a read before a write for each account. Calendar deletion protects shared/recurring events; not every provider mutation is supported. Email acceptance does not prove inbox delivery. Uncertain sends are not automatically retried.
