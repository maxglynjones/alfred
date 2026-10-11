# Start from scratch

Alfred is an independent, self-hosted assistant for **iPhone + Even G2/R1**. Home Assistant runs it; the glasses do not run a model or a replacement operating system. A Mac is one server option, not a requirement.

**Read before starting:** the current glasses app must be built for **your exact HTTPS Home Assistant address** and uploaded through **your own Even Hub developer account**. There is no universal Alfred store package that can connect to arbitrary servers. This is a platform networking constraint, not a paid Alfred account or relay requirement. [Why the package is personal to your server](EVEN.md).

## What you need

| Essential | Why |
| --- | --- |
| Even G2, iPhone and the Even app; optional R1 | The supported glasses client; pair the hardware in Even first. Temple controls provide a ring-free path, subject to firmware validation |
| Always-available Home Assistant | Hosts Alfred and its private settings |
| Private HTTPS access from iPhone | Needed for the installed glasses app, including away from home |
| Even Hub developer access | Register and upload your own package; ordinary store access alone is insufficient |
| Git, Node 22/24, pnpm 10 and Python 3.12+ on a build computer | Compile/package the source; these tools are not required inside HA |
| A speech recogniser | Required for voice; either a supported HA engine or a speech API |

Optional: AI API account/local model, mail/calendar OAuth, vendor device integrations, HA lists, and the HA iPhone app for push. API usage, hardware and cloud hosting may have their own costs. Consumer ChatGPT/Claude subscriptions do not include the API configuration. Alfred has no compulsory hosted account. Home Assistant itself is required even for basic AI because it hosts this release's backend.

The physically exercised route is **Apple Silicon Mac → UTM → HAOS → Tailscale → iPhone/G2/R1**. Other hosts/providers are described separately and remain experimental until validated. See [validation scope](OPERATIONS.md).

## 1. Get Home Assistant running

**Already have HA?** Skip host installation. Back up your configuration first.

**Starting on Apple Silicon Mac?** Follow [Mac setup](MAC.md), then return here. Use HAOS in UTM; start with 2 vCPUs and 2 GB RAM and plan extra capacity for local speech/models. Keep the host powered and available.

**Expected result:** HA opens in your browser, you have an administrator account, and a backup exists. Note its local address and port. Default is `http://HA_ADDRESS:8123`; use the actual address shown by your installation. This local URL is not your final glasses server address.

## 2. Get the source and build tools

