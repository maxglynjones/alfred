import { uiIcon } from '../public/studio/icons.js';
import { iconCard } from './companion';

/** Explicit views with one settings destination and a predictable route home. */
export function setupPhoneNavigation() {
  const main = document.querySelector('main');
  if (!main) return;
  const panels = [...main.children].filter((node) =>
    node.matches('section,details'),
  ) as HTMLElement[];
  for (const panel of panels)
    panel.dataset.phoneView ||= ['connection-panel', 'connection-recovery'].includes(panel.id)
      ? 'home'
      : panel.id === 'phone-list-panel'
        ? 'lists'
        : panel.matches('section') || panel.querySelector('#shared-text')
          ? 'home'
          : 'settings';
  const nav = document.createElement('nav');
  nav.className = 'phone-nav';
  nav.setAttribute('aria-label', 'alfred companion views');
  const heading = document.createElement('div');
  heading.className = 'view-heading';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '← Home';
  const title = document.createElement('h1');
  title.tabIndex = -1;
  heading.append(back, title);
  const names: Record<string, string> = {
    home: 'Home',
    lists: 'Lists',
    reminders: 'Reminders',
    research: 'Research',
    activity: 'Activity',
    settings: 'Settings',
  };
  const select = (name: string) => {
    for (const panel of panels) panel.hidden = panel.dataset.phoneView !== name;
    for (const button of nav.querySelectorAll<HTMLButtonElement>('button'))
      button.setAttribute('aria-pressed', String(button.dataset.view === name));
    heading.hidden = name === 'home';
    title.textContent = names[name] || name;
    main.dispatchEvent(new CustomEvent('alfred-view', { detail: name }));
    if (name !== 'home') title.focus({ preventScroll: true });
  };
  back.onclick = () => select('home');
  for (const [name, label] of [
    ['home', 'Home'],
    ['lists', 'Lists'],
    ['activity', 'Activity'],
    ['settings', 'Settings'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = name;
    button.innerHTML = uiIcon(name) + (name === 'settings' ? '' : `<span>${label}</span>`);
    button.setAttribute('aria-label', label);
    if (name === 'settings') button.className = 'utility';
    button.onclick = () => select(name);
    nav.append(button);
  }
  main.querySelector('header')?.after(nav);
  nav.after(heading);
  main.querySelector<HTMLAnchorElement>('.brand')?.addEventListener('click', (event) => {
    event.preventDefault();
    select('home');
  });
  for (const button of main.querySelectorAll<HTMLButtonElement>('[data-navigate]')) {
    button.replaceChildren(
      ...iconCard(
        button.textContent || '',
        button.dataset.icon || 'default',
        button.dataset.description || '',
      ),
    );
    button.className = 'companion-tile';
    button.onclick = () => select(button.dataset.navigate || 'home');
  }
  const settings = document.createElement('section');
  settings.className = 'companion-feature-grid';
  settings.dataset.phoneView = 'settings';
  panels.push(settings);
  main.querySelector('footer')?.before(settings);
  const home = main.querySelector('#home-features');
  for (const details of [...main.querySelectorAll<HTMLDetailsElement>(':scope > details')]) {
    const view = details.dataset.phoneView || 'settings';
    const label = details.querySelector('summary')?.textContent || 'Settings';
    const icon =
      details.dataset.icon ||
      (details.querySelector('#ring-serial')
        ? 'devices'
        : details.querySelector('#phone-location')
          ? 'location'
          : details.querySelector('#shared-text')
            ? 'conversation'
            : details.querySelector('#operations-link')
              ? 'connections'
              : view === 'home'
                ? 'help'
                : 'settings');
    const description = details.querySelector('#ring-serial')
      ? 'Batteries and R1 identity'
      : details.querySelector('#phone-location')
        ? 'Nearby weather or saved town'
        : details.querySelector('#shared-text')
          ? 'Type a request or share text'
          : details.querySelector('#operations-link')
            ? 'Manage your server in HA'
            : label === 'Glasses controls'
              ? 'Ring and temple gestures'
              : view === 'home'
                ? 'Setup and connection recovery'
                : 'Optional controls and diagnostics';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'companion-tile';
    button.replaceChildren(...iconCard(label, icon, description));
    (view === 'home' ? home : settings)?.append(button);
    const dialog = document.createElement('dialog');
    dialog.className = 'companion-dialog';
    const bar = document.createElement('div');
    bar.className = 'dialog-heading';
    const h2 = document.createElement('h2');
    h2.textContent = label;
    h2.id = 'companion-dialog-' + main.querySelectorAll('dialog').length;
    dialog.setAttribute('aria-labelledby', h2.id);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.onclick = () => dialog.close();
    bar.append(h2, close);
    dialog.append(bar, details);
    main.append(dialog);
    details.open = true;
    details.hidden = false;
    delete details.dataset.phoneView;
    const at = panels.indexOf(details);
    if (at >= 0) panels.splice(at, 1);
    button.onclick = () => dialog.showModal();
  }
  select('home');
}
