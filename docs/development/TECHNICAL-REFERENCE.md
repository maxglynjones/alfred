# Technical reference and evidence

Reviewed 11 October 2026 against Alfred 0.20.1. This is a community project exercised primarily on one installation, not a compatibility certification. Use [feature examples](../FEATURES.md) and [setup](../setup/README.md) alongside this record.

## Reference environment

| Item | Record | Evidence scope |
| --- | --- | --- |
| Host | Mac mini M2, 8 GB; macOS 27.0.1 | M2 described by owner; local read-only check returned Mac14,3 and 8,589,934,592 bytes; OS checked |
| HA | HAOS 18.3 in UTM 4.7.5, HA Core 2026.10.0 | Current authenticated version-only reads and local UTM metadata |
| Phone | iPhone 15 Pro | Owner-reported; iOS/Even app current installed versions not independently recorded |
| Glasses/ring | Even G2, R1 | Owner-confirmed use; last reported firmware G2 2.3.2.14 / R1 2.3.2.0007, not re-read during this review |
| Source | Alfred 0.20.1, SDK 0.0.16, evenhub-cli 0.1.14 | package/lock/manifests inspected; stricter app floor 2.2.10 retained; registry floor refresh previously unavailable |
| Build | Node 24.19.0 in this workspace; supported Node 22/24, pnpm 10.18.3, Python 3.12+ | Current toolchain/repository instructions. Not a fresh-machine install |
| Working connections | Tailscale, OpenAI, Google, Hue-connected lighting, Tapo plugs, HA lists and iPhone push | Reference installation and user feedback; no public account/configuration exported |

