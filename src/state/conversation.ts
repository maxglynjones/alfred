export type Exchange = { id: number; question: string; reply: string };
export type ConversationPage = {
  exchange: number;
  role: 'You' | 'Assistant';
  text: string;
  part: number;
  parts: number;
};
export function paginate(text: string, limit = 300): string[] {
  const pages: string[] = [];
  let page = '';
  // Split oversized words too, so each glasses page always stays within its budget.
  const words = text
    .trim()
    .split(/\s+/)
    .flatMap((word) => word.match(new RegExp(`.{1,${limit}}`, 'gu')) ?? []);
  for (const word of words) {
    if (page && page.length + word.length + 1 > limit) {
      pages.push(page);
      page = '';
    }
    page += (page ? ' ' : '') + word;
  }
  if (page) pages.push(page);
  return pages;
}
export class Conversation {
  exchanges: Exchange[] = [];
  pages: ConversationPage[] = [];
  index = 0;
  private nextId = 1;
  constructor(
    private maxExchanges = 20,
    private split: (text: string) => string[] = paginate,
  ) {}
  restore(exchanges: Exchange[]) {
    this.exchanges = exchanges
      .filter(
        (x) =>
          Number.isInteger(x.id) && typeof x.question === 'string' && typeof x.reply === 'string',
      )
      .slice(-this.maxExchanges);
    this.nextId = (this.exchanges.at(-1)?.id ?? 0) + 1;
    this.rebuild();
    this.latest();
  }
  private rebuild() {
    this.pages = this.exchanges.flatMap((turn) =>
      (['You', 'Assistant'] as const).flatMap((role) => {
        const parts = this.split(role === 'You' ? turn.question : turn.reply);
        return parts.map((text, i) => ({
          exchange: turn.id,
          role,
          text,
          part: i + 1,
          parts: parts.length,
        }));
      }),
    );
  }
  add(question: string, reply: string) {
    const exchange = { id: this.nextId++, question, reply };
    this.exchanges = [...this.exchanges, exchange].slice(-this.maxExchanges);
    this.rebuild();
    this.index = this.pages.findIndex(
      (page) => page.exchange === exchange.id && page.role === 'Assistant',
    );
    if (this.index < 0) this.index = Math.max(0, this.pages.length - 1);
  }
  move(direction: number) {
    this.index = Math.max(0, Math.min(this.pages.length - 1, this.index + direction));
  }
  latest() {
    const last = this.exchanges.at(-1);
    if (last)
      this.index = this.pages.findIndex(
        (page) => page.exchange === last.id && page.role === 'Assistant',
      );
  }
  clear() {
    this.exchanges = [];
    this.pages = [];
    this.index = 0;
  }
  get current() {
    return this.pages[this.index];
  }
}
// Both ring/system gestures and text-container gestures emit these SDK event values.
export function scrollDirection(event: number | undefined) {
  return event === 1 ? -1 : event === 2 ? 1 : 0;
}

// A fixed 200 words/minute budget plus three seconds to orient to a new page.
// Character count also accounts for URLs, numbers and oversized tokens.
export function replyReadingTime(text: string): number {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  const readingUnits = Math.max(words, Math.ceil(Array.from(trimmed).length / 6));
  return Math.min(60000, Math.max(8000, 3000 + Math.ceil((readingUnits * 60000) / 200)));
}

// Wall-clock expiry survives throttled timers and WebView suspension.
export class ReplyExpiry {
  private deadline = 0;
  constructor(private now: () => number = Date.now) {}
  arm(text: string) {
    this.deadline = text.trim() ? this.now() + replyReadingTime(text) : 0;
  }
  clear() {
    this.deadline = 0;
  }
  get remaining() {
    return this.deadline ? Math.max(0, this.deadline - this.now()) : 0;
  }
  get due() {
    return this.deadline > 0 && this.now() >= this.deadline;
  }
}
