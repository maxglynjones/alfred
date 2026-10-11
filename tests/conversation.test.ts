import { replyReadingTime, ReplyExpiry } from '../src/state/conversation';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, paginate, scrollDirection } from '../src/state/conversation';
test('conversation scrolling crosses replies and questions, new replies preserve old pages, latest/reset behave', () => {
  const c = new Conversation();
  c.add('First question', 'First reply');
  c.add('Second question', 'Second reply');
  assert.equal(c.current?.text, 'Second reply');
  c.move(-1);
  assert.equal(c.current?.text, 'Second question');
  c.move(-1);
  assert.equal(c.current?.text, 'First reply');
  c.add('Third question', 'Third reply');
  assert.equal(c.current?.text, 'Third reply');
  assert.equal(c.exchanges.length, 3);
  c.move(-99);
  assert.equal(c.current?.text, 'First question');
  c.latest();
  assert.equal(c.current?.text, 'Third reply');
  c.move(99);
  assert.equal(c.current?.text, 'Third reply');
  c.clear();
  assert.equal(c.current, undefined);
});
test('history is bounded and long responses scroll without oversized pages', () => {
  const c = new Conversation(2);
  c.add('Old', 'Old reply');
  c.add('Middle', 'Middle reply');
  c.add('Latest', 'word '.repeat(300));
  assert.equal(c.exchanges.length, 2);
  assert.ok(!c.pages.some((p) => p.text === 'Old reply'));
  assert.equal(c.current?.part, 1);
  c.move(1);
  assert.equal(c.current?.part, 2);
  assert.ok(paginate('a'.repeat(1000)).every((p) => p.length <= 300));
  assert.equal(scrollDirection(1), -1);
  assert.equal(scrollDirection(2), 1);
  assert.equal(scrollDirection(0), 0);
});

test('reply expiry is deterministic, scales with page length and bounds short/oversized content', () => {
  assert.equal(replyReadingTime('Done, sir.'), 8000);
  assert.equal(replyReadingTime(Array(40).fill('hello').join(' ')), 15000);
  assert.equal(replyReadingTime(Array(100).fill('hello').join(' ')), 33000);
  assert.equal(replyReadingTime('x'.repeat(10000)), 60000);
  assert.equal(replyReadingTime('same words'), replyReadingTime('same words'));
  assert.ok(replyReadingTime('https://example.com/' + 'a'.repeat(200)) > 8000);
});

test('wall-clock expiry remains due after a missed timer, and a new page starts its own budget', () => {
  let now = 0;
  const expiry = new ReplyExpiry(() => now);
  expiry.arm('Say yes or no.');
  now = 7999;
  assert.equal(expiry.due, false);
  now = 600000;
  assert.equal(expiry.due, true);
  assert.equal(expiry.due, true);
  expiry.arm('A new page.');
  assert.equal(expiry.due, false);
  now += 8000;
  assert.equal(expiry.due, true);
  expiry.clear();
  assert.equal(expiry.due, false);
});