The source repository is [Alfred on GitHub](https://github.com/maxglynjones/alfred). Measurements below remain historical development evidence; the repository URL does not imply a published binary release or wider compatibility validation. Version numbers are a reference snapshot, not minimum guaranteed hardware firmware. Target versions must be retested.

## Validation categories

| Capability | Code/fixture evidence | Reference-device/account evidence |
| --- | --- | --- |
| Deliberate capture, native text, fade, dashboard and controls | Frontend tests/build; layout/lifecycle fixtures | Used by owner; earlier clipping/stall issues and ongoing hardware validation mean no universal smoothness claim |
| Scoped lighting status/on/off/brightness/colour | Native readback/scope/snapshot tests | Hue/Innr/Tapo-related owner tests; scene effects and cross-fixture optical equality not universally established |
| Selected HA lists and list clear | Native tests including batched all-status clear | Add/show/remove/complete exercised; new bulk-clear tests use fixtures, not destructive owner purges |
| Reminders and HA iPhone push | Durable scheduler/uncertainty tests | Owner confirmed immediate and scheduled push |
| Google mail/calendar and research delivery | Account adapter/tool tests | Google reads/writes and self-delivered reports exercised; account-specific/recurrence restrictions remain |
| Memory/news/weather | Local operation/provider fixtures | Basic flows exercised by owner |
| Routines/plans/broader home domains/Shortcuts | Implementation and bounded fixture checks | Advanced physical workflows need separate validation; shortcut notification is not automatic execution |
| Claude/Microsoft/alternative local models | Implemented adapters/configuration paths | Experimental, not broadly account tested |
| Linux/AWS/Azure/GCP | Deployment guidance | Experimental; not deployed/tested in this reference review |
| R1 battery/health | Identified status parser tests | Battery still conditional on host data; health retrieval unsupported by installed SDK |

On 11 October, 62 frontend tests, 87 native HA fixtures and 12 reminder fixtures passed: 161 total. Generic build also passed. Test-suite runtime is not user-response latency. Fixtures do not boot HA Core or emulate physical BLE. Independent security and fresh-user installation reviews remain valuable.

## Historical latency measurements — release 0.16.2

These are recorded development measurements from the deployed integration, not a new benchmark of 0.20.1. Small samples, uncontrolled background/network load and incomplete runtime/version metadata prevent a rigorous cross-model comparison. Raw private audio/account traces are not published.

| Request/stage | Earlier path | 0.16.2 recorded result |
| --- | ---: | ---: |
| Bathroom lighting status, text | 4,457 ms | 13 ms |
| Shakespeare birth date, text | 8,085 ms | 1,912 ms |
| Einstein birth date, text | Not measured | 1,906 ms |
| Lighting status, synthetic voice | Local speech stage in recent requests: 3,109–5,120 ms | Total server processing: 519 / 552 / 723 ms |

The text status route used current HA state without an LLM. Final factual requests each used one model call and no tools; exact reply model/snapshot was not recorded in the sanitised comparison, so no named-model speed claim is made. Synthetic audio was a 2.5-second English question. Server timing starts at request receipt and excludes microphone recording, ring event detection, transport to HA and glasses rendering. These numbers must not be advertised as hold-to-answer latency.

## Speech and local-model results

| Engine tested in 0.16.2 | Quantisation / setup | Recorded recognition stage | Interpretation |
| --- | --- | --- | --- |
| Local Whisper base | int8, reference HA service | 2,726–2,876 ms | Small synthetic sample; slower than the tested cloud recogniser |
| Local Whisper tiny | int8, explicit English, beam size 1 | Warm 1,832–2,037 ms; first cold 4,013 ms | All transcripts correct in that sample; accent/noise/device-name accuracy unproven |
| OpenAI gpt-4o-mini-transcribe | Hosted API; quantisation not applicable | 513–714 ms in integration requests | Owner approved speed/privacy trade-off; speech is sent externally |
| Optional Qwen3 1.7B intent adapter | Ollama example in provider guide; installed quantisation not recorded here | No reproducible throughput/first-token/memory table available | Do not claim it outperforms rules/cloud or certify tool accuracy |
| General local / Claude reply models | Configurable adapters | Not measured in this review | Implemented does not mean benchmarked |

Whisper is speech recognition, not the assistant's conversational LLM. Resident memory, generation tokens/sec, first-token latency and tool accuracy for general local models were not established by these measurements. Prefer deterministic supported commands; enable the optional interpreter only after representative benchmarks. On an 8 GB host, model and VM memory compete.

## Dashboard, launch and battery measurement plan

No current end-to-end timing comparison exists for basic text dashboard, rich dashboard, first launch or warm refresh. No stock-versus-Alfred battery-life experiment is recorded. The source serialises bridge writes, coalesces stale frames, uses native reply updates and only uploads changed dashboard tiles; this is mechanism evidence, not a physical latency guarantee.

For each installed version, record app/firmware/HA/model/recogniser versions, network type and direct/relay transport. Film 10 cold and 20 warm launches/dashboard switches and voice commands with a visible time reference. Mark gesture release, first readable reply, last tile complete and passive expiry. Export sanitised backend `transcription_ms`, `answer_ms`, model/tool timing and total timing; report median/p95, sample count and errors separately. Compare text and rich layouts under identical conditions. Record whole-day battery use with the same brightness, wear time and interaction count, with stock/Alfred runs; never extrapolate a browser animation rate to glasses FPS or stock battery parity.

## Operating costs in GBP

Actual daily API invoices, audio minutes, search calls and measured wall-plug energy are not available in this launch review. A verified actual £/day total is therefore **not established**. Existing hardware is a sunk cost; new purchases are upfront costs. Independently hosted HA/Alfred has no compulsory Alfred subscription or developer relay charge. Optional cloud/model/provider/network plans have their own prices/eligibility.

The [OpenAI pricing page](https://developers.openai.com/api/docs/pricing) checked on 11 October lists an estimated $0.003/minute for gpt-4o-mini-transcribe. As an illustration only, 100 five-second clips are 8.33 minutes, approximately $0.025 for recognition. Using a deliberately hypothetical £0.80 per US dollar gives about £0.020/day before taxes/fees. This is not an exchange-rate quote or the owner's usage. Reply generation, research/search/tool calls and failed/repeated requests are additional.

Electricity illustration only: a continuously attributable 10 W load at a hypothetical £0.30/kWh costs `10 / 1000 × 24 × 0.30 = £0.072/day`. Neither wattage nor tariff is measured for this Mac. Incremental Alfred power differs from whole-host draw. A local model has no cloud token bill but still consumes compute/energy and may require more hardware.

For a real cost statement, obtain seven days of provider usage by model/tool, billed currency/fees/tax, actual electricity tariff and wall-plug energy with and without the workload. Weather/news need provider terms/rate review, not a blanket free-forever assertion. Shared-relay hosting is hypothetical and not a current Alfred expense. Tailscale plan eligibility/pricing is external and should be checked by each user.
