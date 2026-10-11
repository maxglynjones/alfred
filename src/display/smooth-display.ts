import { drawStartup, startupAssets } from './startup-art';
import type { AccentFrame } from './accent';
import { replyLayout } from './reply-layout';
import {
  dashboardAssets,
  dashboardRegions,
  dashboardTiles,
  drawDashboardCard,
  prepareDashboardFont,
} from './dashboard-art';
import {
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  RebuildPageContainer,
  type MenuContainerProperty,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { AccentMotion } from './accent';
import type { Screen } from './types';
export type NativeView = 'conversation' | 'dashboard' | 'dashboard-fast';
export const smoothContainers = (view: NativeView = 'conversation') =>
  view === 'dashboard-fast'
    ? {
        // Native text arrives in the rebuild payload; no full-screen bitmap transfers.
        textObject: [
          [1, 'assistant', 24, 12, 452, 66],
          [21, 'body', 24, 90, 254, 132],
          [22, 'status', 302, 90, 250, 132],
          [23, 'footer', 24, 238, 528, 42],
        ].map(
          ([id, name, x, y, width, height]) =>
            new TextContainerProperty({
              containerID: Number(id),
              containerName: String(name),
              xPosition: Number(x),
              yPosition: Number(y),
              width: Number(width),
              height: Number(height),
              isEventCapture: id === 1 ? 1 : 0,
              content: ' ',
              paddingLength: 0,
              textColor: 1,
            }),
        ),
        imageObject: [
          new ImageContainerProperty({
            containerID: 30,
            containerName: 'butler',
            xPosition: 488,
            yPosition: 12,
            width: 64,
            height: 64,
          }),
        ],
      }
    : {
        textObject: [
          new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            containerID: 1,
            containerName: 'assistant',
            isEventCapture: 1,
            content: ' ',
            paddingLength: 0,
            zOrderIndex: 0,
          }),
          new TextContainerProperty({
            xPosition: replyLayout.x,
            yPosition: replyLayout.y,
            width: replyLayout.width,
            height: replyLayout.height,
            containerID: 21,
            containerName: 'body',
            content: ' ',
            paddingLength: 0,
            textColor: 2,
            zOrderIndex: 1,
          }),
          new TextContainerProperty({
            xPosition: 410,
            yPosition: 14,
            width: 74,
            height: 30,
            containerID: 22,
            containerName: 'status',
            content: ' ',
            paddingLength: 0,
            textColor: 1,
            zOrderIndex: 2,
          }),
          new TextContainerProperty({
            xPosition: 24,
            yPosition: 256,
            width: 200,
            height: 30,
            containerID: 23,
            containerName: 'footer',
            content: ' ',
            paddingLength: 0,
            textColor: 1,
            zOrderIndex: 3,
          }),
        ].filter((container) => view === 'conversation' || container.containerID === 1),
        imageObject: [
          new ImageContainerProperty({
            xPosition: 488,
            yPosition: 0,
            width: 64,
            height: 64,
            containerID: 30,
            containerName: 'butler',
            zOrderIndex: 4,
          }),
          new ImageContainerProperty({
            xPosition: 396,
            yPosition: 0,
            width: 64,
            height: 64,
            containerID: 31,
            containerName: 'microphone',
            zOrderIndex: 8,
          }),
          ...dashboardTiles.map(
            (tile) =>
              new ImageContainerProperty({
                containerID: tile.id,
                containerName: tile.name,
                xPosition: tile.x,
                yPosition: tile.y,
                width: 288,
                height: 144,
                zOrderIndex: tile.id - 26,
              }),
          ),
        ].filter((container) =>
          view === 'conversation' ? container.containerID! < 32 : container.containerID! >= 32,
        ),
      };
export type Emblem =
  | 'tick'
  | 'outline'
  | 'arrival'
  | 'blank'
  | 'butler'
  | 'sun'
  | 'moon'
  | 'cloud'
  | 'partly'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog'
  | 'dots1'
  | 'dots2'
  | 'dots3';
