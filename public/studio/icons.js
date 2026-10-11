/** Shared original SVG icons; no external icon service. */
const paths = {
  reminders: 'M6 8a6 6 0 0 1 12 0v7l2 3H4l2-3zM10 21h4',
  research: 'M14 6a5 5 0 1 1-10 0 5 5 0 0 1 10 0M12 10l8 8M15 3h6M18 6h3',
  conversation: 'M3 4h18v12H9l-6 4zM7 8h10M7 12h7',
  home: 'M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7',
  lists: 'M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  light: 'M9 18h6M10 21h4M8 13a6 6 0 1 1 8 0l-1 3H9l-1-3',
  switch: 'M9 8h6a4 4 0 0 1 0 8H9a4 4 0 0 1 0-8M9 12h.01',
  climate: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0M12 10v7',
  fan: 'M12 12c-5-7 4-12 4-5 0 3-4 5-4 5Zm0 0c8-3 10 7 4 5-3-1-4-5-4-5Zm0 0c0 9-10 7-7 2 2-3 7-2 7-2Z',
  media_player: 'M5 5h14v11H5zM9 20h6M10 8l5 3-5 3z',
  scene: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z',
  todo: 'M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01',
  camera: 'M3 7h18v13H3zM8 7l2-3h4l2 3M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  sensor: 'M5 8a10 10 0 0 1 14 0M8 11a6 6 0 0 1 8 0M11 14h2M12 18h.01',
  connections: 'M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  routines: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z',
  news: 'M4 4h16v16H4zM7 8h4v4H7zM14 8h3M14 11h3M7 16h10',
  memory: 'M6 6h12v12H6zM9 9h6v6H9zM12 2v4M12 18v4M2 12h4M18 12h4',
  profile: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M5 21v-3a7 7 0 0 1 14 0v3',
  briefings: 'M6 4h12v17H6zM9 8h6M9 12h6M9 16h4',
  devices: 'M3 9h7v7H3zM14 9h7v7h-7zM10 11h4M3 9V6M21 9V6',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  help: 'M4 4h7l1 2 1-2h7v16h-7l-1 1-1-1H4zM12 6v15',
  default: 'M5 5h14v14H5zM9 9h6v6H9z',
};
export function uiIcon(domain) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[domain] || paths.default}"/></svg>`;
}
