# iPhone access away from home

Alfred needs a reachable **HTTPS origin**, for example `https://your-node.example.ts.net`, plus a separate pairing token. A LAN URL is not sufficient on cellular. HA administrator authentication remains required for its control centre.

## Tailscale — private route used in the tested setup

Each user connects their own iPhone and host in their own tailnet. No shared Alfred application relay or developer server is involved. Tailscale ordinarily uses direct peer-to-peer transport, but can relay end-to-end encrypted WireGuard traffic through DERP when necessary. Its coordination infrastructure remains an external dependency. Do not advertise this as a guarantee that no packets traverse provider infrastructure. [Routing](https://tailscale.com/docs/concepts/traffic-routing-through-tailscale), [encryption](https://tailscale.com/docs/concepts/tailscale-encryption). Speech/model/vendor/push processing are separate boundaries: [privacy guide](PRIVACY.md).

1. Install Tailscale on the host and iPhone and sign into the same tailnet. Enable MagicDNS and HTTPS certificates in the tailnet administration UI if prompted. Keep the iPhone VPN connected while using Alfred away from home.
2. Verify the host can reach the actual HA HTTP endpoint. Note the VM address and port, and reserve the address.
3. For HA on a separate VM/LAN address, the tested architecture is **TLS-terminated TCP forwarding** from the Mac. Substitute your own target:

```sh
tailscale serve --bg --tls-terminated-tcp=443 tcp://HA_VM_ADDRESS:8123
tailscale serve status
```

Use `80` only if your HA service really listens there. This does not publish a Funnel endpoint. On macOS the CLI may be at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`; use your installed variant's CLI.

4. If HA runs on the same host, an HTTP proxy alternative is `tailscale serve --bg http://127.0.0.1:8123`. Current Serve HTTP proxies support loopback targets; do not assume the HTTP proxy form can target an arbitrary VM address. TCP forwarding and HTTP reverse proxying are different modes.
5. Open the reported HTTPS URL on the iPhone, authenticate into HA, then open `/alfred/app/index.html`. Configure the identical origin in Alfred → Glasses & access and in your Even package build.
6. Set tailnet access policy to restrict who can reach the node/443; do not share your personal tailnet with store users or reviewers as an onboarding substitute. Verify cellular, screen lock and restart behaviour.

Source: [Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve). HTTPS certificate issuance makes the node's DNS name observable in certificate infrastructure; it is not a secret, but avoid publishing personal hostnames accidentally.

## Other routes — account/deployment validation required

- **Your own TLS reverse proxy/domain:** configure valid TLS, HA authentication and narrowly scoped trusted proxies if forwarding headers are used. Never trust all networks in HA's HTTP settings. Do not put provider secrets in proxy URLs or static files.
- **Cloud HA host:** use the experimental cloud guide and a private route back to local devices. DNS/discovery broadcasts do not automatically cross the VPN.

No remote route bypasses pairing or entity permissions. Certificate expiry, a disconnected VPN, stale origin, suspended VM and pairing revocation are distinct issues; do not re-pair reflexively for network outages.

Home Assistant Cloud migration is outside the current launch path. Even if another route supplies HTTPS, it does not remove the origin-specific Even package requirement.
