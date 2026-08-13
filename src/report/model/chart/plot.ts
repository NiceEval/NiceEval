import { padDisplay, padStartDisplay, stringWidth } from "../text-layout.ts";

export interface PlotPoint {
  mark: string;
  x: number;
  y: number;
}

export interface CharPlotOptions {
  width: number;
  height?: number;
  points: PlotPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  lines?: { x: number; y: number }[][];
  xLabel: string;
  yLabel: string;
  formatX: (value: number, step?: number) => string;
  formatY: (value: number, step?: number) => string;
  invertX?: boolean;
  invertY?: boolean;
}

interface Scale {
  lo: number;
  hi: number;
  at(value: number): number;
}

function makeScale(lo: number, hi: number, cells: number, invert: boolean): Scale {
  const span = hi - lo;
  return {
    lo,
    hi,
    at(value: number): number {
      let t = span === 0 ? 0.5 : (value - lo) / span;
      if (invert) t = 1 - t;
      return Math.max(0, Math.min(cells - 1, Math.round(t * (cells - 1))));
    },
  };
}

function drawLine(grid: string[][], a: { col: number; row: number }, b: { col: number; row: number }): void {
  const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
  for (let i = 1; i < steps; i++) {
    const col = Math.round(a.col + ((b.col - a.col) * i) / steps);
    const row = Math.round(a.row + ((b.row - a.row) * i) / steps);
    if (grid[row]![col] === " ") grid[row]![col] = "·";
  }
}

export function renderCharPlot(opts: CharPlotOptions): string {
  const height = Math.max(4, opts.height ?? 9);
  const yTickTexts = [opts.formatY(opts.yDomain[0]), opts.formatY(opts.yDomain[1])];
  const gutter = Math.max(...yTickTexts.map(stringWidth)) + 1;
  const plotWidth = Math.max(16, opts.width - gutter - 1);

  const xScale = makeScale(opts.xDomain[0], opts.xDomain[1], plotWidth, opts.invertX ?? false);
  const yScale = makeScale(opts.yDomain[0], opts.yDomain[1], height, opts.invertY ?? false);
  const rowOf = (y: number) => height - 1 - yScale.at(y);

  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: plotWidth }, () => " "));
  for (const line of opts.lines ?? []) {
    for (let i = 1; i < line.length; i++) {
      drawLine(
        grid,
        { col: xScale.at(line[i - 1]!.x), row: rowOf(line[i - 1]!.y) },
        { col: xScale.at(line[i]!.x), row: rowOf(line[i]!.y) },
      );
    }
  }
  for (const point of opts.points) {
    grid[rowOf(point.y)]![xScale.at(point.x)] = point.mark;
  }

  const tickByRow = new Map<number, string>();
  tickByRow.set(rowOf(yScale.lo), opts.formatY(yScale.lo, yScale.hi - yScale.lo));
  tickByRow.set(rowOf(yScale.hi), opts.formatY(yScale.hi, yScale.hi - yScale.lo));

  const out: string[] = [];
  out.push(`${" ".repeat(gutter)}${opts.yLabel} ↑`);
  for (let row = 0; row < height; row++) {
    const tick = tickByRow.get(row) ?? "";
    out.push(`${padStartDisplay(tick, gutter)}│${grid[row]!.join("")}`.replace(/\s+$/, ""));
  }
  out.push(`${" ".repeat(gutter)}└${"─".repeat(plotWidth)}→ ${opts.xLabel}`);

  const ticksRow = Array.from({ length: plotWidth }, () => " ");
  for (const value of xScale.lo === xScale.hi ? [xScale.lo] : [xScale.lo, xScale.hi]) {
    const label = opts.formatX(value, xScale.hi - xScale.lo);
    let col = xScale.at(value);
    col = Math.min(col, plotWidth - stringWidth(label));
    for (let i = 0; i < label.length && col + i < plotWidth; i++) ticksRow[col + i] = label[i]!;
  }
  out.push(`${" ".repeat(gutter + 1)}${ticksRow.join("")}`.replace(/\s+$/, ""));
  return out.join("\n");
}

export function renderCoordinateTable(
  rows: { mark?: string; series?: string; key: string; x: string; y: string }[],
  header: { mark?: string; series?: string; key: string; x: string; y: string },
): string {
  const all = [header, ...rows];
  const columns: ("mark" | "series" | "key" | "x")[] = ["mark", "series", "key", "x"];
  const widths = new Map<string, number>();
  for (const column of columns) {
    widths.set(column, Math.max(...all.map((row) => stringWidth(row[column] ?? ""))));
  }
  return all
    .map((row) =>
      [...columns.map((column) => padDisplay(row[column] ?? "", widths.get(column)!)), row.y]
        .filter((cell) => cell.length > 0)
        .join("   ")
        .replace(/\s+$/, ""),
    )
    .join("\n");
}
