// <Table> 原语的 text 面(../primitives.tsx 的 Table.text 就是它)。
// 官方的表状组件(MetricTable / MetricMatrix / Scoreboard / DeltaTable)的 text 面也直接
// 调它 —— 官方与自定义表共用同一个渲染器,是「用户组件与官方组件对等」的构造证明:
// 官方用不上的能力用户就拿不到,官方绕过它手搓它就一定会长歪。
//
// 列宽按显示宽度算(CJK 记 2 列);null 渲染 —,不补 0;超宽先折最宽的左对齐列,
// 压到下限仍放不下就从右侧丢列并如实报数(「截断报剩余」是既有契约,不在这里破例)。

import type { TableColumn, TableRow } from "./primitives.tsx";
import type { TextContext } from "./tree.ts";
import { countText, localeText, resolveLocalizedText } from "../model/locale.ts";
import { charDisplayWidth, renderAlignedRows, stringWidth, wrapDisplay, type ColumnAlign } from "../model/text-layout.ts";

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
 * 1. 压最宽的左对齐列(文本列)到下限 —— 右对齐列是数字,折行读不了,不压;
 * 2. 仍放不下就从右侧丢列(至少留一列),丢了几列如实返回。
 */
function fitWidths(
  natural: readonly number[],
  align: readonly ColumnAlign[],
  available: number,
): { widths: number[]; hidden: number } {
  const widths = [...natural];
  while (totalWidth(widths) > available) {
    let widest = -1;
    for (let c = 0; c < widths.length; c++) {
      if (align[c] === "right" || widths[c] <= MIN_TEXT_COLUMN) continue;
      if (widest === -1 || widths[c] > widths[widest]) widest = c;
    }
    if (widest === -1) break;
    const over = totalWidth(widths) - available;
    widths[widest] = Math.max(MIN_TEXT_COLUMN, widths[widest] - over);
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
      !cell.includes("\n") && stringWidth(cell) <= widths[c] ? [cell] : wrapDisplay(cell, widths[c]),
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
  const { widths, hidden } = fitWidths(natural, align, ctx.width);

  const maxLines: (number | undefined)[] = props.columns.map((column) => column.maxLines);
  if (hasLocator) maxLines.push(undefined);
  // 表头不参与 maxLines 收口:表头是自己写的短词,收口只服务数据格。
  const physical = [
    ...toPhysicalRows(header.slice(0, widths.length), widths, widths.map(() => undefined)),
    ...body.flatMap((row) => toPhysicalRows(row.slice(0, widths.length), widths, maxLines)),
  ];
  const table = renderAlignedRows(physical, align);
  return hidden > 0 ? `${table}\n${countText(locale, "table.columnsHidden", hidden)}` : table;
}
