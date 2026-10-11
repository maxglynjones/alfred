# Linux, AWS, Azure and GCP — experimental, untested

These are reproducible deployment instructions for the same HA integration, not validated cloud installations or a multi-tenant service. Only the Mac/UTM/HAOS reference installation has been exercised physically. Keep HA supported/upgraded and validate each account, network and vendor path before depending on it.

## Local Linux

Choose HAOS for an appliance with Apps/add-ons, or HA Container on a supported Linux/Docker host. Container has no HA Apps store: STT/Ollama and other services must be deployed separately. Install the Alfred archive into the HA persistent configuration directory and restart HA.

A minimal Container example is `examples/compose.home-assistant.yml`. Follow [HA Linux installation](https://www.home-assistant.io/installation/linux/) for the host/runtime prerequisites. The example has persistent config, host networking and restart policy; it does not bundle administrator credentials or blindly grant privileged USB access. Configure device permissions only if your integrations require them.

## Shared cloud steps

1. Choose a supported Ubuntu/Linux VM image and a modest initial instance with enough memory for HA. Keep inference on an independently sized service unless measured on the same VM. Select a persistent disk, backups and an allowed region for your data.
2. Use key-based admin access. Restrict SSH to your admin address/VPN; keep TCP 8123 and model ports closed to the public internet. Apply updates and install Docker/Compose from maintained vendor sources.
3. Copy the Compose example and create a private config directory outside your source checkout. Start with `docker compose -f compose.home-assistant.yml up -d`. On the host verify `http://127.0.0.1:8123` and complete HA onboarding over a private tunnel/VPN.
4. Build Alfred from the public source and copy only `custom_components/alfred` into the HA config volume. Restart the container, add the integration and configure feature connections.
5. Install Tailscale on VM/iPhone and create a private HTTPS Serve endpoint targeting loopback 8123. Build the Even package for that exact origin. Alternatively use your deliberately secured HA Cloud/custom HTTPS route.
6. For local bridges, deploy/approve an appropriate **home subnet router/private route**. HA in the cloud must reach the bridges' LAN addresses. Avoid overlapping subnets; test vendor protocols. mDNS/SSDP broadcasts do not generally cross this route, so explicit addresses or a home-hosted HA installation may be required.
7. Validate daylight timezone/location, OAuth callbacks, all features in scope, reboot recovery, disk persistence and twenty-second reminders. Test backup restore. Monitor disk, RAM and account costs; do not assume an instance is cost-free.

## AWS / Azure / Google Cloud

| Platform | VM/network/persistence choices |
| --- | --- |
| AWS | EC2 Linux VM, private VPC/security group, persistent EBS volume and snapshots. Do not add a public 8123 ingress rule. |
| Azure | Linux Virtual Machine, restrictive NSG/private network, managed data disk and backup policy. Use a private administration path. |
| GCP | Compute Engine Linux VM, restrictive VPC firewall, persistent disk and snapshot schedule. Restrict IAM and admin access. |

Provision your own account/subscription/project. IAM roles, exact images and console labels vary; use the official [AWS EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html), [Azure VM](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/overview), [GCP VM](https://cloud.google.com/compute/docs/instances/create-start-instance) and [Docker](https://docs.docker.com/engine/install/) instructions. The source contains no Terraform credentials or production secrets.

Cloud hosting cannot solve Even's exact-origin distribution requirement. A developer-operated public service would need a separate multi-user isolation, identity, consent, abuse/billing and operational design. This release intentionally does not provide that service.
