/** Section / Table outer frames. Chart axis glyphs (│ ┤) also appear in pipe. */
const PANEL_FRAMES = /[╭╮╰╯]/;

export function hasBoxFrames(text: string): boolean {
  return PANEL_FRAMES.test(text);
}

export function expectBoxed(text: string, diagnostic: string): void {
  if (!hasBoxFrames(text)) {
    throw new Error(`expected box-drawing characters in PTY output\n${diagnostic}\n---\n${text}`);
  }
}

export function expectPlain(text: string, diagnostic: string): void {
  if (hasBoxFrames(text)) {
    throw new Error(`pipe/NO_COLOR output must stay plain, found box-drawing characters\n${diagnostic}\n---\n${text}`);
  }
}
