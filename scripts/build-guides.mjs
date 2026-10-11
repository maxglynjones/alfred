/** Embed the public setup guides locally. No hosted Alfred service or markdown runtime. */
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url),
  target = new URL('public/guides/', root);
const escape = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function inline(text, resolveLink) {
  return escape(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      if (!/^https:\/\//.test(url) && !/^[A-Za-z0-9./_-]+\.md$/.test(url)) return label;
      const href = !url.startsWith('https:') && url.endsWith('.md') ? resolveLink(url) : url;
      if (!href) return label;
      return `<a href="${href}"${url.startsWith('https:') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
export function renderGuide(
  markdown,
  resolveLink = (url) => url.split('/').at(-1).replace('.md', '.html'),
) {
  const lines = markdown.split('\n');
  let html = '',
    paragraph = [],
    list = '',
    code = null,
    table = [];
  const flush = () => {
    if (paragraph.length) {
      html += `<p>${inline(paragraph.join(' '), resolveLink)}</p>`;
      paragraph = [];
    }
    if (list) {
      html += `</${list}>`;
      list = '';
    }
    if (table.length) {
      const rows = table.filter((l) => !/^\|[\s:|-]+\|$/.test(l));
      html +=
        '<div class="table-wrap"><table>' +
        rows
          .map(
            (line, i) =>
              '<tr>' +
              line
                .split('|')
                .slice(1, -1)
                .map(
                  (cell) =>
                    `<${i ? 'td' : 'th'}>${inline(cell.trim(), resolveLink)}</${i ? 'td' : 'th'}>`,
                )
                .join('') +
              '</tr>',
          )
          .join('') +
        '</table></div>';
      table = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code !== null) {
        html += '<pre><code>' + escape(code.join('\n')) + '</code></pre>';
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (line.startsWith('|')) {
      if (!table.length) flush();
      table.push(line);
      continue;
    }
    if (table.length) flush();
    const heading = line.match(/^(#{1,4})\s+(.+)/),
      item = line.match(/^(?:([-*]) |(\d+)\. )(.+)/);
    if (heading) {
      flush();
      html += `<h${heading[1].length}>${inline(heading[2], resolveLink)}</h${heading[1].length}>`;
    } else if (item) {
      if (paragraph.length) {
        html += `<p>${inline(paragraph.join(' '), resolveLink)}</p>`;
        paragraph = [];
      }
      const kind = item[2] ? 'ol' : 'ul';
      if (list !== kind) {
        if (list) html += `</${list}>`;
        html += `<${kind}>`;
        list = kind;
      }
      html += '<li>' + inline(item[3], resolveLink) + '</li>';
    } else if (!line.trim()) flush();
    else {
      if (list) {
        html += `</${list}>`;
        list = '';
      }
      paragraph.push(line);
    }
  }
  flush();
  if (code) html += '<pre><code>' + escape(code.join('\n')) + '</code></pre>';
  return html;
}
/** Resolve against the source file, not its basename; README names can collide. */
export function guideLink(source, link, outputs) {
  const path = new URL(link, 'https://guides.invalid/' + source).pathname.slice(1);
  return outputs.get(path);
}
export async function buildGuides() {
  await mkdir(target, { recursive: true });
  const docs = new URL('docs/setup/', root),
    names = (await readdir(docs)).filter((x) => x.endsWith('.md'));
  const sources = [
    ...names.map((name) => 'docs/setup/' + name),
    'docs/FEATURES.md',
    'docs/development/README.md',
    'docs/development/ARCHITECTURE.md',
    'docs/development/TECHNICAL-REFERENCE.md',
    'docs/development/ENGINEERING.md',
    'docs/development/PACKAGING.md',
    'docs/development/EVEN-RECOMMENDATIONS.md',
    'docs/publishing/EVEN-STORE.md',
    'docs/publishing/RELEASE-CHECKLIST.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'marketing/community/diagrams/README.md',
  ];
  const outputs = new Map(
    sources.map((source) => [
      source,
      (source.startsWith('docs/setup/')
        ? source.split('/').at(-1)
        : source.replaceAll('/', '-')
      ).replace('.md', '.html'),
    ]),
  );
  const shell = (title, content) =>
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Alfred</title><link rel="stylesheet" href="../studio/design-system.css"><style>body{margin:0;padding:24px 18px;font-size:15px}main{max-width:850px;margin:auto}header{display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:28px}header img{width:32px}h1{font-size:28px}h2{margin-top:32px}li{line-height:1.7;margin:8px 0;color:var(--muted)}pre{padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:auto}code{font:13px ui-monospace,monospace}td,th{text-align:left;border-bottom:1px solid var(--line);padding:12px;vertical-align:top}table{border-collapse:collapse;width:100%}.table-wrap{overflow:auto}nav{display:flex;gap:12px;flex-wrap:wrap}footer{border-top:1px solid var(--line);padding:20px 0;margin-top:32px;font-size:12px}</style><main><header><img src="../assets/alfred-icon.svg" alt=""><strong>alfred guides</strong></header><nav><a class="button-link" href="../index.html">Alfred Home</a><a class="button-link" href="index.html">All guides</a></nav><article>${content}</article><footer>Independent and self-hosted. Guides are bundled with your installation; no Alfred account is required.</footer></main></html>`;
  const entries = [];
  for (const source of sources) {
    const name = outputs.get(source);
    const content = await readFile(new URL(source, root), 'utf8');
    const title = content.match(/^# (.+)/)?.[1] || name;
    entries.push({ name, title, setup: source.startsWith('docs/setup/') });
    await writeFile(
      new URL(name, target),
      shell(
        title,
        renderGuide(content, (link) => guideLink(source, link, outputs)),
      ),
    );
  }
  await writeFile(
    new URL('index.html', target),
    shell(
      'Start here',
      `<h1>Set up your Alfred.</h1><p>Begin with the complete installation guide. You can add optional connections later.</p><p><a class="button-link primary" href="README.html">Start from scratch</a></p><ul>${entries
        .filter((x) => x.setup && x.name !== 'README.html')
        .map((x) => `<li><a href="${x.name}">${escape(x.title)}</a></li>`)
        .join('')}</ul><h2>Understand and contribute</h2><ul>${entries
        .filter((x) => !x.setup)
        .map((x) => `<li><a href="${x.name}">${escape(x.title)}</a></li>`)
        .join('')}</ul>`,
    ),
  );
  console.log('Built local setup guides.');
}
if (process.argv[1] === new URL(import.meta.url).pathname) await buildGuides();
