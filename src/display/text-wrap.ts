/** Wrap using the actual glyph measurements, including unbroken words. */
export function wrap(text: string, measure: (s: string) => number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let fragments = [word];
      if (measure(word) > width) {
        fragments = [];
        let part = '';
        for (const char of word) {
          if (part && measure(part + char) > width) {
            fragments.push(part);
            part = '';
          }
          part += char;
        }
        if (part) fragments.push(part);
      }
      for (const fragment of fragments) {
        if (line && measure(line + ' ' + fragment) > width) {
          lines.push(line);
          line = '';
        }
        line += (line ? ' ' : '') + fragment;
      }
    }
    lines.push(line);
  }
  return lines;
}
