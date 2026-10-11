// Build generic HA assets separately from the owner-specific Even package.
import { spawnSync } from 'node:child_process';
import { cp, rm, copyFile } from 'node:fs/promises';
import { checkEnvironment } from './check-environment.mjs';
checkEnvironment();
const root = new URL('../', import.meta.url);
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw Error('HA build failed.');
};
run(process.execPath, ['scripts/build-guides.mjs']);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  ...process.env,
  ALFRED_BUILD_GENERIC: '1',
});
const target = new URL('integrations/home-assistant/custom_components/alfred/frontend/app/', root);
await rm(target, { recursive: true, force: true });
await cp(new URL('dist/', root), target, { recursive: true });
for (const name of ['product.json', 'preferences.json', 'tool-routing.json'])
  await copyFile(
    new URL('config/' + name, root),
    new URL('integrations/home-assistant/custom_components/alfred/' + name, root),
  );
run('python3', ['-B', 'scripts/package-ha.py']);
