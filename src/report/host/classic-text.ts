import { paddedAxisDomain, ticksInDomain, tickStepOf } from "../model/chart/math.ts";
import { renderCharPlot, renderCoordinateTable } from "../model/chart/plot.ts";
import { planTextGrid, TEXT_GRID_SEPARATOR } from "../model/grid-layout.ts";
import {
  DATA_BOX_FRAME_OVERHEAD,
  dataBoxBorder,
  dataBoxMode,
  dataBoxRow,
  panelContentWidth,
  renderPanel,
  type PanelMode,
} from "../model/panel.ts";
import { renderTableText } from "../model/table-text.ts";
import {
  joinColumns,
  padDisplay,
  padStartDisplay,
  stringWidth,
  textBar,
  wrapDisplay,
  type ColumnAlign,
} from "../model/text-layout.ts";
import { formatAxisTick, formatDateTimeMinute, shortestUniqueLabels } from "../classic/format.ts";
import type {
  ReportBlock,
  ReportHero,
  ReportRankedBars,
  ReportScatter,
} from "../semantic/document.ts";

export interface ClassicTextContext {
  readonly width: number;
  readonly mode: PanelMode;
  readonly sectionBoxedDepth: number;
}

function blockWidth(block: string): number {
  return Math.max(...block.split("\n").map((line) => stringWidth(line)), 0);
}

function framedGridRows(blocks: readonly string[], widths: readonly number[], outerFrame: boolean): string[] {
  const columns = blocks.map((block) => block.split("\n"));
  const height = Math.max(...columns.map((lines) => lines.length), 1);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(dataBoxRow(columns.map((lines, c) => padDisplay(lines[i] ?? "", widths[c]!)), outerFrame));
  }
  return out;
}

export function renderHeroText(block: ReportHero, width: number): string[] {
  const meta = block.lastRunAt === null || block.lastRunAt === undefined
    ? "No runs yet"
    : [
      `Last run ${formatDateTimeMinute(block.lastRunAt)}`,
      ...(block.runCount !== undefined && block.runCount > 1 ? [`composed from ${block.runCount} runs`] : []),
    ].join(" · ");
  const lines: string[] = [];
  if (block.title !== undefined) lines.push(block.title);
  if (block.description.length > 0) lines.push(...wrapDisplay(block.description, width));
  for (const link of block.links) {
    lines.push(link.label === link.target.href ? link.label : `${link.label} (${link.target.href})`);
  }
  if (block.lastRunAt !== undefined) lines.push(meta);
  return lines;
}

export function renderGridText(block: Extract<ReportBlock, { readonly type: "grid" }>, ctx: ClassicTextContext): string[] {
  if (block.cells.length === 0) return [];
  const lines = dataBoxMode(ctx.mode, ctx.width) === "boxed";
  const outerFrame = lines && ctx.sectionBoxedDepth === 0;
  const plan = planTextGrid({
    availableWidth: outerFrame ? ctx.width - DATA_BOX_FRAME_OVERHEAD : ctx.width,
    cellCount: block.cells.length,
  });
  const lastRowStart = Math.floor((block.cells.length - 1) / plan.columns) * plan.columns;
  const cellWidths = block.cells.map((_, i) => {
    const col = i % plan.columns;
    const isLastCell = i === block.cells.length - 1;
    const lastRowCells = block.cells.length - lastRowStart;
    if (!isLastCell || lastRowCells === plan.columns) return plan.contentWidths[col]!;
    if (lastRowCells === 1) return plan.fullRowContentWidth;
    const rest = plan.contentWidths.slice(col);
    return rest.reduce((sum, w) => sum + w, 0) + TEXT_GRID_SEPARATOR.length * (rest.length - 1);
  });
  const childCtxFor = (width: number): ClassicTextContext => ({
    width,
    mode: ctx.mode,
    sectionBoxedDepth: ctx.sectionBoxedDepth,
  });
  const blocks = block.cells.map((cell, i) => renderClassicBlockText(cell, childCtxFor(cellWidths[i]!)).join("\n"));
  const columnWidths = plan.contentWidths.map((planned, col) => {
    const widest = blocks.reduce((max, rendered, i) => {
      if (i % plan.columns !== col || cellWidths[i] !== planned) return max;
      return Math.max(max, blockWidth(rendered));
    }, 1);
    return Math.min(planned, widest);
  });
  const fittedWidths = cellWidths.map((width, i) => {
    const col = i % plan.columns;
    if (width === plan.contentWidths[col]) return columnWidths[col]!;
    const rest = columnWidths.slice(col);
    return rest.reduce((sum, w) => sum + w, 0) + TEXT_GRID_SEPARATOR.length * (rest.length - 1);
  });
  // Measuring can shrink columns below the width used for the first render.
  // Reflow every cell against its final fitted width before framing it;
  // otherwise a spanning last-row cell can retain an over-wide line and open
  // the right border even though the border itself uses the fitted width.
  const fittedBlocks = block.cells.map((cell, i) =>
    renderClassicBlockText(cell, childCtxFor(fittedWidths[i]!)).join("\n")
  );
  const out: string[] = [];
  let previousRow = 0;
  let lastRowWidths: readonly number[] = plan.contentWidths;
  for (let start = 0; start < fittedBlocks.length; start += plan.columns) {
    const rowBlocks = fittedBlocks.slice(start, start + plan.columns);
    const rowWidths = fittedWidths.slice(start, start + rowBlocks.length);
    if (!lines) {
      if (start > 0) out.push("");
      out.push(joinColumns(rowBlocks, rowWidths, "   "));
      continue;
    }
    if (start === 0 && outerFrame) out.push(dataBoxBorder("top", columnWidths, true));
    if (start > 0) {
      out.push(dataBoxBorder("rule", columnWidths.slice(0, previousRow), outerFrame, rowBlocks.length));
    }
    out.push(...framedGridRows(rowBlocks, rowWidths, outerFrame));
    previousRow = rowBlocks.length;
    lastRowWidths = rowWidths;
  }
  if (lines && outerFrame) out.push(dataBoxBorder("bottom", lastRowWidths, true));
  return out;
}

