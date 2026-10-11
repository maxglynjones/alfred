import type { Row, Screen, Weather } from './display/types';
export type Mode = 'home' | 'day' | 'shopping' | 'tasks' | 'rooms';
const names: Record<Mode, string> = {
  home: 'Dashboard',
  day: 'Your day',
  shopping: 'Shopping',
  tasks: 'Tasks',
  rooms: 'Rooms',
};
export type Room = {
  name: string;
  on: number;
  total: number;
  unavailable: number;
  lights?: Array<{ name: string; state: string }>;
};
export type Snapshot = {
  profile?: { name: string; address: string; timezone: string };
  next_event?: { title: string; start: { dateTime?: string }; end?: { dateTime?: string } } | null;
  agenda_error?: string;
  weather?: Weather;
  view: string;
  generated_at?: string;
  tasks?: number;
  shopping?: number;
  total?: number;
  connected?: boolean;
  connections?: {
    ai: boolean;
    home: boolean;
    google: boolean;
    mail_provider?: string;
    calendar_provider?: string;
  };
  items?: Array<{ title: string }>;
  events?: Array<{
    title: string;
    start: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    location?: string;
  }>;
  rooms?: Room[];
  more_available?: boolean;
  next_offset?: number | null;
};
export function clock(now = new Date(), zone = 'UTC') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}
export function viewScreens(mode: Mode, data: Snapshot): Screen[] {
  const zone = data.profile?.timezone ?? 'UTC';
  const stamp = data.generated_at
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(data.generated_at))
    : clock();
  if (mode === 'home') {
    const localNow = new Date(),
      hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(localNow),
      );
    const title = data.profile?.address ? `, ${data.profile.address}` : '';
    const greeting =
      (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + title + '.';
    const weather = data.weather;
    const observed = weather?.observed_at ? clock(new Date(weather.observed_at), zone) : '';
    return [
      {
        kind: 'home',
        timezone: zone,
        title: 'Home',
        status: 'TODAY',
        headline: clock(localNow, zone),
        weekday: new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' })
          .format(localNow)
          .toUpperCase(),
        date: new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(localNow),
        greeting,
        weather,
        next_event: data.next_event,
        agenda_error: data.agenda_error,
        tasks: data.tasks,
        shopping: data.shopping,
        footer: weather?.available
          ? `OPEN-METEO / ESTIMATE ${observed}`
          : `YOUR DAY / ${zone.toUpperCase()}`,
      },
    ];
  }
  let rows: Row[] = [];
  let empty = 'Nothing here just yet.';
  if (mode === 'shopping' || mode === 'tasks') {
    rows = (data.items ?? []).map((x) => ({
      label: x.title,
      detail: mode === 'shopping' ? 'Needed' : 'To do',
    }));
    empty = mode === 'shopping' ? 'Your shopping list is clear.' : 'Nothing outstanding, sir.';
  }
  if (mode === 'day') {
    rows = (data.events ?? []).map((x) => ({
      label: x.title || 'Untitled event',
      detail: `${x.start.date ? 'All day' : clock(new Date(x.start.dateTime!), zone)}${x.location ? ' / ' + x.location : ''}`,
    }));
    empty =
      data.connected === false
        ? 'Choose and connect a calendar in Settings.'
        : 'A clear diary today.';
  }
  if (mode === 'rooms') {
    rows = (data.rooms ?? []).map((x) => ({
      label: x.name,
      detail: `${x.on} / ${x.total} lights on${x.unavailable ? ` / ${x.unavailable} unavailable` : ''}`,
    }));
    empty = data.connected === false ? 'Connect Home Assistant in setup.' : 'No rooms available.';
  }
  const pages = [];
  for (let i = 0; i < Math.max(1, rows.length); i += 3)
    pages.push({
      kind: 'list' as const,
      title: names[mode],
      status: names[mode],
      eyebrow:
        mode === 'day'
          ? `TODAY / ${zone.toUpperCase()}`
          : `${rows.length}${data.total && data.total > rows.length ? ` OF ${data.total}` : ''} ${mode.toUpperCase()}`,
      rows: rows.slice(i, i + 3),
      text: rows.length ? undefined : empty,
      footer: `UPDATED ${stamp}${data.more_available ? ' / MORE AVAILABLE' : ''}`,
      page: `${Math.floor(i / 3) + 1} / ${Math.max(1, Math.ceil(rows.length / 3))}`,
    });
  return pages;
}
const sampleDay = new Date().toISOString().slice(0, 10);
export const sampleSnapshots: Record<string, Snapshot> = {
  home: {
    view: 'home',
    weather: {
      available: true,
      configured: true,
      city: 'Sample town',
      temperature: 14,
      description: 'Partly cloudy',
      weather_code: 2,
      wind_kmh: 12,
      humidity_percent: 74,
      feels_like: 12,
      sunrise: `${sampleDay}T06:08:00Z`,
      sunset: `${sampleDay}T17:35:00Z`,
      daylight_seconds: 41220,
      is_day: true,
      observed_at: `${sampleDay}T12:00:00Z`,
      source: 'Open-Meteo',
    },
    tasks: 3,
    shopping: 8,
    connections: { ai: true, home: true, google: true },
  },
  day: {
    view: 'day',
    connected: true,
    events: [
      {
        title: 'Coffee & a little planning',
        start: { dateTime: `${sampleDay}T09:00:00+01:00` },
        location: 'Kitchen',
      },
      {
        title: 'An afternoon with space to think',
        start: { dateTime: `${sampleDay}T14:00:00+01:00` },
      },
    ],
  },
  shopping: {
    view: 'shopping',
    total: 4,
    items: [
      { title: 'Fresh tomatoes' },
      { title: '500g beef mince' },
      { title: 'Spaghetti' },
      { title: 'Parmesan' },
    ],
  },
  tasks: {
    view: 'tasks',
    total: 3,
    items: [
      { title: 'Book the dentist' },
      { title: 'Call the plumber' },
      { title: 'A little time for yourself' },
    ],
  },
  rooms: {
    view: 'rooms',
    connected: true,
    rooms: [
      { name: 'Living Room', on: 5, total: 8, unavailable: 0 },
      { name: 'Dining Room', on: 3, total: 3, unavailable: 0 },
      { name: 'Kitchen', on: 6, total: 6, unavailable: 0 },
      { name: 'Bedroom', on: 0, total: 6, unavailable: 0 },
    ],
  },
};

for (const room of sampleSnapshots.rooms.rooms ?? [])
  room.lights = Array.from({ length: room.total }, (_, i) => ({
    name: `${room.name} light ${i + 1}`,
    state: i < room.on ? 'on' : 'off',
  }));
