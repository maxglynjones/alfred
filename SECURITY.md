# Security model

## Private data and trust

Home Assistant administrators configure Alfred. They control keys/OAuth registrations, selected devices/lists, account providers and paired client revocation. Paired clients use separate scoped credentials, never HA admin tokens. Installing a custom integration runs code inside HA Core and therefore requires trusting that code.

HA stores settings/pairing/history/action journals in private `.storage/alfred.product`, reminders in `.storage/alfred.reminders`. The files may contain account secrets and personal content. HA storage is not per-field encrypted; secure host disks, access and backups. Credential-presence markers replace secret values in administrative status. Private recovery exports are not suitable for public support attachments.

## Network and models

Use authenticated HA and private HTTPS/VPN or a deliberately secured remote endpoint. CORS is not authentication. Private API operations require pairing credentials; admin operations require HA admin login. Installed WebViews have opaque/loopback origins, which are handled explicitly rather than using a blanket credentials-enabled wildcard policy. Do not add public unauthenticated forwarding, trust-all proxies or publicly exposed Ollama endpoints.

Pairing codes expire and attempts/rates/bodies are bounded. Model rounds, responses, jobs and feed parsing are bounded. News retrieval rejects private/reserved DNS addresses, redirects, oversized responses and XML entities/DTD declarations. Network operations have deadlines; document work runs outside the HA event loop.

Only requested audio/photo data is submitted. Speech/model/search providers receive content necessary for that feature. Approximate location is opt-in and short-lived. An embedded email logo avoids recipient tracking-image requests. HTML email escapes supplied text and limits Markdown rather than trusting model HTML.

Independent hosting does not imply that every optional path is local. Tailscale can relay encrypted packets and uses coordination infrastructure; cloud recognisers receive audio even for rule-handled commands, and vendor/push/mail services have distinct boundaries. See [data-flow and privacy guide](docs/setup/PRIVACY.md). There is no mandatory shared Alfred application relay. Do not advertise guaranteed direct transport or entirely offline operation without testing the exact configuration.

## Actions

Selected current HA entities/lists define home scope. Models cannot expand it. Capability-aware light writes verify supported requested attributes and retry safe idempotent settings once after mismatch. A confirmed HA state is not proof of optical output. Arbitrary scripts/native scenes may only be accepted without a verifiable resulting-state contract; they must not be advertised as physically verified.

Clear supported requested changes execute by default; optional review is configurable. The assistant cannot infer approval from external email/calendar/news/web content. Deletions require a direct user request and unambiguous selected record; protected shared/recurring calendar operations remain restricted. Uncertain email/script/calendar mutations are journaled and are not blindly retried.

## Publication

The source has empty account defaults and fictional examples. Never publish `.local`, HA `.storage`, private VM images, logs/transcripts, OAuth exports, your owner-specific packages or recovery files. The build audit checks suspicious patterns and an optional private denylist, but is not a security certification. Review the exact staged diff and Git author email; use a GitHub noreply address if you do not want a personal email in commit metadata.

Before opening GitHub issues, remove names, addresses, keys, account content and private URLs. After creating the repo, enable secret scanning/private vulnerability reporting if available and configure a private maintainer contact. No support inbox or reporting URL is claimed before the owner publishes it.

## Recovery and disclosure

Keep a HA backup plus previous integration version. Roll back code and compatible private state as necessary; do not run both old/new reminder schedulers. Validate new HA/provider versions in a maintenance window. Report vulnerabilities privately to the repository owner using the configured reporting route; if none is published, request a private channel without posting the exploit or secret.

This release has isolated regression and publication checks and one physical reference installation. Independent security review, new-user onboarding, account-provider permutations and cloud-host isolation are required before broader operational guarantees.
