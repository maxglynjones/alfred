/** Friendly, read-only build prerequisite checks. */
import { spawnSync } from 'node:child_process';
export function checkEnvironment() {
  const major = Number(process.versions.node.split('.')[0]);
  if (![22, 24].includes(major)) throw Error('Use Node 22 or 24. See docs/setup/README.md.');
  const python = spawnSync('python3', ['-c', 'import sys; print("%s.%s" % sys.version_info[:2])'], {
    encoding: 'utf8',
  });
  const [a, b] = String(python.stdout || '')
    .trim()
    .split('.')
    .map(Number);
  if (python.status !== 0 || a !== 3 || b < 12)
    throw Error('Put Python 3.12+ on PATH as python3 before building. See docs/setup/README.md.');
  console.log('Build tools ready: Node ' + major + ', Python ' + a + '.' + b + '.');
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    checkEnvironment();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