export type DisplayState = {
  startup?: AccentFrame;
  nativeDashboard?: boolean;
  decoration?: ReturnType<typeof dashboardAssets>;
  body: string;
  status: string;
  footer: string;
  listening: boolean;
  emblem: Emblem;
  header?: string;
  left?: string;
  right?: string;
};
const time = (value?: string, zone = 'UTC') =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '--:--';
export function weatherEmblem(code?: number, isDay = true): Emblem {
  if (code === 0 || code === 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ([71, 73, 75, 77, 85, 86].includes(code ?? -1)) return 'snow';
  if ([95, 96, 99].includes(code ?? -1)) return 'storm';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code ?? -1)) return 'rain';
  return 'blank';
}
export function displayState(screen: Screen): DisplayState {
  if (screen.kind === 'success')
    return { body: '', status: '', footer: '', listening: false, emblem: 'tick' };
  if (screen.kind === 'home') {
    return {
      body: '',
      header: '',
      left: '',
      right: '',
      status: '',
      footer: '',
      listening: false,
      emblem: 'blank',
    };
  }
  if (screen.kind === 'activity')
    return {
      body: '',
      status: '',
      footer: '',
      listening: screen.status === 'LISTENING',
      emblem: 'blank',
      ...(screen.status === 'THINKING' ? { status: '· · ·' } : {}),
    };
  return {
    body: screen.text ?? '',
    status: '',
    footer: '',
    listening: false,
    emblem: screen.text ? 'butler' : 'blank',
  };
}
export function fastDashboardState(screen: Screen): DisplayState {
  const compact = (s: string | undefined, n: number) => (s ?? '').slice(0, n);
  const w = screen.weather;
  const battery = (n?: number) => (n === undefined ? '—' : `${Math.round(n)}%`);
  return {
    body: '',
    status: '',
    listening: false,
    emblem: 'butler',
    nativeDashboard: true,
    header: `${screen.headline ?? '--:--'}  ${(screen.weekday ?? '').slice(0, 3)}\n${screen.date ?? ''}`,
    left: w?.available
      ? `${w.temperature}°  ${compact(w.description, 12)}\n${compact(w.city, 18)}\n${screen.next_event ? 'Next ' + time(screen.next_event.start?.dateTime, screen.timezone) : 'Your day'}\n${compact(screen.next_event?.title, 18)}`
      : `Weather\n${w?.configured ? 'Unavailable' : 'Not configured'}`,
    right: `Tasks ${screen.tasks ?? '—'}\nShopping ${screen.shopping ?? '—'}\n\nG2 ${battery(screen.battery?.glasses)}  R1 ${battery(screen.battery?.ring)}`,
    footer: `Rise ${time(w?.sunrise, w?.timezone)} ───── Set ${time(w?.sunset, w?.timezone)}`,
  };
}
const iconPaths: Record<Emblem, string> = {
  dots1: 'M10 18a2 2 0 1 0-4 0a2 2 0 1 0 4 0',
  dots2: 'M10 18a2 2 0 1 0-4 0a2 2 0 1 0 4 0M20 18a2 2 0 1 0-4 0a2 2 0 1 0 4 0',
  dots3:
    'M10 18a2 2 0 1 0-4 0a2 2 0 1 0 4 0M20 18a2 2 0 1 0-4 0a2 2 0 1 0 4 0M30 18a2 2 0 1 0-4 0a2 2 0 1 0 4 0',
  tick: 'M7 18l7 7L30 9',
  outline: 'M4 13V4h9M23 4h9v9M32 23v9h-9M13 32H4v-9',
  arrival:
    'M12 13C8 3 28 3 24 13M12 12v5c0 8 12 8 12 0v-5M12 10c3-2 9-2 12 0M4 13V4h5M27 4h5v9M32 27v5h-5M9 32H4v-5',
  blank: '',
  butler:
    'M12 13C8 3 28 3 24 13M12 12v5c0 8 12 8 12 0v-5M12 10c3-2 9-2 12 0M10 24l-6 6v5h28v-5l-6-6M12 24l6 11 6-11M12 26l5 2-5 2zM24 26l-5 2 5 2zM17 16h2M15 20h6',
  sun: 'M25 18a7 7 0 1 0-14 0a7 7 0 1 0 14 0M18 2v5M18 29v5M2 18h5M29 18h5M6 6l4 4M26 26l4 4M6 30l4-4M26 10l4-4',
  moon: 'M23 3C6 3 3 27 20 31Q30 32 34 22C20 27 14 13 23 3Z',
  cloud: 'M9 27C-1 27 0 15 8 15C10 3 27 4 28 15C39 15 38 27 28 27Z',
  partly:
    'M10 3v4M0 13h4M2 4l3 3M17 5l-3 3M7 16a6 6 0 1 1 10-7M11 30C2 30 3 18 11 18C13 8 28 9 29 19C39 19 38 30 29 30Z',
  rain: 'M8 22C-1 22 0 11 8 11C10 0 26 1 28 12C38 12 38 22 28 22ZM9 28l-3 6M19 28l-3 6M29 28l-3 6',
  snow: 'M8 20C-1 20 0 9 8 9C10-1 26 0 28 10C38 10 38 20 28 20ZM9 26v8M5 30h8M25 26v8M21 30h8',
  storm: 'M8 20C-1 20 0 9 8 9C10-1 26 0 28 10C38 10 38 20 28 20ZM19 24l-6 7h6l-3 7 10-10h-7Z',
  fog: 'M8 20C-1 20 0 9 8 9C10-1 26 0 28 10C38 10 38 20 28 20ZM2 27h32M6 33h25',
};
const microphonePath =
  'M13 7Q18 1 23 7V19Q18 25 13 19ZM8 16V19Q8 31 18 31Q28 31 28 19V16M18 31V37M12 37H24';
