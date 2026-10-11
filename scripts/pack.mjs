import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = new URL('..', import.meta.url);
const manifest = new URL('.local/app.json', root);
try {
  const app = JSON.parse(await readFile(manifest, 'utf8'));
  const deployment = JSON.parse(await readFile(new URL('.local/deployment.json', root), 'utf8'));
  if (
    !app.permissions.find((p) => p.name === 'network')?.whitelist.includes(deployment.backendOrigin)
  )
    throw Error('Manifest and private backend do not match.');
  // HA's generic build also uses dist. Always rebuild the installed app with its
  // configured exact origin so an HA packaging run cannot produce a broken app.
  const guides = spawnSync(process.execPath, ['scripts/build-guides.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (guides.status !== 0) throw Error('Guide build failed.');
  const buildEnv = { ...process.env, ALFRED_BUILD_GENERIC: '0' };
  for (const args of [
    ['node_modules/typescript/bin/tsc', '--noEmit'],
    ['node_modules/vite/bin/vite.js', 'build'],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: buildEnv,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw Error('Installed-app build failed.');
  }
  await mkdir(new URL('.local/packages', root), { recursive: true, mode: 0o700 });
  const output = new URL(`.local/packages/alfred-${app.version}.ehpk`, root).pathname;
  const result = spawnSync(
    process.execPath,
    [
      new URL('node_modules/@evenrealities/evenhub-cli/main.js', root).pathname,
      'pack',
      manifest.pathname,
      new URL('dist/', root).pathname,
      '-o',
      output,
      '--sdk-ver',
      app.min_sdk_version,
    ],
    { stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(
    error.message +
      ' Configure your own deployment with node scripts/configure-deployment.mjs before packing.',
  );
  process.exitCode = 1;
}
