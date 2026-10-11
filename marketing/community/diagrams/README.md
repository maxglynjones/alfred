# Architecture visuals

These are explanatory diagrams, not product screenshots or claims of physical latency. SVG is editable; Mermaid expresses the same boundaries for GitHub. PNG exports can be used in community posts. No personal backend, account, serial or credential appears here.

| Asset | Purpose |
| --- | --- |
| `technical-architecture.svg` / `.png` / `.mmd` | Hardware, Even WebView, user-hosted HA, optional providers/devices/push |
| `architecture-overview.svg` / `.png` / `.mmd` | Minimal green community overview and independent-hosting story |
| `networking.svg` / `.png` / `.mmd` | Destination permission, browser CORS and separate pairing authentication |
| `notifications.svg` / `.png` / `.mmd` | Durable reminder → HA push target → iPhone, with separate foreground inbox reading |

The reference host is Mac/UTM/HAOS, not an Alfred dependency. R1 is optional. Tailscale transport may be direct or encrypted-relayed; there is no mandatory shared Alfred application backend. Model/speech/vendor/mail/push boundaries remain explicit. See [architecture](../../../docs/development/ARCHITECTURE.md), [privacy](../../../docs/setup/PRIVACY.md) and [notification prerequisites](../../../docs/setup/HOME.md).

Maintain the diagram sources when changing the architecture. Only include supported pathways; notification receipt is not a generic iOS interception API, and a plugin cannot promise background glasses delivery.
