import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Capture, MAX_BYTES, wav, type Recording } from '../src/audio/capture';

test('tap recording starts and finishes without a hold or R1 release', async () => {
  const calls: boolean[] = [];
  let completions = 0;
  const capture = new Capture({
    microphone: async (open) => {
      calls.push(open);
      return true;
    },
    status: () => {},
    complete: () => {
      completions++;
    },
  });
  capture.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capture.state, 'listening');
  capture.release();
  assert.equal(capture.state, 'listening');
  capture.add(new Uint8Array(3200));
  capture.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capture.state, 'idle');
  assert.deepEqual(calls, [true, false]);
  assert.equal(completions, 1);
});

test('release during microphone opening closes it once without losing the release', async () => {
  let open!: (value: boolean) => void;
  const calls: boolean[] = [];
  const capture = new Capture({
    microphone: async (value) => {
      calls.push(value);
      return value
        ? await new Promise<boolean>((resolve) => {
            open = resolve;
          })
        : true;
    },
    status: () => {},
    complete: () => assert.fail('No audio should be reported'),
  });
  const start = capture.start();
  await capture.stop();
  open(true);
  await start;
  assert.deepEqual(calls, [true, false]);
  assert.equal(capture.state, 'idle');
});

test('captured bytes are bounded, analysed, and exported as a playable WAV', async () => {
  let recording: Recording | undefined;
  const capture = new Capture({
    microphone: async () => true,
    status: () => {},
    complete: (value) => {
      recording = value;
    },
  });
  await capture.start();
  const pcm = new Uint8Array(32000);
  new DataView(pcm.buffer).setInt16(0, 16384, true);
  capture.add(pcm);
  await capture.stop();
  assert.ok(recording);
  assert.equal(recording.seconds, 1);
  assert.equal(recording.peak, 0.5);
  const file = wav(recording.pcm);
  const view = new DataView(file.buffer);
  assert.equal(new TextDecoder().decode(file.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 32000);
  assert.deepEqual(file.subarray(44), pcm);
  capture.add(pcm);
  assert.equal(capture.state, 'idle');
  await capture.start();
  capture.add(new Uint8Array(MAX_BYTES + 100));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recording.pcm.length, MAX_BYTES);
  assert.equal(capture.state, 'idle');
});

test('cancel discards audio; a failed close prevents recording another session', async () => {
  let refuseClose = false,
    completions = 0;
  const capture = new Capture({
    microphone: async (open) => open || !refuseClose,
    status: () => {},
    complete: () => {
      completions++;
    },
  });
  await capture.start();
  capture.add(new Uint8Array(32000));
  await capture.stop(true);
  assert.equal(completions, 0);
  assert.equal(capture.state, 'idle');
  await capture.start();
  refuseClose = true;
  await capture.stop();
  assert.equal(capture.state, 'error');
  await capture.start();
  assert.equal(capture.state, 'error');
});
