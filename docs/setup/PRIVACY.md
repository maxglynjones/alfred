# Independent hosting and data boundaries

Alfred's source is MIT licensed. Each installation runs in its user's Home Assistant and stores its own settings and credentials. There is no mandatory Alfred account, author-operated backend, shared application relay or dependence on the author's computer. The official Even/iOS software and optional provider services retain their own terms and licences. Open source, self-hosted and entirely offline are different claims.

## Follow one home command

G2 microphone → Even app's Alfred WebView → authenticated HTTPS to your HA → chosen speech recogniser → direct command resolver where supported → approved current HA entity → maintained vendor integration → device. The observed result returns to Alfred. This is an application-level direct-to-user-server design. It is not a claim that every network hop or recogniser is local.

| Boundary | What leaves / where it executes | User choice and limitation |
| --- | --- | --- |
| Even app / G2 / R1 | Microphone bytes, input events and display updates through the supported bridge | Requires proprietary Even host software; no replacement firmware |
| Tailscale | Encrypted peer traffic; hosted coordination and possible encrypted DERP transport relay | Tested private HTTPS route; no Alfred service processes traffic in the middle. Direct transport is not guaranteed |
| Speech recognition | Audio goes to the configured recogniser | HA/local-compatible service can reduce cloud processing; OpenAI recognition sends audio to OpenAI even for a simple light command |
| Direct supported commands | Rule parsing, target resolution and execution in HA | Avoids conversation-model inference; still needs speech recognition for voice |
| AI fallback / research | Relevant request and tool/context content to the selected provider | Conversation may use a local model or cloud; current web research uses configured OpenAI search. Local-only policy does not create a local search engine |
| HA vendor integration | Depends on the selected device integration | Local-capable devices can execute locally; some integrations authenticate or operate through vendor clouds |
| iPhone push | HA sends to the selected Companion notification service; remote push uses external push infrastructure | Optional. The phone OS may delay/suppress delivery. This is not the VPN home-command route |
| Mail/calendar | Authorised account content and requested mutations to Google/Microsoft | Optional OAuth accounts, separate from home controls |
| Weather/news | Chosen approximate location to weather service; requests to selected public feeds | Optional town or opt-in location; no street address required. Feeds may observe request metadata |

Tailscale's [routing](https://tailscale.com/docs/concepts/traffic-routing-through-tailscale) normally prefers a direct path; [encrypted DERP fallback](https://tailscale.com/docs/concepts/tailscale-encryption) can occur. A transport relay does not receive decrypted Alfred commands. Tailscale's control plane is nevertheless a provider dependency. Strictly excluding third-party transport relays would need independently operated connectivity and testing; it is not a default guarantee.

For remote iPhone notifications, review the [Companion privacy/security documentation](https://companion.home-assistant.io/docs/notifications/notification-details/). Do not put sensitive secrets into notification messages. No general iOS Notification Centre reader is shipped. The reminder inbox and push delivery are separate: inbox presence does not prove an iPhone alert appeared.

## Reduce external processing deliberately

Select a tested local recogniser and local-capable HA integrations; prefer supported direct commands; optionally use a local interpreter/conversation model and configure cloud policy. Disable unwanted personal/search/news/weather connections and push. Validate this exact configuration before calling it offline. Local services have their own memory/security/latency requirements; a small model is not necessarily faster end to end.

Provider keys stay in HA's private `.storage`; pairing clients receive separate scoped credentials. HA storage is not encrypted per field. Protect disks/backups and revoke lost clients. See [Secrets](SECRETS.md) and [Security](../../SECURITY.md). CORS and the Even whitelist are access boundaries, not credentials or a privacy guarantee.
