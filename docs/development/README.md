# Developer quick start

Use Node 22/24, pnpm 10.18.3 and Python 3.12+. Production runs in Home Assistant. Vite is for development only.

```sh
pnpm install --frozen-lockfile
pnpm dev
# Open http://127.0.0.1:5173/?preview=1
```

Sample preview performs no account/home writes. Live-device testing requires a private backend, pair registration and deliberate developer-origin/network configuration. Do not test arbitrary mutations against somebody's home.

```sh
pnpm build
pnpm test
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
pnpm pack:ha
.venv/bin/python -B tests/ha-native-runtime.py
.venv/bin/python -B tests/ha-reminder-engine.py
pnpm check:public
```

`pack:ha` compiles the generic phone frontend and copies canonical product/preference/routing JSON into the deployable integration. The HA archive includes static assets and Python source, not the Node toolchain. The generated frontend directory and zip are ignored by Git. Canonical runtime JSON mirrors are kept readable in the integration; build updates them when root config changes.

`node scripts/configure-deployment.mjs https://your-node.example.ts.net com.yourorganisation.alfred` generates your ignored deployment metadata. `pnpm pack` rebuilds the frontend for that origin and emits an ignored `.ehpk`. Never commit the owner-specific dist or package.

## Where to make a change

- A new voice command: rules/resolution in `commands.py` or `local_ops.py`; service verification in `home.py`; regression in `tests/ha-native-runtime.py`.
- A new provider: `providers.py` and provider-facing schemas/selection in `assistant.py`; configuration validation in `web.py`; panel fields and guide.
- A new tool: `tool_contracts.json`, dispatch/validation, explicit permission checks and failure receipts. Never let a model choose arbitrary URLs/services.
- Display/gesture: `src/display`, `src/state/gestures.ts`, `src/main.ts`; tests for layout, coalescing, expiry and physical retest.
- Command centre: `frontend/panel.js`, `frontend/quick-start.js`, `public/studio/operations.js/css`; shared web tokens/icons are in `public/studio/design-system.css` and `icons.js`, readiness presentation in `setup-model.js`; preserve form handlers, secret masking and accessible dialogs.
- Email presentation: `email_format.py`; safe MIME/Graph assembly in `providers.py`. HTML must not trust model/mail markup.
- Defaults/catalogue: root `config/*.json`, then regenerate the deployable mirrors. Leave all accounts/secrets disabled/empty by default.

Python tests provide minimal HA fixtures rather than starting HA Core; import API compatibility and service behaviour still need a real supported HA installation. The GitHub CI workflow runs build, tests, packaging and source audit; it does not flash hardware, deploy accounts or send emails.

## Formatting and release

Run `pnpm format` and `.venv/bin/python -m black integrations/home-assistant/custom_components/alfred scripts tests`. Keep public docs about current behaviour; do not add personal transcripts, deployment notes or old design experiments. Archive those outside the repo. Use [release checks](../publishing/RELEASE-CHECKLIST.md) before tagging.

## Embedded guides and release assets

`pnpm build:guides` renders canonical setup Markdown into ignored `public/guides/`. HA and Even builds embed these pages locally; update the source docs, not generated HTML. Raw HTML is escaped; scripts/unsafe links are not accepted by the small renderer.

The published-release workflow builds a generic HA ZIP and source archive only after a maintainer publishes a version-matched GitHub release. It does not upload to Even or create a universal package. Until that workflow has actually run, direct users to building from source.

## Evidence and extension boundaries

Use the [feature catalogue](../FEATURES.md) to explain prerequisites, the [technical reference](TECHNICAL-REFERENCE.md) for measured-versus-unmeasured claims, and [engineering decisions](ENGINEERING.md) for the reason behind scope/receipt/rendering constraints. [Prebuilt packaging](PACKAGING.md) is a proposal: current origin selection remains compiled into the installed client. [Platform recommendations](EVEN-RECOMMENDATIONS.md) are not implemented APIs.

Useful debugging order: preview/UI → fixtures → reviewed build → isolated HA test → real installed glasses. `runtime.py` records bounded backend transcription/answer/model/tool timings; those exclude actual microphone capture and BLE display completion. Compare warm/cold runs and errors, not a single favourable request. Never publish raw transcript/history/account exports as benchmark data.
