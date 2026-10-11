/** Audit files eligible for publication, not private generated/local artifacts.
 * An optional external denylist adds owner-specific values without committing them.
 * This is a reproducible release guard, not a substitute for reviewing Git history.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const ignored = new Set([
  '.git',
  '.local',
  '.venv',
  '.pnpm-store',
  'node_modules',
  'dist',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
]);
const generated = 'integrations/home-assistant/custom_components/alfred/frontend/app/';
const deniedPath =
  /(?:^|\/)(?:archive|outputs|recordings|research|secrets)(?:\/|$)|\.(?:ehpk|zip|qcow2|xz|utm|pyc|pem|key|pcap|db|log|xlsx)$|(?:^|\/)\.env(?:\.|$)/i;
let candidates;
try {
  candidates = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .split('\0')
    .filter(Boolean);
} catch {
  candidates = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (ignored.has(e.name) || e.name === '.DS_Store') continue;
      const path = join(dir, e.name),
        rel = relative(root, path);
      if (rel.startsWith('public/guides/')) continue;
      if (rel.startsWith(generated) || rel === generated.slice(0, -1)) continue;
      if (rel === 'integrations/home-assistant/alfred-ha.zip') continue;
      if (e.isSymbolicLink()) throw Error('Publication symlink refused: ' + rel);
      if (e.isDirectory()) await walk(path);
      else candidates.push(rel);
    }
  }
  await walk(root);
}
let denylist = [];
if (process.env.ALFRED_PRIVATE_SCAN_FILE)
  denylist = JSON.parse(await readFile(process.env.ALFRED_PRIVATE_SCAN_FILE, 'utf8'));
const patterns = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{25,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{15,}/,
];
// Public repository links can contain a maintainer handle also present in a
// private denylist. Exempt only the declared repository URL from that list;
// credential patterns still inspect the original, unmodified content.
const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const repositoryUrl = packageMetadata.repository?.url
  ?.replace(/^git\+/, '')
  .replace(/\.git$/, '');
const publicRepositoryPattern =
  typeof repositoryUrl === 'string' &&
  /^https:\/\/(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryUrl)
    ? new RegExp(repositoryUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[/.#?\\s)"\x27`])', 'g')
    : null;
const failures = [];
for (const rel of new Set(candidates)) {
  if (
    deniedPath.test(rel) ||
    rel.startsWith(generated) ||
    rel.split('/').some((x) => ignored.has(x))
  ) {
    failures.push(rel + ': private/generated file');
    continue;
  }
  const bytes = await readFile(join(root, rel));
  const text = bytes.toString();
  const privateText = publicRepositoryPattern
    ? text.replace(publicRepositoryPattern, '[public repository]')
    : text;
  if (
    denylist.some(
      (v) => typeof v === 'string' && v.length > 3 && privateText.toLowerCase().includes(v.toLowerCase()),
    ) ||
    patterns.some((p) => p.test(text))
  )
    failures.push(rel + ': sensitive value/pattern');
}
if (failures.length) {
  console.error('Publication blocked:\n' + failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Publication scan passed: ${new Set(candidates).size} source files. Review staged diff/history and private metadata separately.`,
  );
