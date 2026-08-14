export function expectPlain(text: string, diagnostic: string): void {
  if (/[╭╰]/.test(text) || text.includes("╭─") || text.includes("╰─") || text.includes("├─")) {
    throw new Error(`pipe/NO_COLOR output must stay plain, found box-drawing characters\n${diagnostic}\n---\n${text}`);
  }
}

/**
 * PTY rows are physical terminal rows, so CJK wide glyphs count as two
 * columns while frame glyphs and ASCII count as one. This stays deliberately
 * small: it is a layout witness, not a second renderer.
 */
export function expectDisplayColumns(rows: readonly string[], columns: number, diagnostic: string): void {
  for (const [index, row] of rows.entries()) {
    const actual = [...row].reduce((total, character) => total + terminalColumns(character), 0);
    if (actual !== columns) {
      throw new Error(
        `PTY witness row ${index + 1} occupies ${actual} columns, expected ${columns}\n${diagnostic}\n---\n${row}`,
      );
    }
  }
}

function terminalColumns(character: string): number {
  const point = character.codePointAt(0)!;
  return (point >= 0x1100 &&
    (point <= 0x115f ||
      point === 0x2329 ||
      point === 0x232a ||
      (point >= 0x2e80 && point <= 0xa4cf) ||
      (point >= 0xac00 && point <= 0xd7a3) ||
      (point >= 0xf900 && point <= 0xfaff) ||
      (point >= 0xfe10 && point <= 0xfe19) ||
      (point >= 0xfe30 && point <= 0xfe6f) ||
      (point >= 0xff00 && point <= 0xff60) ||
      (point >= 0xffe0 && point <= 0xffe6)))
    ? 2
    : 1;
}
