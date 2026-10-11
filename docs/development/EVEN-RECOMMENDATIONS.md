# Constructive Even platform proposals

These are proposals for discussion, not approved features or a message already sent to Even. Alfred values the supported SDK and retains stock firmware.

| Current boundary | Practical impact | Proposed supported change | Benefit |
| --- | --- | --- | --- |
| Fixed exact-origin package whitelist | Independently hosted servers need different packages | Ask the user to approve a specific HTTPS backend origin at runtime, show/revoke it in app settings, keep other destinations blocked | Universal client without compulsory developer application relay |
| Per-installation build/upload workflow | Non-developers need tools/account steps | Approved personalised package-generation/install tooling with destination visibility and validation | Easier self-hosted onboarding without weakening consent |
| Built-in-only activation choices on tested app | R1 Menu plus tap is necessary to open Alfred | Register installed third-party assistants as launch actions, with foreground/microphone consent | Faster deliberate invocation; future vendor-mediated wake invocation could be explored |
| Serial bitmap updates / limited native text | Rich dashboard tiles appear incrementally | Supported frame transaction or explicit completion acknowledgement; more native typography/layout where hardware permits | Easier smooth, readable interfaces without pretending BLE has unlimited bandwidth |
| Foreground WebView / no generic notification input | Background reminders belong in HA/iPhone, not always-running plugin | Clearly scoped lifecycle and eligible event integration with user control | Useful notifications within iOS/Even boundaries, not unrestricted Notification Centre interception |
| Native battery identity/payload ambiguity | R1 may show unknown despite stock app reading | Separate documented multi-device snapshot, typed R1 status and diagnostic errors; opt-in health API only if privacy design permits | Accurate batteries/optional health features without guessing values |
| Generic networking errors | Whitelist rejection, CORS and TLS failures look similar | Structured permission/preflight/TLS diagnostics safe to share without credentials | Faster developer and user recovery |
| Self-hosted examples are sparse | Common direct-to-user-server patterns require experimentation | Official sample for paired HTTPS endpoints, token storage, exact-origin manifests and migration | Safer reusable architecture |

Do not infer a fault or bypass from undocumented behaviour. The [networking documentation](https://hub.evenrealities.com/docs/build/networking), [FAQ](https://hub.evenrealities.com/docs/reference/faq) and [runtime issue](https://github.com/even-realities/evenhub-templates/issues/1) distinguish established boundaries from unresolved observations.
