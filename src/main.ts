import product from '../config/product.json';
import { setupPhoneNavigation } from './phone-navigation';
import { renderActivity } from './companion';
import displayPower from '../config/display-power.json';
import { readableFallback } from './display/text-fallback';
import { gestureAction, gestureInput, tapIntent } from './state/gestures';
import { DeviceBatteries } from './state/devices';
import {
  AppLocationAccuracy,
  EvenAppMethod,
  AudioInputSource,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  EventSourceType,
  OsEventTypeList,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { Capture, wav, type Recording } from './audio/capture';
import { Conversation, scrollDirection, ReplyExpiry } from './state/conversation';
import {
  backendOrigin as chooseBackendOrigin,
  readApiResponse,
  ApiError,
  privateOrigin,
} from './backend';
import { AlfredHud, hudContainers } from './display/hud';
import { type Screen } from './display/types';
import { replyPages } from './display/reply-layout';
import { viewScreens, sampleSnapshots, type Snapshot } from './home';
type Mode = 'home' | 'conversation';
const modes: Mode[] = ['home', 'conversation'];
const edition = document.querySelector('.edition');
if (edition) edition.textContent = 'iPhone · Home Assistant';
const names = { home: 'Dashboard', conversation: 'Talk' };
import { persistentStorage } from './state/storage';
import { SmoothDisplay, smoothContainers, displayState } from './display/smooth-display';
import './style.css';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const simulator = new URLSearchParams(location.search).get('sim') === '1';
const phoneMode = new URLSearchParams(location.search).get('phone') === '1';
const preview = simulator || new URLSearchParams(location.search).get('preview') === '1';
const connection = el('connection'),
  display = el('display'),
  toggle = el<HTMLButtonElement>('toggle'),
  cancel = el<HTMLButtonElement>('cancel'),
  reset = el<HTMLButtonElement>('reset'),
  download = el<HTMLButtonElement>('download');
const backendOrigin = chooseBackendOrigin(location);
let pairing = '';
try {
  pairing = localStorage.getItem('assistant-pairing') ?? '';
} catch {
  /* Pairing form handles unavailable storage. */
}
const fromQR = new URLSearchParams(location.hash.slice(1)).get('pair');
if (fromQR && /^[a-f0-9]{64}$/.test(fromQR)) {
  pairing = fromQR;
  try {
    localStorage.setItem('assistant-pairing', pairing);
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* User can re-pair in the installed app. */
  }
}
function log(message: string) {
  el('log').textContent =
    `${new Date().toLocaleTimeString()} ${message}\n${el('log').textContent ?? ''}`.slice(0, 6000);
}
async function api(path: string, options: RequestInit = {}) {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(
          ['/api/voice', '/api/ask', '/api/speech', '/api/image'].includes(path) ? 32000 : 6000,
        ),
      ])
    : AbortSignal.timeout(6000);
  try {
    return await readApiResponse(
      await fetch(backendOrigin + path, {
        ...options,
        signal,
        headers: { ...options.headers, 'X-Alfred-Token': pairing },
      }),
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError) {
      if (error.status === 401) {
        el('pairing-form').hidden = false;
        el('pairing-status').textContent =
          'Pairing is invalid or revoked. Create a new code on your server.';
      }
      throw error;
    }
    throw new Error(
      signal.aborted
        ? 'Your HA server took too long to respond. Check its connection and Alfred integration. Completed actions are not retried.'
        : error instanceof TypeError
          ? 'Cannot reach Home Assistant. Check your remote connection and that HA is running.'
          : error instanceof Error
            ? error.message
            : 'The server connection failed.',
    );
  }
}
async function start(bridge?: EvenAppBridge) {
  el<HTMLAnchorElement>('operations-link').href = privateOrigin || chooseBackendOrigin(location);
  let restoreFailed = false;
  const storage = persistentStorage(
    {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
    preview ? undefined : bridge,
  );
  if (!preview) {
    try {
      pairing =
        fromQR && /^[a-f0-9]{64}$/.test(fromQR) ? fromQR : await storage.read('assistant-pairing');
      if (fromQR && pairing === fromQR) await storage.write('assistant-pairing', pairing);
    } catch {
      restoreFailed = true;
      pairing = '';
      connection.textContent =
        'Even could not restore your saved pairing. Close and reopen Alfred.';
    }
  }
  let interactionProfile = 'store';
  let profileAddress = '';
  const deviceBatteries = new DeviceBatteries();
  const battery = deviceBatteries.values;
  let readingDevice = false,
    dashboardReady = false,
    lastDeviceRead = 0;
  let deviceReadState = 'Not checked yet.';
  let nativeDeviceFields = '';
  let identityCache = '';
  function deviceSummary() {
    const d = deviceBatteries.diagnostics();
    return `G2: ${d.glasses === undefined ? 'No battery supplied' : d.glasses + '%'}\nR1: ${d.ring !== undefined ? d.ring + '%' : d.ringIdentified ? 'Identified; no battery supplied' : 'No ring identity supplied'}\nUnidentified battery sources: ${d.unidentifiedReadings}\n${deviceReadState}\n${nativeDeviceFields}`;
  }
  function showDeviceSummary() {
    const candidates = el('ring-candidates');
    candidates.replaceChildren();
    for (const reading of deviceBatteries.unidentified()) {
      const row = document.createElement('p'),
        button = document.createElement('button');
      row.textContent = `Unidentified device ending ${reading.sn.slice(-4)}: ${reading.battery}% `;
      button.textContent = 'This is my R1';
      button.onclick = () => {
        el<HTMLInputElement>('ring-serial').value = reading.sn;
        void changeRingIdentity(false);
      };
      row.append(button);
      candidates.append(row);
    }
    el('device-battery-status').textContent = bridge
      ? deviceSummary()
      : 'Device readings are available inside the Even iPhone app, not Safari or the desktop preview.';
  }
  async function refreshDevice(force = false) {
    if (
      !bridge ||
      readingDevice ||
      closed ||
      (!force && Date.now() - lastDeviceRead < displayPower.deviceReadCooldownMs)
    )
      return;
    readingDevice = true;
    lastDeviceRead = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      // Same documented native method as getDeviceInfo(), preserving explicit
      // model/status fields before the SDK defaults unknown models to G1 and
      // missing battery readings to 0. Do not send speculative ring parameters.
      const info = await Promise.race([
        bridge.callEvenApp(EvenAppMethod.GetGlassesInfo),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, 2000);
        }),
      ]);
      nativeDeviceFields = Array.isArray(info)
        ? 'Device list supplied'
        : info && typeof info === 'object'
          ? 'Native fields: ' + Object.keys(info).slice(0, 12).join(', ')
          : 'No native snapshot';
      const count = deviceBatteries.registerPayload(info);
      deviceReadState = count
        ? `Device information received at ${new Date().toLocaleTimeString()}.`
        : timedOut
          ? 'Even did not respond within two seconds.'
          : 'Even supplied no identifiable device information.';
      const identities = JSON.stringify(deviceBatteries.identities());
      if (identities !== identityCache && count) {
        void storage
          .write('assistant-device-identities', identities)
          .then(() => {
            identityCache = identities;
          })
          .catch(() => {
            /* Battery reads remain usable without saved identity bindings. */
          });
      }
      if (dashboardReady && mode === 'home' && snapshot && !busy && !overlay)
        paint(viewScreens('home', snapshot)[0]);
    } catch {
      deviceReadState = 'The Even device-information request failed.';
    } finally {
      if (timer) clearTimeout(timer);
      readingDevice = false;
      showDeviceSummary();
    }
  }
  el('device-battery-refresh').onclick = () => {
    void refreshDevice(true);
    showDeviceSummary();
  };
  showDeviceSummary();
  el<HTMLButtonElement>('ring-bind').disabled = !bridge;
  el<HTMLButtonElement>('ring-forget').disabled = !bridge;
  async function changeRingIdentity(forget: boolean) {
    const node = el('ring-bind-status');
    const previous = deviceBatteries.identities();
    try {
      if (!bridge) throw Error('Open Alfred inside the Even iPhone app to save device identity.');
      if (forget) deviceBatteries.forgetRing();
      else deviceBatteries.bindRing(el<HTMLInputElement>('ring-serial').value);
      const identities = JSON.stringify(deviceBatteries.identities());
      await storage.write('assistant-device-identities', identities);
      identityCache = identities;
      node.textContent = forget
        ? 'Saved R1 identity forgotten. Refresh device readings.'
        : 'R1 identity saved. Waiting for a reading from that exact serial.';
      el<HTMLInputElement>('ring-serial').value = '';
    } catch (error) {
      deviceBatteries.forgetRing();
      deviceBatteries.restore(previous);
      node.textContent = error instanceof Error ? error.message : 'R1 identity could not be saved.';
    }
    showDeviceSummary();
    if (dashboardReady && mode === 'home' && snapshot && !busy && !overlay)
      paint(viewScreens('home', snapshot)[0]);
  }
  el('ring-bind').onclick = () => {
    void changeRingIdentity(false);
  };
  el('ring-forget').onclick = () => {
    void changeRingIdentity(true);
  };
  if (bridge) {
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          storage.read('assistant-device-identities'),
          new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve(''), 2000);
          }),
        ]);
        deviceBatteries.restore(JSON.parse(value || '[]'));
        identityCache = JSON.stringify(deviceBatteries.identities());
      } catch {
        /* Ignore malformed or unavailable identity bindings. */
      } finally {
        if (timer) clearTimeout(timer);
        void refreshDevice();
      }
    })();
    bridge.onDeviceStatusChanged((status) => {
      deviceBatteries.update(status, false);
      // Unknown ring readings are not a reason to repeatedly query the glasses.
      showDeviceSummary();
      if (dashboardReady && mode === 'home' && snapshot && !busy && !overlay)
        paint(viewScreens('home', snapshot)[0]);
    });
  }
  const smooth = new SmoothDisplay(el<HTMLCanvasElement>('glasses'));
  const conversation = new Conversation(20, replyPages);
  let mode: Mode = 'conversation',
    current: Screen = { kind: 'home', title: 'Home', headline: 'At your service.' },
    busy = false,
    overlay = false,
    exiting = false,
    request: AbortController | undefined,
    lastRecording: Recording | undefined,
    loadId = 0,
    loading: AbortController | undefined;
  let closed = false;
  dashboardReady = true;
  let native = false,
    nativeHud: AlfredHud | undefined;
  const menuObject = new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemID: 1, itemName: 'Dashboard' }),
      new MenuItemProperty({ itemID: 6, itemName: 'Speak' }),
      new MenuItemProperty({ itemID: 7, itemName: 'Hide display' }),
      new MenuItemProperty({ itemID: 9, itemName: 'Refresh' }),
      new MenuItemProperty({ itemID: 10, itemName: 'Close Alfred' }),
    ],
  });
  const fallbackText = (s: Screen) =>
    [
      s.weekday,
      s.date,
      s.headline,
      s.greeting,
      s.weather?.available
        ? `${s.weather.city}: ${s.weather.temperature}°C, ${s.weather.description}`
        : undefined,
      s.text,
      ...(s.rows ?? []).map((x) => x.label + (x.detail ? ' / ' + x.detail : '')),
    ]
      .filter(Boolean)
      .join('\n');
  const replyExpiry = new ReplyExpiry();
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  let dashboardDismiss: ReturnType<typeof setTimeout> | undefined;
  let dashboardDeadline = 0;
  function paint(screen: Screen, rearm = true) {
    if (closed) return;
    if (screen.text)
      screen = {
        ...screen,
        text: screen.text.replace(/, sir\b/g, profileAddress ? ', ' + profileAddress : ''),
      };
    if (screen.kind === 'home') screen = { ...screen, battery: { ...battery } };
    if (rearm) {
      if (replyTimer) clearTimeout(replyTimer);
      replyTimer = undefined;
      if (mode === 'conversation' && screen.kind === 'reply' && screen.text) {
        replyVisible = true;
        replyExpiry.arm(screen.text);
        replyTimer = setTimeout(expireReply, replyExpiry.remaining);
      } else {
        replyVisible = false;
        replyExpiry.clear();
      }
    }
    current = screen;
    smooth.show(screen);
    display.textContent = fallbackText(screen);
    el('hud-status').textContent = screen.status ?? screen.title;
    el('page-position').textContent = mode === 'home' ? 'Dashboard' : (screen.page ?? 'Talk');
    if (native) {
      const state = displayState(screen);
      nativeHud?.show(readableFallback(screen), state.listening ? 'Listening' : state.status, '');
    }
  }
  async function fallback() {
    smooth.stop();
    if (!bridge || native) return;
    const ok = await bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: 4, textObject: hudContainers(), menuObject }),
    );
    if (ok) {
      native = true;
      nativeHud = new AlfredHud(bridge, false);
      const state = displayState(current);
      nativeHud.show(readableFallback(current), state.listening ? 'Listening' : state.status, '');
      log('Graphics unavailable; readable text mode is active.');
      connection.textContent = 'Connected · text fallback active.';
    } else {
      log('Glasses page could not recover. Reopen Alfred.');
      connection.textContent = 'Please close and reopen Alfred to restore the display.';
    }
  }
  if (bridge) {
    const containers = smoothContainers();
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: containers.textObject.length + containers.imageObject.length,
        ...containers,
        menuObject,
      }),
    );
    if (result !== 0) {
      const textResult = await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 4,
          textObject: hudContainers(),
          menuObject,
        }),
      );
      if (textResult !== 0) throw Error('Glasses page could not open. Close and reopen Alfred.');
      native = true;
      nativeHud = new AlfredHud(bridge, false);
    } else
      smooth.attach(
        bridge,
        (reason) => {
          log(`Native display: ${reason ?? 'transfer failed'}. Switching to text recovery.`);
          void fallback().catch(() => {
            connection.textContent = 'Graphics recovery failed. Reopen Alfred.';
          });
        },
        menuObject,
      );
  }
  let replyVisible = false;
  function rest() {
    if (dashboardDismiss) clearTimeout(dashboardDismiss);
    dashboardDismiss = undefined;
    dashboardDeadline = 0;
    mode = 'conversation';
    replyVisible = false;
    replyExpiry.clear();
    paint({ kind: 'reply', quiet: true, title: 'Chat', text: '' });
  }
  let snapshot: Snapshot | undefined;
  let snapshotAt = 0;
  let dashboardFetch: Promise<Snapshot> | undefined;
  function warmDashboard() {
    if (preview) {
      snapshot = sampleSnapshots.home;
      snapshotAt = Date.now();
      return Promise.resolve(snapshot);
    }
    return (dashboardFetch ??= api('/api/dashboard?view=home', {
      signal: AbortSignal.timeout(8000),
    })
      .then((data: Snapshot) => {
        snapshot = data;
        snapshotAt = Date.now();
        return data;
      })
      .finally(() => {
        dashboardFetch = undefined;
      }));
  }
  function renderConversation() {
    if (document.querySelector('button[data-view=activity][aria-pressed=true]')) {
      void loadActivity();
      return;
    }
    renderActivity(el('conversation'), {
      history: conversation.exchanges.map((turn) => ({
        question: turn.question,
        reply: turn.reply,
      })),
    });
  }
  async function loadActivity() {
    const node = el('phone-activity-status');
    node.textContent = 'Refreshing…';
    try {
      const data = preview
        ? {
            history: [
              {
                question: 'Show my shopping list',
                reply: 'Milk\nBread',
                created_at: new Date().toISOString(),
              },
            ],
            activity: [
              {
                kind: 'action',
                title: 'Example light request',
                detail: 'Confirmed by the service',
                created_at: new Date().toISOString(),
              },
            ],
          }
        : await api('/api/activity');
      renderActivity(el('conversation'), data);
      node.textContent = preview ? 'Sample activity' : 'Updated.';
    } catch (error) {
      node.textContent = error instanceof Error ? error.message : 'Activity unavailable.';
    }
  }
  el('phone-activity-refresh').onclick = () => void loadActivity();
  function showReply() {
    const page = conversation.current;
    if (page) paint({ kind: 'reply', quiet: true, title: 'Chat', text: page.text });
    else rest();
  }

  function controls() {
    const guide =
      interactionProfile === 'store'
        ? 'Tap a temple to speak, then tap again to send. Hold/release also works when delivered by Even. The contextual menu has Speak, Dashboard, Hide display and Close Alfred. Store mode reserves double-tap for Even’s exit confirmation.'
        : 'Tap a temple to speak, then tap again to send; hold/release is also supported when delivered. Double-tap left stem shows/hides Dashboard; right stem or ring returns passive. Use the contextual menu for Speak, Dashboard, Hide display or Close Alfred.';
    if (el('gesture-guide').textContent !== guide) el('gesture-guide').textContent = guide;
    expireReply();
    toggle.disabled =
      !bridge || !pairing || preview || busy || ['stopping', 'error'].includes(capture.state);
    toggle.textContent = capture.state === 'idle' ? 'Speak' : 'Finish recording';
    cancel.disabled = !busy && !['starting', 'listening'].includes(capture.state);
    reset.disabled = busy || capture.state !== 'idle';
    el<HTMLButtonElement>('latest').disabled = !conversation.current || busy;
    for (const b of el('modes').querySelectorAll<HTMLButtonElement>('button')) {
      b.disabled = busy || capture.state !== 'idle';
      b.setAttribute('aria-current', String(b.dataset.mode === mode));
    }
    el<HTMLButtonElement>('exit').disabled = !bridge || preview || exiting;
  }
  async function setMode(next: Mode, force = false) {
    if (next === 'home') void refreshDevice();
    if (busy || capture.state !== 'idle') return;
    mode = next;
    controls();
    loading?.abort();
    loading = undefined;
    const id = ++loadId;
    if (next === 'conversation') {
      rest();
      return;
    }
    // Background timer throttling must not turn a glance into an always-on view.
    if (dashboardDismiss) clearTimeout(dashboardDismiss);
    dashboardDeadline = Date.now() + displayPower.dashboardVisibleMs;
    dashboardDismiss = setTimeout(expireReply, displayPower.dashboardVisibleMs);
    if (snapshot?.view === 'home') paint(viewScreens('home', snapshot)[0]);
    else paint(viewScreens('home', { view: 'home' })[0]);
    try {
      if (!force && snapshot?.view === 'home' && Date.now() - snapshotAt < 30000) return;
      const data = await warmDashboard();
      if (id !== loadId) return;
      snapshot = data;
      paint(viewScreens('home', snapshot)[0]);
    } catch (error) {
      if (id !== loadId) return;
      paint({
        kind: 'reply',
        title: 'Dashboard',
        status: 'OFFLINE',
        text: error instanceof Error ? error.message : 'This screen is unavailable.',
      });
    } finally {
      if (id === loadId) loading = undefined;
    }
  }
  function browse(direction: number) {
    if (mode === 'home' || busy || overlay || loading || capture.state !== 'idle') return;
    if (replyVisible && direction < 0) {
      rest();
      return;
    }
    if (!replyVisible) {
      rest();
      return;
    }
    if (conversation.current) {
      const next = conversation.index + direction;
      if (next >= 0 && next < conversation.pages.length) {
        conversation.move(direction);
        showReply();
      }
    }
  }
  function cancelAnswer() {
    request?.abort();
  }
  async function ask(recording: Recording) {
    if (busy) return;
    if (recording.seconds < 0.1 || recording.peak < 0.001) {
      paint({
        kind: 'reply',
        title: 'Assistant',
        status: 'TRY AGAIN',
        text: 'I could not hear clear speech. Hold until Listening, then speak.',
      });
      return;
    }
    busy = true;
    loadId++;
    loading?.abort();
    loading = undefined;
    controls();
    let requestedView: Mode | undefined;
    const abort = new AbortController();
    request = abort;
    const timer = setTimeout(() => abort.abort(), 32000);
    paint({
      kind: 'activity',
      quiet: true,
      title: 'Assistant',
      status: 'THINKING',
      eyebrow: 'AT YOUR SERVICE',
      text: 'One moment, sir.\nI’m attending to your request.',
      footer: 'TAP TO CANCEL',
    });
    try {
      const data = await api('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: recording.pcm as BodyInit,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (
        /^(?:please )?(?:show|open)(?: me)?(?: my| the)? dashboard[.!]?$/i.test(
          data.transcript.trim(),
        )
      )
        requestedView = 'home';
      else if (
        /^(?:please )?(?:show|open)(?: me)?(?: my| the)? (?:history|conversation history)[.!]?$/i.test(
          data.transcript.trim(),
        )
      ) {
        conversation.latest();
        requestedView = 'conversation';
      }
      if (data.ui_action === 'dashboard') requestedView = 'home';
      if (data.ui_action === 'exit') {
        void exit();
        return;
      }
      if (data.ui_action === 'passive') {
        rest();
        return;
      }
      el('transcript').textContent = data.transcript;
      el('answer').textContent = data.reply;
      if (!requestedView) conversation.add(data.transcript, data.reply);
      if (data.history_warning) {
        connection.textContent = data.history_warning;
        log('History could not be saved.');
      }
      renderConversation();
      if (!requestedView) {
        mode = 'conversation';
        if (data.presentation === 'action_complete') {
          paint({ kind: 'success', title: 'Done' });
          const completionId = loadId;
          void smooth.whenSettled().then(() => {
            if (loadId === completionId && current.kind === 'success')
              replyTimer = setTimeout(() => rest(), 650);
          });
        } else showReply();
      }
    } catch (error) {
      if (!exiting)
        paint({
          kind: 'reply',
          title: 'Assistant',
          status: abort.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE',
          text: abort.signal.aborted
            ? 'Cancelled or timed out. Changes may have reached the service; check their state before retrying.'
            : error instanceof Error
              ? error.message
              : 'Assistant unavailable.',
        });
    } finally {
      clearTimeout(timer);
      if (request === abort) request = undefined;
      busy = false;
      controls();
      queueMicrotask(resumeMenuSpeak);
      if (requestedView === 'home') void setMode('home');
      else if (requestedView === 'conversation') {
        mode = 'conversation';
        showReply();
      }
    }
  }
  const capture = new Capture({
    microphone: (open) =>
      bridge
        ? bridge.audioControl(open, AudioInputSource.Glasses)
        : Promise.reject(new Error('Use your connected glasses to speak to Alfred.')),
    status: (state, message) => {
      if (state === 'stopping') {
        controls();
        return;
      }
      if (state === 'starting') {
        mode = 'conversation';
        loadId++;
        loading?.abort();
        loading = undefined;
      }
      if (!busy) {
        if (state === 'listening' || state === 'starting')
          paint({
            kind: 'activity',
            quiet: true,
            title: 'Assistant',
            status: state === 'listening' ? 'LISTENING' : 'CONNECTING',
            eyebrow: 'A WORD WITH ALFRED',
            text:
              state === 'listening'
                ? 'I’m listening.\nRelease your hold or tap to finish.'
                : 'Preparing the microphone…',
            footer: state === 'listening' ? 'MICROPHONE ON' : 'WAIT FOR LISTENING',
          });
        else if (state === 'idle') {
          if (mode === 'conversation') rest();
          else if (snapshot) paint(viewScreens('home', snapshot)[0]);
          else paint({ kind: 'reply', title: 'Assistant', text: message });
        } else
          paint({ kind: 'reply', title: 'Assistant', status: state.toUpperCase(), text: message });
      }
      controls();
      log(`Microphone: ${state}`);
      if (state === 'idle') queueMicrotask(resumeMenuSpeak);
    },
    complete: (recording) => {
      lastRecording = recording;
      download.disabled = false;
      el('recording').textContent = `Last recording: ${recording.seconds.toFixed(1)} seconds.`;
      void ask(recording);
    },
  });
  function tap() {
    if (overlay || closed || exiting || (!preview && !pairing)) return;
    const intent = tapIntent(capture.state, busy);
    if (intent === 'cancel') {
      cancelAnswer();
      return;
    }
    // Ring-free fallback: a single tap begins a new question even over a reply
    // or dashboard. A second tap finishes; double-tap cancels the delayed tap.
    if (intent === 'listen' || intent === 'finish') capture.toggle();
  }
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let menuSpeakPending = false;
  function menuSpeak() {
    menuSpeakPending = true;
    if (busy) cancelAnswer();
    resumeMenuSpeak();
  }
  function resumeMenuSpeak() {
    if (!menuSpeakPending || overlay || closed || exiting || busy || capture.state !== 'idle')
      return;
    menuSpeakPending = false;
    tap();
  }
  function singleTap() {
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      tapTimer = undefined;
      tap();
    }, 350);
  }
  async function passive() {
    menuSpeakPending = false;
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = undefined;
    loadId++;
    loading?.abort();
    loading = undefined;
    cancelAnswer();
    await capture.stop(true);
    mode = 'conversation';
    rest();
    controls();
  }
  function dashboardGesture(fromRing = false) {
    menuSpeakPending = false;
    if (fromRing && interactionProfile === 'store') {
      void exit();
      return;
    }
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = undefined;
    if (busy || exiting || capture.state !== 'idle' || overlay) return;
    void setMode(mode === 'home' ? 'conversation' : 'home');
  }
  async function exit() {
    if (!bridge || exiting) return;
    menuSpeakPending = false;
    exiting = true;
    controls();
    cancelAnswer();
    loadId++;
    loading?.abort();
    loading = undefined;
    try {
      await capture.stop(true);
      if (['starting', 'stopping'].includes(capture.state)) {
        connection.textContent = 'Microphone is closing. Try Close Alfred again once it stops.';
        return;
      }
      await smooth.transition('close');
      await bridge.shutDownPageContainer(1);
      if (!closed && !overlay) paint(current, false);
    } catch {
      connection.textContent = 'Open the glasses contextual menu and choose Close Alfred.';
    } finally {
      exiting = false;
      controls();
    }
  }
  if (bridge)
    bridge.onEvenHubEvent((event) => {
      if (event.audioEvent) {
        if (event.audioEvent.source === AudioInputSource.Glasses)
          capture.add(event.audioEvent.audioPcm);
        return;
      }
      if (event.menuItemClickEvent) {
        const id = event.menuItemClickEvent.itemID;
        if (id !== 6) menuSpeakPending = false;
        if (id === 10) void exit();
        else if (id === 9) void setMode(mode, true);
        else if (id === 1) void setMode('home');
        else if (id === 6) menuSpeak();
        else if (id === 7) void passive();
        return;
      }
      const sys = event.sysEvent;
      if (sys) {
        const type = sys.eventType;
        if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
          if (tapTimer) clearTimeout(tapTimer);
          tapTimer = undefined;
          overlay = true;
          smooth.cancelMotion();
          void capture.stop(true);
          return;
        }
        if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
          overlay = false;
          if (menuSpeakPending) {
            resumeMenuSpeak();
            return;
          }
          if (!busy && capture.state === 'idle') {
            if (
              (mode === 'conversation' && replyExpiry.due) ||
              (mode === 'home' && dashboardDeadline && Date.now() >= dashboardDeadline)
            )
              expireReply();
            else paint(current, false);
          }
          return;
        }
        if (
          type === OsEventTypeList.SYSTEM_EXIT_EVENT ||
          type === OsEventTypeList.ABNORMAL_EXIT_EVENT
        ) {
          closed = true;
          menuSpeakPending = false;
          if (tapTimer) clearTimeout(tapTimer);
          tapTimer = undefined;
          if (replyTimer) clearTimeout(replyTimer);
          if (dashboardDismiss) clearTimeout(dashboardDismiss);
          smooth.stop();
          nativeHud?.stop();
          cancelAnswer();
          loading?.abort();
          loading = undefined;
          void capture.stop(true);
          return;
        }
      }
      const input = gestureInput(event);
      if (input) {
        const type = input.type;
        const action = gestureAction(type, input.source, interactionProfile);
        if (action === 'passive') {
          void passive();
          return;
        }
        if (action === 'system-exit') {
          void exit();
          return;
        }
        if (action === 'dashboard') {
          dashboardGesture();
          return;
        }
        if (action === 'listen' && pairing && !busy && !exiting && !closed && !overlay) {
          menuSpeakPending = false;
          if (tapTimer) clearTimeout(tapTimer);
          tapTimer = undefined;
          capture.hold();
        }
        if (action === 'release') capture.release();
        const direction = scrollDirection(type);
        if (direction) browse(direction);
        if (action === 'tap') singleTap();
        return;
      }
    });
  for (const item of modes) {
    const button = document.createElement('button');
    button.dataset.mode = item;
    const n = document.createElement('span');
    n.textContent = item === 'home' ? '01' : '02';
    button.append(n, document.createTextNode(item === 'home' ? 'Dashboard' : 'Talk'));
    button.onclick = () => (item === 'home' ? dashboardGesture() : void setMode('conversation'));
    el('modes').append(button);
  }
  el('previous').onclick = () => browse(-1);
  el('next').onclick = () => browse(1);
  el('latest').onclick = () => {
    if (!busy && capture.state === 'idle') {
      loadId++;
      loading?.abort();
      loading = undefined;
      mode = 'conversation';
      conversation.latest();
      showReply();
      controls();
    }
  };
  el('refresh').onclick = () => void setMode(mode, true);
  toggle.onclick = () => {
    if (bridge && !busy) capture.toggle();
  };
  cancel.onclick = () => {
    cancelAnswer();
    void capture.stop(true);
  };
  reset.onclick = () => {
    void (preview ? Promise.resolve() : api('/api/reset', { method: 'POST' }))
      .then(() => {
        conversation.clear();
        renderConversation();
        el('transcript').textContent = '';
        el('answer').textContent = '';
        void setMode('conversation');
      })
      .catch((error) =>
        paint({ kind: 'reply', quiet: true, title: 'Chat', status: 'ERROR', text: String(error) }),
      );
  };
  el('exit').onclick = () => {
    void exit();
  };
  download.onclick = () => {
    if (!lastRecording) return;
    const url = URL.createObjectURL(
      new Blob([wav(lastRecording.pcm) as BlobPart], { type: 'audio/wav' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alfred-recording.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  let locationEnabled = false,
    lastLocationAt = 0;
  async function useLocation() {
    const status = el('location-status');
    if (preview) {
      status.textContent = 'Location is not requested in design preview.';
      return;
    }
    if (!pairing) {
      status.textContent = 'Pair your server first.';
      return;
    }
    status.textContent = 'Requesting approximate location…';
    try {
      const position = bridge
        ? await bridge.getAppLocation({ accuracy: AppLocationAccuracy.Low, timeoutMs: 5000 })
        : await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 8000,
              maximumAge: 600000,
            }),
          );
      if (!position) throw Error('Location unavailable');
      const coords = 'coords' in position ? position.coords : position;
      await api('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: Math.round(coords.latitude * 100) / 100,
          longitude: Math.round(coords.longitude * 100) / 100,
        }),
      });
      locationEnabled = true;
      lastLocationAt = Date.now();
      await storage.write('alfred-phone-location', 'enabled');
      status.textContent =
        'Approximate phone location updated. Expires in one hour; your saved town is the fallback.';
      snapshot = undefined;
      if (mode === 'home') void setMode('home', true);
    } catch {
      status.textContent =
        'Location unavailable or permission denied. Your saved town is used. You can retry here.';
    }
  }
  el('text-ask').onclick = () => {
    if (busy) return;
    const text = el<HTMLTextAreaElement>('shared-text').value.trim();
    if (!text) return;
    const result = el('text-result');
    result.textContent = 'Thinking…';
    busy = true;
    const textAbort = new AbortController();
    request = textAbort;
    controls();
    void (
      preview
        ? Promise.resolve({
            transcript: text,
            reply: 'Design preview. No account actions are performed.',
            presentation: 'conversation',
          })
        : api('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              context: el<HTMLTextAreaElement>('shared-context').value.trim(),
            }),
            signal: textAbort.signal,
          })
    )
      .then((d) => {
        result.textContent = d.reply;
        conversation.add(d.transcript, d.reply);
        renderConversation();
        mode = 'conversation';
        if (d.presentation === 'action_complete') {
          paint({ kind: 'success', title: 'Done' });
          const completionId = loadId;
          void smooth.whenSettled().then(() => {
            if (loadId === completionId && current.kind === 'success')
              replyTimer = setTimeout(() => rest(), 650);
          });
        } else showReply();
      })
      .catch((e) => {
        result.textContent = e.message;
      })
      .finally(() => {
        if (request === textAbort) request = undefined;
        busy = false;
        controls();
      });
  };
  function reviewClearList(kind: 'shopping' | 'tasks') {
    const dialog = document.createElement('dialog');
    dialog.className = 'companion-dialog';
    dialog.setAttribute('aria-label', 'Clear ' + kind + ' list');
    const title = document.createElement('h2');
    title.textContent = 'Clear ' + (kind === 'tasks' ? 'to-do' : 'shopping') + ' list?';
    const description = document.createElement('p');
    description.textContent =
      'Remove every open and completed item. Your Home Assistant list itself will stay.';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    const confirm = document.createElement('button');
    confirm.textContent = 'Clear all items';
    confirm.type = 'button';
    confirm.className = 'danger';
    confirm.disabled = preview || !pairing;
    if (confirm.disabled)
      status.textContent = preview
        ? 'Preview only; no items are removed.'
        : 'Connect alfred on Home first.';
    confirm.onclick = async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      status.textContent = 'Clearing and verifying…';
      try {
        const result = await api('/api/lists/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind }),
          signal: AbortSignal.timeout(30000),
        });
        if (!result.verified) throw Error('The full list could not be verified empty.');
        dialog.close();
        await loadPhoneLists();
      } catch (error) {
        status.textContent =
          (error instanceof Error ? error.message : 'Clear failed.') +
          ' Check the list before trying again.';
        cancel.disabled = false;
      }
    };
    actions.append(cancel, confirm);
    dialog.append(title, description, status, actions);
    document.querySelector('main')?.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  async function loadPhoneLists() {
    const holder = el('phone-lists');
    const status = el('phone-lists-status');
    const refresh = el<HTMLButtonElement>('phone-lists-refresh');
    if (refresh.disabled) return;
    refresh.disabled = true;
    status.textContent = 'Refreshing…';
    try {
      if (!preview && !pairing) {
        holder.replaceChildren();
        status.textContent = 'Connect Alfred on Home to see your lists.';
        return;
      }
      const results = await Promise.allSettled(
        ['tasks', 'shopping'].map((view) =>
          preview
            ? Promise.resolve({
                items:
                  view === 'tasks'
                    ? [{ title: 'Check the garden' }]
                    : [{ title: 'Milk' }, { title: 'Bread' }],
              })
            : api('/api/dashboard?view=' + view),
        ),
      );
      holder.replaceChildren();
      results.forEach((result, index) => {
        const section = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = index ? 'Shopping' : 'To-do';
        section.append(heading);
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'clear-list';
        clear.textContent = 'Clear list';
        clear.onclick = () => reviewClearList(index ? 'shopping' : 'tasks');
        section.append(clear);
        if (result.status === 'fulfilled') {
          const count = document.createElement('span');
          count.className = 'list-count';
          const rows = result.value.items || [];
          count.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
          heading.append(count);
          const list = document.createElement('ul');
          for (const row of result.value.items || []) {
            const li = document.createElement('li');
            li.textContent = row.title;
            list.append(li);
          }
          if (!list.children.length) {
            const empty = document.createElement('p');
            empty.textContent = 'Nothing here yet.';
            section.append(empty);
          } else section.append(list);
        } else {
          const p = document.createElement('p');
          p.textContent =
            result.reason instanceof Error
              ? result.reason.message
              : 'Choose this list in HA → Alfred → Lists.';
          section.append(p);
        }
        holder.append(section);
      });
      status.textContent = preview ? 'Sample lists · no services checked' : 'Lists updated.';
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'Lists unavailable.';
    } finally {
      refresh.disabled = false;
    }
  }
  el('phone-lists-refresh').onclick = () => void loadPhoneLists();
  document.querySelector('main')?.addEventListener('alfred-view', ((event: CustomEvent) => {
    if (event.detail === 'lists') void loadPhoneLists();
    if (event.detail === 'activity') void loadActivity();
    if (event.detail === 'reminders') void loadReminders();
    if (event.detail === 'research') void loadResearch();
  }) as EventListener);
  el('phone-location').onclick = () => void useLocation();
  el('location-off').onclick = () => {
    locationEnabled = false;
    void storage
      .write('alfred-phone-location', 'disabled')
      .then(() =>
        api('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear: true }),
        }),
      )
      .then(() => {
        el('location-status').textContent = 'Using your saved town.';
        snapshot = undefined;
      })
      .catch((e) => {
        el('location-status').textContent = e.message;
      });
  };
  async function refreshGrantedLocation() {
    if (
      !locationEnabled ||
      Date.now() - lastLocationAt < 600000 ||
      document.visibilityState === 'hidden' ||
      !navigator.permissions
    )
      return;
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') await useLocation();
    } catch {
      /* WebView may not expose the permissions API. Use the explicit button. */
    }
  }
  void storage
    .read('alfred-phone-location')
    .then((value) => {
      locationEnabled = value === 'enabled';
      if (locationEnabled) void refreshGrantedLocation();
    })
    .catch(() => {});
  document.addEventListener('visibilitychange', () => {
    void refreshGrantedLocation();
  });
  const sharedInput = new URLSearchParams(location.hash.slice(1)).get('share');
  if (sharedInput && sharedInput.length <= 4000) {
    el<HTMLTextAreaElement>('shared-context').value = sharedInput;
    el<HTMLTextAreaElement>('shared-text').value = 'Summarise this selected content.';
    el('shared-context').closest('details')!.open = true;
    history.replaceState(null, '', location.pathname + location.search);
  }
  el('reconnect').onclick = () => location.reload();
  const locationTicker = setInterval(() => void refreshGrantedLocation(), 1800000);

  el('recover-display').onclick = async () => {
    if (!bridge) {
      connection.textContent = 'Open Alfred inside Even to recover the glasses display.';
      return;
    }
    try {
      await fallback();
    } catch {
      connection.textContent = 'Display recovery failed. Close and reopen Alfred.';
    }
  };
  el('phone-health').onclick = () => {
    const n = el('phone-health-status');
    n.textContent = 'Checking…';
    void (
      preview
        ? Promise.resolve({
            connections: { preview: { status: 'Sample data — no services checked' } },
          })
        : api('/api/status')
    )
      .then((d) => {
        n.textContent = Object.entries(d.connections ?? {})
          .map(
            ([name, value]) =>
              `${name.replaceAll('_', ' ')} / ${(value as { status: string; detail?: string }).status}${(value as { detail?: string }).detail ? ' — ' + (value as { detail: string }).detail : ''}`,
          )
          .join('\n');
      })
      .catch((e) => {
        n.textContent = e.message;
      });
  };
  el('share-response').onclick = async () => {
    const text = conversation.exchanges.at(-1)?.reply || el('text-result').textContent || '';
    const status = el('share-status');
    if (!text) {
      status.textContent = 'Ask Alfred a question first.';
      return;
    }
    try {
      if (navigator.share) await navigator.share({ title: 'Alfred', text });
      else {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Response copied. Paste into your chosen app or Shortcut.';
      }
    } catch (e) {
      status.textContent =
        e instanceof Error && e.name === 'AbortError'
          ? 'Sharing cancelled.'
          : 'Sharing is unavailable here. Copy the response text manually.';
    }
  };
  async function loadResearch() {
    const list = el('phone-jobs-list'),
      result = el('phone-job-result');
    try {
      const d = preview ? { jobs: [] } : await api('/api/jobs');
      list.replaceChildren();
      for (const job of d.jobs) {
        const row = document.createElement('p'),
          read = document.createElement('button');
        row.textContent = job.query + ' — ' + job.status + ' ';
        read.textContent = 'Read';
        read.onclick = async () => {
          try {
            const item = await api('/api/jobs?id=' + encodeURIComponent(job.id));
            result.textContent =
              item.result?.body || item.result?.summary || item.error || item.phase || item.status;
          } catch (e) {
            result.textContent = e instanceof Error ? e.message : 'Task unavailable.';
          }
        };
        row.append(read);
        list.append(row);
      }
      if (!d.jobs.length) list.textContent = 'No research tasks yet.';
    } catch (e) {
      result.textContent = e instanceof Error ? e.message : 'Research inbox unavailable.';
    }
  }
  el('phone-jobs').onclick = () => void loadResearch();
  async function loadReminders() {
    const status = el('phone-inbox-status');
    status.textContent = 'Refreshing…';
    try {
      const data = preview
        ? {
            inbox: [],
            items: [
              { title: 'Check the garden', due_at: new Date(Date.now() + 3600000).toISOString() },
            ],
          }
        : await api('/api/inbox');
      const holder = el('phone-reminders');
      holder.replaceChildren();
      for (const [title, items] of [
        ['Scheduled', data.items || []],
        ['Reminder inbox', data.inbox || []],
      ] as [string, any[]][]) {
        const heading = document.createElement('h3');
        heading.textContent = title;
        holder.append(heading);
        if (!items.length) {
          const empty = document.createElement('p');
          empty.className = 'empty';
          empty.textContent = 'Nothing here yet.';
          holder.append(empty);
        }
        for (const item of [...items].sort(
          (a, b) => Date.parse(a.due_at || a.created_at) - Date.parse(b.due_at || b.created_at),
        )) {
          const row = document.createElement('article');
          row.className = 'reminder-row';
          const name = document.createElement('strong');
          name.textContent = item.title;
          const time = document.createElement('small');
          const at = item.due_at || item.created_at;
          time.textContent = at
            ? new Date(at).toLocaleString()
            : item.delivery_status || 'Recorded';
          row.append(name, time);
          holder.append(row);
        }
      }
      status.textContent = preview ? 'Sample reminders' : 'Updated.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Reminders unavailable.';
    }
  }
  el('phone-inbox').onclick = () => void loadReminders();
  el('pairing-form').hidden = preview || Boolean(pairing);
  el('pairing-form').onsubmit = (event) => {
    event.preventDefault();
    const input = el<HTMLInputElement>('pairing-code'),
      code = input.value.trim();
    if (!/^\d{6}$/.test(code)) {
      el('pairing-status').textContent = 'Enter the six digits from your server.';
      return;
    }
    const button = el<HTMLButtonElement>('pairing-submit');
    button.disabled = true;
    void (async () => {
      let response;
      try {
        response = await fetch(backendOrigin + '/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name: el<HTMLInputElement>('device-name').value.trim() }),
          signal: AbortSignal.timeout(6000),
        });
      } catch {
        throw Error(
          'Cannot reach Home Assistant. Check your remote connection and app network permissions.',
        );
      }
      const data = await readApiResponse(response);
      if (typeof data.clientToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.clientToken))
        throw Error('Invalid pairing details. Create a fresh code.');
      await storage.write('assistant-pairing', data.clientToken);
      pairing = data.clientToken;
      input.value = '';
      el('pairing-form').hidden = true;
      connection.textContent = 'Connected to your server.';
      const preferences = await api('/api/preferences');
      interactionProfile = preferences.interactionProfile;
      profileAddress =
        preferences.profile.addressAs === 'name'
          ? preferences.profile.name
          : preferences.profile.addressAs === 'none'
            ? ''
            : preferences.profile.addressAs;

      await setMode('conversation');
    })()
      .catch((error) => {
        el('pairing-status').textContent = String(error.message ?? error);
      })
      .finally(() => {
        button.disabled = false;
      });
  };
  function expireReply() {
    if (closed || exiting) return;
    if (
      mode === 'home' &&
      dashboardDeadline &&
      Date.now() >= dashboardDeadline &&
      !busy &&
      !overlay &&
      capture.state === 'idle'
    ) {
      void passive();
      return;
    }
    if (
      mode === 'conversation' &&
      replyVisible &&
      replyExpiry.due &&
      !busy &&
      !overlay &&
      capture.state === 'idle'
    )
      rest();
  }
  controls();
  document.addEventListener('visibilitychange', expireReply);
  window.addEventListener('pageshow', expireReply);
  window.addEventListener('focus', expireReply);
  window.addEventListener('pagehide', () => {
    replyExpiry.clear();
    if (tapTimer) clearTimeout(tapTimer);
    if (replyTimer) clearTimeout(replyTimer);
    if (dashboardDismiss) clearTimeout(dashboardDismiss);
    clearInterval(locationTicker);
    smooth.stop();
    nativeHud?.stop();
    cancelAnswer();
    loading?.abort();
    loading = undefined;
    void capture.stop(true);
  });
  rest();
  const startupMotion = smooth.transition('open');
  if (preview) {
    interactionProfile = 'personal';
    connection.textContent = 'Design preview / sample data. No account actions are performed.';
    conversation.add(
      'What can you do for me?',
      'Your home, your day and the little things. Quietly taken care of, sir.',
    );
    renderConversation();
    return;
  }
  if (restoreFailed) {
    el('pairing-form').hidden = true;
    paint({
      kind: 'reply',
      title: 'Connection',
      status: 'STORAGE',
      text: 'Even could not restore your saved pairing. Close and reopen Alfred. Your saved credential has not been replaced.',
    });
    return;
  }
  if (!pairing) {
    connection.textContent = 'Introduce Alfred to your server below.';
    paint({
      kind: 'reply',
      title: 'Alfred',
      status: 'PAIRING',
      eyebrow: 'ONE-TIME INTRODUCTION',
      text: 'Open Alfred on your iPhone and enter a pairing code from the server Command Centre.',
    });
    return;
  }
  try {
    const status = await api('/api/status');
    const preferences = await api('/api/preferences');
    interactionProfile = preferences.interactionProfile;
    profileAddress =
      preferences.profile.addressAs === 'name'
        ? preferences.profile.name
        : preferences.profile.addressAs === 'none'
          ? ''
          : preferences.profile.addressAs;
    connection.textContent = status.configured
      ? 'Your glasses and Home Assistant are connected.'
      : 'Choose AI and speech in Home Assistant → Alfred.';
    const history = await api('/api/history');
    conversation.restore(history.exchanges ?? []);
    renderConversation();
    controls();
    void warmDashboard().catch(() => {});
    await startupMotion;
    await setMode('conversation');
    if (!status.configured)
      paint({
        kind: 'reply',
        title: 'Setup',
        text: 'Choose AI and speech in Home Assistant → Alfred → Connections. Home Assistant is required; email and weather are optional.',
      });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      el('pairing-form').hidden = false;
      el('pairing-status').textContent = 'Pairing was revoked. Create a new code on the server.';
    }
    connection.textContent =
      error instanceof ApiError && error.status === 401
        ? 'Please pair Alfred again.'
        : 'Your Mac could not be reached.';
    paint({
      kind: 'reply',
      title: 'Alfred',
      status: 'OFFLINE',
      text:
        error instanceof Error ? error.message : 'Check your remote connection and Home Assistant.',
    });
  }
}
void (
  phoneMode || (preview && !simulator)
    ? start()
    : Promise.race([
        waitForEvenAppBridge(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
      ]).then(start)
).catch((error) => {
  connection.textContent = String(error.message ?? error);
  log('Alfred could not open.');
});

setupPhoneNavigation();
