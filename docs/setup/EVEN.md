# Build and install your own Even app

## Why is a build needed?

Alfred is public source you can host independently. The installed Even app declares which network origins it may contact. Your server address must be in its package whitelist; the current build also embeds that address for connecting to HA. Browser CORS is a second check, handled separately by Alfred's paired-device endpoints.

One compiled package does not currently offer arbitrary per-user HA server addresses. We do not provide a compulsory relay to work around that. This does **not** mean open-source publication is prohibited or that Even has rejected Alfred: universal self-hosted store onboarding needs a platform-supported/approved mechanism we have not established. Your own package is the current installation route.

Even's documented rules require full origins and exclude wildcards; WebSockets have the same permission restriction. A runtime URL setting cannot add an origin to the packaged whitelist. Correct CORS headers are necessary but cannot override that gate. [Official networking rules](https://hub.evenrealities.com/docs/build/networking). [Packaging improvement proposal](../development/PACKAGING.md) describes a simpler future process, not a shipped manifest-only installer.

Compiling translates the source into the HTML/JavaScript assets Even runs. It does not flash firmware or change your glasses OS. API keys and HA administrator credentials are never included. Your HTTPS hostname and package identity are included.

## Before building

Complete [Start from scratch](README.md) through speech setup. Have your reachable HTTPS origin and sign into [Even Hub](https://hub.evenrealities.com/) using the account used by the iPhone Even app.

Register your own Hub application and copy its **package ID** from the app details. It is a reverse-domain identifier such as `com.yourorganisation.alfred`; use the value you registered, not the generic source template or another person's ID. Current portal workflows and access eligibility may change.

## Build locally

From the cloned repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:self-hosted https://YOUR_HA_ORIGIN YOUR_REGISTERED_PACKAGE_ID
```

Replace both placeholders. Use just the HTTPS origin with no path/query/credentials; this helper currently expects standard port 443.

The command builds the generic HA installer, your origin-specific Even package and static manifest checks. It does not upload files, register an app, create an Alfred account or operate a relay.

**Expected outputs:**

- `integrations/home-assistant/alfred-ha.zip` — generic HA integration, no owner configuration.
- `.local/packages/alfred-VERSION.ehpk` — your Even upload package; VERSION matches package.json.
- `.local/app.json` and `.local/deployment.json` — private deployment metadata, ignored by Git.

A leading dot makes `.local` hidden in Finder. Press Command–Shift–period to reveal hidden folders, or use a file chooser's Go to Folder to open the repository's `.local/packages` directory.

## Upload and install

1. Open **your registered app** in Even Hub. Use its build/version upload control and select the generated `.ehpk` file. Do not upload the source ZIP or HA ZIP.
2. Check the uploaded version and package ID match. Follow the portal's validation/required metadata prompts.
3. Select/promote that version to the portal's current test/beta workflow if required. An uploaded development build is not automatically a current beta.
4. Open Testing group/invitation controls, add your own eligible Even account as tester where needed, and obtain the current installation invitation.
5. Open the invite on iPhone with the same account in Even. Accept/install the current build and confirm Alfred appears in your Even menu. Developer Scan QR is a different temporary route.
6. Open Alfred, create a pairing code in HA → Alfred → Glasses & access, and enter it under companion **Home**.

Portal names, approval requirements and tester eligibility are platform-controlled. These steps describe the workflow, not a promise of immediate approval. Use [Even's official packaging guide](https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/build-and-deploy/SKILL.md) and current portal instructions. SDK/app minimum versions are in the source manifest; static validation is not publication approval.

## Recovery and updates

- **Invite expired:** verify current test/beta promotion, tester account and invite version, then obtain a new invitation. Do not re-pair glasses hardware.
- **Cannot reach server:** test HTTPS on iPhone cellular and check VPN/HA availability. A valid package whitelist does not bypass CORS.
- **Invalid/revoked pairing:** generate a new code. Temporary network errors do not require pairing again.
- **Changed server address:** rebuild the package for the new origin, update HA's saved origin and any OAuth callbacks, then test before retiring the old connection.
- **Normal application update:** rebuild/upload a new version under the same registered ID; keep backups and test the exact installed package. Do not assume every WebView preserves storage.

No replacement firmware, glasses flashing or factory reset is part of this process. Keep provider keys, .storage and recovery exports outside Git. [Operations](OPERATIONS.md), [Secrets](SECRETS.md).

For contributors only: `pnpm dev` defaults to loopback; `?preview=1` shows sample data. A Vite URL is not a production install. Live developer testing needs deliberately configured connectivity and Even developer tools.

## Read a connection failure accurately

| Symptom | Check before changing anything |
| --- | --- |
| Build rejects origin | HTTPS, standard port, no path/query/embedded credential; use just the origin |
| Server unreachable on iPhone | HA/host awake, VM online, private VPN connected, certificate valid; test the saved URL on cellular |
| Works in browser but not installed app | Exact installed version, embedded endpoint and packaged whitelist; then server CORS/preflight |
| Browser certificate warning | Correct TLS/domain; do not bypass the warning or disable validation |
| HTTP 401 / revoked pairing | Confirm endpoint, then create a fresh short-lived pairing code; never enter an HA admin token in the client |
| Generic WebView fetch failure | May be whitelist, TLS, transport or CORS. Check each layer; the error alone cannot reliably identify which |
| Missing feature | Configure that feature's HA entities/account/provider, not a new package unless its backend origin changed |

Diagnostic summaries must omit provider keys, tokens and account content. Private hostnames and device serials can still identify an installation. No automatic log export or public relay is needed to recover.
