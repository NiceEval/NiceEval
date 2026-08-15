// text 面的排版工具:显示宽度(CJK 记 2 列)、填充、折行、对齐列、字符条形。
// 全部纯函数、零依赖;niceeval show 的终端输出与 Row 分栏都建立在这几样上。
//
// 其中七个是公开面(`niceeval/report` 以 stringWidth / padEnd / padStart / wrapText /
// indent / bar / columns 的名字导出,见 ../index.ts):自定义组件的 text 面必须拿到与
// 官方组件同一把尺子,否则「用户组件与官方组件对等」是假的。它们的 TSDoc 就是公开文档,
// 改签名即破坏公开面。renderAlignedRows 不导出 —— 表格的能力由 <Table> 原语承担。

/** 终端显示宽度:CJK / 全角记 2 列,其余记 1。启发式覆盖常用区段,够对齐表格用。 */
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
  ) {
    return 2;
  }
  return 1;
}

/**
 * 一段文本在终端里占几列:CJK / 全角字符记 2 列,其余记 1 列。
 *
 * 对齐终端输出用它,不要用 `String.prototype.length`——`length` 数的是 UTF-16 码元,
 * 一个汉字占 2 个显示列却只算 1 个码元,中文一进来列就错位。
 *
 * @param text 任意文本。
 * @returns 显示列数。
 */
export function stringWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charDisplayWidth(ch.codePointAt(0)!);
  return width;
}

/**
 * 按显示宽度在右侧补空格(左对齐)。超宽不截断,如实溢出。
 *
 * `String.prototype.padEnd` 的显示宽度版:内容含中文时才对得齐。
 *
 * @param text 要补齐的文本。
 * @param width 目标显示宽度。
 * @returns 补齐后的文本。
 */
export function padDisplay(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

/**
 * 按显示宽度在左侧补空格(右对齐)。超宽不截断,如实溢出。
 *
 * 数字列靠它对齐小数点。
 *
 * @param text 要补齐的文本。
 * @param width 目标显示宽度。
 * @returns 补齐后的文本。
 */
export function padStartDisplay(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? " ".repeat(gap) + text : text;
}

/**
 * 按显示宽度折行:优先在空格处断,单个词超宽(URL / 中文长句)按列宽硬断。
 *
 * @param text 要折行的文本(`\n` 分段)。
 * @param width 每行的最大显示宽度。
 * @returns 折好的行;至少一行(空串输入 → `[""]`)。
 */
export function wrapDisplay(text: string, width: number): string[] {
  const max = Math.max(4, width);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let lineWidth = 0;
    const flush = () => {
      lines.push(line);
      line = "";
      lineWidth = 0;
    };
    for (const word of paragraph.split(" ")) {
      const wordWidth = stringWidth(word);
      if (lineWidth > 0 && lineWidth + 1 + wordWidth > max) flush();
      if (wordWidth > max) {
        // 单词本身超宽(URL / 中文长句):逐字符硬断
        for (const ch of word) {
          const w = charDisplayWidth(ch.codePointAt(0)!);
          if (lineWidth + w > max) flush();
          line += ch;
          lineWidth += w;
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

/**
 * 给一整块文本的每行加同一段前缀(嵌套块缩进)。空行不加,不留尾随空格。
 *
 * @param block 多行文本。
 * @param indent 每行的前缀,通常是若干空格。
 * @returns 缩进后的文本块。
 */
export function indentBlock(block: string, indent: string): string {
  return block
    .split("\n")
    .map((line) => (line.length > 0 ? indent + line : line))
    .join("\n");
}

/** 列对齐方向:`"left"` 是默认,`"right"` 按显示宽度右对齐(数字列用)。 */
export type ColumnAlign = "left" | "right";

/**
 * 对齐列渲染:每列宽 = 该列最宽格的显示宽度,列间 3 空格,行尾不留空白。首行是表头。
 * `align[c]` 给第 c 列的对齐方向,缺省 `"left"`。
 *
 * 内部件:公开面是 <Table> 原语(见 ./table.ts 的 renderTableText,它先按 ctx.width
 * 定好列宽再调这里)。不导出到 `niceeval/report` —— 两条并行的建表路径只会让作者选错。
 */
export function renderAlignedRows(
  rows: string[][],
  align: readonly ColumnAlign[] = [],
  separator = "   ",
): string {
  const columnCount = Math.max(...rows.map((r) => r.length), 0);
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    widths.push(Math.max(...rows.map((r) => stringWidth(r[c] ?? ""))));
  }
  return rows
    .map((row) =>
      row
        .map((cell, c) => (align[c] === "right" ? padStartDisplay(cell, widths[c]) : padDisplay(cell, widths[c])))
        .join(separator)
        .replace(/\s+$/, ""),
    )
    .join("\n");
}

/**
 * 字符条形:比例 → `█` 填充、`░` 补齐到 `barWidth` 显示列。比例超出 [0, 1] 时钳住。
 *
 * @param ratio 填充比例,0 到 1。
 * @param barWidth 整条的显示宽度。
 * @returns 定宽的字符条。
 */
export function textBar(ratio: number, barWidth: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * barWidth);
  return "█".repeat(filled) + "░".repeat(barWidth - filled);
}

/**
 * 多块文本并排成栏(`Row` 的 text 面):逐行拼接,各栏按显示宽度补齐,短栏补空行。
 *
 * @param blocks 每栏一块多行文本。
 * @param columnWidths 每栏的显示宽度,与 `blocks` 一一对应。
 * @param separator 栏间分隔符,默认 `" │ "`。
 * @returns 并排后的文本块。
 */
export function joinColumns(blocks: string[], columnWidths: number[], separator = " │ "): string {
  const columns = blocks.map((block) => block.split("\n"));
  const height = Math.max(...columns.map((lines) => lines.length), 0);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const parts = columns.map((lines, c) => padDisplay(lines[i] ?? "", columnWidths[c]));
    out.push(parts.join(separator).replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/** v0.12-compatible public aliases sharing the exact same width implementation. */
export const padEnd = padDisplay;
export const padStart = padStartDisplay;
export const wrapText = wrapDisplay;
export const indent = indentBlock;
export const bar = textBar;
export const columns = joinColumns;
