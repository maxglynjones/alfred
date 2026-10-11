# Alfred: feature examples and prerequisites

Alfred is an independently hosted, iOS-focused assistant with a discreet English-butler personality. Tap or hold, ask, get a short answer or an action receipt, then return to passive. The optional dashboard is for deliberate glances. It complements the Even software; it does not replace the OS.

Home Assistant is the required host. Most connections are optional. Start with speech and one successful request; enable only the tiles you need. The [setup guide](setup/README.md) explains prerequisites. Evidence below refers to the single reference installation and isolated automated fixtures, not universal compatibility. [Technical reference](development/TECHNICAL-REFERENCE.md).

## Voice, conversation and context

The WebView captures G2 audio only during deliberate input, then sends it to the chosen recogniser. Rules and local operations handle supported requests first. An optional tiny interpreter can recover alternative wording; a selected OpenAI/Claude/Ollama conversation adapter handles broader questions/tools. Tools are bounded and cannot grant device access. Per-device references support follow-ups; ambiguous references ask for clarification.

Try “What can you do?” for local help, “What is 27 plus 15?” for a short question, or “When was Henry VIII born?” with a conversation model. “Turn them back on” can follow a resolved room command; it must not select an unrelated room. Configure speech and, for general questions, a conversation provider. OpenAI was exercised; Claude/alternative Ollama setups remain experimental. Stable factual answers omit unnecessary links on glasses; research retains citations in the delivered report. This is not always-on voice or spoken phone calling.

## Home devices and lighting

HA owns device protocols and integration updates. Alfred discovers current entities, names, Areas and supported attributes, then restricts commands to the administrator's approved scope. Room lighting resolves the room before an individual lamp. Capability-aware writes verify requested state; an on/off plug is skipped for a colour-only change. Safe idempotent writes can retry once after mismatch. Confirmed HA state is not an optical measurement.

Try “What is the status of the bedroom lights?”, “Turn the bedroom lights off” and “Set them to 40 percent”. An advanced colour request such as “Make the bedroom lights blue” affects compatible approved fixtures in that room. Software gamut matching aims to reduce colour differences; it is not measured fixture calibration. “Restore lights to the previous configuration” replays the bounded persisted pre-change snapshot, not an unlimited undo history.

Native approved HA scenes, scripts and automations can be invoked; saved Alfred lighting scenes retain selected light state. Try “What lighting scenes are available?” and “Save current bedroom lighting as a scene called Reading”, then “Activate Reading”. Native scripts/scenes may have accepted-but-unverified effects; do not assume every workflow's physical result can be checked. New HA scenes must remain inside the approved scope.

The native action map also covers selected switches, media players, climate, covers, fans, vacuums and helpers. For example, “Pause the living room speaker” needs an approved capable media player. These broader domains are implemented/fixture tested, not all exercised on reference hardware. Locks and other consequential devices deserve deliberate approval. This is not automatic support for every HA integration or arbitrary service execution. [Home guide](setup/HOME.md).

## Shopping and to-do

Choose native HA to-do entities in Lists & reminders. Alfred reads, adds, completes and removes entries, rather than maintaining a competing list database. The companion presents separate list cards with Clear list controls.

Try “Add milk and bread to my shopping list”, “Show my shopping list” or “Complete check the garden on my to-do list”. “Clear my shopping list and to-do list” uses the same verified clear implementation as the companion. Clear removes open and completed items while retaining the HA list entity. Each list is bounded and serialised independently; combined operations are not a cross-list transaction. A concurrent new item can prevent an empty-list success receipt. Duplicate names need clarification. Exercised on selected Local To-do lists.

## Durable reminders and iPhone push

The Alfred integration persists reminders in HA Store and processes due work while HA is running, independent of the foreground glasses session. The selected `notify.mobile_app_*` target reuses the official HA iPhone app. Due items also appear in the reminder inbox for Alfred/companion review. Push and inbox status are distinct.

Try “Remind me to check the oven in two minutes” and “Show my reminders”. A recurring request needs unambiguous schedule/timezone details. The immediate and scheduled iPhone path was physically confirmed on the reference setup; other phone configurations need validation. HA downtime, Focus and network conditions can delay delivery. Uncertain notifications are not blindly replayed. No bespoke Alfred iOS app, Home Screen Web Push setup or SMS account is needed. This does not read notifications generated by other iOS apps. [Notification/privacy boundaries](setup/PRIVACY.md).

## Mail and calendar

