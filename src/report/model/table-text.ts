import {
  charDisplayWidth,
  padDisplay,
  padStartDisplay,
  stringWidth,
  wrapDisplay,
  type ColumnAlign,
} from "./text-layout.ts";
import { DATA_BOX_FRAME_OVERHEAD, dataBoxBorder, dataBoxMode, dataBoxRow, type PanelMode } from "./panel.ts";

export interface TextTableColumn {
  readonly key: string;
  readonly header: string;
  readonly align?: ColumnAlign;
  readonly maxLines?: number;
}

export interface TextTableRow {
  readonly cells: Readonly<Record<string, string | null | undefined>>;
  readonly depth?: number;
  readonly locator?: string;
}

export interface TextTableProps {
  readonly columns: readonly TextTableColumn[];
  readonly rows: readonly TextTableRow[];
}

export interface TextTableContext {
  readonly width: number;
  readonly panelMode: PanelMode;
  readonly sectionBoxedDepth: number;
}

const MISSING_MARK = "—";
const COLUMN_GAP = 3;
const MIN_TEXT_COLUMN = 8;
const MIN_IDENTITY_COLUMN = 24;
/** Keep exact Record identities in the semantic document, but do not let a
 * full AttemptId dominate the terminal overview's identity column. */
const LOCATOR_DISPLAY_WIDTH = 14;

function isLocatorCell(cell: string): boolean {
  return /^\s*(?:[✓✗!·]\s+)?@[A-Za-z0-9._-]+$/.test(cell);
}

function compactLocatorCell(cell: string): string {
  if (!isLocatorCell(cell)) return cell;
  const locatorStart = cell.indexOf("@");
  const locator = cell.slice(locatorStart);
  if (stringWidth(locator) <= LOCATOR_DISPLAY_WIDTH) return cell;
  return `${cell.slice(0, locatorStart)}${truncateDisplay(locator, LOCATOR_DISPLAY_WIDTH - 1)}…`;
}

function cellText(row: TextTableRow, key: string): string {
  const value = row.cells[key];
  return value === null || value === undefined ? MISSING_MARK : value;
}

function totalWidth(widths: readonly number[]): number {
  return widths.reduce((sum, w) => sum + w, 0) + COLUMN_GAP * Math.max(0, widths.length - 1);
}

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

function clampCellLines(lines: string[], maxLines: number | undefined, width: number): string[] {
  if (maxLines === undefined || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  const last = kept[kept.length - 1]!;
  kept[kept.length - 1] = `${truncateDisplay(last, Math.max(1, width - 1))}…`;
  return kept;
}

function wrapIndented(cell: string, width: number): string[] {
  const indent = cell.length - cell.trimStart().length;
  if (indent === 0) return wrapDisplay(cell, width);
  const pad = " ".repeat(indent);
  const body = wrapDisplay(cell.slice(indent), Math.max(1, width - indent));
  return body.map((line) => `${pad}${line}`);
}

function toPhysicalRows(
  cells: readonly string[],
  widths: readonly number[],
  maxLines: readonly (number | undefined)[],
): string[][] {
  const wrapped = cells.map((cell, c) =>
    clampCellLines(
      isLocatorCell(cell) || (!cell.includes("\n") && stringWidth(cell) <= widths[c]!)
        ? [cell]
        : wrapIndented(cell, widths[c]!),
      maxLines[c],
      widths[c]!,
    ),
  );
  const height = Math.max(...wrapped.map((lines) => lines.length), 1);
  const out: string[][] = [];
  for (let i = 0; i < height; i++) out.push(wrapped.map((lines) => lines[i] ?? ""));
  return out;
}

function hiddenColumnsNote(hidden: number): string {
  return hidden === 1 ? "(1 more column not shown)" : `(${hidden} more columns not shown)`;
}

function renderFramedTable(
  header: readonly string[][],
  body: readonly { depth: number; physical: string[][] }[],
  widths: readonly number[],
  align: readonly ColumnAlign[],
  outerFrame: boolean,
): string {
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

export function renderTableText(props: TextTableProps, ctx: TextTableContext): string {
  if (props.columns.length === 0) return "";

  const header = props.columns.map((column) => column.header);
  const align: ColumnAlign[] = props.columns.map((column) => column.align ?? "left");
  const body = props.rows.map((row) =>
    props.columns.map((column, columnIndex) =>
      columnIndex === 0 && row.locator !== undefined
        ? compactLocatorCell(cellText(row, column.key))
        : cellText(row, column.key)
    )
  );

  const matrix = [header, ...body];
  const natural = header.map((_, c) =>
    Math.max(...matrix.map((row) => stringWidth(row[c] ?? ""))),
  );
  const lines = dataBoxMode(ctx.panelMode, ctx.width) === "boxed";
  const outerFrame = lines && ctx.sectionBoxedDepth === 0;
  const available = outerFrame ? ctx.width - DATA_BOX_FRAME_OVERHEAD : ctx.width;
  const { widths, hidden } = fitWidths(natural, align, available);

  const maxLines: (number | undefined)[] = props.columns.map((column) => column.maxLines);
  const headerPhysical = toPhysicalRows(header.slice(0, widths.length), widths, widths.map(() => undefined));
  const bodyBlocks = body.map((row, i) => ({
    depth: props.rows[i]?.depth ?? 0,
    physical: toPhysicalRows(row.slice(0, widths.length), widths, maxLines),
  }));
  const bodyPhysical = bodyBlocks.flatMap((block) => block.physical);

  const table = lines
    ? renderFramedTable(headerPhysical, bodyBlocks, widths, align, outerFrame)
    : renderFittedRows([...headerPhysical, ...bodyPhysical], widths, align);
  return hidden > 0 ? `${table}\n${hiddenColumnsNote(hidden)}` : table;
}

function padCell(cell: string, width: number, align: ColumnAlign): string {
  const used = stringWidth(cell);
  const gap = width - used;
  if (gap <= 0) return cell;
  return align === "right" ? `${" ".repeat(gap)}${cell}` : `${cell}${" ".repeat(gap)}`;
}

function renderFittedRows(
  rows: readonly string[][],
  widths: readonly number[],
  align: readonly ColumnAlign[],
): string {
  return rows
    .map((row) =>
      row
        .map((cell, c) => padCell(cell, widths[c]!, align[c] ?? "left"))
        .join("   ")
        .replace(/\s+$/, ""),
    )
    .join("\n");
}
