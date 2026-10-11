// Presentation only: the HA panel keeps authentication, validation and action handlers.
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const newsCatalog = [
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', tag: 'UK · general' },
  { name: 'The Guardian · World', url: 'https://www.theguardian.com/world/rss', tag: 'World' },
  { name: 'NPR · Top stories', url: 'https://feeds.npr.org/1001/rss.xml', tag: 'US · world' },
  { name: 'BBC · World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', tag: 'World' },
  {
    name: 'BBC · Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    tag: 'Technology',
  },
  {
    name: 'BBC · Business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    tag: 'Business',
  },
  {
    name: 'The Guardian · Technology',
    url: 'https://www.theguardian.com/technology/rss',
    tag: 'Technology',
  },
  { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/home.xml', tag: 'UK · world' },
];
export const memoryExamples = [
  'I prefer short answers unless I ask for detail.',
  'I’m vegetarian; suggest meals without meat.',
  'Use Celsius and kilometres.',
  'My usual work hours are 9am to 5pm.',
];
export { uiIcon as deviceIcon } from './icons.js';
import { uiIcon as deviceIcon } from './icons.js';
import { setupReadiness, featureGroups } from './setup-model.js';
// Use HA area IDs as group keys: duplicate room names must not merge devices.
export function homeRooms(inventory = []) {
  const rooms = new Map();
  for (const device of inventory) {
    const key = device.area_id || device.room || '__unassigned__';
    if (!rooms.has(key)) rooms.set(key, { name: device.room || 'Unassigned', devices: [] });
    rooms.get(key).devices.push(device);
  }
  return [...rooms.values()].sort((a, b) =>
    a.name === 'Unassigned' ? 1 : b.name === 'Unassigned' ? -1 : a.name.localeCompare(b.name),
  );
}
export function eventRows(state) {
  return [
    ...(state.activity || []),
    ...(state.history || []).map((x) => ({
      kind: 'conversation',
      title: x.question,
      detail: x.reply,
      created_at: x.created_at,
    })),
    ...(state.actions || []).map((x) => ({
      kind: 'action',
      title: `${x.kind || 'Action'} · ${x.status || 'recorded'}`,
      detail: x.result?.verified
        ? 'Verified by the service.'
        : x.status?.includes('uncertain')
          ? 'Result uncertain. Check the service before repeating.'
          : 'Open Activity in the service for delivery details.',
      created_at: x.created_at,
    })),
  ]
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
    .slice(0, 100);
}
const descriptions = {
  'local-router': [
    'Local command engine',
    'Instant sentence matching, with an optional tiny local interpreter.',
  ],
  'remote-access': [
    'Remote access',
    'Home Assistant Cloud, private VPN or your own HTTPS connection.',
  ],
  providers: ['Intelligence', 'Choose your AI and listening engine. Configure only what you use.'],
  'oauth-google': ['Google', 'Mail and calendar, with your approval.'],
  'oauth-outlook': ['Microsoft Outlook', 'Connect your Microsoft mail and calendar.'],
  'apple-shortcuts': ['Apple shortcuts', 'Music, Focus and your existing iPhone shortcuts.'],
  profile: ['Your profile', 'Address preference, units, location and preferred accounts.'],
  lists: ['List connections', 'Choose existing Home Assistant task and shopping lists.'],
  delivery: ['iPhone notifications', 'Native push through the official HA iPhone app.'],
  news: ['News preferences', 'Select sources and an optional daily digest.'],
  network: ['Private connection', 'Remote access and exact allowed origins.'],
  proactive: ['Quiet updates', 'A daily briefing and selected home alerts.'],
  routine: ['Build manually', 'An alternative to asking Alfred to create a reviewed routine.'],
  schedule: ['Routine schedule', 'Choose a saved home routine, time or sunrise/sunset.'],
  memory: ['Add memory', 'A preference or useful fact you want Alfred to remember.'],
  scope: ['Home permissions', 'Choose the devices Alfred may control.'],
};
function stateLabel(id, c) {
  if (id === 'providers') return c.replyProvider === 'none' ? 'Optional setup' : c.replyProvider;
  if (id.startsWith('oauth-')) return c[id.slice(6)]?.connected ? 'Connected' : 'Optional setup';
  if (id === 'lists') return Object.values(c.haLists || {}).filter(Boolean).length + ' connected';
  if (id === 'news') return (c.newsSources || []).length + ' sources';
  return 'Manage';
}
function modal(root, title, content) {
  const dialog = document.createElement('dialog');
  dialog.className = 'studio-dialog';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<div class="dialog-heading"><h2>${esc(title)}</h2><button type="button" aria-label="Close dialog">✕</button></div><div class="dialog-content"></div><p data-dialog-message role="status"></p>`;
  dialog.querySelector('.dialog-content').append(content);
  root.querySelector('main').append(dialog);
  const close = () => {
    if (dialog.querySelector('form[data-dirty]')) {
      dialog.querySelector('[data-dialog-message]').textContent =
        'Save or cancel your changes before closing.';
      return;
    }
    dialog.close();
  };
  dialog.querySelector('[aria-label="Close dialog"]').onclick = close;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const b = dialog.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)
        close();
    }
  });
  return dialog;
}
function composer(panel, root, example = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p>Describe the outcome. Alfred uses your permitted devices and connected services. Review any proposed changes before approving.</p><form class="studio-ask"><label>Ask Alfred<textarea name="request" rows="3" maxlength="4000" required placeholder="Prepare a bedtime routine that turns my bedroom lights off">${esc(example)}</textarea></label><button>Ask Alfred</button></form><p class="ask-result" role="status"></p><div class="actions" hidden><button data-approve>Yes, proceed</button><button data-decline>No, cancel</button></div>`;
  const dialog = modal(root, 'Ask Alfred', wrap);
  const result = wrap.querySelector('.ask-result'),
    review = wrap.querySelector('.actions');
  let pendingReview = false;
  const ask = async (text) => {
    wrap.querySelectorAll('button').forEach((button) => (button.disabled = true));
    dialog.classList.add('busy');
    result.textContent = 'Alfred is thinking…';
    review.hidden = true;
    try {
      const d = await panel.call('test', { text });
      result.textContent = d.reply;
      review.hidden = !d.pending_review;
      pendingReview = !!d.pending_review;
      panel.state = await panel.call('status');
    } catch (e) {
      result.textContent = e.message;
    } finally {
      wrap.querySelectorAll('button').forEach((button) => (button.disabled = false));
      dialog.classList.remove('busy');
    }
  };
  wrap.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    await ask(new FormData(e.target).get('request'));
  };
  wrap.querySelector('[data-approve]').onclick = () => ask('yes');
  wrap.querySelector('[data-decline]').onclick = () => ask('no');
  dialog.addEventListener(
    'close',
    () => {
      void (async () => {
        try {
          if (pendingReview) await panel.call('test', { text: 'no' });
        } finally {
          await panel.refresh();
        }
      })().catch(() => {});
    },
    { once: true },
  );
  dialog.showModal();
}
export function enhancePanel(panel) {
  const root = panel.shadowRoot,
    s = panel.state,
    c = s.settings;
  const main = root.querySelector('main');
  main.classList.add('studio');
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = `<div><p class="eyebrow">YOUR PERSONAL ASSISTANT</p><h1>${esc({ home: 'Connected home', lists: 'Lists & reminders', memory: 'Memory', connections: 'Connections', activity: 'Activity', routines: 'Routines & plans', help: 'Your Alfred guide' }[panel.view] || panel.view[0].toUpperCase() + panel.view.slice(1))}</h1></div><div class="actions">${panel.view === 'quickstart' ? '<button class="back-home">← Command centre</button>' : '<button class="quickstart-launch">Quick Start</button>'}<button class="ask-launch">Ask Alfred</button><button class="refresh-view" aria-label="Refresh view">↻</button></div>`;
  root.querySelector('nav').after(heading);
  const back = heading.querySelector('.back-home');
  if (back) back.onclick = () => panel.completeQuickStart();
  const quickstart = heading.querySelector('.quickstart-launch');
  if (quickstart)
    quickstart.onclick = () => {
      panel.view = 'quickstart';
      void panel.refresh();
    };
  const check = root.querySelector('#setup-check');
  if (check) check.onclick = () => setupDoctor(panel, root);
  heading.querySelector('.ask-launch').hidden = !['overview', 'quickstart'].includes(panel.view);
  heading.querySelector('.ask-launch').onclick = () => composer(panel, root);
  heading.querySelector('.refresh-view').onclick = () => void panel.refresh();
  if (panel.view === 'memory') {
    const intro = document.createElement('section');
    intro.className = 'memory-intro';
    intro.innerHTML = `<h2>The little things worth remembering.</h2><p>Memory is a small collection of facts and preferences you explicitly save. Alfred includes these in future answers to make them more useful. It is separate from conversation history and does not change device permissions or automatically create reminders.</p><p>Save ordinary preferences rather than passwords or private account credentials. Review, edit or remove them whenever you like.</p><div class="example-grid">${memoryExamples.map((x) => `<button data-example="${esc(x)}">${esc(x)}</button>`).join('')}</div><small>You can also say “Remember that I prefer…” to Alfred.</small>`;
    heading.after(intro);
    intro.querySelectorAll('[data-example]').forEach(
      (b) =>
        (b.onclick = () => {
          const input = root.querySelector('#memory [name=text]');
          input.value = b.dataset.example;
          root.querySelector('[data-setup="memory"]').click();
        }),
    );
  }
  if (panel.view === 'routines') {
    const intro = document.createElement('section');
    intro.innerHTML = `<h2>Describe it. Review it. Make it yours.</h2><p>Ask Alfred to prepare a routine, then approve the preview. Saved routines appear here after refresh. These live inside the Alfred HA integration; they are not entries in HA’s separate Automations editor.</p><button class="routine-ask">Build with Alfred</button>`;
    heading.after(intro);
    intro.querySelector('button').onclick = () =>
      composer(
        panel,
        root,
        'Prepare a bedtime routine using my approved bedroom lights. Ask only for essential missing details.',
      );
    root
      .querySelectorAll('[data-run-routine]')
      .forEach((b) => b.closest('details')?.classList.add('routine-card'));
    root.querySelectorAll('[data-run-routine]').forEach((button) => {
      const routine = s.experiences.routines.find((x) => x.id === button.dataset.runRoutine);
      const pre = button.closest('details')?.querySelector('pre');
      if (!pre || !routine) return;
      const list = document.createElement('ol');
      list.className = 'routine-step-list';
      for (const step of routine.steps) {
        const item = document.createElement('li');
        const args = step.args || {};
        const device = s.inventory.find((x) => x.entity_id === args.entity_id);
        item.textContent =
          step.kind === 'home'
            ? [args.action || 'Control', args.area || device?.name || args.entity_id, args.value]
                .filter((x) => x !== undefined && x !== '')
                .join(' · ')
            : step.kind + ' · ' + (args.title || args.subject || 'Reviewed step');
        list.append(item);
      }
      pre.replaceWith(list);
    });
  }
  if (panel.view === 'lists') {
    const grid = document.createElement('div');
    grid.className = 'list-grid';
    for (const kind of ['shopping', 'tasks']) {
      const data = s.listData?.[kind] || { items: [], error: 'Refresh to load your list.' };
      const section = document.createElement('section');
      section.innerHTML = `<div class="section-heading"><h2>${deviceIcon('todo')}${kind === 'shopping' ? 'Shopping list' : 'To-do list'}</h2><span>${data.total ?? data.items.length} items</span></div>${data.error ? `<p>${esc(data.error)}</p><small>Choose a list connection below; leave unused lists unconfigured.</small>` : `<div class="list-items">${data.items.map((x) => `<label class="list-row ${x.completed ? 'completed' : ''}"><input type="checkbox" data-item="${esc(x.id)}" ${x.completed ? 'checked' : ''}><span>${esc(x.title)}</span></label>`).join('') || '<p class="empty">Nothing here yet. Ask Alfred to add an item.</p>'}</div>${data.more_available ? '<small>Showing the first 100 items. View the complete list in HA To-do lists.</small>' : ''}<form class="quick-add"><input name="title" maxlength="300" required placeholder="Add an item" aria-label="Add ${kind} item"><button>Add</button></form>`}`;
      section.querySelectorAll('[data-item]').forEach(
        (b) =>
          (b.onchange = async () => {
            b.disabled = true;
            try {
              await panel.call('list/edit', {
                kind,
                operation: 'complete',
                id: b.dataset.item,
                completed: b.checked,
              });
              await panel.refresh();
            } catch (e) {
              b.checked = !b.checked;
              b.disabled = false;
              root.querySelector('#status').textContent = e.message;
            }
          }),
      );
      const form = section.querySelector('form');
      if (form)
        form.onsubmit = async (e) => {
          e.preventDefault();
          const button = form.querySelector('button');
          button.disabled = true;
          try {
            await panel.call('list/edit', {
              kind,
              operation: 'add',
              title: new FormData(form).get('title'),
            });
            await panel.refresh();
          } catch (e) {
            root.querySelector('#status').textContent = e.message;
            button.disabled = false;
          }
        };
      grid.append(section);
    }
    heading.after(grid);
    const reminders = s.listData?.reminders?.items || [];
    const reminderCard = document.createElement('section');
    reminderCard.innerHTML = `<div class="section-heading"><h2>Scheduled reminders</h2><span>${reminders.length} active</span></div>${
      reminders
        .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
        .map(
          (x) =>
            `<p><strong>${esc(x.title)}</strong><small>${esc(new Date(x.due_at).toLocaleString())}</small></p>`,
        )
        .join('') || '<p>No scheduled reminders. Say “Remind me in ten minutes to…”</p>'
    }`;
    grid.after(reminderCard);
  }
  if (panel.view === 'activity') {
    const sections = [...main.querySelectorAll(':scope > section')];
    sections.forEach((x) => x.remove());
    const section = document.createElement('section');
    section.className = 'timeline';
    const rows = eventRows(s);
    section.innerHTML = `<div class="section-heading"><h2>A clear record</h2><span>Latest ${rows.length} events</span></div><p>Conversations, action receipts and configuration changes. “Accepted” means the provider accepted the request; it does not promise delivery. Configuration events record field names, never secret values.</p>${rows.map((x) => `<article class="event-row" data-kind="${esc(x.kind)}"><span class="event-dot"></span><div><div class="event-meta"><span>${esc(x.kind)}</span><time>${esc(x.created_at ? new Date(x.created_at).toLocaleString() : 'Earlier')}</time></div><strong>${esc(x.title)}</strong>${x.detail ? `<details><summary>Details</summary><p>${esc(x.detail)}</p></details>` : ''}</div></article>`).join('') || '<p>No events yet. Future conversations and settings changes appear here.</p>'}`;
    heading.after(section);
  }
  if (panel.view === 'help') {
    const guide = document.createElement('section');
    guide.className = 'setup-guide-link';
    guide.innerHTML =
      '<h2>From empty setup to your first request</h2><p>Build tools, Home Assistant, HTTPS, your Even package and pairing. Each step has an expected result.</p><a class="button-link primary" href="/alfred/app/guides/README.html" target="_blank" rel="noopener noreferrer">Open installation guide</a><p><a href="/alfred/app/guides/index.html" target="_blank" rel="noopener noreferrer">All guides</a></p>';
    main.append(guide);
    const operating = main.querySelector(':scope > section');
    const recovery = operating?.nextElementSibling;
    if (operating) {
      const paragraphs = [...operating.querySelectorAll('p')];
      const titles = [
        'Glasses controls',
        'Connection & pairing',
        'Lists, reminders and personal services',
        'Apple shortcuts and access',
        'Beta & hardware limitations',
      ];
      const cards = document.createElement('div');
      cards.className = 'help-grid';
      paragraphs.forEach((p, i) => {
        const details = document.createElement('details');
        details.className = 'help-card';
        details.innerHTML = `<summary>${esc(titles[i] || 'More help')}</summary>`;
        details.append(p);
        cards.append(details);
      });
      operating.replaceChildren(cards);
    }
    if (recovery) recovery.classList.add('recovery-card');
  }
  // Secret fields report presence without ever putting a stored secret into the DOM.
  root.querySelectorAll('input[type=password]').forEach((input) => {
    let key = input.name;
    const provider = input.closest('form')?.id.replace('oauth-', '');
    if (['google', 'outlook'].includes(provider)) key = provider + '.' + key;
    input.placeholder = c.credentialStatus?.[key]
      ? 'Configured · leave blank to keep'
      : 'Not configured';
  });
  root
    .querySelectorAll('form[id^=oauth-] input[name=clientId]')
    .forEach(
      (input) =>
        (input.placeholder = c.credentialStatus?.[input.closest('form').id.slice(6) + '.clientId']
          ? 'Configured · leave blank to keep'
          : 'OAuth client ID'),
    );
  if (panel.view === 'home')
    root.querySelectorAll('[name=entity]').forEach((input) => {
      const x = s.inventory.find((x) => x.entity_id === input.value);
      if (!x) return;
      const span = input.nextElementSibling;
      span.insertAdjacentHTML(
        'afterbegin',
        `<span class="device-icon">${deviceIcon(x.domain)}</span>`,
      );
      if (x.manufacturer)
        span.insertAdjacentHTML(
          'beforeend',
          `<span class="brand-tag">${esc(x.manufacturer)}</span>`,
        );
    });
  if (panel.view === 'news') {
    const check = root.querySelector('#news-check'),
      result = root.querySelector('#news-result');
    if (check && result)
      check.onclick = async () => {
        check.disabled = true;
        result.textContent = 'Reading your sources…';
        try {
          const data = await panel.call('news');
          result.replaceChildren();
          for (const item of data.items || []) {
            const article = document.createElement('article');
            article.className = 'news-article';
            const title = document.createElement('strong');
            title.textContent = item.title || 'Untitled';
            article.append(title);
            const source = document.createElement('small');
            source.textContent = item.source || '';
            article.append(source);
            try {
              const url = new URL(item.url || item.link);
              if (url.protocol === 'https:') {
                const link = document.createElement('a');
                link.href = url.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Read article ↗';
                article.append(link);
              }
            } catch {}
            result.append(article);
          }
          if (!result.children.length)
            result.textContent = 'No headlines available. Review your selected sources.';
          for (const failure of data.errors || []) {
            const p = document.createElement('p');
            p.textContent = failure.source + ': ' + failure.error;
            result.append(p);
          }
        } catch (e) {
          result.textContent = e.message;
        } finally {
          check.disabled = false;
        }
      };
    const textarea = root.querySelector('[name=sources]');
    const label = textarea.closest('label');
    const choices = document.createElement('div');
    choices.className = 'source-picker';
    choices.innerHTML = `<h3>Choose your sources</h3><p>No sources are selected for new users. You can combine these with your own feeds.</p>${newsCatalog.map((x, i) => `<label><input type="checkbox" data-source="${i}" ${(c.newsSources || []).some((y) => y.url === x.url) ? 'checked' : ''}><span><strong>${esc(x.name)}</strong><small>${esc(x.tag)}</small></span></label>`).join('')}`;
    label.before(choices);
    const custom = (c.newsSources || []).filter((x) => !newsCatalog.some((y) => y.url === x.url));
    textarea.value = custom.map((x) => x.name + ' | ' + x.url).join('\n');
    const details = document.createElement('details');
    details.innerHTML = '<summary>Custom feeds · advanced</summary>';
    label.before(details);
    details.append(label);
    textarea.hidden = true;
    const customEditor = document.createElement('div');
    customEditor.innerHTML =
      '<p>Add another public RSS or Atom feed.</p><div class="custom-feed-rows"></div><button type="button">Add custom source</button>';
    const rows = customEditor.querySelector('.custom-feed-rows');
    const addFeed = (feed = {}) => {
      if (rows.children.length >= 16) return;
      const row = document.createElement('div');
      row.className = 'custom-feed-row';
      row.innerHTML = `<label>Name<input class="feed-name" value="${esc(feed.name || '')}" maxlength="80" placeholder="My news source"></label><label>HTTPS feed URL<input class="feed-url" value="${esc(feed.url || '')}" placeholder="https://…/rss"></label><button type="button">Remove</button>`;
      row.querySelector('button').onclick = () => row.remove();
      rows.append(row);
    };
    custom.forEach(addFeed);
    customEditor.querySelector(':scope > button').onclick = () => addFeed();
    details.append(customEditor);
    const form = textarea.closest('form');
    const previous = form.onsubmit;
    form.onsubmit = async (e) => {
      const raw = [...rows.children]
        .map((row) => ({
          name: row.querySelector('.feed-name').value.trim(),
          url: row.querySelector('.feed-url').value.trim(),
        }))
        .filter((x) => x.name || x.url)
        .map((x) => x.name + ' | ' + x.url)
        .join('\n');
      const selected = [...choices.querySelectorAll('input:checked')].map(
        (x) => newsCatalog[Number(x.dataset.source)],
      );
      textarea.value = [...selected.map((x) => x.name + ' | ' + x.url), raw]
        .filter(Boolean)
        .join('\n');
      try {
        await previous(e);
      } finally {
        textarea.value = raw;
      }
    };
  }
  // Each feature opens one dialog. Related forms use disclosures inside it.
  for (const form of root.querySelectorAll('form')) {
    if (!descriptions[form.id]) continue;
    const section = form.closest('section');
    if (!section) continue;
    const [title, description] = descriptions[form.id];
    const disclosure = document.createElement('details');
    disclosure.className = 'configuration-block';
    disclosure.open = ['providers', 'profile'].includes(form.id);
    disclosure.innerHTML = `<summary><span>${esc(title)}</span><span class="badge">${esc(stateLabel(form.id, c))}</span></summary><p>${esc(description)}</p>`;
    section.before(disclosure);
    disclosure.append(section);
    section.classList.add('configuration-body');
    // Preserve all original action/form handlers when moving the section.
    form.querySelector('button:not([type=button])')?.classList.add('primary');
  }
  if (panel.view === 'home') {
    const grid = document.createElement('div');
    grid.className = 'home-rooms';
    grid.innerHTML =
      homeRooms(s.inventory)
        .map(
          (room) =>
            `<section class="room-section"><div class="section-heading"><h2>${esc(room.name)}</h2><span>${room.devices.length} devices · ${room.devices.filter((x) => x.approved).length} permitted</span></div><div class="home-grid">${room.devices
              .map(
                (x) =>
                  `<article class="device-card"><div class="section-heading"><span class="device-icon">${deviceIcon(x.domain)}</span><span class="badge">${x.approved ? 'Permitted' : 'Not permitted'}</span></div><h3>${esc(x.name)}</h3><div class="device-meta"><span>${esc(x.state)}</span>${x.manufacturer ? `<span class="brand-tag">${esc(x.manufacturer)}</span>` : ''}</div></article>`,
              )
              .join('')}</div></section>`,
        )
        .join('') ||
      '<section>No devices discovered yet. Add integrations in HA → Devices & services.</section>';
    heading.after(grid);
  }
  const workbench = document.createElement('div');
  workbench.className = 'workbench';
  [...main.children]
    .filter((x) => !x.matches('header,nav,dialog,.page-heading'))
    .forEach((x) => workbench.append(x));
  main.append(workbench);
  root.querySelector('nav').hidden = true;
  heading.querySelector('h1').textContent =
    panel.view === 'quickstart' ? 'Set up your Alfred.' : 'Your Alfred.';
  heading.querySelector('.eyebrow').textContent = 'ALFRED · COMMAND CENTRE';
  const directory = featureDirectory(panel, root);
  if (panel.view !== 'quickstart') {
    heading.after(directory);
    heading.after(healthStrip(panel, root));
  }
  if (panel.view !== 'overview' && panel.view !== 'quickstart') {
    const content = document.createElement('div');
    content.className = 'feature-content';
    while (workbench.firstChild) content.append(workbench.firstChild);
    workbench.remove();
    const feature = modal(
      root,
      {
        connections: 'Intelligence & accounts',
        home: 'Connected home',
        lists: 'Lists & reminders',
        devices: 'Glasses & access',
      }[panel.view] || panel.view[0].toUpperCase() + panel.view.slice(1),
      content,
    );
    feature.classList.add('feature-dialog');
    feature.addEventListener(
      'close',
      () => {
        const previous = panel.view;
        panel.view = panel.returnView || 'overview';
        panel.returnView = undefined;
        void panel
          .refresh()
          .then(() => panel.shadowRoot.querySelector(`[data-feature="${previous}"]`)?.focus());
      },
      { once: true },
    );
    feature.showModal();
  }
  if (panel.view === 'overview') {
    [...workbench.children].filter((x) => !x.matches('.page-heading')).forEach((x) => x.remove());
    const samples = s.performance || [];
    const durations = samples.map((x) => x.total_ms).sort((a, b) => a - b);
    const card = document.createElement('section');
    const ms = (fraction) =>
      durations.length
        ? (
            durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))] /
            1000
          ).toFixed(2) + ' s'
        : 'Awaiting requests';
    card.innerHTML = `<div class="section-heading"><h2>Response performance</h2><span>Last ${samples.length} requests · this HA session</span></div><div class="performance-grid"><div><strong>${ms(0.5)}</strong><small>Median backend response</small></div><div><strong>${ms(0.95)}</strong><small>95th percentile</small></div>${['rules', 'local_model', 'cloud'].map((route) => `<div><strong>${samples.filter((x) => x.route === route).length}</strong><small>${{ rules: 'Direct commands', local_model: 'Tiny interpreter', cloud: 'Configured AI' }[route]}</small></div>`).join('')}</div><p>Backend timings include speech recognition when used. Glasses transport and reading time are separate. No extra transcripts are recorded for these measurements.</p>`;
    const diagnostics = document.createElement('details');
    diagnostics.className = 'diagnostics';
    diagnostics.innerHTML = '<summary>Response diagnostics</summary>';
    diagnostics.append(card);
    workbench.append(diagnostics);
    const footer = document.createElement('div');
    footer.className = 'utility-actions';
    footer.innerHTML =
      '<button data-feature="activity">Activity</button><button data-feature="help">Help & setup</button>';
    footer.querySelectorAll('button').forEach(
      (b) =>
        (b.onclick = () => {
          panel.view = b.dataset.feature;
          void panel.refresh();
        }),
    );
    workbench.prepend(footer);
  }
}

