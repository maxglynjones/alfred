import { wrap } from './text-wrap';

// Native G2 text uses the firmware font, not the canvas preview font.
// Approximate the proportional firmware font; retain a right gutter and explicit
// bounds for wide glyphs. Treating every lowercase letter as 24px wasted half the screen.
export const replyLayout = { x: 24, y: 64, width: 528, height: 192, wrapWidth: 504, lines: 6 };
export function replyLineWidth(text: string) {
  return Array.from(text).reduce((width, char) => {
    if (/\s/u.test(char)) return width + 6;
    if (/[MW@%&#QO]/u.test(char)) return width + 20;
    if (char.codePointAt(0)! > 0x2ff) return width + 24;
    if (/[ilI.,'!:;|]/u.test(char)) return width + 6;
    return width + 12;
  }, 0);
}
export function replyPages(text: string): string[] {
  const lines = wrap(text, replyLineWidth, replyLayout.wrapWidth);
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += replyLayout.lines)
    pages.push(lines.slice(i, i + replyLayout.lines).join('\n'));
  return pages.length ? pages : [''];
}
