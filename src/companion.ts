import { uiIcon } from '../public/studio/icons.js';

export type Activity = {
  id?: string;
  kind?: string;
  title?: string;
  detail?: string;
  created_at?: string;
  question?: string;
  reply?: string;
  status?: string;
};
export function activityRows(data: {
  history?: Activity[];
  activity?: Activity[];
  actions?: Activity[];
}) {
  return [
    ...(data.history || []).map((x) => ({
      ...x,
      kind: 'conversation',
      title: x.question,
      detail: x.reply,
    })),
    ...(data.activity || []),
    ...(data.actions || []).map((x) => ({
      ...x,
      kind: 'receipt',
      title: x.kind === 'email_result' ? 'Email delivery' : 'Service request',
      detail:
        x.status === 'completed' || x.status === 'accepted'
          ? 'Accepted by the service'
          : x.status?.includes('uncertain')
            ? 'Result uncertain; check the service before repeating'
            : x.status || 'Recorded',
    })),
  ]
    .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))
    .slice(0, 100);
}
export function renderActivity(holder: HTMLElement, data: Parameters<typeof activityRows>[0]) {
  holder.replaceChildren();
  const rows = activityRows(data);
  if (!rows.length) {
    holder.textContent = 'No activity yet. Conversations and action receipts appear here.';
    return;
  }
  for (const row of rows) {
    const article = document.createElement('article');
    article.className = 'companion-event';
    const icon = document.createElement('span');
    icon.className = 'event-icon';
    icon.innerHTML = uiIcon(row.kind === 'conversation' ? 'conversation' : 'activity');
    const body = document.createElement('div'),
      meta = document.createElement('div');
    meta.className = 'event-meta';
    const label = document.createElement('span');
    label.textContent =
      row.kind === 'conversation' ? 'Conversation' : row.kind === 'receipt' ? 'Receipt' : 'Action';
    const time = document.createElement('time');
    time.textContent = row.created_at ? new Date(row.created_at).toLocaleString() : 'This session';
    if (row.created_at) time.dateTime = row.created_at;
    meta.append(label, time);
    const title = document.createElement('strong');
    title.textContent = row.title || 'Request';
    const detail = document.createElement('p');
    detail.textContent = row.detail || '';
    body.append(meta, title, detail);
    article.append(icon, body);
    holder.append(article);
  }
}
export function iconCard(title: string, icon: string, description: string) {
  const wrapper = document.createElement('span');
  wrapper.className = 'companion-tile-copy';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = description;
  wrapper.append(strong, small);
  const glyph = document.createElement('span');
  glyph.className = 'tile-icon';
  glyph.innerHTML = uiIcon(icon);
  return [glyph, wrapper];
}
