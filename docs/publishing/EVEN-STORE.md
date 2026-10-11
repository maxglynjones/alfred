# Even Hub public submission

Original icons are under `marketing/store`. Maintainers keep contact details, listing copy and legal drafts outside the public repository. Use the currently registered app/package ID for an update; do not replace it with the generic template ID. Use the version in package.json and minimum versions in app.json; do not reuse old release values. This is a maintainer reference. Self-hosters should follow the Even installation guide.

## Important distribution boundary

Alfred currently is **self-hosted and origin-specific**. The public template has no backend whitelist. `configure-deployment.mjs` produces a private manifest/package for one exact HTTPS server origin. The owner package is suitable for that installation/review, not every store user's HA server. It includes endpoint/package metadata but no provider keys or HA admin credentials.

Do not promote a private-tailnet package as a plug-and-play universal public app. Public distribution needs either an approved origin/onboarding mechanism for per-user self-hosting or individual builds. A compulsory developer-operated relay or hosted Alfred service is outside the product direction. Clarify the permitted distribution path with Even; the official build docs establish the permission whitelist/CORS requirements but do not establish approval of Alfred's self-hosting model.

## Prepare the submission

1. Build/test your registered origin-specific package and run the manifest checks. Hardware-test the exact uploaded package, including exit and passive state.
2. Upload under the existing app in the Hub build/version workflow. Beta selection/test invites and public publication review are different states; promoting a test build to beta does not grant public admission.
3. Fill Basic info, category, About, tags and developer/contact fields from your private submission materials. Confirm current portal lengths before submitting.
4. Host your completed privacy/terms/support pages at real publicly reachable URLs. The drafts intentionally have operator/contact/date placeholders. They are not published URLs.
5. Supply genuine current glasses/simulator screenshots and a reviewer route/demo that does not disclose your personal home, inbox, calendar or tailnet. No screenshot or live review account has been fabricated in this repo.
6. Submit for publication review yourself after reviewing platform terms and unresolved distribution/reviewer constraints. Static admission checks do not replace that review.

Official references: [Even build/deploy](https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/build-and-deploy/SKILL.md) and [Even platform terms](https://support.evenrealities.com/hc/en-us/articles/15606676690703-Even-Hub-Developer-Platform-Terms-of-Service).
