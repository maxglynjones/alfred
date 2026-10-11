import { quickStartPage } from './quick-start.js?v=0.20.2';
import { enhancePanel } from './app/studio/operations.js?v=0.20.2';
import { providerVisibility } from './app/studio/setup-model.js?v=0.20.2';
// One HA-authenticated administration surface. No credentials in static bundles.
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
class AlfredPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.view = 'overview';
    this.loaded = false;
  }
  set hass(h) {
    this._hass = h;
    if (!this.loaded) {
      this.loaded = true;
      this.refresh();
    }
  }
  completeQuickStart() {
    try {
      localStorage.setItem('alfred-quickstart-' + (this._hass.user?.id || 'local'), 'seen');
    } catch {
      /* Browsers may disable persistent storage; navigation must still work. */
    }
    this.view = 'overview';
    this.returnView = undefined;
    void this.refresh();
  }
  async call(action, args = {}) {
    const d = await this._hass.callApi('POST', 'alfred/manage', { action, args });
    if (d.error) throw Error(d.error);
    return d;
  }
  async refresh(force = false) {
    if (!force && this.shadowRoot.querySelector('form[data-dirty]')) {
      this.view = this.renderedView || this.view;
      const message = this.shadowRoot.querySelector('dialog[open] [data-dialog-message], #status');
      if (message)
        message.textContent = 'Save or cancel your changes before leaving or refreshing.';
      return;
    }
    // Preserve other unsaved sections after saving a different form. Drafts are
    // in-memory only; typed credentials never enter localStorage or server logs.
    const drafts = [...this.shadowRoot.querySelectorAll('form[id][data-dirty]')].map((form) => ({
      id: form.id,
      fields: [...form.elements]
        .filter((field) => field.name && field.type !== 'file')
        .map((field) => ({
          name: field.name,
          value: field.value,
          checked: field.checked,
          selected: field.multiple ? [...field.selectedOptions].map((x) => x.value) : null,
        })),
    }));
    try {
      this.state = await this.call('status');
      const key = 'alfred-quickstart-' + (this._hass.user?.id || 'local');
      if (!this.quickstartChecked) {
        this.quickstartChecked = true;
        try {
          if (!localStorage.getItem(key)) this.view = 'quickstart';
        } catch {
          /* Storage may be unavailable; navigation still works. */
        }
      }
      if (this.view === 'lists') this.state.listData = await this.call('lists');
      this.render();
      for (const draft of drafts) {
        const form = this.shadowRoot.querySelector('#' + CSS.escape(draft.id));
        if (!form) continue;
        const seen = new Map();
        for (const field of draft.fields) {
          const at = seen.get(field.name) || 0;
          seen.set(field.name, at + 1);
          const node = [...form.elements].filter((x) => x.name === field.name)[at];
          if (!node) continue;
          node.value = field.value;
          if (field.checked !== undefined) node.checked = field.checked;
          if (field.selected)
            for (const option of node.options)
              option.selected = field.selected.includes(option.value);
          node.dispatchEvent(new Event('change', { bubbles: true }));
        }
        form.dataset.dirty = 'true';
        const section = form.closest('details');
        if (section) section.open = true;
      }
    } catch (e) {
      const message = this.shadowRoot.querySelector('dialog[open] [data-dialog-message], #status');
      if (message)
        message.textContent =
          'Could not refresh Alfred: ' + e.message + '. Your unsaved changes remain here.';
      else
        this.shadowRoot.innerHTML =
          '<p>Could not load Alfred. Check Home Assistant and reload this page.</p>';
    }
  }
  field(key, label, value = '', type = 'text') {
    return `<label>${label}<input name="${key}" type="${type}" value="${escape(value)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}></label>`;
  }
  select(key, label, values, value) {
    return `<label>${label}<select name="${key}">${values.map((v) => `<option ${v === value ? 'selected' : ''}>${escape(v)}</option>`).join('')}</select></label>`;
  }
  form(id, title, body) {
    return `<section><h2>${title}</h2><form id="${id}">${body}<button>Save changes</button></form></section>`;
  }
  render() {
    this.renderedView = this.view;
    const s = this.state,
      c = s.settings,
      p = c.profile || {},
      f = this.field.bind(this),
      sel = this.select.bind(this);
    let body = '';
    if (this.view === 'overview')
      body = `<div class="hero"><span>YOUR PERSONAL ASSISTANT</span><h1>A little more effortless.</h1><p>Alfred lives inside Home Assistant. One setup for your glasses, home and personal services.</p></div><div class="grid">${s.features.map((x) => `<section><span class="badge">${x.configured ? 'READY' : 'OPTIONAL SETUP'}</span><h2>${escape(x.name)}</h2><p>${escape(x.requires)}</p><button data-nav="connections">Configure</button></section>`).join('')}</div><section><h2>Start in three steps</h2><ol><li>Choose AI and speech in Connections.</li><li>Review your home devices and optional personal services.</li><li>Pair Alfred in the Even app using Devices.</li></ol></section>`;
    if (this.view === 'connections')
      body =
        this.form(
          'providers',
          'Intelligence',
          sel(
            'cloudPolicy',
            'Cloud conversation policy',
            ['explicit', 'automatic', 'local-only'],
            c.cloudPolicy || 'automatic',
          ) +
            `<p>Recognised everyday commands run locally; other wording and questions automatically use your chosen AI. Say “research” for sourced findings emailed to you. Speech recognition has its own provider and costs.</p><label><input type="checkbox" name="emailOverflow" ${c.emailOverflow !== false ? 'checked' : ''}> Email responses longer than one glasses page</label><label><input type="checkbox" name="confirmActions" ${c.confirmActions ? 'checked' : ''}> Preview clear actions before execution (optional)</label>` +
            sel(
              'replyProvider',
              'Reply provider',
              ['none', 'openai', 'claude', 'ollama'],
              c.replyProvider,
            ) +
            `<div data-openai-key>${f('apiKey', 'OpenAI API key', '', 'password')}</div><div class="provider" data-provider="openai">${f('replyModel', 'OpenAI reply model', c.replyModel)}</div><div class="provider" data-provider="claude">${f('claudeKey', 'Anthropic API key', '', 'password')}${f('claudeModel', 'Claude model', c.claudeModel)}</div><div class="provider" data-provider="ollama">${f('ollamaUrl', 'Ollama server URL', c.ollamaUrl)}${f('ollamaModel', 'Ollama model', c.ollamaModel)}<small>The model service runs separately. Use a trusted private address.</small></div>` +
            sel(
              'transcriptionProvider',
              'Speech recognition',
              ['none', 'ha', 'openai', 'local'],
              c.transcriptionProvider,
            ) +
            `<div data-speech-model>${f('transcriptionModel', 'Speech model', c.transcriptionModel)}</div>` +
            `<div data-ha-speech><label>Installed HA recognition engine<select name="transcriptionEntity"><option value="">Choose an engine</option>${(s.stt_entities || []).map((x) => `<option value="${escape(x.id)}" ${x.id === c.transcriptionEntity ? 'selected' : ''}>${escape(x.name)}</option>`).join('')}</select></label>` +
            f('transcriptionLanguage', 'HA recognition language', c.transcriptionLanguage || 'en') +
            `<small>For HA speech, install official Whisper and add its discovered Wyoming integration, then choose the recognition engine. Your conversation provider receives transcribed text when used.</small></div>` +
            `<details><summary>Local speech and web research</summary><div data-local-speech>${f('localSpeechUrl', 'Local speech server', c.localSpeechUrl)}</div>${sel('webSearchProvider', 'Public web research', ['none', 'openai'], c.webSearchProvider)}${f('webSearchModel', 'Search-capable OpenAI model', c.webSearchModel)}</details>`,
        ) +
        `<div class="grid">${['google', 'outlook'].map((provider) => `<section><h2>${provider === 'google' ? 'Google' : 'Microsoft Outlook'}</h2><span class="badge">${c[provider]?.connected ? 'CONNECTED' : 'OPTIONAL'}</span><p>Connect mail and calendar once. Review the requested account permissions before connecting.</p><form id="oauth-${provider}">${f('clientId', 'OAuth client ID')}${f('clientSecret', 'Client secret (when required)', '', 'password')}<button>Save registration</button></form><button data-oauth="${provider}">Connect account</button><small>Register ${escape(c.publicOrigin || location.origin)}/alfred/oauth/${provider} as the callback URL.</small></section>`).join('')}</div>`;
    if (this.view === 'connections')
      body += this.form(
        'local-router',
        'Local command engine',
        `<p>Sentence matching handles supported commands first. A tiny local model can interpret alternative wording; cloud requests follow your selected policy. A local interpreter failure never repeats an action; explicit mode asks for an AI command instead of silently using cloud tokens.</p><label><input type="checkbox" name="enabled" ${c.localRouter?.enabled ? 'checked' : ''}> Enable the optional tiny interpreter</label>${f('url', 'Authenticated model adapter origin', c.localRouter?.url || '')}${f('localRouterKey', 'Adapter key', '', 'password')}${f('model', 'Tiny model', c.localRouter?.model || 'qwen3:1.7b')}${f('timeoutMs', 'Interpretation deadline (250–3000 ms)', c.localRouter?.timeoutMs || 1500, 'number')}<small>Install the model on a trusted Mac/Linux server; keep Ollama on localhost. Rules require no model installation. Status: ${escape(s.local_interpreter?.status || 'not tested')}.</small>`,
      );
    if (this.view === 'connections')
      body += this.form(
        'remote-access',
        'Remote access',
        `${sel('remoteAccessMethod', 'Connection method', ['private', 'ha-cloud', 'custom'], c.remoteAccessMethod || 'private')}${f('publicOrigin', 'Your external HTTPS origin', c.publicOrigin || '')}<button type="button" id="detect-cloud-origin">Detect HA Cloud address</button><p>Home Assistant Cloud removes the iPhone VPN requirement; it requires your own subscription. Enable remote access in HA → Settings → Home Assistant Cloud, then use its HTTPS address. Private VPN access remains supported.</p><small>Changing this address also requires rebuilding your Even package's exact network whitelist, updating OAuth callback registration and pairing/recovery testing over cellular. Keep the existing connection until that test passes. See Remote access in the guide.</small>`,
      );
    if (this.view === 'connections')
      body += this.form(
        'apple-shortcuts',
        'Apple handoffs',
        `<p>Register existing shortcuts by their exact iPhone names. Alfred sends a notification that you tap to run; it does not silently control iOS.</p><label>Shortcut names, one per line<textarea name="names">${escape((c.appleShortcuts || []).map((x) => x.name).join('\n'))}</textarea></label><small>Use this for Apple Music playlists, Focus routines and other supported Shortcut actions. Instructions are in Help.</small>`,
      );
    if (this.view === 'routines')
      body =
        this.form(
          'routine',
          'Build a routine',
          f('title', 'Routine name') +
            f('alias', 'Say this to Alfred') +
            `<div id="routine-steps"></div><button type="button" id="add-routine-step">Add home action</button><small>Choose a room or approved device. Running the routine shows one preview before acting. You can also ask Alfred to prepare a routine or a broader plan by voice.</small><details><summary>Advanced steps</summary><label>Optional reviewed JSON steps<textarea name="steps" rows="5"></textarea></label><small>For explicit shopping, task, reminder, mail or calendar steps. Leave empty to use the home actions above.</small></details>`,
        ) +
        `<section><h2>Your routines</h2>${(s.experiences?.routines || []).map((x) => `<details><summary>${escape(x.title)} · ${escape(x.alias)}</summary><pre>${escape(JSON.stringify(x.steps, null, 2))}</pre><button data-run-routine="${escape(x.id)}">Preview routine</button><button data-remove-routine="${escape(x.id)}">Remove routine</button></details>`).join('') || '<p>No routines yet. Ask Alfred to prepare one from your approved devices.</p>'}<pre id="routine-result"></pre></section>`;
    if (this.view === 'routines')
      body +=
        this.form(
          'schedule',
          'Schedule a home routine',
          `<label>Routine<select name="routine_id">${(s.experiences?.routines || []).map((x) => `<option value="${escape(x.id)}">${escape(x.title)}</option>`).join('')}</select></label>` +
            sel('trigger', 'Run at', ['time', 'sunrise', 'sunset'], 'time') +
            f('time', 'Daily time', '20:00', 'time') +
            `<small>Home-device steps only. Uses HA's sun state for sunrise/sunset. No catch-up execution after downtime. Saving explicitly authorises this schedule.</small>`,
        ) +
        `<section><h2>Schedules</h2>${(s.experiences?.schedules || []).map((x) => `<p>${escape(x.title)} · ${escape(x.trigger)} ${escape(x.time)} <button data-remove-schedule="${escape(x.id)}">Remove schedule</button></p>`).join('') || '<p>No schedules.</p>'}</section>`;
    if (this.view === 'memory')
      body =
        this.form('memory', 'Teach Alfred', f('text', 'A preference or useful fact')) +
        `<section><h2>Personal knowledge</h2><p>Only facts you explicitly save are used. Review and remove anything you no longer want remembered.</p>${(s.experiences?.memories || []).map((x) => `<details><summary>${escape(x.text || x.content)}</summary><form class="memory-edit" data-id="${escape(x.id)}"><textarea name="text">${escape(x.text || x.content)}</textarea><button>Update memory</button></form><button data-remove-memory="${escape(x.id)}">Remove memory</button></details>`).join('') || '<p>No saved memories.</p>'}</section>`;
    if (this.view === 'briefings') {
      const proactive = c.proactive || {};
      body =
        `<section><h2>A moment for your day</h2><p>Weather, appointments, unread mail, lists and home state. Each source reports its own connection problem, without hiding the rest.</p><div class="actions"><button data-briefing="normal">Brief me</button><button data-briefing="meeting">Next meeting</button></div><pre id="briefing-result"></pre></section>` +
        this.form(
          'proactive',
          'Quiet, selective updates',
          `<label><input name="enabled" type="checkbox" ${proactive.enabled ? 'checked' : ''}> Enable selected updates through the existing HA reminder inbox / iPhone target</label><label><input name="briefing" type="checkbox" ${proactive.briefing ? 'checked' : ''}> One daily briefing notification</label>` +
            f('time', 'Briefing time', proactive.time || '08:00', 'time') +
            f('quietStart', 'Quiet hours start', proactive.quietStart || '22:00', 'time') +
            f('quietEnd', 'Quiet hours end', proactive.quietEnd || '07:00', 'time') +
            `<label>Watch for availability or alarm changes<select name="watchEntities" multiple size="6">${s.inventory
              .filter((x) => (c.homeEntities || []).includes(x.entity_id))
              .map(
                (x) =>
                  `<option value="${escape(x.entity_id)}" ${(proactive.watchEntities || []).includes(x.entity_id) ? 'selected' : ''}>${escape(x.name)}</option>`,
              )
              .join(
                '',
              )}</select></label><small>Opt-in only. First readings establish a baseline; only changes to unavailable, unknown or triggered generate an alert. No always-on glasses updates.</small>`,
        );
    }
    if (this.view === 'profile')
      body = this.form(
        'profile',
        'Personal preferences',
        f('name', 'Name', p.name) +
          sel(
            'addressAs',
            'How Alfred addresses you',
            ['none', 'sir', 'madam', 'name'],
            p.addressAs,
          ) +
          f('gender', 'Gender — optional', p.gender) +
          f('selfEmail', 'Email to myself', p.selfEmail, 'email') +
          f('timezone', 'Timezone', p.timezone) +
          f('weatherCity', 'Weather town', c.weatherCity) +
          sel('mailProvider', 'Preferred mail', ['none', 'google', 'outlook'], c.mailProvider) +
          sel(
            'calendarProvider',
            'Preferred calendar',
            ['none', 'google', 'outlook'],
            c.calendarProvider,
          ) +
          `<label><input name="dashboardAgenda" type="checkbox" ${c.dashboardAgenda ? 'checked' : ''}> Show next appointment</label>`,
      );
    if (this.view === 'home')
      body = `<section><h2>Your connected home</h2><p>Discovery stays current. Choose permitted devices once; removed devices disappear automatically. Scenes and scripts appear here too.</p><div class="actions"><button id="safe-select">Select lights, switches and scenes</button><button id="select-none">Clear selection</button></div><form id="scope"><div class="devices">${s.inventory.map((x) => `<label><input type="checkbox" name="entity" value="${escape(x.entity_id)}" ${x.approved ? 'checked' : ''}><span>${escape(x.name)}<small>${escape(x.room || 'No room')} · ${escape(x.domain)} · ${escape(x.state)}</small></span></label>`).join('')}</div><button>Save permissions</button></form></section>`;
    if (this.view === 'lists')
      body =
        this.form(
          'lists',
          'Lists and reminders',
          `<p>Enable only the lists you use. Native HA lists stay visible in other HA apps.</p>` +
            ['tasks', 'shopping']
              .map(
                (kind) =>
                  `<label>${kind}<select name="${kind}"><option value="">Not used</option>${s.inventory
                    .filter((x) => x.domain === 'todo')
                    .map(
                      (x) =>
                        `<option value="${escape(x.entity_id)}" ${c.haLists?.[kind] === x.entity_id ? 'selected' : ''}>${escape(x.name)}</option>`,
                    )
                    .join('')}</select></label>`,
              )
              .join(''),
        ) +
        `<section><h2>iPhone reminders</h2><p>Install the official Home Assistant iPhone app and allow notifications. No extra Home Screen app is needed. Inbox-only reminders work without push.</p><button id="phones">Find my iPhone</button><form id="delivery"><label>Delivery<select name="phone"><option value="">Inbox only</option>${s.reminders.phone ? `<option selected>${escape(s.reminders.phone)}</option>` : ''}</select></label><button>Save delivery</button></form></section>`;
    if (this.view === 'news')
      body =
        this.form(
          'news',
          'Your daily briefing',
          `<p>Add your own public RSS or Atom feeds. No publisher is selected for new users.</p><label>Sources — one per line: Name | HTTPS URL<textarea name="sources" rows="5">${escape((c.newsSources || []).map((x) => x.name + ' | ' + x.url).join('\n'))}</textarea></label>` +
            sel('newsBackend', 'Feed reader', ['alfred', 'ha'], c.newsBackend) +
            `<details><summary>Daily digest</summary><label><input type="checkbox" name="enabled" ${c.newsDigest?.enabled ? 'checked' : ''}> Enable one daily digest</label>${f('time', 'Time', c.newsDigest?.time || '08:00', 'time')}${sel('delivery', 'Deliver to', ['inbox', 'ha', 'email'], c.newsDigest?.delivery || 'inbox')}<div class="days">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x, i) => `<label><input name="day" type="checkbox" value="${i + 1}" ${(c.newsDigest?.weekdays || [1, 2, 3, 4, 5, 6, 7]).includes(i + 1) ? 'checked' : ''}>${x}</label>`).join('')}</div><small>Email uses your preferred mail account and self-email. Enabling it authorises the scheduled digest.</small></details>`,
        ) +
        `<section><button id="news-check">Check news feeds</button><pre id="news-result"></pre></section>`;
    if (this.view === 'devices')
      body =
        `<section><h2>Connect your glasses</h2><p>Install Alfred from Even Hub. Keep your iPhone connected to your private HA endpoint. Open Alfred and enter the pairing code once.</p><button id="pair">Create pairing code</button><p id="pair-code"></p>${(c.pairedDevices || []).map((d) => `<p>${escape(d.label)} <button data-revoke="${escape(d.id)}">Revoke</button></p>`).join('')}</section>` +
        this.form(
          'network',
          'Private connection',
          f('publicOrigin', 'HTTPS origin reachable by your iPhone', c.publicOrigin) +
            `<label>Exact additional WebView origins (one per line)<textarea name="clientOrigins">${escape((c.clientOrigins || []).join('\n'))}</textarea></label><small>Keep remote access private with a VPN or a supported authenticated HA endpoint. Pairing credentials do not grant HA administration.</small>`,
        );
    if (this.view === 'activity')
      body = `<section><h2>Activity and verification</h2><p>Accepted by a provider does not guarantee delivery. Uncertain sends are not repeated automatically.</p><pre>${escape(JSON.stringify({ actions: s.actions, jobs: s.jobs, reminders: s.reminders, plans: s.experiences?.plans, diagnostics: s.diagnostics }, null, 2))}</pre></section><section><h2>Try a command</h2><form id="test">${f('text', 'Ask Alfred')}<button>Ask</button></form><pre id="test-result"></pre></section>`;
    if (this.view === 'quickstart' || this.view === 'help') body = quickStartPage();
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/alfred/app/studio/operations.css?v=0.20.2"><main><header><strong><img src="/alfred/app/assets/alfred-icon.svg" alt="Alfred butler" width="36" height="36"> alfred</strong><span>Command centre · ${escape(s.version)}</span></header><nav>${[
      'overview',
      'briefings',
      'routines',
      'memory',
      'connections',
      'profile',
      'home',
      'lists',
      'news',
      'devices',
      'activity',
      'help',
    ]
      .filter((v) => v !== 'call' || c.experimentalCalls)
      .map(
        (v) =>
          `<button data-nav="${v}" class="${v === this.view ? 'active' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`,
      )
      .join('')}</nav>${body}<div id="status" role="status"></div></main>`;
    this.shadowRoot.querySelectorAll('form').forEach((form) => {
      form.addEventListener('input', () => {
        form.dataset.dirty = 'true';
      });
      form.addEventListener('change', () => {
        form.dataset.dirty = 'true';
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel changes';
      cancel.onclick = () => {
        form.reset();
        form
          .querySelectorAll('select')
          .forEach((select) => select.dispatchEvent(new Event('change', { bubbles: true })));
        delete form.dataset.dirty;
      };
      if (form.id !== 'test') form.append(cancel);
    });
    const done = this.shadowRoot.querySelector('#quickstart-done');
    if (done) done.onclick = () => this.completeQuickStart();
    const q = (s) => this.shadowRoot.querySelector(s),
      status = (m) => {
        q('#status').textContent = m;
        const message = q('dialog[open] [data-dialog-message]');
        if (message) message.textContent = m;
      };
    this.shadowRoot.querySelectorAll('[data-nav]').forEach(
      (b) =>
        (b.onclick = () => {
          this.returnView = this.view === 'quickstart' ? 'quickstart' : undefined;
          this.view = b.dataset.nav;
          void this.refresh();
        }),
    );
    this.shadowRoot.querySelectorAll('form').forEach(
      (form) =>
        (form.onsubmit = async (event) => {
          event.preventDefault();
          const d = Object.fromEntries(new FormData(form));
          let args = {};
          try {
            if (form.id === 'apple-shortcuts')
              args = {
                appleShortcuts: d.names
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .map((name) => ({
                    id:
                      (c.appleShortcuts || []).find((x) => x.name === name)?.id ||
                      crypto.randomUUID(),
                    name,
                  })),
              };
            if (form.id === 'schedule') {
              await this.call('schedule', d);
              delete form.dataset.dirty;
              await this.refresh(true);
              return;
            }
            if (form.id === 'proactive')
              args = {
                proactive: {
                  ...d,
                  enabled: form.elements.enabled.checked,
                  briefing: form.elements.briefing.checked,
                  watchEntities: new FormData(form).getAll('watchEntities'),
                },
              };
            if (form.id === 'memory' || form.classList.contains('memory-edit')) {
              await this.call('memory', { text: d.text, id: form.dataset.id });
              delete form.dataset.dirty;
              await this.refresh(true);
              return;
            }
            if (form.id === 'routine') {
              await this.call('routine', {
                ...d,
                steps: d.steps.trim()
                  ? JSON.parse(d.steps)
                  : [...q('#routine-steps').children].map((row) => {
                      const target = row.querySelector('[name=target]').value,
                        action = row.querySelector('[name=action]').value,
                        raw = row.querySelector('[name=value]').value;
                      const args = target.startsWith('area:')
                        ? { area: target.slice(5), action }
                        : { entity_id: target, action };
                      if (raw)
                        args.value = [
                          'brightness',
                          'white_temperature',
                          'volume',
                          'percentage',
                          'temperature',
                        ].includes(action)
                          ? Number(raw)
                          : raw;
                      return { kind: 'home', args };
                    }),
              });
              delete form.dataset.dirty;
              await this.refresh(true);
              return;
            }
            if (form.id === 'providers') {
              args = {
                ...d,
                emailOverflow: form.elements.emailOverflow.checked,
                confirmActions: form.elements.confirmActions.checked,
              };
              for (const key of ['apiKey', 'claudeKey']) if (!args[key]) delete args[key];
            }
            if (form.id === 'local-router') {
              args = {
                localRouter: {
                  enabled: form.elements.enabled.checked,
                  url: d.url.trim(),
                  model: d.model.trim(),
                  timeoutMs: Number(d.timeoutMs),
                },
              };
              if (d.localRouterKey) args.localRouterKey = d.localRouterKey;
            }
            if (form.id === 'remote-access')
              args = {
                remoteAccessMethod: d.remoteAccessMethod,
                publicOrigin: d.publicOrigin.trim(),
              };
            if (form.id === 'profile') {
              args = {
                profile: Object.fromEntries(
                  ['name', 'gender', 'addressAs', 'selfEmail', 'timezone'].map((k) => [k, d[k]]),
                ),
                weatherCity: d.weatherCity,
                mailProvider: d.mailProvider,
                calendarProvider: d.calendarProvider,
                dashboardAgenda: !!form.elements.dashboardAgenda.checked,
              };
            }
            if (form.id === 'scope')
              args = { homeEntities: [...new FormData(form).getAll('entity')] };
            if (form.id === 'lists') args = { haLists: d };
            if (form.id === 'network')
              args = {
                publicOrigin: d.publicOrigin,
                clientOrigins: d.clientOrigins.split('\n').filter(Boolean),
              };
            if (form.id === 'delivery')
              args = {
                reminderDelivery: d.phone
                  ? { provider: 'ha', service: d.phone }
                  : { provider: 'none' },
              };
            if (form.id === 'news')
              args = {
                newsSources: d.sources
                  .split('\n')
                  .filter((x) => x.trim())
                  .map((line) => {
                    const i = line.indexOf('|');
                    if (i < 0) throw Error('Use Name | HTTPS URL.');
                    return {
                      name: line.slice(0, i).trim(),
                      url: line.slice(i + 1).trim(),
                      enabled: true,
                    };
                  }),
                newsBackend: d.newsBackend,
                newsDigest: {
                  enabled: form.elements.enabled.checked,
                  time: d.time,
                  delivery: d.delivery,
                  weekdays: new FormData(form).getAll('day').map(Number),
                },
              };
            if (form.id.startsWith('oauth-')) {
              const provider = form.id.slice(6);
              args = { [provider]: Object.fromEntries(Object.entries(d).filter(([k, v]) => v)) };
            }
            if (form.id === 'test') {
              q('#test-result').textContent = 'Thinking…';
              q('#test-result').textContent = (await this.call('test', d)).reply;
              return;
            }
            await this.call('configure', args);
            delete form.dataset.dirty;
            await this.refresh(true);
            status('Saved.');
          } catch (e) {
            status(e.message);
          }
        }),
    );
    const bind = (id, fn) => {
      if (q(id))
        q(id).onclick = async () => {
          try {
            await fn();
          } catch (e) {
            status(e.message);
          }
        };
    };
    this.shadowRoot.querySelectorAll('[data-remove-schedule]').forEach(
      (b) =>
        (b.onclick = async () => {
          await this.call('schedule', { operation: 'remove', id: b.dataset.removeSchedule });
          await this.refresh(true);
        }),
    );
    this.shadowRoot.querySelectorAll('[data-briefing]').forEach(
      (b) =>
        (b.onclick = async () => {
          const target = q('#briefing-result') || q('#test-result');
          target.textContent = 'Preparing…';
          try {
            target.textContent = (
              await this.call('test', {
                text:
                  b.dataset.briefing === 'meeting'
                    ? 'Prepare me for my next meeting'
                    : 'Brief me on my day. Keep it concise.',
              })
            ).reply;
          } catch (e) {
            target.textContent = e.message;
          }
        }),
    );
    this.shadowRoot.querySelectorAll('[data-remove-memory]').forEach(
      (b) =>
        (b.onclick = async () => {
          await this.call('memory', { operation: 'remove', id: b.dataset.removeMemory });
          await this.refresh(true);
        }),
    );
    this.shadowRoot.querySelectorAll('[data-remove-routine]').forEach(
      (b) =>
        (b.onclick = async () => {
          await this.call('routine', { operation: 'remove', id: b.dataset.removeRoutine });
          await this.refresh(true);
        }),
    );
    this.shadowRoot.querySelectorAll('[data-run-routine]').forEach(
      (b) =>
        (b.onclick = async () => {
          const x = s.experiences.routines.find((x) => x.id === b.dataset.runRoutine);
          q('#routine-result').textContent = (
            await this.call('test', { text: 'run ' + x.title })
          ).reply;
        }),
    );
    const addRoutineStep = () => {
      const holder = q('#routine-steps');
      if (!holder || holder.children.length >= 12) return;
      const allowed = s.inventory.filter((x) => (c.homeEntities || []).includes(x.entity_id));
      const rooms = [
        ...new Set(
          allowed
            .filter((x) => ['light', 'switch', 'fan', 'input_boolean'].includes(x.domain))
            .map((x) => x.room)
            .filter(Boolean),
        ),
      ];
      const row = document.createElement('div');
      row.className = 'routine-row';
      row.innerHTML = `<label>Room or device<select name="target">${rooms.map((x) => `<option value="area:${escape(x)}">${escape(x)} · whole room</option>`).join('')}${allowed.map((x) => `<option value="${escape(x.entity_id)}">${escape(x.name)}</option>`).join('')}</select></label><label>Action<select name="action"></select></label><label>Value, when needed<input name="value" placeholder="e.g. 30 for brightness"/></label><button type="button">Remove step</button>`;
      const update = () => {
        const target = row.querySelector('[name=target]').value,
          domain = target.startsWith('area:') ? 'area' : target.split('.')[0];
        const actions = {
          area: ['on', 'off'],
          light: ['on', 'off', 'brightness', 'white_temperature', 'rgb'],
          switch: ['on', 'off'],
          scene: ['activate'],
          script: ['run'],
          automation: ['trigger', 'on', 'off'],
          fan: ['on', 'off', 'percentage'],
          media_player: ['on', 'off', 'play', 'pause', 'volume'],
          climate: ['on', 'off', 'temperature', 'mode'],
          input_boolean: ['on', 'off'],
        };
        row.querySelector('[name=action]').innerHTML = (actions[domain] || ['on', 'off'])
          .map((x) => `<option>${x}</option>`)
          .join('');
      };
      row.querySelector('[name=target]').onchange = update;
      row.querySelector('button').onclick = () => row.remove();
      holder.append(row);
      update();
    };
    bind('#add-routine-step', async () => addRoutineStep());
    if (q('#routine-steps')) addRoutineStep();
    bind('#detect-cloud-origin', async () => {
      const cloud = await Promise.race([
        this._hass.callWS({ type: 'cloud/status' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error('HA Cloud status request timed out.')), 6000),
        ),
      ]);
      if (!cloud.logged_in || !cloud.remote_connected || !cloud.remote_domain)
        throw Error('Enable your own HA Cloud remote access first. Current connection unchanged.');
      const domain = cloud.remote_domain;
      const url = new URL(domain.startsWith('https://') ? domain : 'https://' + domain);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw Error('Copy the exact HTTPS origin from HA Cloud settings.');
      q('#remote-access [name=publicOrigin]').value = url.origin;
      q('#remote-access [name=remoteAccessMethod]').value = 'ha-cloud';
      q('#remote-access').dataset.dirty = 'true';
      status(
        'Address found as an unsaved draft. Save, rebuild your Even package and test on cellular before retiring the existing connection.',
      );
    });
    bind('#pair', async () => {
      const d = await this.call('pair');
      q('#pair-code').textContent = d.code + ' · valid for 5 minutes';
    });
    bind('#phones', async () => {
      const d = await this.call('phones');
      const select = q('[name=phone]');
      select.innerHTML =
        '<option value="">Inbox only</option>' +
        d.targets.map((x) => `<option>${escape(x)}</option>`).join('');
      status('Choose your iPhone and save.');
    });
    bind(
      '#news-check',
      async () =>
        (q('#news-result').textContent = JSON.stringify(await this.call('news'), null, 2)),
    );
    bind('#safe-select', async () => {
      this.shadowRoot
        .querySelectorAll('[name=entity]')
        .forEach((x) => (x.checked = ['light', 'switch', 'scene'].includes(x.value.split('.')[0])));
      q('#scope').dataset.dirty = 'true';
    });
    bind('#select-none', async () => {
      this.shadowRoot.querySelectorAll('[name=entity]').forEach((x) => (x.checked = false));
      q('#scope').dataset.dirty = 'true';
    });
    bind('#export', async () => {
      const d = await this.call('export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'alfred-private-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    });
    this.shadowRoot.querySelectorAll('[data-revoke]').forEach(
      (b) =>
        (b.onclick = async () => {
          await this.call('revoke', { id: b.dataset.revoke });
          await this.refresh(true);
        }),
    );
    this.shadowRoot.querySelectorAll('[data-oauth]').forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const d = await this.call('oauth', { provider: b.dataset.oauth });
            window.open(d.url, '_blank', 'noopener');
          } catch (e) {
            status(e.message);
          }
        }),
    );
    if (q('[name=replyProvider]')) {
      const show = () => {
        const choice = {
          replyProvider: q('[name=replyProvider]').value,
          transcriptionProvider: q('[name=transcriptionProvider]').value,
          webSearchProvider: q('[name=webSearchProvider]').value,
        };
        this.shadowRoot
          .querySelectorAll('[data-provider]')
          .forEach((x) => (x.hidden = x.dataset.provider !== choice.replyProvider));
        const visibility = providerVisibility(choice);
        for (const [selector, key] of [
          ['[data-openai-key]', 'openaiKey'],
          ['[data-speech-model]', 'speechModel'],
          ['[data-ha-speech]', 'haSpeech'],
          ['[data-local-speech]', 'localSpeech'],
        ])
          q(selector).hidden = !visibility[key];
      };
      for (const name of ['replyProvider', 'transcriptionProvider', 'webSearchProvider'])
        q(`[name=${name}]`).onchange = show;
      show();
    }
    enhancePanel(this);
  }
}
customElements.define('alfred-panel', AlfredPanel);
