// <Table> 原语的 text 面(../primitives.tsx 的 Table.text 就是它)。
// 官方的表状组件(Table / Scoreboard / DeltaTable)的 text 面也直接
// 调它 —— 官方与自定义表共用同一个渲染器,是「用户组件与官方组件对等」的构造证明:
// 官方用不上的能力用户就拿不到,官方绕过它手搓它就一定会长歪。
//
// 列宽按显示宽度算(CJK 记 2 列);null 渲染 —,不补 0;超宽按比例压左对齐列并在格内折行,
// 全压到下限仍放不下才从右侧丢列并如实报数(「截断报剩余」是既有契约,不在这里破例)。
// 画线与不画线是同一份列宽算术:数据格框的列间 ` │ ` 与朴素形态的 `   ` 都占 3 列。

import type { TableColumn, TableRow } from "./primitives.tsx";
import type { TextContext } from "./tree.ts";
import { countText, localeText, resolveLocalizedText } from "../model/locale.ts";
import {
  charDisplayWidth,
  padDisplay,
  padStartDisplay,
  renderAlignedRows,
  stringWidth,
  wrapDisplay,
  type ColumnAlign,
} from "../model/text-layout.ts";
import { DATA_BOX_FRAME_OVERHEAD, dataBoxBorder, dataBoxMode, dataBoxRow } from "../model/panel.ts";
import { panelSectionDepth } from "./primitives/text-panel-state.ts";

/** text 排版器入参:faces.ts 与旧 Table 形态共用的预格式化表。 */
export interface TextTableProps {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  locale?: import("../model/locale.ts").ReportLocale;
}

const MISSING_MARK = "—";
/** 列间距,与 renderAlignedRows 的 join("   ") 一致。 */
const COLUMN_GAP = 3;
/** 左对齐列的压缩下限:再窄就读不成句,宁可丢列。 */
const MIN_TEXT_COLUMN = 8;
/** 身份列(首列)的压缩下限:读不出身份的行等于没有,所以它比其余文本列早停在这个宽度
 *  ——列自然宽本来就短于它时以自然宽为准,不给短列补空。压到这一步还放不下就丢列。 */
const MIN_IDENTITY_COLUMN = 24;

/** 格子的文本形态:缺这个键、或值是 null,都渲染 —(与 web 面同源)。 */
function cellText(row: TableRow, key: string): string {
  const value = row.cells[key];
  return value === null || value === undefined ? MISSING_MARK : value;
}

function totalWidth(widths: readonly number[]): number {
  return widths.reduce((sum, w) => sum + w, 0) + COLUMN_GAP * Math.max(0, widths.length - 1);
}

/**
 * 自然列宽 → 放得进 available 的列宽。两步,顺序即优先级:
 * 1. 按自然宽的比例压所有左对齐列(文本列)到下限 —— 右对齐列是数字,折行读不了,不压;
 *    按比例分摊而不是逐个压最宽的那列:两个都很长的文本列各让一半,比把其中一个压到
 *    下限(读出来是「Experime / nt」)可读得多;
 * 2. 全部压到下限仍放不下,才从右侧丢列(至少留一列),丢了几列如实返回。
 */
function fitWidths(
  natural: readonly number[],
  align: readonly ColumnAlign[],
  available: number,
): { widths: number[]; hidden: number } {
  const widths = [...natural];
  const floorOf = (c: number): number =>
    c === 0 ? Math.min(natural[0] ?? MIN_IDENTITY_COLUMN, MIN_IDENTITY_COLUMN) : MIN_TEXT_COLUMN;
  for (;;) {
    const over = totalWidth(widths) - available;
    if (over <= 0) break;
    const flexible = widths
      .map((w, c) => ({ c, w, floor: floorOf(c) }))
      .filter(({ c, w, floor }) => align[c] !== "right" && w > floor);
    if (flexible.length === 0) break;
    // 可压缩总量按各列自己的余量加权分摊;取整后的余数留给下一轮,循环终止于「无列可压」。
    const slack = flexible.reduce((sum, { w, floor }) => sum + (w - floor), 0);
    let remaining = Math.min(over, slack);
    for (const { c, w, floor } of flexible) {
      if (remaining <= 0) break;
      const share = Math.min(w - floor, Math.max(1, Math.round((over * (w - floor)) / slack)), remaining);
      widths[c] = w - share;
      remaining -= share;
    }
  }
  let hidden = 0;
  while (widths.length > 1 && totalWidth(widths) > available) {
    widths.pop();
    hidden += 1;
  }
  return { widths, hidden };
}

/** 按显示宽度截到 width(不够放 `…` 时原样返回)。 */
function truncateDisplay(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = charDisplayWidth(ch.codePointAt(0)!);
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  return out;
}

