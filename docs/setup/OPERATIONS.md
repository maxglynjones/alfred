# Updates, recovery and diagnostics

Before updating, back up HA and retain the working integration archive. Install a reviewed tagged build, replace only `custom_components/alfred`, restart HA, then test one read, one disposable list edit, a safe light, the actual email/calendar account and push. Update the Even package when frontend changes; a backend install does not replace the installed glasses bundle.

Alfred product settings, pairing, history, memory/scenes/routines and delivery journals live in `.storage/alfred.product`; reminders use `.storage/alfred.reminders`. Restoring code alone may not restore state. Keep HA backups encrypted/private and test restoration. Do not publish these files or raw exports.

The command-centre activity view records conversation/actions/configuration events without echoing provider secrets. Some records still contain private questions or event/mail data; sanitise support exports. Performance shows backend timings and route counts, not Bluetooth frame timing.

## Diagnose in order

1. Is HA reachable from the host and phone? Is the VM running and the host awake?
2. Does the private HTTPS origin work on cellular? Is Tailscale/your remote route connected and its certificate valid?
3. Is the exact installed package pointed at that origin? Do not test an old beta build accidentally.
4. Is the client still paired? Revoke/re-pair only after reachability and endpoint checks.
5. Is the required feature connected/authorised? Validate OAuth scopes, selected default provider and selected HA lists/devices.
6. Does HA report the requested state? Unavailable devices, missing capabilities and uncertain provider writes are not successes.
7. Compare warm/cold speech/model timing. Local inference can be slower than cloud on a constrained host. Prefer direct commands and measure end-to-end.

An uncertain email/calendar/script action is not automatically repeated, to prevent duplicate external effects. If a send timed out, check the provider first. HA restart pauses scheduled work; a custom integration bug can affect HA Core. Keep a maintenance/recovery route that does not depend on Alfred itself.

## Setup checks and first verification

Command centre → Check setup shows configuration readiness without calling external models or sending messages. It checks the selected speech engine/configuration, saved HTTPS origin and paired-device registration. Configured does not mean a provider accepted a request or that the phone can reach HA. The iPhone cellular/package checkboxes are your confirmations, saved in this browser only. They do not bypass any requirement.

Download setup summary to obtain the non-secret origin, companion address and build command. Your private hostname may still identify your installation; share deliberately. Recovery backups are separate and contain private settings.

The first minimal test is “What can you do?” with speech configured. Then test only features you enabled. Use a disposable list item, one safe light and a short reminder; check actual state/receipt. Keep old code/HA backup until these checks pass. No clean-machine, cloud or universal hardware validation is implied by automated checks.

## Uninstall or restore

To temporarily stop Alfred, disable its integration in HA. To remove it, revoke paired devices/accounts as appropriate, remove the Alfred integration through HA Devices & services, and uninstall the Even app. After keeping a private backup, remove only `custom_components/alfred` from HA's configuration if no longer needed, then restart. Deleting code does not necessarily erase private `.storage` records; retain or remove those deliberately using HA's supported backup/file-access process. Never delete unrelated HA configuration.

For rollback, restore the previous integration folder and restart HA; restore the matching HA backup if a data migration requires it. Reinstall the matching previous Even package for frontend regressions. Firmware rollback/flashing is not required.
