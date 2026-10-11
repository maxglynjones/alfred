import type { Screen } from './types';
export const dashboardRegions = {
  left: { x: 16, y: 12, width: 544, height: 264 },
};
export const dashboardTiles = [
  { id: 32, name: 'dash-tl', x: 0, y: 0 },
  { id: 33, name: 'dash-tr', x: 288, y: 0 },
  { id: 34, name: 'dash-bl', x: 0, y: 144 },
  { id: 35, name: 'dash-br', x: 288, y: 144 },
];
// Compose at full resolution, then crop into the SDK's four allowed image regions.
export function composeDashboard(draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = 576;
  canvas.height = 288;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, 576, 288);
  c.translate(16, 12);
  draw(c);
  return dashboardTiles.map((tile, i) => {
    const part = document.createElement('canvas');
    part.width = 288;
    part.height = 144;
    part
      .getContext('2d')!
      .drawImage(canvas, (i % 2) * 288, Math.floor(i / 2) * 144, 288, 144, 0, 0, 288, 144);
    const bytes = Uint8Array.from(atob(part.toDataURL('image/png').split(',')[1]), (x) =>
      x.charCodeAt(0),
    );
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return { ...tile, bytes, key: 'pixels-' + hash };
  });
}
const font = (size: number, weight = 500) => `${weight} ${size}px "Alfred Display", sans-serif`;
let fontReady = false;
let load: Promise<void> | undefined;
export function prepareDashboardFont() {
  return (load ??= (async () => {
    try {
      const face = new FontFace('Alfred Display', 'url(/assets/fonts/space-grotesk.ttf)');
      await face.load();
      document.fonts.add(face);
      fontReady = true;
      cached = undefined;
    } catch {
      /* Offline/font failure retains a readable system fallback. */
    }
  })());
}
export function daylightPosition(sunrise?: string, sunset?: string, now = Date.now()) {
  const rise = Date.parse(sunrise ?? ''),
    set = Date.parse(sunset ?? '');
  if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise) return null;
  return {
    fraction: Math.max(0, Math.min(1, (now - rise) / (set - rise))),
    day: now >= rise && now <= set,
  };
}
function label(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  weight = 500,
) {
  c.font = font(size, weight);
  let fitted = text;
  while (fitted && c.measureText(fitted).width > maxWidth)
    fitted = Array.from(fitted).slice(0, -1).join('');
  if (fitted !== text) {
    while (fitted && c.measureText(fitted + '…').width > maxWidth)
      fitted = Array.from(fitted).slice(0, -1).join('');
    fitted += '…';
  }
  c.fillText(fitted, x, y);
}
export function drawBattery(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number | undefined,
  name: string,
) {
  c.save();
  c.strokeStyle = '#888';
  c.fillStyle = '#888';
  c.lineWidth = 1;
  label(c, name, x, y + 11, 12, 25);
  x += 30;
  c.strokeRect(x, y, 46, 15);
  c.fillRect(x + 46, y + 4, 2, 7);
  if (value === undefined) label(c, '?', x + 19, y + 11, 12, 16);
  else c.fillRect(x + 3, y + 3, (40 * Math.max(0, Math.min(100, value))) / 100, 9);
  c.restore();
}
const clock = (v?: string, zone = 'UTC') =>
  v && Number.isFinite(Date.parse(v))
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(v))
    : '--:--';