const RIGHT_ALIGNED_HEADERS = new Set([
  "Avg. time",
  "Pass rate",
  "Tokens",
  "Cost",
  "durationMs",
  "costUSD",
  "passRate",
  "tokens",
  "total",
]);

export function renderCellTableText(
  block: Extract<ReportBlock, { readonly type: "cell-table" }>,
  ctx: ClassicTextContext,
): string[] {
  const hierarchyDepths = cellTableHierarchyDepths(block);
  const firstColumn = block.columns[0] ?? "";
  const table = renderTableText(
    {
      columns: block.columns.map((column) => ({
        key: column,
        header: column,
        align: (RIGHT_ALIGNED_HEADERS.has(column) ? "right" : "left") as ColumnAlign,
      })),
      rows: block.rows.map((row) => {
        const hierarchyDepth = hierarchyDepths.get(row.key);
        return {
          cells: hierarchyDepth === undefined
            ? row.cells
            : indentHierarchyCells(row.cells, firstColumn, hierarchyDepth),
          depth: row.kind === "summary"
            ? 0
            : hierarchyDepth ?? (row.key.startsWith("coverage:") ? 0 : indentDepth(row.cells[firstColumn] ?? "")),
          ...(row.kind === "attempt"
            ? { locator: (row.cells[firstColumn] ?? "").trim() }
            : row.key.startsWith("@")
              ? { locator: row.key }
              : {}),
        };
      }),
    },
    {
      width: ctx.width,
      panelMode: ctx.mode,
      sectionBoxedDepth: ctx.sectionBoxedDepth,
    },
  );
  return table.length === 0 ? [] : table.split("\n");
}

function indentHierarchyCells(
  cells: Readonly<Record<string, string>>,
  firstColumn: string,
  depth: number,
): Readonly<Record<string, string>> {
  const first = cells[firstColumn];
  if (depth === 0 || first === undefined || first === "—") return cells;
  return Object.freeze({ ...cells, [firstColumn]: `${"  ".repeat(depth)}${first}` });
}

function cellTableHierarchyDepths(
  block: Extract<ReportBlock, { readonly type: "cell-table" }>,
): ReadonlyMap<string, number> {
  if (block.hierarchy !== true) return new Map();
  const rows = new Map(block.rows.map((row) => [row.key, row]));
  const depths = new Map<string, number>();
  const depthFor = (key: string): number => {
    const known = depths.get(key);
    if (known !== undefined) return known;
    const row = rows.get(key);
    if (row === undefined || row.parentKey === undefined) {
      depths.set(key, 0);
      return 0;
    }
    const depth = depthFor(row.parentKey) + 1;
    depths.set(key, depth);
    return depth;
  };
  for (const row of block.rows) depthFor(row.key);
  return depths;
}

function indentDepth(cell: string): number {
  const indent = cell.length - cell.trimStart().length;
  return Math.floor(indent / 2);
}

