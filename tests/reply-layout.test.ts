import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyPages, replyLineWidth, replyLayout } from '../src/display/reply-layout';
test('wide words, long addresses and unicode responses fit inside the reply gutter without losing content', () => {
  for (const text of [
    'WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM WWW MMM',
    'The bedroom lights are now switched off. Would you like anything else?',
    'https://example.com/averylongunbrokenaddresswithMMMMMMMMMMMMMMMMMMMMMMMM',
    '日本語の長い回答でも右端で文字を切り落とさずに表示します。',
  ]) {
    const pages = replyPages(text);
    for (const page of pages) {
      assert.ok(page.split('\n').length <= replyLayout.lines);
      for (const line of page.split('\n')) assert.ok(replyLineWidth(line) <= replyLayout.wrapWidth);
    }
    assert.equal(pages.join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''));
  }
  assert.ok(replyLayout.wrapWidth < replyLayout.width);
  assert.ok(replyLineWidth('MMMM') > replyLineWidth('aaaa'));
});

test('document previews keep complete content through short pages with conservative native geometry', () => {
  const text =
    'Document preview\n' +
    Array.from(
      { length: 60 },
      (_, i) =>
        `${i + 1}. WWW report findings at https://example.org/${'longpath'.repeat(8)}. café 日本語`,
    ).join('\n') +
    '\nSay yes or no.';
  const pages = replyPages(text);
  assert.equal(pages.join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''));
  assert.ok(pages.length > 5);
  assert.ok(pages.at(-1)?.includes('Say yes or no.'));
  assert.ok(replyLayout.x + replyLayout.width <= 576);
  assert.ok(replyLayout.y + replyLayout.height <= 288);
  assert.ok(replyLayout.width - replyLayout.wrapWidth >= 24);
  for (const page of pages)
    for (const line of page.split('\n')) assert.ok(replyLineWidth(line) <= replyLayout.wrapWidth);
});

test('ordinary replies fill the width instead of breaking into narrow columns', () => {
  const pages = replyPages(
    'The bedroom lights are now switched off. Your shopping list has milk, bread, tomatoes and pasta. Is there anything else you need?',
  );
  assert.equal(pages.length, 1);
  assert.ok(pages[0].split('\n')[0].length >= 40);
});
