# Simpler independent packaging: proposal

This is a design proposal, not a shipped universal installer. The current reproducible command is `pnpm build:self-hosted HTTPS_ORIGIN YOUR_REGISTERED_PACKAGE_ID`; it generates local deployment metadata, builds the HA installer/frontend, packs an Even bundle and runs static checks. See [installation](../setup/EVEN.md).

## Why changing the manifest alone is insufficient today

`src/backend.ts` reads the bundled `__ALFRED_BACKEND_ORIGIN__`, supplied by Vite from ignored deployment metadata. `pack.mjs` deliberately rebuilds before packing to prevent accidental reuse of generic HA assets. Updating only `permissions.network.whitelist` would leave the frontend calling the old address. The HA-generic companion instead uses its serving origin. These are separate outputs.

## Proposed implementation

1. Ship reproducible, versioned prebuilt client assets with source/checksums and third-party notices. Keep a source-build route for contributors.
2. Replace the compile-time-only endpoint with a small local package configuration file loaded before any private request. Accept only validated standard-port HTTPS origins, registered package IDs and supported metadata; reject credentials/paths/query strings. No token/API secret belongs in this file.
3. A local packaging tool copies the verified prebuilt assets, writes deployment metadata and generates `app.json` with exactly the same origin. Verify the paired-client code cannot select a different unlisted endpoint through ordinary UI.
4. Invoke the official Even CLI packer with the pinned SDK version and verify archive contents, asset checksums, manifest minimums and destination consistency. Still upload through the user's own registered app/test workflow; no unsupported automatic Hub submission API is assumed.
5. Add mismatch, stale-origin, invalid-ID and fresh-install regressions. Hardware-test the generated package before calling it ready. Backend and client versions need compatibility checks.

This can remove repeated TypeScript compilation, but the official CLI still requires a supported Node environment unless Even provides a simpler approved installer. An HA download button could later generate the configuration/artifact, but running Node/CLI tooling inside HA Core is not desirable. A local helper or separately packaged build tool is preferable; it must not create an unauthenticated remotely reachable packaging service.

## Options and trade-offs

| Option | Fits arbitrary self-hosted origins? | Status |
| --- | --- | --- |
| Universal bundle with an editable URL | Not under current documented whitelist rules | Unsupported assumption |
| Per-installation package with automated generation | Yes, one permitted origin per package | Current source-build path; prebuilt-assets variant proposed |
| Fixed shared relay origin | Architecturally viable with multi-user isolation, authentication, operating costs and privacy design | Not implemented and outside the chosen independent-hosting direction; need not depend on the author's Mac |
| User-consented runtime origins approved by Even | Could enable a universal package with independent hosts | Preferred platform enhancement, not an existing API |

Home Assistant Cloud HTTPS does not itself authorise each user's origin in Even. It is outside this launch's migration scope. Wildcards accepted by a CLI parser are not proof of released runtime support or review approval. [Official networking](https://hub.evenrealities.com/docs/build/networking), [open runtime issue](https://github.com/even-realities/evenhub-templates/issues/1).
