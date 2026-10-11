export const SAMPLE_RATE = 16000;
export const MAX_BYTES = SAMPLE_RATE * 2 * 30;
export type CaptureState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error';
export type Recording = { pcm: Uint8Array; seconds: number; rms: number; peak: number };
type Hooks = {
  microphone: (open: boolean) => Promise<boolean>;
  status: (state: CaptureState, message: string) => void;
  complete: (recording: Recording) => void;
};

// Stop can arrive while the native microphone-open request is still pending.
// Keep that intent and close immediately after opening, rather than losing release.
export class Capture {
  state: CaptureState = 'idle';
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private stopRequested = false;
  private discard = false;
  private timer?: ReturnType<typeof setTimeout>;
  private held = false;
  constructor(private hooks: Hooks) {}
  private status(state: CaptureState, message: string) {
    this.state = state;
    this.hooks.status(state, message);
  }
  hold() {
    this.held = true;
    void this.start();
  }
  release() {
    if (this.held) {
      this.held = false;
      void this.stop();
    }
  }
  toggle() {
    if (this.state === 'idle') void this.start();
    else if (this.state === 'starting' || this.state === 'listening') void this.stop();
  }
  async start() {
    if (this.state !== 'idle') return;
    this.chunks = [];
    this.bytes = 0;
    this.stopRequested = false;
    this.discard = false;
    this.status('starting', 'Opening microphone…\nWait before speaking.');
    try {
      if (!(await this.hooks.microphone(true)))
        throw new Error('Microphone permission or connection refused.');
      if (this.stopRequested) {
        await this.finish();
        return;
      }
      this.status('listening', 'Listening…\nSpeak now. Release or tap to finish.');
      this.timer = setTimeout(() => void this.stop(), 30000);
    } catch (error) {
      // An ambiguous open failure still needs a best-effort close.
      try {
        if (!(await this.hooks.microphone(false))) throw new Error('Close refused');
        this.status('idle', `Could not start microphone.\n${String(error)}\nTry again.`);
      } catch {
        this.status(
          'error',
          'Microphone state uncertain.\nClose this app in Even Hub, then reopen it.',
        );
      }
    }
  }
  add(pcm: Uint8Array) {
    if (this.state !== 'starting' && this.state !== 'listening') return;
    const accepted = pcm.slice(0, MAX_BYTES - this.bytes);
    this.chunks.push(accepted);
    this.bytes += accepted.byteLength;
    if (this.bytes >= MAX_BYTES) void this.stop();
  }
  async stop(cancel = false) {
    this.discard ||= cancel;
    if (this.state === 'starting') {
      this.stopRequested = true;
      return;
    }
    if (this.state !== 'listening') return;
    await this.finish();
  }
  private async finish() {
    clearTimeout(this.timer);
    this.status('stopping', 'Closing microphone…');
    try {
      if (!(await this.hooks.microphone(false))) throw new Error('Microphone close refused');
      if (this.discard) {
        this.status('idle', 'Cancelled.\nTap a temple or hold again to try.');
      } else if (this.bytes < 2) {
        this.status(
          'idle',
          'No audio received.\nHold until Listening, then speak.\nCheck glasses and microphone permission.',
        );
      } else {
        const pcm = new Uint8Array(this.bytes - (this.bytes % 2));
        let offset = 0;
        for (const chunk of this.chunks) {
          const part = chunk.subarray(0, pcm.length - offset);
          pcm.set(part, offset);
          offset += part.length;
        }
        const view = new DataView(pcm.buffer);
        let energy = 0,
          peak = 0;
        for (let i = 0; i < pcm.length; i += 2) {
          const sample = view.getInt16(i, true) / 32768;
          energy += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        const recording = {
          pcm,
          seconds: pcm.length / (SAMPLE_RATE * 2),
          rms: Math.sqrt(energy / (pcm.length / 2)),
          peak,
        };
        this.status(
          'idle',
          `Audio received: ${recording.seconds.toFixed(1)} seconds.\n${peak < 0.001 ? 'Very quiet signal. Try speaking again.' : 'Microphone data received.'}\nHold again for another test.`,
        );
        this.hooks.complete(recording);
      }
    } catch {
      this.status(
        'error',
        'Could not confirm microphone stopped.\nClose this app in Even Hub, then reopen it.',
      );
    } finally {
      this.held = false;
      this.chunks = [];
      this.bytes = 0;
    }
  }
}

export function wav(pcm: Uint8Array): Uint8Array {
  const output = new Uint8Array(44 + pcm.length);
  const view = new DataView(output.buffer);
  const label = (at: number, text: string) =>
    [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  label(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, pcm.length, true);
  output.set(pcm, 44);
  return output;
}
