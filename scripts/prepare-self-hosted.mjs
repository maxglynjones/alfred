/** Local-only packaging: no relay registration, upload or credential collection. */
import { spawnSync } from 'node:child_process';
import { checkEnvironment } from './check-environment.mjs';

const [origin, packageId] = process.argv.slice(2);
if (!origin || !packageId) {
  console.error('Usage: pnpm build:self-hosted HTTPS_ORIGIN YOUR_REGISTERED_PACKAGE_ID');
  process.exit(1);
}
try {
  checkEnvironment();
  new URL(origin);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const root = new URL('../', import.meta.url);
for (const args of [
  ['scripts/configure-deployment.mjs', origin, packageId],
  ['scripts/build-ha.mjs'],
  ['scripts/pack.mjs'],
  ['scripts/verify-release.mjs', '.local/app.json'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  'Built locally. HA installer: integrations/home-assistant/alfred-ha.zip. Even package: .local/packages/alfred-VERSION.ehpk (VERSION is in package.json). Upload through your own registered Hub app. See docs/setup/EVEN.md.',
);
