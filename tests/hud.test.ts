import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { AlfredHud, hudContainers } from '../src/display/hud';
test('Alfred glasses layout uses one input surface, respects screen bounds and SDK validation', () => {
  const containers = hudContainers();
  assert.equal(containers.filter((x) => x.isEventCapture === 1).length, 1);
  for (const x of containers) {
    assert.ok(x.xPosition! + x.width! <= 576);
    assert.ok(x.yPosition! + x.height! <= 288);
  }
  assert.equal(validateEvenHubPageContainer({ textObject: containers }).valid, true);
});
test('slow glasses updates coalesce intermediate frames without losing the latest reply', async () => {
  const calls: Array<{ containerID?: number; content?: string }> = [];
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const hud = new AlfredHud(
    {
      textContainerUpgrade: async (data) => {
        calls.push(data);
        if (calls.length === 1) await held;
        return true;
      },
    },
    false,
  );
  hud.show('Old reply');
  hud.show('Intermediate reply');
  hud.show('Latest reply', 'REPLY');
  release();
  await new Promise((r) => setImmediate(r));
  hud.stop();
  assert.ok(calls.some((x) => x.content === 'Latest reply'));
  assert.ok(!calls.some((x) => x.content === 'Intermediate reply'));
  assert.ok(calls.length <= 4);
});
test('status is isolated at the top right; activity animates only the lower scanner and stops on a reply', async () => {
  const containers = hudContainers();
  const status = containers.find((x) => x.containerID === 2)!;
  assert.ok(status.xPosition! >= 350);
  assert.equal(containers.length, 4);
  const calls: Array<{ containerID?: number; content?: string }> = [];
  const hud = new AlfredHud(
    {
      textContainerUpgrade: async (data) => {
        calls.push(data);
        return true;
      },
    },
    true,
  );
  hud.activity('THINKING', 'Working on it.', '');
  await new Promise((r) => setTimeout(r, 390));
  assert.equal(calls.filter((x) => x.containerID === 1).length, 1);
  assert.equal(calls.filter((x) => x.containerID === 2).length, 1);
  assert.ok(calls.filter((x) => x.containerID === 3).length >= 2);
  hud.show('Done.', 'REPLY 1', '1 / 1');
  await new Promise((r) => setImmediate(r));
  const count = calls.length;
  await new Promise((r) => setTimeout(r, 390));
  assert.equal(calls.length, count);
  assert.equal(calls.filter((x) => x.containerID === 3).at(-1)?.content, '1 / 1');
  hud.stop();
});
