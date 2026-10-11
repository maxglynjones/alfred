import { readFile, writeFile, mkdir } from 'node:fs/promises';
// Only public deployment metadata. Credentials never belong in an app package.
const [origin, packageId] = process.argv.slice(2);
if (!origin) {
  console.error(
    'Usage: node scripts/configure-deployment.mjs https://your-ha-https-host [your.package.id]',
  );
  process.exit(1);
}
const url = new URL(origin);
if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  url.port ||
  url.search ||
  url.hash ||
  url.pathname !== '/'
)
  throw Error('Use your private HTTPS Home Assistant origin.');
const root = new URL('..', import.meta.url),
  app = JSON.parse(await readFile(new URL('app.json', root), 'utf8'));
if (packageId) {
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(packageId))
    throw Error('Use your registered Even package ID.');
  app.package_id = packageId;
}
app.permissions.find((p) => p.name === 'network').whitelist = [url.origin];
await mkdir(new URL('.local', root), { recursive: true, mode: 0o700 });
await writeFile(
  new URL('.local/deployment.json', root),
  JSON.stringify({ backendOrigin: url.origin, backendPath: '/alfred' }, null, 2) + '\n',
);
await writeFile(new URL('.local/app.json', root), JSON.stringify(app, null, 2) + '\n');
console.log('Private origin and package whitelist updated. Rebuild and pack before uploading.');