Install [Git](https://git-scm.com/downloads), [Node.js 22 or 24](https://nodejs.org/en/download) and [Python 3.12+](https://www.python.org/downloads/) from their official sources. On macOS, `git --version` may offer Apple's Command Line Tools; complete that installation if needed. On Linux use your supported package-manager route and verify versions.

Install the pinned package manager:

```sh
npm install --global pnpm@10.18.3
node --version
pnpm --version
python3 --version
```

If your `python3` is older than 3.12, install a newer Python and adjust your PATH before building. The backend uses HA's Python at runtime; do not install Alfred into macOS system Python.

Copy this repository's **HTTPS clone URL** from GitHub's Code menu. Replace `REPOSITORY_URL` below, then run:

```sh
git clone REPOSITORY_URL alfred
cd alfred
pnpm install --frozen-lockfile
pnpm pack:ha
```

**Expected result:** `integrations/home-assistant/alfred-ha.zip` exists. Stay in the `alfred` folder for subsequent commands. `pnpm dev` is an optional sample preview, not the production server.

If a published GitHub release supplies a generic HA ZIP, you can use that ZIP for step 3. You still need the source and build tools for your own Even package. A local source checkout does not imply a release asset has already been published.

## 3. Install the HA integration

Extract the ZIP on your build computer. It contains `custom_components/alfred`. Copy **the alfred folder**, including its `frontend` folder, into HA's `custom_components` configuration folder:

```text
HA configuration directory/
  custom_components/
    alfred/
      __init__.py
      manifest.json
      frontend/
```

Do not copy the repository, `node_modules`, `.local`, a ZIP alone, or a second nested `config` folder.

**Recommended HAOS transfer:** temporarily install the official Samba share app in HA Settings → Apps (called Add-ons in older releases). Configure its username/password yourself, enable only the config share you need, and start it. In Mac Finder choose Go → Connect to Server, enter `smb://HA_ADDRESS`, sign in and open the `config` share. Create `custom_components` if absent, then copy the extracted `alfred` folder there. Windows/Linux users can use their file manager's SMB connection. See the [official Samba app instructions](https://github.com/home-assistant/addons/blob/master/samba/DOCS.md). Stop the app after transfer if you no longer need it.

If you already use SSH or another trusted file-access tool, use that instead. Container users copy into their mounted `/config/custom_components/alfred`; Container has no HA Apps and model services are separate.

Restart HA through Settings → System. Open Settings → Devices & services → Add integration → **Alfred**. Open Alfred in the sidebar as an administrator.

**Expected result:** Alfred's Quick Start page appears. If not, check HA System Logs and the directory tree above. Wait for HA to finish restarting before trying again. [Operations and recovery](OPERATIONS.md).

## 4. Establish one HTTPS origin

Follow [private remote access](REMOTE-ACCESS.md). The tested route uses Tailscale on Mac and iPhone. Your own valid TLS domain is an alternative requiring independent testing. Home Assistant Cloud migration is outside the current launch scope.

An **origin** is just the scheme and host: `https://your-node.example.ts.net`. Do not include `/alfred`, `/index.html`, a query, username or token. The current package helper expects HTTPS on the standard port 443.

1. Open your HTTPS origin on iPhone with Wi-Fi off and your private VPN connected when required.
2. Sign in to HA and verify it loads.
3. In Alfred → Glasses & access → Private connection, save that **same origin**.

**Expected result:** your iPhone can reach your own HA over cellular. Keep the origin handy; reuse it exactly for package building and OAuth. Never use the developer's address.

## 5. Configure speech; add AI only if wanted

In Alfred → Intelligence & accounts → Intelligence, select speech recognition:

- Existing HA Whisper/STT: choose HA and the discovered recognition engine.
- OpenAI speech: enter your API key and supported transcription model; API billing applies.
- Other local compatible speech routes are experimental and need their own service.

General AI is independent. Select a provider if you want open-ended conversation; direct supported commands do not require a conversation model. See [provider instructions](PROVIDERS.md). Do not assume home, lists, mail or weather must be configured now.

**Expected result:** Setup checks reports speech configuration present. This is not a live recognition test; verify it on glasses in step 7.

## 6. Build and install your Even package

Follow [Even installation](EVEN.md): sign in to Even Hub with the account used by your iPhone Even app, register your own app, copy its package ID, then run:

```sh
pnpm build:self-hosted https://YOUR_HA_ORIGIN YOUR_REGISTERED_PACKAGE_ID
```

Replace both values. Upload `.local/packages/alfred-VERSION.ehpk` to your own Hub application, select/promote the current test/beta build where required, and install through the current invitation workflow. Developer QR loading and an installed test/beta app are different routes.

**Expected result:** Alfred opens from your Even menu and displays connection setup. If an invitation says expired, check that it points to the current eligible test/beta build. Do not assume an upload alone installs the app.

## 7. Pair and verify

Create a short-lived pairing code in HA → Alfred → Glasses & access. Enter it in the installed Alfred companion Home page. Put Alfred first in Even's menu and assign R1 long press to Menu: hold, release, tap Alfred to launch.

Tap a temple to start recording and tap again to send. Ring/temple hold and release are also supported when Even delivers them. Try **“What can you do?”**. This local help request needs no home devices, mail, weather, lists or general AI. It does need working speech recognition and connectivity. Temple alternatives and personal/store gesture profiles must be checked on the installed app/firmware; there is no always-listening wake word.

**Expected result:** the glasses show a short capabilities overview. Test again on cellular with the host screen locked. [Controls](CONTROLS.md). Pairing should survive reopening; do not regenerate it for a temporary network outage.

## 8. Add only the features you use

- **Connected home:** add vendor integrations in HA, assign Areas and names, then deliberately approve Alfred's entities. Discovery does not grant permission. [Home guide](HOME.md).
- **Lists & reminders:** create/select native HA to-do lists. Install/connect the HA iPhone app and select your notification target for optional push. Verify a test notification arrives.
- **Profile & behaviour:** choose address preference, timezone, optional weather town and self-email. “None” avoids sir/madam.
- **Mail/calendar:** connect your own Google/Microsoft OAuth application, choose defaults and test a read before a write. [Providers](PROVIDERS.md).
- **News, routines, memory and briefings:** use their tiles. Unused features remain unconfigured and explain requirements when requested.

Keep a backup containing Alfred's private HA storage and the previous install ZIP. Follow [updates, recovery and uninstall](OPERATIONS.md). Cloud/Linux/alternative provider instructions are experimental; they are not part of the verified beginner path.
