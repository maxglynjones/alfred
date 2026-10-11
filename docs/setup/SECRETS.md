# Where secrets belong

| Value | Configure/store it here | Never put it here |
| --- | --- | --- |
| OpenAI/Anthropic key | HA-authenticated Intelligence setup; private `.storage/alfred.product` | config/product.json, Vite variables, Even app bundle, issues |
| Google/Microsoft client secret and refresh token | OAuth setup and HA private storage | examples, Git history, shared recovery exports |
| Pairing credential | Revocable client storage issued by HA | HA admin token in phone JavaScript |
| Optional router key | Private router.json, mode 600; corresponding HA setting | CLI arguments, committed sample JSON |
| Tailscale credentials | Tailscale's account/client credential storage | Repo, provider configuration, store package |
| VM/HA data | Private persistent storage and encrypted backups | Git checkout or marketing screenshots |

The server origin and registered package ID are deployment metadata, not API credentials. They can still identify a person/server, so keep owner-specific package/deployment files out of the public source. Safe templates use fictional example domains and empty provider defaults.

A blank secret field means “keep configured value”; it never displays the stored secret. Changing a provider does not automatically revoke its key at the provider. Revoke tokens in the relevant account service and remove lost client registrations.

HA's application storage is private through HA access control; it is not a per-field encrypted vault. Protect host disks/backups with your OS/storage controls. Private recovery exports contain credentials. Use a secrets manager for private cloud provisioning where appropriate; never embed values in cloud user-data posted to a public repo.

`pnpm check:public` checks publication candidates, suspicious credential patterns, private artifacts and optional owner-specific denylist values. It does not prove absence of all unknown secrets. Review `git diff --cached`, commit identity, tags, history and screenshots before pushing. Use GitHub secret scanning and private vulnerability reporting where available.
