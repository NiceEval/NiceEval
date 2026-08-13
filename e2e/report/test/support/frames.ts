/** Nested Section frames measured on `reports/site.tsx --page overview` at 120×40. */
const PANEL_CORNERS = /[╭╰]/;
const REQUIRED_BOX_SEGMENTS = ["╭─", "├─", "│", "╰─"] as const;

export function hasBoxFrames(text: string): boolean {
  return PANEL_CORNERS.test(text);
}

export function expectBoxed(text: string, diagnostic: string): void {
  const missing = REQUIRED_BOX_SEGMENTS.filter((segment) => !text.includes(segment));
  if (missing.length > 0) {
    throw new Error(
      `expected complete Section frames (${REQUIRED_BOX_SEGMENTS.join("/")}); missing ${missing.join(", ")}\n${diagnostic}\n---\n${text}`,
    );
  }
}

export function expectPlain(text: string, diagnostic: string): void {
  if (hasBoxFrames(text) || text.includes("╭─") || text.includes("╰─") || text.includes("├─")) {
    throw new Error(`pipe/NO_COLOR output must stay plain, found box-drawing characters\n${diagnostic}\n---\n${text}`);
  }
}
