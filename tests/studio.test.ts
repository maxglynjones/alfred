import { test } from 'node:test';
import assert from 'node:assert/strict';
// Static UI model has no Home Assistant or browser side effects.
// @ts-ignore public modules ship without a TypeScript runtime dependency.
import { eventRows, newsCatalog, deviceIcon, homeRooms } from '../public/studio/operations.js';
test('activity merges bounded history, receipts and configuration chronologically', () => {
  const rows = eventRows({
    activity: [
      {
        kind: 'configuration',
        title: 'Updated',
        detail: 'apiKey',
        created_at: '2026-10-07T11:00:00Z',
      },
    ],
    history: [{ question: 'List?', reply: 'Empty.', created_at: '2026-10-07T12:00:00Z' }],
    actions: [{ kind: 'home', status: 'failed_or_uncertain', created_at: '2026-10-07T13:00:00Z' }],
  });
  assert.equal(rows[0].kind, 'action');
  assert.match(rows[0].detail, /uncertain/);
  assert.equal(rows[1].detail, 'Empty.');
  assert.equal(rows[2].detail, 'apiKey');
  assert.equal(
    eventRows({ history: Array.from({ length: 120 }, () => ({ question: 'Hello' })) }).length,
    100,
  );
});
test('home groups by HA area without merging identically named rooms', () => {
  const rooms = homeRooms([
    { area_id: 'one', room: 'Office', entity_id: 'light.one' },
    { area_id: 'two', room: 'Office', entity_id: 'light.two' },
    { area_id: 'one', room: 'Office', entity_id: 'light.three' },
    { entity_id: 'sensor.outside' },
  ]);
  assert.equal(rooms.length, 3);
  assert.equal(rooms[0].devices.length, 2);
  assert.equal(rooms[2].name, 'Unassigned');
});
test('optional news presets use distinct HTTPS sources and unknown devices have a vector fallback', () => {
  assert.equal(new Set(newsCatalog.map((x: any) => x.url)).size, newsCatalog.length);
  assert.ok(newsCatalog.every((x: any) => new URL(x.url).protocol === 'https:'));
  assert.match(deviceIcon('unsupported'), /<svg/);
  assert.doesNotMatch(deviceIcon('<script>'), /<script>/);
});
