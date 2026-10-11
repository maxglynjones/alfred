# Home controls, lists and push

HA owns device protocols. Add maintained integrations in Settings → Devices & services, then assign meaningful names and Areas. Alfred discovers the current HA entities; you approve the entities it can control in Connected home. Do not automatically grant all devices, particularly locks, alarms or other consequential services.

## Lighting

For Hue, pair/authorise the bridge in HA. Compatible Innr Zigbee lights can join a Hue bridge, but model-specific features and reset/pairing requirements vary; use the fixture manufacturer's instructions. Alfred does not directly depend on the Innr BG220 hub, nor flash glasses/lighting firmware. Tapo plugs use HA's maintained TP-Link integration and the credentials/permissions it requires. Other vendors use their existing HA integrations.

Assign lights and plugs to the correct Areas. Rename outlets by what they power. A bedroom lamp on an on/off plug cannot become colour-capable; room colour commands skip such fixtures and verify the compatible lights. Colour gamut matching is software-level, not measured optical calibration. Removed/unapproved entities cannot be controlled.

Native HA scenes/scripts are discovered when permitted. A service acceptance alone is not a guarantee of physical scene effects. Saved Alfred scenes store state of approved lights: “Save current bedroom lighting as a scene called Reading”, “Activate Reading”. “Restore lights to the previous configuration” uses the persisted pre-change snapshot; it is not unlimited historical undo. Routines use permitted steps; the UI and activity receipts let you inspect them. Direct HA bindings are primary; MCP is optional and is not required for this setup.

## Lists

Create two native HA to-do lists (for example using the official Local To-do integration) and choose them under Lists & reminders. Names need not be Shopping/Tasks. Alfred reads/writes those selected entities. Try adding a disposable item, listing it, then completing/removing it. Duplicate/ambiguous names should ask for clarification rather than modify an arbitrary entry.

## iPhone notifications

Install the official HA Companion iPhone app, connect it to the same server and allow notifications in iOS. Alfred discovers the `notify.mobile_app_*` services; select your phone target in Lists & reminders. Send the UI test and verify receipt, then try “Remind me to check Alfred in 20 seconds”. A HA service acceptance is not proof that iOS displayed it; Focus/network settings can suppress it.

The Alfred reminder scheduler runs in HA and persists its records. No Home Screen Web Push application or SMS provider is required. Recent HA iOS versions can display Alfred's bundled sender avatar. HA remains the app identity. See [HA notification options](https://companion.home-assistant.io/docs/notifications/notifications-basic/).

If HA is stopped, reminders cannot be delivered on time. Restore backups containing both `.storage/alfred.product` and `.storage/alfred.reminders`. Do not run a second legacy scheduler.
