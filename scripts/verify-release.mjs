import { readFile } from 'node:fs/promises';
const app = JSON.parse(
  await readFile(process.argv[2] ?? new URL('../app.json', import.meta.url), 'utf8'),
);
const errors = [];
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(app.package_id)) errors.push('Invalid package ID');
if (app.edition !== '202601') errors.push('Invalid edition');
if (!app.name || app.name.length > 20 || /even/i.test(app.name))
  errors.push('Invalid display name');
if (!/^\d+\.\d+\.\d+$/.test(app.version)) errors.push('Invalid version');
if (!app.min_sdk_version) errors.push('Missing SDK version');
if (!app.entrypoint) errors.push('Missing entrypoint');
for (const p of app.permissions ?? []) {
  if (!p.desc || p.desc.length > 300) errors.push('Invalid permission description');
  if (
    p.name === 'network' &&
    (!p.whitelist?.length || p.whitelist.some((x) => !/^https:\/\/[^/*]+$/.test(x)))
  )
    errors.push('Configure exact HTTPS origins before packing');
}
console.log(
  errors.length
    ? 'Release manifest blocked: ' + errors.join('; ')
    : 'Manifest static admission checks passed. Hardware, listing, privacy and reviewer access checks remain separate.',
);
process.exitCode = errors.length ? 1 : 0;
