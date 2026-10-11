import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableFallback } from '../src/display/text-fallback';
import { smoothContainers } from '../src/display/smooth-display';
test('graphics recovery has a readable dashboard and preserves reply content', () => {
  const text = readableFallback({
    kind: 'home',
    title: 'Dashboard',
    headline: '12:30',
    tasks: 3,
    shopping: 8,
    battery: { glasses: 75 },
  });
  assert.match(text, /12:30/);
  assert.match(text, /Tasks: 3/);
  assert.match(text, /G2: 75%/);
  assert.match(text, /R1: unavailable/);
  assert.equal(
    readableFallback({ kind: 'reply', title: 'Chat', text: 'Complete answer' }),
    'Complete answer',
  );
});
test('image page uses standard 288 by 144 tiles with complete nonoverlapping screen coverage', () => {
  const page = smoothContainers('dashboard'),
    cells = new Set<string>();
  assert.equal(page.imageObject.length, 4);
  for (const tile of page.imageObject) {
    assert.equal(tile.width, 288);
    assert.equal(tile.height, 144);
    assert.ok(tile.containerName!.length <= 16);
    cells.add(`${tile.xPosition},${tile.yPosition}`);
  }
  assert.deepEqual([...cells], ['0,0', '288,0', '0,144', '288,144']);
});