export function drawDaylight(c: CanvasRenderingContext2D, s?: Screen) {
  if (!s) return;
  const w = s.weather,
    p = daylightPosition(w?.sunrise, w?.sunset);
  c.save();
  c.strokeStyle = '#444';
  c.lineWidth = 1;
  c.fillStyle = '#666';
  label(c, 'DAYLIGHT', 15, 11, 10, 230);
  c.beginPath();
  c.moveTo(15, 30);
  c.lineTo(233, 30);
  c.stroke();
  for (const x of [15, 233]) {
    c.beginPath();
    c.moveTo(x, 26);
    c.lineTo(x, 34);
    c.stroke();
  }
  label(c, clock(w?.sunrise, w?.timezone), 15, 49, 12, 100);
  label(c, clock(w?.sunset, w?.timezone), 196, 49, 12, 55);
  if (p) {
    const x = 15 + 218 * p.fraction;
    c.fillStyle = p.day ? '#aaa' : '#666';
    c.beginPath();
    c.arc(x, 30, 3, 0, Math.PI * 2);
    c.fill();
    if (p.day)
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        c.beginPath();
        c.moveTo(x + 6 * Math.cos(a), 30 + 6 * Math.sin(a));
        c.lineTo(x + 8 * Math.cos(a), 30 + 8 * Math.sin(a));
        c.stroke();
      }
  }
  c.restore();
}
// One composed card: the type, borders, batteries and butler arrive in one image.
export function drawDashboardCard(c: CanvasRenderingContext2D, s?: Screen) {
  if (!s) return;
  c.strokeStyle = '#444';
  c.lineWidth = 1;
  c.stroke(new Path2D('M12 14V6H26M262 6H276V14M12 129V137H26M262 137H276V129'));
  c.fillStyle = '#aaa';
  label(c, s.headline ?? '--:--', 23, 33, 26, 170);
  c.fillStyle = '#666';
  label(c, `${(s.weekday ?? '').slice(0, 3).toUpperCase()} ${s.date ?? ''}`, 24, 48, 10, 205);
  c.save();
  c.translate(244, 10);
  c.scale(0.55, 0.55);
  c.strokeStyle = '#777';
  c.lineWidth = 1.8;
  c.stroke(
    new Path2D(
      'M12 13C8 3 28 3 24 13M12 12v5c0 8 12 8 12 0v-5M12 10c3-2 9-2 12 0M10 24l-6 6v5h28v-5l-6-6M12 24l6 11 6-11M12 26l5 2-5 2zM24 26l-5 2 5 2zM17 16h2M15 20h6',
    ),
  );
  c.restore();
  c.strokeStyle = '#333';
  c.beginPath();
  c.moveTo(145, 61);
  c.lineTo(145, 107);
  c.stroke();
  if (s.next_event) {
    c.fillStyle = '#777';
    label(
      c,
      'Next: ' + (s.next_event.title ?? '') + ' ' + clock(s.next_event.start?.dateTime, s.timezone),
      24,
      59,
      9,
      240,
    );
  }
  const w = s.weather;
  c.fillStyle = '#999';
  if (w?.available) {
    label(c, `${w.temperature}°`, 24, 76, 20, 100);
    c.fillStyle = '#777';
    label(c, w.description ?? 'Weather', 24, 92, 11, 114);
    c.fillStyle = '#666';
    label(c, w.city ?? '', 24, 106, 10, 114);
  } else label(c, w?.configured ? 'Weather unavailable' : 'Set up weather', 24, 84, 11, 114);
  c.fillStyle = '#999';
  label(c, String(s.tasks ?? '—'), 160, 78, 21, 42);
  label(c, String(s.shopping ?? '—'), 218, 78, 21, 42);
  c.fillStyle = '#666';
  label(c, 'TASKS', 160, 91, 8, 50);
  label(c, 'SHOPPING', 218, 91, 8, 50);
  for (const [x, name, value] of [
    [160, 'G2', s.battery?.glasses],
    [218, 'R1', s.battery?.ring],
  ] as const) {
    label(c, name, x, 107, 8, 16);
    c.strokeStyle = '#777';
    c.strokeRect(x + 18, 99, 24, 9);
    c.fillRect(x + 42, 102, 2, 3);
    if (value === undefined) label(c, '?', x + 26, 106, 8, 10);
    else c.fillRect(x + 20, 101, (20 * Math.max(0, Math.min(100, value))) / 100, 5);
  }
  const p = daylightPosition(w?.sunrise, w?.sunset);
  c.strokeStyle = '#444';
  c.beginPath();
  c.moveTo(12, 122);
  c.lineTo(276, 122);
  c.stroke();
  if (p) {
    const x = 12 + 264 * p.fraction;
    c.fillStyle = p.day ? '#aaa' : '#666';
    c.beginPath();
    c.arc(x, 122, 3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#aaa';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      c.beginPath();
      c.moveTo(x + 5 * Math.cos(a), 122 + 5 * Math.sin(a));
      c.lineTo(x + 7 * Math.cos(a), 122 + 7 * Math.sin(a));
      c.stroke();
    }
  }
  c.fillStyle = '#666';
  label(c, clock(w?.sunrise, w?.timezone), 12, 135, 9, 70);
  label(c, clock(w?.sunset, w?.timezone), 247, 135, 9, 45);
}
// One dashboard image updates only when dashboard content changes.
// Keep cache bounded to the last view; never run a bitmap animation loop.
let cached:
  | {
      key: string;
      panel: Uint8Array<ArrayBuffer>;
      solar: Uint8Array<ArrayBuffer>;
      panelKey?: string;
      solarKey?: string;
      tiles?: ReturnType<typeof composeDashboard>;
    }
  | undefined;
export function dashboardAssets(s?: Screen) {
  const key = s
    ? JSON.stringify([
        s.headline,
        s.weekday,
        s.date,
        s.weather,
        s.battery,
        s.tasks,
        s.shopping,
        s.next_event,
        s.timezone,
        s.agenda_error,
        Math.floor(Date.now() / 60000),
        fontReady,
      ])
    : 'blank';
  if (cached?.key === key) return cached;
  const tiles = composeDashboard((c) => {
    c.translate(13, 2);
    c.scale(1.8, 1.8);
    drawDashboardCard(c, s);
  });
  return (cached = {
    key,
    tiles,
    panel: tiles[0].bytes,
    solar: tiles[1].bytes,
    panelKey: key,
    solarKey: key,
  });
}