Optional server-side Google/Microsoft OAuth adapters use the selected default mail/calendar accounts. Profile self-email powers “email me”; it is never the developer's address. Provider keys/tokens remain in HA. Calendar dates use the configured timezone. Clear direct requests execute by default after validation; optional review and protected/ambiguous operations can require clarification.

Try “Show my unread emails”, then “Read the first email”; “What is in my calendar tomorrow?”; or “Email me a test message. Make up a short subject and body and send it.” Calendar creation can support recurrence, for example a weekly Friday event with a configured reminder offset. Deleting recurring/shared events is restricted and account-specific. New events/attachments/sends are journaled to avoid duplicate uncertain effects. Acceptance by an email provider does not prove inbox delivery. Google was exercised; Microsoft/recurring-provider variations require independent validation. [Provider guide](setup/PROVIDERS.md).

## Research and long answers

Current web research uses a separately configured OpenAI search-capable provider. A “Research …” request returns findings with source citations and uses configured self-email delivery. Long conversational answers can be emailed when overflow delivery is enabled. Explicit background research has a saved job/report view; background jobs do not automatically email results merely because they exist.

Try “Research three facts about Windsor Castle using official sources” or “Give me a detailed explanation of how a heat pump works”. An advanced request can prepare a document and deliver it through authorised mail tools; supported document/attachment workflows need account validation. The email formatter produces escaped branded HTML and plain text with an embedded logo. External source content cannot authorise actions. Missing search/mail/self-email setup must be explained, not silently invented. Research-to-email was exercised; do not claim all document formats/provider permutations were physically tested.

## Weather, daylight and news

Weather uses a saved town or opt-in approximate phone location with expiry. Selected RSS sources provide headlines independently of conversation-model inference. Daily digests are configurable rather than pinned to BBC. For public examples use London, UK; no owner's location is bundled as a default.

Try “What is the weather?” or “Show news”. A general question about current stories needs search/AI where plain feed listing is insufficient. RSS selection and weather were exercised; digest/provider/Feedreader permutations need their own checks. Remote services receive the data described in [Privacy](setup/PRIVACY.md).

## Dashboard and display

The rich dashboard composes clock/date, compact weather, available batteries, list counts and a full-width sunrise/sunset track. Its sun position follows current time between validated rise/set values. Ask “Show my dashboard” or use the configured dashboard gesture. Native text replies occupy their own layout; graphics use four grayscale bitmap tiles with changed-pixel caching. Display updates are serialised and stale frames coalesced. There is no atomic full-screen transfer or promised high frame rate.

Replies expire after a deterministic reading budget; verified actions show a brief tick, then clear. Reduced motion and readable fallback exist. G2/R1 batteries are only shown when the host provides a valid identified reading. R1 health statistics are not supported by the installed SDK. Dashboard/graphics behaviour requires real BLE testing, beyond the automated layout fixtures. [Controls](setup/CONTROLS.md), [Device limits](setup/DEVICES.md).

## Memory, personalisation and briefings

Explicit memories and profile settings guide Alfred's responses; address preferences can use sir, madam, a name or no honorific. They are not silent training or unrestricted long-term retention. Try “Remember that my favourite tea is Earl Grey”, “What is my favourite tea?”, “Show my memories” and “Forget that my favourite tea is Earl Grey”. Those basic memory flows were exercised.

Briefings aggregate configured weather/home/reminders/agenda and optional unread mail, with bounded optional-service failures. Routines/plans reuse approved actions and stop on uncertainty; they do not roll back already completed steps. A configured named routine may combine a light setting and a reminder. Creation through conversational tools is implemented but requires separate physical validation before showcasing complex plans. Registered iPhone Shortcuts dispatch a notification to tap; Alfred cannot claim they ran automatically. Personal knowledge and proactive watches exist as experimental configured workflows, not an autonomous all-purpose agent.

## Companion and command centre

The Even companion has Home, Lists, Reminders, Research, chronological Activity and Settings, with connection recovery and device diagnostics. The HA command centre holds administrator configuration, provider keys, approved device scope, guides and readiness checks. Configured means settings are present, not that a live provider has succeeded. Neither UI requires a new native iOS application. No phone screen-mirror, phone calling or image-recognition UI is advertised.

Unsupported features include always-on wake words, unrestricted iOS/WhatsApp access, automatic opening of stock Even apps, custom firmware, CallKit and R1 health retrieval. [Engineering choices](development/ENGINEERING.md) and [platform proposals](development/EVEN-RECOMMENDATIONS.md) separate future ambitions from working capabilities.
