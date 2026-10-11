import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap } from '../src/display/text-wrap';
import { viewScreens } from '../src/home';
import { Conversation } from '../src/state/conversation';
test('wrapping handles oversized words and explicit paragraphs', () => {
  const lines = wrap('WWWWWWWW\nshort words', (s) => s.length * 10, 40);
  assert.deepEqual(lines, ['WWWW', 'WWWW', 'shor', 't', 'word', 's']);
  assert.ok(lines.every((x) => x.length <= 4));
});
test('room/list pages show observed values and explicit truncation', () => {
  const pages = viewScreens('shopping', {
    view: 'shopping',
    items: Array.from({ length: 7 }, (_, i) => ({ title: `Item ${i}` })),
    total: 130,
    more_available: true,
  });
  assert.equal(pages.length, 3);
  assert.match(pages[0].eyebrow!, /7 OF 130/);
  assert.match(pages[0].footer!, /MORE AVAILABLE/);
  const room = viewScreens('rooms', {
    view: 'rooms',
    rooms: [{ name: 'Kitchen', on: 2, total: 6, unavailable: 1 }],
  })[0];
  assert.match(room.rows![0].detail!, /2 \/ 6 lights on \/ 1 unavailable/);
});
test('restored conversations preserve IDs and use measured custom-font pagination', () => {
  const c = new Conversation(20, (text) => text.match(/.{1,10}/g) ?? []);
  c.restore([{ id: 41, question: 'A question', reply: 'A longer answer to show' }]);
  assert.equal(c.current?.exchange, 41);
  assert.ok(c.current!.parts > 1);
  c.add('Next', 'Reply');
  assert.equal(c.current?.exchange, 42);
});
