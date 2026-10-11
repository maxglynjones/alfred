# Glasses and phone controls

In the Even iPhone app, put Alfred at the top of your menu and assign R1 long press to **Menu**. Long press, then tap Alfred. Third-party apps were not available in the tested custom-long-press picker; Alfred does not claim to bypass that OS restriction.

| Action | Control |
| --- | --- |
| Speak without R1 | Tap a temple once, wait for the listening indicator, speak, then tap again to send |
| Hold to speak | Hold/release R1 or a temple when the host delivers those events |
| Dismiss voice and return passive | Double tap R1; or say “That’s all” |
| Dashboard | Say “Show my dashboard”; personal mode uses left-stem double tap to show/hide |
| Glasses menu fallback | Tap then hold to open the stock contextual menu; choose Speak, Dashboard, Hide display or Close Alfred |
| Exit Alfred | Say “Close Alfred” or use its exit menu, then complete Even's required confirmation |
| Reply paging | Supported ring scroll/swipe input while a reply is visible |

Store mode preserves Even's mandated exit gesture; personal mode has additional gesture mapping. Choose the mode in configuration and test your installed firmware. Replies disappear after deterministic reading time; successful supported actions show a brief tick and clear. A tick depends on a verified service receipt, not optical sensor measurement.

The rich dashboard shows clock/date, compact weather, tasks/shopping counts, supplied G2/R1 batteries and a daylight track. Unknown battery stays unknown. Its bitmaps cross BLE sequentially, so full-screen opening may be slower than text replies. No fake frame-rate or battery-life guarantee is advertised.

Open `/alfred/app/index.html` on the paired iPhone for text requests, lists and connection recovery without wearing the glasses. Speech uses the connected G2 microphone. The companion exposes Lists, Reminders, Research, Activity and Settings. The screen-mirror feature is not exposed. Pair the browser independently if its storage is separate. The command centre uses HA administrator login; ordinary phone clients use pairing credentials.

Do not rely on an always-listening wake word, CallKit/phone calls, iOS inbox notifications, WhatsApp history, arbitrary opening of stock Even apps or custom firmware. Those are not shipped features.

Use Settings → Device readings & recovery for R1 identity/battery diagnostics. [Device limitations](DEVICES.md). Clear list removes all open/completed items, not the HA list entity; voice examples: “Clear my shopping list” or “Purge my to-do list”. The phone offers one explicit bulk-clear review before removal.

From 0.20.2, a single tap starts a new recording from idle, a displayed reply or the dashboard. The second tap sends it; capture is capped at 30 seconds. Double-tap cancels the delayed single-tap action. In personal mode right/ring double-tap cancels voice and clears the display, while left double-tap toggles the dashboard. Store mode retains Even’s required exit confirmation. Swipe through reply pages as supported by your host. If temple hold events are not delivered, use tap-to-speak or the Speak menu; no ring is needed. Menu opening cancels recording and queued taps, and Speak waits for the menu to close before opening the microphone. These routes are regression-tested, but the new ring-free flow needs physical confirmation on your installed host.