/** 列的 maxLines 收口:超出的行丢弃,最后一行以 `…` 如实标注被收口。 */
function clampCellLines(lines: string[], maxLines: number | undefined, width: number): string[] {
  if (maxLines === undefined || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  const last = kept[kept.length - 1]!;
  kept[kept.length - 1] = `${truncateDisplay(last, Math.max(1, width - 1))}…`;
  return kept;
}

/**
 * 折行时保住格子开头的缩进:层级就长在首列的缩进上(docs 的「层级与横线」),而 wrapDisplay
 * 会把行首空格吃掉——身份被压窄正是最需要看清层级的时候,不能一折行就把层级折没了。
 * 续行跟着对齐到同一个缩进。
 */
function wrapIndented(cell: string, width: number): string[] {
  const indent = cell.length - cell.trimStart().length;
  if (indent === 0) return wrapDisplay(cell, width);
  const pad = " ".repeat(indent);
  const body = wrapDisplay(cell.slice(indent), Math.max(1, width - indent));
  return body.map((line) => `${pad}${line}`);
}

/** 逻辑行 → 物理行:每格折到自己的列宽,列带 maxLines 就收口,行高取最高的那格,矮格补空串。 */
function toPhysicalRows(
  cells: readonly string[],
  widths: readonly number[],
  maxLines: readonly (number | undefined)[],
): string[][] {
  const wrapped = cells.map((cell, c) =>
    // 放得下就原样保留:wrapDisplay 会把连续空格折成一个,而 DeltaTable 的
    // "50% → 62%   +12pp" 这类格子内含固定间距 —— 不折行时一个字节都不能动。
    clampCellLines(
      !cell.includes("\n") && stringWidth(cell) <= widths[c] ? [cell] : wrapIndented(cell, widths[c]!),
      maxLines[c],
      widths[c]!,
    ),
  );
  const height = Math.max(...wrapped.map((lines) => lines.length), 1);
  const out: string[][] = [];
  for (let i = 0; i < height; i++) out.push(wrapped.map((lines) => lines[i] ?? ""));
  return out;
}

/**
 * <Table> 的 text 面:columns × rows → 对齐的字符表。
 * 有任一行带 locator 时追加一列 attempt(locator 本身就是 `niceeval show <locator>`
 * 的位置参数;逐行重复整条命令会把表撑宽,与三个实体列表 text 面的既有取舍一致)。
 */
export function renderTableText(props: TextTableProps, ctx: TextContext): string {
  const locale = props.locale ?? ctx.locale;
  const hasLocator = props.rows.some((row) => row.locator !== undefined);
  if (props.columns.length === 0 && !hasLocator) return "";

  const header = props.columns.map((column) => resolveLocalizedText(column.header, locale));
  const align: ColumnAlign[] = props.columns.map((column) => column.align ?? "left");
  const body = props.rows.map((row) => props.columns.map((column) => cellText(row, column.key)));
  if (hasLocator) {
    header.push(localeText(locale, "table.attempt"));
    align.push("left");
    props.rows.forEach((row, i) => body[i].push(row.locator ?? MISSING_MARK));
  }

  const matrix = [header, ...body];
  const natural = header.map((_, c) => Math.max(...matrix.map((row) => stringWidth(row[c] ?? ""))));
  // 画线时列间距与不画线时相同(` │ ` 与 `   ` 都是 3 列),所以只有外框那 4 列要先让出来。
  const lines = dataBoxMode(ctx.panelMode, ctx.width) === "boxed";
  // 嵌在画框的 Section 里:边界已由面板的框给出,自己只留列边界与表头横线,不套二层框。
  const outerFrame = lines && panelSectionDepth() === 0;
  const available = outerFrame ? ctx.width - DATA_BOX_FRAME_OVERHEAD : ctx.width;
  const { widths, hidden } = fitWidths(natural, align, available);

  const maxLines: (number | undefined)[] = props.columns.map((column) => column.maxLines);
  if (hasLocator) maxLines.push(undefined);
  // 表头不参与 maxLines 收口:表头是自己写的短词,收口只服务数据格。
  const headerPhysical = toPhysicalRows(header.slice(0, widths.length), widths, widths.map(() => undefined));
  const bodyBlocks = body.map((row, i) => ({
    depth: props.rows[i]?.depth ?? 0,
    physical: toPhysicalRows(row.slice(0, widths.length), widths, maxLines),
  }));
  const bodyPhysical = bodyBlocks.flatMap((block) => block.physical);

  const table = lines
    ? renderFramedTable(headerPhysical, bodyBlocks, widths, align, outerFrame)
    : renderAlignedRows([...headerPhysical, ...bodyPhysical], align);
  return hidden > 0 ? `${table}\n${countText(locale, "table.columnsHidden", hidden)}` : table;
}

/**
 * 数据格框形态:列边界贯穿全表,横线画在行树自己的边界上——表头与正文之间一条,行树有
 * 嵌套时每个顶层行之前再一条(一组一格,组内不切)。平表只有表头那一条:逐行切割读起来
 * 是一堆独立小框,层级与分组反而看不出来。分隔只按 depth 判,`Table` 不认识具体实体。
 *
 * 框宽跟随表自己的内容宽度(`fitWidths` 已经把它压进可用列数),不硬拉满终端——
 * 窄表拉满只会让同一行的读数彼此远离。
 */
function renderFramedTable(
  header: readonly string[][],
  body: readonly { depth: number; physical: string[][] }[],
  widths: readonly number[],
  align: readonly ColumnAlign[],
  outerFrame: boolean,
): string {
  // 实际列宽取该列所有物理行的最宽者:压缩与折行之后不少列比预算更窄,框跟着收。
  const physical = [...header, ...body.flatMap((block) => block.physical)];
  const actual = widths.map((w, c) => {
    const widest = Math.max(...physical.map((row) => stringWidth(row[c] ?? "")), 1);
    return Math.min(w, widest);
  });
  const line = (row: readonly string[]): string =>
    dataBoxRow(
      actual.map((w, c) => (align[c] === "right" ? padStartDisplay(row[c] ?? "", w) : padDisplay(row[c] ?? "", w))),
      outerFrame,
    );
  const nested = body.some((block) => block.depth > 0);
  const out: string[] = [];
  if (outerFrame) out.push(dataBoxBorder("top", actual, true));
  for (const row of header) out.push(line(row));
  out.push(dataBoxBorder("rule", actual, outerFrame));
  body.forEach((block, i) => {
    if (nested && i > 0 && block.depth === 0) out.push(dataBoxBorder("rule", actual, outerFrame));
    for (const row of block.physical) out.push(line(row));
  });
  if (outerFrame) out.push(dataBoxBorder("bottom", actual, true));
  return out.join("\n");
}
