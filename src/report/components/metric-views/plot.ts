// text 面的字符坐标图:MetricScatter / MetricLine 共用。
// 形态照 docs-site/zh/reference/report-components.mdx 的示例块:y 轴刻度 + │ 边框,
// 点用字母标注、图例列在图下;lower-better 的轴反向,「好」的角落恒在右上。

import { padDisplay, padStartDisplay, stringWidth } from "../../model/text-layout.ts";

export interface PlotPoint {
  /** 图上的标记字符(点或系列的字母)。 */
  mark: string;
  x: number;
  y: number;
}

export interface CharPlotOptions {
  /** 总列宽(含 y 轴刻度区)。 */
  width: number;
  /** 网格行数;默认 9。 */
  height?: number;
  points: PlotPoint[];
  /**
   * 值域(已按呼吸边距 / bounds 钳制推定,与 web 面共用同一份——见
   * chart-math.ts 的 `paddedAxisDomain`,调用方在此之前算好,text 面按字符行列粒度取整,
   * 不重算)。
   */
  xDomain: [number, number];
  yDomain: [number, number];
  /** 值空间的折线(同系列点按 x 排序连线),用 · 描画,字母覆盖其上。 */
  lines?: { x: number; y: number }[][];
  xLabel: string;
  yLabel: string;
  /** 值 → 刻度文案(已格式化的 display)。 */
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** better: "lower" 的轴反向 —— 好的一端在右 / 上。 */
  invertX?: boolean;
  invertY?: boolean;
}

interface Scale {
  lo: number;
  hi: number;
  /** 值 → [0, cells-1] 的下标。 */
  at(value: number): number;
}

function makeScale(lo: number, hi: number, cells: number, invert: boolean): Scale {
  const span = hi - lo;
  return {
    lo,
    hi,
    at(value: number): number {
      // 单值域:唯一的点落正中
      let t = span === 0 ? 0.5 : (value - lo) / span;
      if (invert) t = 1 - t;
      return Math.max(0, Math.min(cells - 1, Math.round(t * (cells - 1))));
    },
  };
}

/** 值空间折线 → 网格 · 描画:相邻点之间按列逐格线性插值。 */
function drawLine(grid: string[][], a: { col: number; row: number }, b: { col: number; row: number }): void {
  const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
  for (let i = 1; i < steps; i++) {
    const col = Math.round(a.col + ((b.col - a.col) * i) / steps);
    const row = Math.round(a.row + ((b.row - a.row) * i) / steps);
    if (grid[row][col] === " ") grid[row][col] = "·";
  }
}

export function renderCharPlot(opts: CharPlotOptions): string {
  const height = Math.max(4, opts.height ?? 9);
  const yTickTexts = [opts.formatY(opts.yDomain[0]), opts.formatY(opts.yDomain[1])];
  const gutter = Math.max(...yTickTexts.map(stringWidth)) + 1;
  const plotWidth = Math.max(16, opts.width - gutter - 1);

  const xScale = makeScale(opts.xDomain[0], opts.xDomain[1], plotWidth, opts.invertX ?? false);
  // y:大下标 = 「好」的一端;网格第 0 行是顶端,行下标 = height-1 - at,
  // 所以 invertY=false(higher 好)时 hi 折到 at=height-1 → 顶行,lower 好时反之
  const yScale = makeScale(opts.yDomain[0], opts.yDomain[1], height, opts.invertY ?? false);
  const rowOf = (y: number) => height - 1 - yScale.at(y);

  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: plotWidth }, () => " "));
  for (const line of opts.lines ?? []) {
    for (let i = 1; i < line.length; i++) {
      drawLine(
        grid,
        { col: xScale.at(line[i - 1].x), row: rowOf(line[i - 1].y) },
        { col: xScale.at(line[i].x), row: rowOf(line[i].y) },
      );
    }
  }
  for (const point of opts.points) {
    grid[rowOf(point.y)][xScale.at(point.x)] = point.mark;
  }

  // y 轴刻度:极值行标注 display,其余空
  const tickByRow = new Map<number, string>();
  tickByRow.set(rowOf(yScale.lo), opts.formatY(yScale.lo));
  tickByRow.set(rowOf(yScale.hi), opts.formatY(yScale.hi));

  const out: string[] = [];
  out.push(`${" ".repeat(gutter)}${opts.yLabel} ↑`);
  for (let row = 0; row < height; row++) {
    const tick = tickByRow.get(row) ?? "";
    out.push(`${padStartDisplay(tick, gutter)}│${grid[row].join("")}`.replace(/\s+$/, ""));
  }
  out.push(`${" ".repeat(gutter)}└${"─".repeat(plotWidth)}→ ${opts.xLabel}`);

  // x 轴刻度:两端极值(反向轴时右端是 lo),标在真实位置上
  const ticksRow = Array.from({ length: plotWidth }, () => " ");
  for (const value of xScale.lo === xScale.hi ? [xScale.lo] : [xScale.lo, xScale.hi]) {
    const label = opts.formatX(value);
    let col = xScale.at(value);
    col = Math.min(col, plotWidth - stringWidth(label));
    for (let i = 0; i < label.length && col + i < plotWidth; i++) ticksRow[col + i] = label[i];
  }
  out.push(`${" ".repeat(gutter + 1)}${ticksRow.join("")}`.replace(/\s+$/, ""));
  return out.join("\n");
}

/** 点太密排不下时的降级:坐标表,不硬挤(每行 key、x、y 的 display)。 */
export function renderCoordinateTable(
  rows: { key: string; x: string; y: string }[],
  header: { key: string; x: string; y: string },
): string {
  const all = [header, ...rows];
  const w1 = Math.max(...all.map((r) => stringWidth(r.key)));
  const w2 = Math.max(...all.map((r) => stringWidth(r.x)));
  return all
    .map((r) => `${padDisplay(r.key, w1)}   ${padDisplay(r.x, w2)}   ${r.y}`.replace(/\s+$/, ""))
    .join("\n");
}
