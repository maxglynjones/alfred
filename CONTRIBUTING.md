# Contributing

Read the architecture and developer guide first. Keep changes small and keep credentials out of examples, tests, issues and commits. Report private security findings using the repository owner's private contact/private vulnerability reporting once enabled; do not file exploitable details publicly.

Run the frontend build/tests, both Python suites, public-source audit and relevant feature checks. Use sample-data preview for UI work. Device-changing tests should use isolated fixtures or explicitly disposable devices; do not run them against someone's home by default.

Format TypeScript/JavaScript with Prettier and Python with Black. Explain why a non-obvious boundary exists, rather than commenting every line. Preserve named types, bounded operations, explicit receipt verification and separate provider adapters. Tests should prove meaningful behaviour, especially ambiguity, timeout, scope, recovery and unsuccessful readback.

Do not add generic arbitrary-service execution, credentials in bundles, automatic retries of uncertain sends, unbounded model jobs, global device access or always-on microphone capture. Retain reduced-motion, keyboard focus and dialog dismissal paths. Vendor integrations remain maintained HA dependencies; Alfred should not duplicate their protocols.

Before a public tag, complete docs/publishing/RELEASE-CHECKLIST.md. New provider/model/hardware support starts as experimental until its exact setup is tested. Include practical limitations rather than implying all accounts/hardware behave alike.
