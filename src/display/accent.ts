// Finite decorative motion. Input/new views cancel immediately; congested frames are skipped.
export type AccentFrame = 'outline' | 'arrival' | 'butler' | 'blank';
export class AccentMotion {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finish: (() => void) | undefined;
  constructor(
    private draw: (frame: AccentFrame) => void,
    private busy: () => boolean,
    private reduced: () => boolean = () => false,
  ) {}
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.finish?.();
    this.finish = undefined;
  }
  run(direction: 'open' | 'close') {
    this.cancel();
    if (this.reduced()) return Promise.resolve();
    const frames: AccentFrame[] =
      direction === 'open'
        ? ['outline', 'arrival', 'butler', 'blank']
        : ['butler', 'arrival', 'outline', 'blank'];
    return new Promise<void>((resolve) => {
      this.finish = resolve;
      let index = 0;
      const tick = () => {
        const frame = frames[index++];
        if (frame === 'blank' || !this.busy()) this.draw(frame);
        if (index === frames.length) {
          this.timer = undefined;
          this.finish = undefined;
          resolve();
        } else
          this.timer = setTimeout(tick, direction === 'open' ? [400, 500, 2100][index - 1] : 260);
      };
      tick();
    });
  }
}
