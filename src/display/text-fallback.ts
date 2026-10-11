import type { Screen } from './types';
export function readableFallback(screen: Screen) {
  if (screen.kind !== 'home') return screen.text ?? '';
  const weather = screen.weather;
  const battery = (v?: number) => (v === undefined ? 'unavailable' : `${v}%`);
  return [
    [screen.headline, screen.weekday, screen.date].filter(Boolean).join(' / '),
    weather?.available
      ? `${weather.temperature}°C / ${weather.description ?? 'Weather'} / ${weather.city ?? ''}`
      : 'Weather unavailable; configure location in Alfred Home.',
    `Tasks: ${screen.tasks ?? 0} / Shopping: ${screen.shopping ?? 0}`,
    `G2: ${battery(screen.battery?.glasses)} / R1: ${battery(screen.battery?.ring)}`,
    screen.next_event ? `Next: ${screen.next_event.title}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}
