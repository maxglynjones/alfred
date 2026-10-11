# Mac Mini / HAOS / UTM

**Validation:** one Mac Mini M2 installation. Intel Macs, other hypervisors and unattended cold-boot recovery have not been validated here. This is the host setup, not a separate Alfred server.

1. Install UTM from its official distribution. Use the official HA macOS guide and HAOS releases to obtain an **aarch64** image for Apple Silicon; Intel uses the corresponding x86-64 image. Verify the download and decompress `.xz` before importing the disk.
2. In UTM, virtualize Linux with the imported HAOS disk and UEFI. Start with **2 vCPUs and 2 GB RAM**, then increase only when measurements justify it. Do not allocate more guest memory than your Mac has. Whisper/model workloads need separate capacity planning.
3. Use networking that makes HA reachable from the Mac and home devices. Bridged Ethernet is convenient for local discovery; shared/NAT networking may require port forwarding and does not automatically pass discovery broadcasts. Reserve the VM address in the router.
4. Start the VM and wait for HA onboarding. Default HA HTTP is `http://HA_ADDRESS:8123`; use the actual port if you deliberately changed it. Create the account, backups and device integrations before installing Alfred.
5. Install Alfred using the main setup guide. Node/pnpm are build tools only; the production assistant is the HA custom integration.
6. Install Tailscale on Mac and iPhone, then follow the private HTTPS guide. Do not reuse another person's hostname, server IP or package identifier.

Sources: [HA macOS installation](https://www.home-assistant.io/installation/macos/), [UTM](https://mac.getutm.app/), [HAOS releases](https://github.com/home-assistant/operating-system/releases). Use their current UI/image details rather than an old image copied into this repository.

## Keep it available while away

- Keep the Mac on mains power. In macOS power/energy settings, prevent system sleep while serving; display sleep and screen lock can stay enabled. Inspect `pmset -g custom` rather than assuming a setting worked. A UPS helps with outages.
- Start UTM and Tailscale at login. Lock the screen and test from cellular. Verify again after a controlled restart while you are present.
- FileVault can require manual unlock after a power loss. User LaunchAgents do not bypass that cold-boot boundary. Do not disable disk encryption or enable automatic login to hide it.
- `scripts/ensure-home-assistant.zsh` is an optional startup guard, with an example LaunchAgent in `examples/headless/`. It starts a stopped/suspended VM, reports HTTP health and **does not force reboot** a slow/unreachable running VM. It cannot fix a dead host or network.
- Keep optional Ollama/router services in `~/Library/Application Support/Alfred`, outside macOS Documents/Desktop privacy restrictions. Use private files and logs; their services need a logged-in session.
- Before archiving installer downloads, confirm UTM imported its own disk and does not use the download file directly. HA backups are different from a VM snapshot; retain both where appropriate.

The build repository contains no VM, installed application, account login or personal LaunchAgent. Recreate those deliberately with your own addresses and paths.