export function renderRankedBarsText(block: ReportRankedBars, width: number): string[] {
  const rawLabels = block.points.map((point) => point.label);
  const labels = shortestUniqueLabels(rawLabels);
  const displays = block.points.map((point) => {
    const coverage = point.coverage;
    return coverage.samples < coverage.total
      ? `${point.display} ${coverage.samples}/${coverage.total}`
      : point.display;
  });
  const labelWidth = Math.max(0, ...rawLabels.map((label) => stringWidth(labels.get(label) ?? label)));
  const valueWidth = Math.max(0, ...displays.map(stringWidth));
  const barWidth = Math.max(8, Math.min(24, width - labelWidth - valueWidth - 4));
  const numbers = block.points.map((point) => point.value).filter((value): value is number => value !== null);
  const boundMax = numbers.length > 0 && numbers.every((value) => value >= 0 && value <= 1) ? 1 : undefined;
  const max = boundMax !== undefined && boundMax > 0
    ? boundMax
    : Math.max(0, ...numbers);
  const heading = block.title;
  return [
    `${padDisplay("", labelWidth)}  ${padDisplay(heading, barWidth)}  ${padStartDisplay("", valueWidth)}`,
    ...block.points.map((point, index) => {
      const label = labels.get(point.label) ?? point.label;
      const value = point.value ?? 0;
      const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
      return `${padDisplay(label, labelWidth)}  ${textBar(ratio, barWidth)}  ${padStartDisplay(displays[index]!, valueWidth)}`;
    }),
  ];
}

function chartFieldLabel(field: string, unit: string | undefined): string {
  const dictionary: Record<string, string> = {
    costUSD: "Cost",
    passRate: "Pass rate",
    totalScore: "Total score",
    durationMs: "Avg. time",
    tokens: "Tokens",
  };
  const base = dictionary[field] ?? field;
  return unit ? `${base}(${unit})` : base;
}

function axisUnit(field: string): string | undefined {
  if (field === "costUSD") return "$";
  if (field === "passRate") return "%";
  if (field === "durationMs") return "ms";
  if (field === "tokens") return "tokens";
  return undefined;
}

function axisBounds(field: string): { min?: number; max?: number } | undefined {
  if (field === "passRate") return { min: 0, max: 1 };
  if (field === "costUSD" || field === "durationMs" || field === "tokens") return { min: 0 };
  return undefined;
}

function signedDelta(delta: number, unit: string | undefined): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const abs = Math.abs(delta);
  if (unit === "%") {
    const points = abs * 100;
    return `${sign}${Number.isInteger(points) ? points : points.toFixed(1)}pt`;
  }
  const formatted = unit === "$"
    ? `$${abs >= 0.01 || abs === 0 ? abs.toFixed(2) : abs.toFixed(4)}`
    : String(abs);
  return `${sign}${formatted}`;
}

export function renderScatterText(block: ReportScatter, width: number): string[] {
  const groups = block.series.map((series) => ({
    key: series.label,
    connect: block.connect,
    points: [...series.points]
      .filter((point) => point.x !== null && point.y !== null)
      .sort((left, right) => (left.x ?? 0) - (right.x ?? 0)),
  })).filter((group) => group.points.length > 0);
  if (groups.length === 0) return ["No data to plot"];

  const plotted = groups.flatMap((group) => group.points);
  const xUnit = axisUnit(block.xLabel);
  const yUnit = axisUnit(block.yLabel);
  const xBetter = block.xBetter;
  const yBetter = block.yBetter;
  const xDomain = paddedAxisDomain(plotted.map((point) => point.x!), axisBounds(block.xLabel));
  const yDomain = paddedAxisDomain(plotted.map((point) => point.y!), axisBounds(block.yLabel));

  const marks = new Map<string, string>();
  let letter = 0;
  for (const group of groups) {
    for (const point of group.points) {
      marks.set(point.key, String.fromCharCode(65 + (letter % 26)));
      letter += 1;
    }
  }

  const plot = renderCharPlot({
    width: Math.min(width, 72),
    height: 9,
    points: plotted.map((point) => ({
      mark: marks.get(point.key) ?? "•",
      x: point.x!,
      y: point.y!,
    })),
    xDomain,
    yDomain,
    lines: block.connect
      ? groups.map((group) => group.points.map((point) => ({ x: point.x!, y: point.y! })))
      : [],
    xLabel: block.xLabel,
    yLabel: block.yLabel,
    formatX: (value, step) => formatAxisTick(value, step ?? tickStepOf(ticksInDomain(xDomain[0], xDomain[1], 5)), xUnit),
    formatY: (value, step) => formatAxisTick(value, step ?? tickStepOf(ticksInDomain(yDomain[0], yDomain[1], 5)), yUnit),
    invertX: xBetter === "lower",
    invertY: yBetter === "lower",
  });

  const multiSeries = groups.length > 1;
  const rows = groups.flatMap((group) =>
    group.points.map((point) => ({
      mark: marks.get(point.key) ?? "•",
      ...(multiSeries ? { series: group.key } : {}),
      key: point.key,
      x: point.xDisplay,
      y: point.yDisplay,
    })),
  );
  const values = renderCoordinateTable(rows, {
    mark: "",
    ...(multiSeries ? { series: "series" } : {}),
    key: "key",
    x: block.xLabel,
    y: block.yLabel,
  });
  const blocks: string[] = [plot];
  blocks.push("better → upper right");
  blocks.push(values);
  const shifts = groups
    .filter((group) => group.connect && group.points.length >= 2)
    .map((group) => {
      const first = group.points[0]!;
      const last = group.points[group.points.length - 1]!;
      const path = group.points.map((point) => marks.get(point.key) ?? "•").join(" → ");
      const parts = [
        `${chartFieldLabel(block.yLabel, yUnit)} ${signedDelta(last.y! - first.y!, yUnit)}`,
        `${chartFieldLabel(block.xLabel, xUnit)} ${signedDelta(last.x! - first.x!, xUnit)}`,
      ];
      return `${group.key}   ${path}   ${parts.join(" · ")}`;
    });
  if (shifts.length > 0) blocks.push(shifts.join("\n"));
  return blocks.join("\n\n").split("\n");
}