function featureDirectory(panel, root) {
  const directory = document.createElement('div');
  directory.className = 'feature-directory';
  for (const group of featureGroups(panel.state)) {
    const section = document.createElement('div');
    section.className = 'feature-group' + (group.title === 'Everyday' ? ' everyday-group' : '');
    section.innerHTML = `<h2>${esc(group.title)}</h2><div class="feature-grid">${group.items.map((x) => `<button class="feature-tile" data-feature="${x.id}"><span class="tile-top"><span class="tile-icon">${deviceIcon(x.id === 'home' ? 'light' : x.id === 'lists' ? 'todo' : x.id)}</span><span class="badge ${x.state === 'Configured' ? 'ready' : ''}">${esc(x.state)}</span></span><strong>${esc(x.title)}</strong><span class="tile-description">${esc(x.summary)}</span></button>`).join('')}</div>`;
    directory.append(section);
  }
  directory.querySelectorAll('[data-feature]').forEach(
    (b) =>
      (b.onclick = () => {
        panel.view = b.dataset.feature;
        void panel.refresh();
      }),
  );
  return directory;
}
function healthStrip(panel, root) {
  const strip = document.createElement('section');
  strip.className = 'health-strip';
  const next = setupReadiness(panel.state).find((x) => !x.ready && !x.manual);
  strip.innerHTML = `<div><span class="status-dot"></span><strong>Home Assistant connected</strong><small>${next ? esc(next.detail) : 'Core configuration saved. Check the installed package and glasses on iPhone.'}</small></div><button>${next ? 'Continue setup' : 'Check setup'}</button>`;
  strip.querySelector('button').onclick = () => setupDoctor(panel, root);
  return strip;
}
function setupDoctor(panel, root) {
  const body = document.createElement('div');
  const rows = setupReadiness(panel.state);
  body.innerHTML = `<p>Read-only configuration checks. Provider configuration is not a live service test.</p><div class="readiness-list">${rows.map((x) => `<div class="readiness-row"><div><strong>${esc(x.title)}</strong><small>${esc(x.detail)}</small></div><span class="badge ${x.ready ? 'ready' : ''}">${esc(x.state)}</span></div>`).join('')}</div><p>Check on iPhone: open your HTTPS address on cellular, install the current package, then hold to speak. These cannot be verified from this browser.</p><label><input type="checkbox" id="cellular-checked"> I verified cellular access</label><label><input type="checkbox" id="package-checked"> I installed my current Even package</label><button class="download-setup">Download setup summary</button><p data-setup-result role="status"></p>`;
  const dialog = modal(root, 'Setup checks', body);
  const key = 'alfred-setup-checks-' + (panel._hass.user?.id || 'local');
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) || '{}');
  } catch {}
  body.querySelectorAll('input').forEach((input) => {
    input.checked = !!saved[input.id];
    input.onchange = () => {
      saved[input.id] = input.checked;
      try {
        localStorage.setItem(key, JSON.stringify(saved));
      } catch {
        body.querySelector('[data-setup-result]').textContent =
          'This browser cannot save your checklist.';
      }
    };
  });
  body.querySelector('.download-setup').onclick = () => {
    const origin = panel.state.settings.publicOrigin || 'https://YOUR_HA_ORIGIN';
    const text = `Alfred setup summary\nVersion: ${panel.state.version}\nHTTPS origin: ${origin}\nCompanion: ${origin}/alfred/app/index.html\n\nBuild on your computer from the repository root:\npnpm build:self-hosted ${origin} YOUR_REGISTERED_PACKAGE_ID\n\nEven package: .local/packages/alfred-${panel.state.version}.ehpk\nHA installer: integrations/home-assistant/alfred-ha.zip\n\n${rows.map((x) => x.title + ': ' + x.state).join('\n')}\n\nNo credentials are included. The hostname may identify your private deployment; share deliberately.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alfred-setup.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  dialog.showModal();
}
