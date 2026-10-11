import {
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
export const hudContainers = () => [
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 220,
    height: 36,
    containerID: 4,
    containerName: 'alfred-brand',
    paddingLength: 5,
    content: ' ',
    textColor: 2,
  }),
  new TextContainerProperty({
    xPosition: 350,
    yPosition: 0,
    width: 226,
    height: 36,
    containerID: 2,
    containerName: 'alfred-status',
    paddingLength: 5,
    content: 'READY',
    textColor: 3,
  }),
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 46,
    width: 576,
    height: 190,
    containerID: 1,
    containerName: 'assistant',
    paddingLength: 5,
    isEventCapture: 1,
    content: 'At your service, sir.',
    textColor: 2,
  }),
  new TextContainerProperty({
    xPosition: 140,
    yPosition: 244,
    width: 296,
    height: 36,
    containerID: 3,
    containerName: 'alfred-guide',
    paddingLength: 5,
    content: ' ',
    textColor: 2,
  }),
];
// Small ASCII scanner: predictable glyphs, no full-page redraw and no suggestion of a measured audio waveform.
export const activityFrames = (label: string) =>
  label === 'LISTENING'
    ? [
        '[ .   |   . ]',
        '[ :  |||  : ]',
        '[ | ||||| | ]',
        '[ :  |||  : ]',
        '[ .   |   . ]',
        '[ .  |||  . ]',
      ]
    : [
        '[ ::        ]',
        '[  ::       ]',
        '[   ::      ]',
        '[    ::     ]',
        '[     ::    ]',
        '[      ::   ]',
        '[       ::  ]',
        '[        :: ]',
        '[       ::  ]',
        '[      ::   ]',
        '[     ::    ]',
        '[    ::     ]',
        '[   ::      ]',
        '[  ::       ]',
      ];
export class AlfredHud {
  private pending = new Map<number, { name: string; text: string }>();
  private sending = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  constructor(
    private bridge: Pick<EvenAppBridge, 'textContainerUpgrade'>,
    private animate = true,
  ) {}
  private update(id: number, name: string, text: string) {
    this.pending.set(id, { name, text });
    void this.flush();
  }
  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.size) {
        const [id, value] = this.pending.entries().next().value!;
        this.pending.delete(id);
        await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: id,
            containerName: value.name,
            contentOffset: 0,
            contentLength: 0,
            content: value.text || ' ',
          }),
        );
      }
    } catch {
      this.pending.clear();
    } finally {
      this.sending = false;
    }
  }
  show(text: string, label = 'READY', guide = '') {
    this.stop();
    this.update(2, 'alfred-status', label);
    this.update(1, 'assistant', text);
    this.update(3, 'alfred-guide', guide);
  }
  activity(label: 'LISTENING' | 'THINKING' | 'CONNECTING', text: string, _guide: string) {
    this.show(text, label);
    if (!this.animate) return;
    const frames = activityFrames(label);
    this.frame = 0;
    this.update(3, 'alfred-guide', frames[this.frame++ % frames.length]);
    this.timer = setInterval(() => {
      this.update(3, 'alfred-guide', frames[this.frame++ % frames.length]);
    }, 350);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.pending.delete(3);
  }
}