export function renderSectionText(
  block: Extract<ReportBlock, { readonly type: "section" }>,
  ctx: ClassicTextContext,
): string[] {
  if (ctx.mode !== "boxed") {
    const contentWidth = Math.max(1, ctx.width - 2);
    const body = block.children
      .map((child) => renderClassicBlockText(child, { ...ctx, width: contentWidth }).join("\n"))
      .filter((text) => text.length > 0)
      .join("\n\n");
    return renderPanel({
      title: block.heading,
      ...(block.meta === undefined ? {} : { meta: block.meta }),
      rows: body.length > 0 ? [{ kind: "line", text: body }] : [],
      width: ctx.width,
      mode: "plain",
    });
  }

  if (ctx.sectionBoxedDepth > 0) {
    const body = block.children
      .map((child) => renderClassicBlockText(child, ctx).join("\n"))
      .filter((text) => text.length > 0)
      .join("\n\n");
    return body.length === 0 ? [] : body.split("\n");
  }

  const contentWidth = panelContentWidth(ctx.width, "boxed");
  const nestedCtx: ClassicTextContext = {
    width: contentWidth,
    mode: ctx.mode,
    sectionBoxedDepth: ctx.sectionBoxedDepth + 1,
  };
  const rows: Array<{ kind: "divider"; title: string; meta?: string } | { kind: "line"; text: string }> = [];
  const bodyParts: string[] = [];
  for (const child of block.children) {
    if (child.type === "section") {
      rows.push({
        kind: "divider",
        title: child.heading,
        ...(child.meta === undefined ? {} : { meta: child.meta }),
      });
      const nested = renderClassicBlockText(child, nestedCtx);
      if (nested.length > 0) bodyParts.push(nested.join("\n"));
      continue;
    }
    const rendered = renderClassicBlockText(child, nestedCtx).join("\n");
    if (rendered.length > 0) bodyParts.push(rendered);
  }
  const body = bodyParts.join("\n\n");
  return renderPanel({
    title: block.heading,
    ...(block.meta === undefined ? {} : { meta: block.meta }),
    rows: [
      ...rows,
      ...(body.length > 0 ? [{ kind: "line" as const, text: body }] : []),
    ],
    width: ctx.width,
    mode: "boxed",
  });
}

export function renderClassicBlockText(block: ReportBlock, ctx: ClassicTextContext): string[] {
  switch (block.type) {
    case "hero":
      return renderHeroText(block, ctx.width);
    case "section":
      return renderSectionText(block, ctx);
    case "ranked-bars":
      return renderRankedBarsText(block, ctx.width);
    case "scatter":
      return renderScatterText(block, ctx.width);
    case "grid":
      return renderGridText(block, ctx);
    case "stat":
      return [block.label, ...block.value.split("\n")].flatMap((line) => wrapDisplay(line, ctx.width));
    case "cell-table":
      return renderCellTableText(block, ctx);
    case "paragraph":
      return wrapDisplay(block.children.map((child) => child.type === "text" ? child.value : "").join(""), ctx.width);
    default:
      return [];
  }
}

export function renderClassicDashboardDocument(
  document: { readonly title: string; readonly children: readonly ReportBlock[] },
  width: number,
  mode: PanelMode,
): string[] {
  const ctx: ClassicTextContext = { width, mode, sectionBoxedDepth: 0 };
  const hasHeroTitle = document.children.some((block) => block.type === "hero" && block.title !== undefined);
  const siteLike = document.children.some((block) =>
    block.type === "grid" || block.type === "stat" || block.type === "cell-table"
    || (block.type === "section" && (block.meta !== undefined || block.children.some((child) =>
      child.type === "grid" || child.type === "stat" || child.type === "cell-table" || child.type === "section"
    )))
  );
  const lines = hasHeroTitle || siteLike ? [] : [document.title];
  for (const block of document.children) {
    const rendered = renderClassicBlockText(block, ctx);
    if (rendered.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(...rendered);
  }
  return lines;
}
