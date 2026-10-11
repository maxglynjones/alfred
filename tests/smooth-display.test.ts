import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEvenHubPageContainer,
  ImageRawDataUpdateResult,
  MenuContainerProperty,
} from '@evenrealities/even_hub_sdk';
import { smoothContainers, displayState, SmoothTransport } from '../src/display/smooth-display';
test('two-view layout has fixed non-overlapping text and small icon regions, with one capture surface', () => {
  const page = smoothContainers();
  assert.equal(validateEvenHubPageContainer(page).valid, true);
  assert.equal(page.textObject.filter((x) => x.isEventCapture === 1).length, 1);
  assert.equal(page.imageObject.length, 2);
  assert.ok(page.imageObject.every((x) => x.width! <= 288 && x.height! <= 144));
  const body = page.textObject.find((x) => x.containerID === 21)!;
  assert.ok(body.yPosition! >= 64);
  assert.ok(body.yPosition! + body.height! <= 256);
  const mic = page.imageObject.find((x) => x.containerID === 31)!;
  assert.equal(mic.width, 64);
  assert.equal(mic.height, 64);
  assert.ok(mic.yPosition! + mic.height! <= body.yPosition!);
  const dots = page.textObject.find((x) => x.containerID === 22)!;
  assert.ok(dots.xPosition! >= mic.xPosition! && dots.xPosition! < mic.xPosition! + mic.width!);
});
test('listening uses only a microphone icon, and idle never contains history or a dashboard', () => {
  assert.deepEqual(
    displayState({
      kind: 'activity',
      title: 'Assistant',
      status: 'LISTENING',
      text: 'Release to finish',
    }),
    { body: '', status: '', footer: '', listening: true, emblem: 'blank' },
  );
  assert.deepEqual(displayState({ kind: 'reply', title: 'Chat', text: '' }), {
    body: '',
    status: '',
    footer: '',
    listening: false,
    emblem: 'blank',
  });
});
test('dashboard never writes absent native reply containers and unchanged tiles cost no transfers', async () => {
  let texts = 0,
    images = 0;
  const bridge = {
    rebuildPageContainer: async () => true,
    textContainerUpgrade: async () => {
      texts++;
      return false;
    },
    updateImageRawData: async () => {
      images++;
      return ImageRawDataUpdateResult.success;
    },
  };
  const transport = new SmoothTransport(
    bridge,
    { butler: new Uint8Array([1]), blank: new Uint8Array([0]), microphone: new Uint8Array([2]) },
    () => assert.fail(),
  );
  const state: any = {
    body: '',
    status: '',
    footer: '',
    emblem: 'blank',
    listening: false,
    decoration: {
      key: 'room',
      panelKey: 'room',
      tiles: [{ id: 32, name: 'top', key: 'one', bytes: new Uint8Array([1]) }],
    },
  };
  transport.submit(state);
  await new Promise((r) => setImmediate(r));
  transport.submit(state);
  await new Promise((r) => setImmediate(r));
  assert.equal(texts, 0);
  assert.equal(images, 1);
  assert.equal(transport.metrics.rebuilds, 1);
});
test('slow bridge coalesces obsolete replies and dashboard transitions; later text changes never send full-screen images', async () => {
  const calls: Array<{ id: number; content?: string }> = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const bridge = {
    rebuildPageContainer: async () => true,
    textContainerUpgrade: async (data: any) => {
      calls.push({ id: data.containerID, content: data.content });
      if (calls.length === 1) await held;
      return true;
    },
    updateImageRawData: async (data: any) => {
      calls.push({ id: data.containerID });
      return ImageRawDataUpdateResult.success;
    },
  };
  const transport = new SmoothTransport(
    bridge,
    { butler: new Uint8Array([1]), microphone: new Uint8Array([2]), blank: new Uint8Array([0]) },
    () => assert.fail('No failure expected'),
  );
  transport.submit({
    body: 'Old reply',
    status: 'REPLY',
    footer: '',
    listening: false,
    emblem: 'blank',
  });
  transport.submit({
    body: 'Dashboard',
    status: '',
    footer: '',
    listening: false,
    emblem: 'blank',
  });
  transport.submit({ body: '', status: '', footer: '', listening: false, emblem: 'blank' });
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.filter((x) => x.id === 21).at(-1)!.content, ' ');
  assert.ok(!calls.some((x) => x.content === 'Dashboard'));
  assert.equal(calls.filter((x) => x.id >= 30).length, 2);
  calls.length = 0;
  transport.submit({
    body: 'New reply',
    status: 'REPLY',
    footer: '1 / 1',
    listening: false,
    emblem: 'blank',
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(calls.every((x) => x.id < 30));
  assert.equal(calls[0].content, 'New reply');
  transport.stop();
});

test('replies have no labels or counters and expiry can clear both icon and text', async () => {
  const active = displayState({
    kind: 'reply',
    title: 'Chat',
    status: 'REPLY',
    page: '2 / 5',
    text: 'A reply',
  });
  assert.equal(active.footer, '');
  assert.equal(active.status, '');
  assert.equal(active.emblem, 'butler');
  const calls: any[] = [];
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async () => true,
      textContainerUpgrade: async (d) => {
        calls.push(d);
        return true;
      },
      updateImageRawData: async (d) => {
        calls.push(d);
        return ImageRawDataUpdateResult.success;
      },
    },
    { butler: new Uint8Array([1]), microphone: new Uint8Array([2]), blank: new Uint8Array([0]) },
    () => assert.fail(),
  );
  transport.submit(active);
  await new Promise((r) => setImmediate(r));
  calls.length = 0;
  transport.submit(displayState({ kind: 'reply', title: 'Passive', text: '' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.find((x) => x.containerID === 21).content, ' ');
  assert.deepEqual(calls.find((x) => x.containerID === 30).imageData, new Uint8Array([0]));
  transport.stop();
});
test('dashboard separates weather and device/list stats, without a weather icon', () => {
  const state = displayState({
    kind: 'home',
    title: 'Home',
    weather: {
      available: true,
      city: 'Windsor',
      temperature: 14,
      description: 'Clear',
      weather_code: 0,
      is_day: false,
      feels_like: 12,
      wind_kmh: 8,
      humidity_percent: 70,
      sunrise: '2026-10-03T06:08:00Z',
      sunset: '2026-10-03T17:35:00Z',
      daylight_seconds: 41220,
    },
    tasks: 3,
    shopping: 8,
  });
  assert.equal(state.emblem, 'blank');
  assert.equal(state.body, '');
  assert.equal(state.right, '');
  assert.ok(!/^Wind /m.test(state.left!));
  assert.ok(!state.right!.includes('%'));
  assert.equal(state.left, '');
  assert.equal(state.footer, '');
});

test('native updates explicitly replace full content and clear stale labels even when the host ignores empty content', async () => {
  const physical = new Map<number, string>();
  const bridge = {
    rebuildPageContainer: async () => true,
    textContainerUpgrade: async (d: any) => {
      assert.equal(d.contentOffset, 0);
      assert.equal(d.contentLength, 0);
      if (d.content) physical.set(d.containerID, d.content);
      return true;
    },
    updateImageRawData: async () => ImageRawDataUpdateResult.success,
  };
  physical.set(22, 'Thinking…');
  physical.set(23, 'Updating…');
  const transport = new SmoothTransport(
    bridge,
    { butler: new Uint8Array([1]), blank: new Uint8Array([0]), microphone: new Uint8Array([2]) },
    () => assert.fail(),
  );
  transport.submit(displayState({ kind: 'reply', title: 'Chat', text: 'Done.' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(physical.get(22), ' ');
  assert.equal(physical.get(23), ' ');
  transport.submit(displayState({ kind: 'reply', title: 'Chat', text: '' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(physical.get(21), ' ');
  transport.stop();
});

test('thinking replaces the head with dots and a finished reply clears them', () => {
  assert.equal(
    displayState({ kind: 'activity', title: 'Assistant', status: 'THINKING' }).emblem,
    'blank',
  );
  assert.equal(
    displayState({ kind: 'activity', title: 'Assistant', status: 'THINKING' }).status,
    '· · ·',
  );
  assert.equal(displayState({ kind: 'reply', title: 'Chat', text: 'Done' }).status, '');
});

test('dashboard containers are removed before response text becomes visible', async () => {
  const calls: Array<{ id: number; content?: string; image?: number }> = [];
  const layouts: number[][] = [];
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async (page: any) => {
        layouts.push(page.imageObject.map((container: any) => container.containerID));
        calls.push({ id: -1 });
        return true;
      },
      textContainerUpgrade: async (d: any) => {
        calls.push({ id: d.containerID, content: d.content });
        return true;
      },
      updateImageRawData: async (d: any) => {
        calls.push({ id: d.containerID, image: d.imageData[0] });
        return ImageRawDataUpdateResult.success;
      },
    } as any,
    { butler: new Uint8Array([1]), blank: new Uint8Array([0]), microphone: new Uint8Array([2]) },
    () => assert.fail(),
  );
  transport.submit({
    ...displayState({ kind: 'home', title: 'Dashboard' }),
    decoration: { key: 'dashboard', panel: new Uint8Array([1]), solar: new Uint8Array([1]) },
  });
  await new Promise((r) => setImmediate(r));
  calls.length = 0;
  transport.submit({
    ...displayState({ kind: 'reply', title: 'Chat', text: 'Your answer.' }),
    decoration: { key: 'blank', panel: new Uint8Array([0]), solar: new Uint8Array([0]) },
  });
  await new Promise((r) => setImmediate(r));
  const answer = calls.findIndex((c) => c.id === 21 && c.content === 'Your answer.');
  assert.ok(answer >= 0);
  assert.deepEqual(layouts, [
    [32, 33, 34, 35],
    [30, 31],
  ]);
  assert.ok(calls.findIndex((c) => c.id === -1) < answer);
  assert.ok(!calls.some((c) => c.id === 32 || c.id === 33));
  transport.stop();
});

test('the large dashboard uses four supported tiles and unchanged content sends no images', async () => {
  const calls: Array<{ id: number; value: number }> = [];
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async () => true,
      textContainerUpgrade: async () => true,
      updateImageRawData: async (d: any) => {
        calls.push({ id: d.containerID, value: d.imageData[0] });
        return ImageRawDataUpdateResult.success;
      },
    } as any,
    { blank: new Uint8Array([0]), butler: new Uint8Array([1]), microphone: new Uint8Array([2]) },
    () => assert.fail(),
  );
  const state = displayState({ kind: 'home', title: 'Dashboard' });
  assert.equal(state.emblem, 'blank');
  transport.submit({
    ...state,
    decoration: {
      key: 'card',
      panelKey: 'card',
      solarKey: 'blank',
      panel: new Uint8Array([3]),
      solar: new Uint8Array([0]),
      tiles: [32, 33, 34, 35].map((id) => ({
        id,
        name: 'tile-' + id,
        x: 0,
        y: 0,
        bytes: new Uint8Array([3]),
        key: '3',
      })),
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(
    calls.filter((c) => c.value !== 0),
    [32, 33, 34, 35].map((id) => ({ id, value: 3 })),
  );
  calls.length = 0;
  transport.submit({
    ...state,
    decoration: {
      key: 'next',
      panelKey: 'next',
      solarKey: 'blank',
      panel: new Uint8Array([4]),
      solar: new Uint8Array([0]),
      tiles: [32, 33, 34, 35].map((id) => ({
        id,
        name: 'tile-' + id,
        x: 0,
        y: 0,
        bytes: new Uint8Array([4]),
        key: '4',
      })),
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(
    calls,
    [32, 33, 34, 35].map((id) => ({ id, value: 4 })),
  );
  calls.length = 0;
  transport.submit({
    ...state,
    decoration: {
      key: 'next',
      panel: new Uint8Array([4]),
      solar: new Uint8Array([0]),
      tiles: [32, 33, 34, 35].map((id) => ({
        id,
        name: 'tile-' + id,
        x: 0,
        y: 0,
        bytes: new Uint8Array([4]),
        key: '4',
      })),
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, []);
  transport.stop();
});

test('reply layout has no opaque or legacy containers intersecting its text rectangle', () => {
  const page = smoothContainers('conversation');
  const body = page.textObject.find((c) => c.containerID === 21)!;
  const overlaps = (c: any) =>
    c.xPosition < body.xPosition! + body.width! &&
    c.xPosition + c.width > body.xPosition! &&
    c.yPosition < body.yPosition! + body.height! &&
    c.yPosition + c.height > body.yPosition!;
  for (const c of [...page.textObject, ...page.imageObject]) {
    if (c.containerID === 21 || ('isEventCapture' in c && c.isEventCapture === 1)) continue;
    assert.equal(overlaps(c), false, `Container ${c.containerID} obscures reply text`);
  }
  const dashboard = smoothContainers('dashboard');
  assert.equal(validateEvenHubPageContainer(dashboard).valid, true);
  assert.ok(!dashboard.textObject.some((c) => c.containerID === 21));
  assert.deepEqual(
    dashboard.imageObject.map((c) => c.containerID),
    [32, 33, 34, 35],
  );
});

test('view rebuilds retain exit menu, coalesce stale views and never rebuild between reply pages', async () => {
  const menu = new MenuContainerProperty({});
  const layouts: any[] = [];
  const text: any[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async (page: any) => {
        layouts.push(page);
        if (layouts.length === 1) await held;
        return true;
      },
      textContainerUpgrade: async (data: any) => {
        text.push(data);
        return true;
      },
      updateImageRawData: async () => ImageRawDataUpdateResult.success,
    },
    { butler: new Uint8Array([1]), microphone: new Uint8Array([2]), blank: new Uint8Array([0]) },
    () => assert.fail('No display failure expected'),
    menu,
  );
  transport.submit({
    ...displayState({ kind: 'home', title: 'Home' }),
    decoration: { key: 'card', panel: new Uint8Array([3]), solar: new Uint8Array([0]) },
  });
  transport.submit(displayState({ kind: 'reply', title: 'Chat', text: 'Obsolete' }));
  transport.submit(displayState({ kind: 'reply', title: 'Chat', text: 'Latest reply' }));
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(layouts.length, 2);
  for (const page of layouts) {
    assert.equal(page.menuObject, menu);
    assert.equal(page.containerTotalNum, page.textObject.length + page.imageObject.length);
  }
  assert.ok(!text.some((data) => data.content === 'Obsolete'));
  assert.equal(text.filter((data) => data.containerID === 21).at(-1).content, 'Latest reply');
  transport.submit(displayState({ kind: 'reply', title: 'Chat', text: 'Next page' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(layouts.length, 2);
  transport.stop();
});

test('failed layout replacement falls back without writing into removed containers', async () => {
  let failed = 0,
    writes = 0;
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async () => false,
      textContainerUpgrade: async () => {
        writes++;
        return true;
      },
      updateImageRawData: async () => {
        writes++;
        return ImageRawDataUpdateResult.success;
      },
    },
    { butler: new Uint8Array([1]), microphone: new Uint8Array([2]), blank: new Uint8Array([0]) },
    () => {
      failed++;
    },
  );
  transport.submit({
    ...displayState({ kind: 'home', title: 'Home' }),
    decoration: { key: 'card', panel: new Uint8Array([3]), solar: new Uint8Array([0]) },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(failed, 1);
  assert.equal(writes, 0);
  transport.submit(displayState({ kind: 'reply', title: 'Chat', text: 'Ignored after failure' }));
  assert.equal(writes, 0);
});

test('minute refresh uploads only changed dashboard tile pixels', async () => {
  const writes: number[] = [];
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async () => true,
      textContainerUpgrade: async () => true,
      updateImageRawData: async (d: any) => {
        writes.push(d.containerID);
        return ImageRawDataUpdateResult.success;
      },
    },
    { blank: new Uint8Array([0]), butler: new Uint8Array([1]), microphone: new Uint8Array([2]) },
    () => assert.fail(),
  );
  const decorate = (clock: string) => ({
    key: clock,
    panel: new Uint8Array([1]),
    solar: new Uint8Array([0]),
    tiles: [32, 33, 34, 35].map((id) => ({
      id,
      name: 'tile-' + id,
      x: 0,
      y: 0,
      bytes: new Uint8Array([id]),
      key: id === 32 ? clock : 'stable-' + id,
    })),
  });
  const state = displayState({ kind: 'home', title: 'Dashboard' });
  transport.submit({ ...state, decoration: decorate('12:00') });
  await new Promise((r) => setImmediate(r));
  writes.length = 0;
  transport.submit({ ...state, decoration: decorate('12:01') });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(writes, [32]);
  transport.stop();
});

test('listening and thinking share one indicator bitmap slot and clear on reply', async () => {
  const writes: { id: number; pixel: number }[] = [];
  const text: { id: number; content: string }[] = [];
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async () => true,
      textContainerUpgrade: async (value) => {
        text.push({ id: value.containerID!, content: value.content! });
        return true;
      },
      updateImageRawData: async (value) => {
        writes.push({ id: value.containerID!, pixel: (value.imageData as Uint8Array)[0] });
        return ImageRawDataUpdateResult.success;
      },
    },
    {
      blank: new Uint8Array([0]),
      butler: new Uint8Array([1]),
      microphone: new Uint8Array([2]),
      dots3: new Uint8Array([3]),
    },
    () => assert.fail('transport failed'),
  );
  transport.submit(displayState({ kind: 'activity', title: '', status: 'LISTENING' }));
  await new Promise((r) => setImmediate(r));
  transport.submit(displayState({ kind: 'activity', title: '', status: 'THINKING' }));
  await new Promise((r) => setImmediate(r));
  transport.submit(displayState({ kind: 'reply', title: '', text: 'Six lights on.' }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(
    writes.filter((x) => x.id === 31).map((x) => x.pixel),
    [2, 3, 0],
  );
  assert.ok(text.filter((x) => x.id === 22).every((x) => x.content === ' '));
  transport.stop();
});

test('fast dashboard delivers all text in the first rebuild before any bitmap, and reopens cleanly', async () => {
  const { fastDashboardState } = await import('../src/display/smooth-display');
  const calls: any[] = [];
  const transport = new SmoothTransport(
    {
      rebuildPageContainer: async (page: any) => {
        calls.push({ kind: 'page', page });
        return true;
      },
      textContainerUpgrade: async (text: any) => {
        calls.push({ kind: 'text', text });
        return true;
      },
      updateImageRawData: async (image: any) => {
        calls.push({ kind: 'image', image });
        return ImageRawDataUpdateResult.success;
      },
    } as any,
    { blank: new Uint8Array([0]), butler: new Uint8Array([1]), microphone: new Uint8Array([2]) },
    () => assert.fail(),
  );
  const state = fastDashboardState({
    kind: 'home',
    title: 'Dashboard',
    headline: '12:30',
    date: '10 October 2026',
    weekday: 'Saturday',
    tasks: 3,
    shopping: 8,
  });
  const page = smoothContainers('dashboard-fast');
  assert.equal(validateEvenHubPageContainer(page).valid, true);
  transport.submit(state);
  await transport.whenSettled();
  assert.equal(calls[0].kind, 'page');
  assert.ok(calls[0].page.textObject[0].content.includes('12:30'));
  assert.ok(calls[0].page.textObject[2].content.includes('Tasks 3'));
  assert.equal(calls.filter((x) => x.kind === 'text').length, 0);
  assert.equal(calls.filter((x) => x.kind === 'image').length, 1);
  transport.submit(state);
  await transport.whenSettled();
  assert.equal(calls.length, 2);
  transport.submit({ body: '', status: '', footer: '', emblem: 'blank', listening: false });
  await transport.whenSettled();
  transport.submit(state);
  await transport.whenSettled();
  assert.equal(calls.filter((x) => x.kind === 'page').length, 3);
  transport.stop();
});
