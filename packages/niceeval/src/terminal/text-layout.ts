/** Pure terminal display-width helpers shared by Runner and Sandbox output. */
export function charDisplayWidth(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) return 2;
  return 1;
}

export function stringWidth(text: string): number {
  let width = 0;
  for (const character of text) width += charDisplayWidth(character.codePointAt(0)!);
  return width;
}

export function padDisplay(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

export function padStartDisplay(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? " ".repeat(gap) + text : text;
}

export function wrapDisplay(text: string, width: number): string[] {
  const maximum = Math.max(4, width);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let lineWidth = 0;
    const flush = (): void => {
      lines.push(line);
      line = "";
      lineWidth = 0;
    };
    for (const word of paragraph.split(" ")) {
      const wordWidth = stringWidth(word);
      if (lineWidth > 0 && lineWidth + 1 + wordWidth > maximum) flush();
      if (wordWidth > maximum) {
        for (const character of word) {
          const characterWidth = charDisplayWidth(character.codePointAt(0)!);
          if (lineWidth + characterWidth > maximum) flush();
          line += character;
          lineWidth += characterWidth;
        }
        continue;
      }
      if (lineWidth > 0) {
        line += " ";
        lineWidth += 1;
      }
      line += word;
      lineWidth += wordWidth;
    }
    flush();
  }
  return lines.length > 0 ? lines : [""];
}
