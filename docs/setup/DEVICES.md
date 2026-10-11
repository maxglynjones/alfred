# R1 battery and health readings

Glasses gestures, device status and health data are different interfaces. The stock Even app can show R1 health statistics; the SDK used by this release (0.0.16) has no supported health-statistics retrieval method. Alfred therefore does not advertise live R1 heart rate, sleep, steps or other health widgets. A future official interface or an independently supported HA data source would be needed. Apple Health export is not assumed.

## Battery

Alfred listens to the documented device-status callback and reads the documented device-info snapshot. It accepts explicit device models, nested device lists/ring wrappers and common battery field aliases; explicitly named ring battery fields can be used without a serial, but it never treats an unidentified second serial as the ring or copies the glasses battery to R1. Missing readings stay unknown, including after restart. Device identities can persist locally; stale battery percentages do not.

Open companion **Settings → Device readings & recovery**, then Refresh device readings. The page shows whether R1 was identified, whether its battery was supplied, the number of unassigned readings, and native snapshot field names without exporting serials or health data.

If an unidentified reading is present, use R1 identity recovery to bind the exact ring serial from Even's device information or packaging. Do not use the glasses serial. This only labels readings from that exact identifier; it cannot make the host app send a missing ring battery. A brief charger connection can prompt a device status update, but is not a guaranteed fix. No glasses reset, speculative native command or firmware flash is required.

If stock Even shows battery but Alfred still has no ring snapshot/callback, the missing information is at the host/SDK boundary. Report whether Alfred identifies the ring and sees unassigned readings, along with your Even app/firmware versions. Do not post serial numbers or private diagnostic exports publicly.

[Even SDK package](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) · [Even health overview](https://support.evenrealities.com/hc/en-us/articles/13500535016591-Features-Overview-Health).
