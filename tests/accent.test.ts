import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccentMotion } from '../src/display/accent';
test('opening and closing motion finish blank, have a fixed lifetime, and skip congested intermediate frames', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frames: string[] = [];
  let busy = false;
  const motion = new AccentMotion(
    (frame) => frames.push(frame),
    () => busy,
  );
  const opened = motion.run('open');
  assert.deepEqual(frames, ['outline']);
  busy = true;
  context.mock.timers.tick(400);
  busy = false;
  context.mock.timers.tick(500);
  context.mock.timers.tick(2100);
  await opened;
  assert.deepEqual(frames, ['outline', 'butler', 'blank']);
  frames.length = 0;
  const closed = motion.run('close');
  for (let i = 0; i < 3; i++) context.mock.timers.tick(260);
  await closed;
  assert.deepEqual(frames, ['butler', 'arrival', 'outline', 'blank']);
});
test('new input cancels motion without late frames overwriting the next view', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const frames: string[] = [];
  const motion = new AccentMotion(
    (frame) => frames.push(frame),
    () => false,
  );
  const opened = motion.run('open');
  motion.cancel();
  await opened;
  context.mock.timers.tick(5000);
  assert.deepEqual(frames, ['outline']);
});
test('reduced motion sends no decorative frames', async () => {
  const motion = new AccentMotion(
    () => assert.fail('Decorative frame forbidden'),
    () => false,
    () => true,
  );
  await motion.run('open');
  await motion.run('close');
});