// One queue owns layout changes and all writes. Bitmap containers are opaque:
// black dashboard pixels must never remain over a conversation. Rebuild only
// when switching views, never for reply pages or animation frames.
export class SmoothTransport {
  private pending: DisplayState | undefined;
  private sending = false;
  private stopped = false;
  private sent = new Map<number, string>();
  private view: NativeView = 'conversation';
  readonly timings: number[] = [];
  readonly metrics = { textWrites: 0, imageWrites: 0, rebuilds: 0, dashboardFirstFrameMs: 0 };
  get averageWriteMs() {
    return this.timings.length ? this.timings.reduce((a, b) => a + b, 0) / this.timings.length : 0;
  }
  constructor(
    private bridge: Pick<
      EvenAppBridge,
      'textContainerUpgrade' | 'updateImageRawData' | 'rebuildPageContainer'
    >,
    private icons: {
      butler: Uint8Array;
      microphone: Uint8Array;
      blank: Uint8Array;
      microphoneBlank?: Uint8Array;
    } & Partial<Record<Emblem, Uint8Array>>,
    private failure: (reason?: string) => void,
    private menuObject?: MenuContainerProperty,
  ) {}
  submit(state: DisplayState) {
    if (this.stopped) return;
    this.pending = state;
    void this.flush();
  }
  get updating() {
    return this.sending || Boolean(this.pending);
  }
  async whenSettled() {
    const deadline = Date.now() + 4000;
    while (this.updating && !this.stopped && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 40));
  }
  private async flush() {
    if (this.sending || this.stopped) return;
    this.sending = true;
    try {
      while (this.pending && !this.stopped) {
        const state = this.pending;
        this.pending = undefined;
        const nextView: NativeView = state.nativeDashboard
          ? 'dashboard-fast'
          : state.decoration && (state.decoration.panelKey ?? state.decoration.key) !== 'blank'
            ? 'dashboard'
            : 'conversation';
        if (nextView !== this.view) {
          const layoutStarted = performance.now();
          const containers = smoothContainers(nextView);
          if (nextView === 'dashboard-fast') {
            const content = [state.header, state.left, state.right, state.footer];
            containers.textObject.forEach((c, i) => {
              c.content = content[i] || ' ';
            });
          }
          if (
            !(await this.bridge.rebuildPageContainer(
              new RebuildPageContainer({
                ...containers,
                containerTotalNum: containers.textObject.length + containers.imageObject.length,
                menuObject: this.menuObject,
              }),
            ))
          )
            throw Error('Layout refused');
          if (nextView === 'dashboard-fast')
            this.metrics.dashboardFirstFrameMs = Math.round(performance.now() - layoutStarted);
          this.view = nextView;
          this.metrics.rebuilds++;
          this.sent.clear();
          if (nextView === 'dashboard-fast')
            [state.header, state.left, state.right, state.footer].forEach((v, i) =>
              this.sent.set([1, 21, 22, 23][i], v || ' '),
            );
        }
        if (this.pending || this.stopped) continue;
        if (this.view === 'dashboard-fast') {
          for (const [id, name, value] of [
            [1, 'assistant', state.header],
            [21, 'body', state.left],
            [22, 'status', state.right],
            [23, 'footer', state.footer],
          ] as const) {
            if (this.pending || this.stopped) break;
            const content = value || ' ';
            if (this.sent.get(id) === content) continue;
            if (
              !(await this.bridge.textContainerUpgrade(
                new TextContainerUpgrade({
                  containerID: id,
                  containerName: name,
                  contentOffset: 0,
                  contentLength: 0,
                  content,
                }),
              ))
            )
              throw Error('Dashboard text refused');
            this.sent.set(id, content);
            this.metrics.textWrites++;
          }
          if (this.pending || this.stopped) continue;
          if (this.sent.get(30) !== 'butler') {
            if (
              (await this.bridge.updateImageRawData(
                new ImageRawDataUpdate({
                  containerID: 30,
                  containerName: 'butler',
                  imageData: this.icons.butler,
                }),
              )) !== ImageRawDataUpdateResult.success
            )
              throw Error('Butler refused');
            this.sent.set(30, 'butler');
            this.metrics.imageWrites++;
          }
          continue;
        }
        if (this.view === 'dashboard' && state.decoration) {
          const tiles: Array<{ id: number; name: string; bytes: Uint8Array; key?: string }> = state
            .decoration.tiles ?? [
            { id: 32, name: 'dashboard-top-left', bytes: state.decoration.panel },
            { id: 33, name: 'dashboard-top-right', bytes: state.decoration.solar },
          ];
          for (const { id, name, bytes, key: pixelKey } of tiles) {
            const key = pixelKey ?? state.decoration.key;
            if (this.pending || this.stopped) break;
            if (this.sent.get(id) === key) continue;
            const started = performance.now();
            if (
              (await this.bridge.updateImageRawData(
                new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: bytes }),
              )) !== ImageRawDataUpdateResult.success
            )
              throw Error(`Dashboard image ${id} refused`);
            this.sent.set(id, key);
            this.metrics.imageWrites++;
            this.timings.push(performance.now() - started);
            this.timings.splice(0, Math.max(0, this.timings.length - 30));
          }
        }
        if (this.pending || this.stopped) continue;
        // Dashboard pages contain only the capture text object, not reply/status
        // containers. Updating absent IDs could fail and strand the display.
        if (this.view === 'dashboard') continue;
        for (const [id, name, content] of (
          [
            [21, 'body', state.body],
            [22, 'status', state.status.includes('·') ? '' : state.status],
            [23, 'footer', state.footer],
          ] as const
        )
          .slice()
          .sort((a, b) => Number(Boolean(a[2])) - Number(Boolean(b[2])))) {
          if (this.stopped) break;
          if (this.pending) break;
          if (this.sent.get(id) === content) continue;
          const start = performance.now();
          if (
            !(await this.bridge.textContainerUpgrade(
              new TextContainerUpgrade({
                containerID: id,
                containerName: name,
                contentOffset: 0,
                contentLength: 0,
                content: content || ' ',
              }),
            ))
          )
            throw Error('Text refused');
          this.timings.push(performance.now() - start);
          this.timings.splice(0, Math.max(0, this.timings.length - 30));
          this.sent.set(id, content);
          this.metrics.textWrites++;
        }
        if (this.pending || this.stopped) continue;
        if (this.sent.get(30) !== state.emblem) {
          const started = performance.now();
          if (
            (await this.bridge.updateImageRawData(
              new ImageRawDataUpdate({
                containerID: 30,
                containerName: 'butler',
                imageData: this.icons[state.emblem] ?? this.icons.blank,
              }),
            )) !== ImageRawDataUpdateResult.success
          )
            throw Error('Icon refused');
          this.sent.set(30, state.emblem);
          this.metrics.imageWrites++;
          this.timings.push(performance.now() - started);
          this.timings.splice(0, Math.max(0, this.timings.length - 30));
        }
        if (this.pending || this.stopped) continue;
        const dots = state.status.includes('·')
          ? (`dots${state.status.split('·').length - 1}` as Emblem)
          : undefined;
        const mic = state.listening ? 'microphone' : (dots ?? 'blank');
        if (this.sent.get(31) !== mic) {
          const started = performance.now();
          if (
            (await this.bridge.updateImageRawData(
              new ImageRawDataUpdate({
                containerID: 31,
                containerName: 'microphone',
                imageData: state.listening
                  ? this.icons.microphone
                  : dots
                    ? (this.icons[dots] ?? this.icons.blank)
                    : (this.icons.microphoneBlank ?? this.icons.blank),
              }),
            )) !== ImageRawDataUpdateResult.success
          )
            throw Error('Icon refused');
          this.sent.set(31, mic);
          this.metrics.imageWrites++;
          this.timings.push(performance.now() - started);
          this.timings.splice(0, Math.max(0, this.timings.length - 30));
        }
      }
    } catch (error) {
      this.stopped = true;
      this.pending = undefined;
      this.failure(error instanceof Error ? error.message : 'Display transfer failed');
    } finally {
      this.sending = false;
    }
  }
  stop() {
    this.stopped = true;
    this.pending = undefined;
  }
}
export class SmoothDisplay {
  private transport: SmoothTransport | undefined;
  private dashboardScreen: Screen | undefined;
  private animation: ReturnType<typeof setInterval> | undefined;
  private accent: AccentMotion;
  constructor(private canvas: HTMLCanvasElement) {
    void prepareDashboardFont().then(() => {
      if (this.dashboardScreen) this.show(this.dashboardScreen);
    });
    this.accent = new AccentMotion(
      (emblem) =>
        this.render({
          body: '',
          status: '',
          footer: '',
          listening: false,
          emblem,
          startup: emblem,
          decoration: startupAssets(emblem),
        }),
      () => this.transport?.updating ?? false,
      () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    );
  }
  whenSettled() {
    return this.transport?.whenSettled() ?? Promise.resolve();
  }
  cancelMotion() {
    this.stopAnimation();
  }
  transition(direction: 'open' | 'close') {
    this.dashboardScreen = undefined;
    this.stopAnimation();
    return this.accent.run(direction);
  }
  private stopAnimation() {
    this.accent.cancel();
    if (this.animation) clearInterval(this.animation);
    this.animation = undefined;
  }
  attach(
    bridge: EvenAppBridge,
    failure: (reason?: string) => void,
    menuObject?: MenuContainerProperty,
  ) {
    const icon = (path: string, size = 64) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 64, 64);
      ctx.scale(size / 64, size / 64);
      ctx.strokeStyle = '#777';
      ctx.lineWidth = 1.7;
      ctx.lineJoin = 'round';
      ctx.translate(14, 14);
      if (path) ctx.stroke(new Path2D(path));
      return Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (char) =>
        char.charCodeAt(0),
      );
    };
    const icons = Object.fromEntries(
      Object.entries(iconPaths).map(([kind, path]) => [kind, icon(path)]),
    ) as Record<Emblem, Uint8Array>;
    this.transport = new SmoothTransport(
      bridge,
      { ...icons, microphone: icon(microphonePath), microphoneBlank: icon('') },
      failure,
      menuObject,
    );
  }
  show(screen: Screen) {
    this.dashboardScreen = screen.kind === 'home' ? screen : undefined;
    this.stopAnimation();
    const state = displayState(screen);
    state.decoration = dashboardAssets(screen.kind === 'home' ? screen : undefined);
    this.render(state);
    if (screen.kind === 'activity' && screen.status === 'THINKING') {
      let phase = 0;
      this.animation = setInterval(() => {
        if (this.transport?.updating || (this.transport?.averageWriteMs ?? 0) > 250) return;
        this.render({ ...state, status: ['·', '· ·', '· · ·'][phase++ % 3] });
      }, 800);
    }
  }
  private render(state: DisplayState) {
    this.transport?.submit(state);
    const c = this.canvas.getContext('2d')!;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 576, 288);
    c.strokeStyle = '#777';
    c.lineWidth = 1.7;
    c.save();
    c.translate(502, 14);
    if (iconPaths[state.emblem]) c.stroke(new Path2D(iconPaths[state.emblem]));
    c.restore();
    c.font = '20px sans-serif';
    c.fillStyle = '#888';
    state.body
      .split('\n')
      .slice(0, replyLayout.lines)
      .forEach((line, i) => c.fillText(line, replyLayout.x, replyLayout.y + 23 + i * 32));
    c.font = '18px sans-serif';
    c.fillStyle = '#888';
    if (state.header && !state.nativeDashboard) c.fillText(state.header, 24, 40);
    for (const [text, x, y] of [
      [state.left, 24, 98],
      [state.right, 310, 139],
    ] as const)
      (state.nativeDashboard ? '' : (text ?? ''))
        .split('\n')
        .forEach((line, i) => c.fillText(line, x, y + i * 30));
    if (state.startup) {
      c.save();
      c.translate(128, 66);
      c.scale(1.6, 1.6);
      drawStartup(c, state.startup);
      c.restore();
    }
    if (state.nativeDashboard || (state.decoration?.key !== 'blank' && state.decoration)) {
      const screen = this.dashboardScreen;
      if (screen) {
        c.save();
        c.translate(dashboardRegions.left.x + 13, dashboardRegions.left.y + 2);
        c.scale(1.8, 1.8);
        drawDashboardCard(c, screen);
        c.restore();
      }
    }
    c.font = '12px sans-serif';
    c.fillStyle = '#666';
    if (state.status.includes('·')) {
      c.save();
      c.translate(410, 14);
      c.stroke(new Path2D(iconPaths[`dots${state.status.split('·').length - 1}` as Emblem]));
      c.restore();
    } else c.fillText(state.status, 410, 32);
    c.fillText(state.footer, 24, 272);
    if (state.listening) {
      c.save();
      c.translate(410, 14);
      c.stroke(new Path2D(microphonePath));
      c.restore();
    }
  }

  stop() {
    this.stopAnimation();
    this.transport?.stop();
  }
}
