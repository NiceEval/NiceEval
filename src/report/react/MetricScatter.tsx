// MetricScatter:质量 × 成本 frontier 的积木,内联 SVG、零图表库。
// 轴向随 better:"lower" 的轴反向画,「好」的角落恒在右上(成本轴 $20 → $0 就是这么来的);
// 同系列的点按 x 值排序连线,系列名标在线旁;x 或 y 为 null 的点不画,
// 底部注脚如实报「n 个点缺数据」;hover 信息退化为 SVG <title>,不 hydrate 也在。

import type { ReactElement } from "react";
import type { MetricColumn, ScatterData } from "./data.ts";
import { colorHexForKey } from "./colors.ts";
import { MISSING_TEXT, cx } from "./format.ts";

// 画布与边距:右侧留白给系列名,底部给 x 轴标签
const WIDTH = 640;
const HEIGHT = 400;
const PLOT = { left: 64, right: WIDTH - 140, top: 24, bottom: HEIGHT - 56 };

/** 可画的点:x/y 都有值。组件内部的整理结果,不改数据。 */
interface DrawablePoint {
  key: string;
  series?: string;
  xValue: number;
  yValue: number;
  xDisplay: string;
  yDisplay: string;
  title: string;
  px: number;
  py: number;
}

/** 一根轴的线性映射:值 → 像素;better:"lower" 时反向,好的一端固定在右/上。 */
function axisScale(values: number[], better: MetricColumn["better"], pixelLo: number, pixelHi: number) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // 单值域:铺 ±1 让唯一的点落在正中,而不是除零
  const span = hi - lo || 2;
  const padded = { lo: lo - (hi - lo ? span * 0.08 : 1), hi: hi + (hi - lo ? span * 0.08 : 1) };
  const scale = (v: number) => {
    let t = (v - padded.lo) / (padded.hi - padded.lo);
    if (better === "lower") t = 1 - t; // 反向:值越低越靠「好」的一端
    return pixelLo + t * (pixelHi - pixelLo);
  };
  return { lo, hi, scale };
}

export function MetricScatter({
  data,
  pointHref,
  className,
}: {
  data: ScatterData;
  pointHref?: (row: ScatterData["rows"][number]) => string;
  className?: string;
}): ReactElement {
  const missing = data.rows.filter((r) => r.x.value === null || r.y.value === null);
  const drawableRows = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);

  const missingNote =
    missing.length > 0 ? (
      <p className="nre-scatter-missing" title={missing.map((r) => r.key).join(", ")}>
        {missing.length} {missing.length === 1 ? "point" : "points"} missing data
      </p>
    ) : null;

  // 一张全缺的图不画空坐标系:缺数据文案 + 注脚,与表格的「绝不画 0」同一态度
  if (drawableRows.length === 0) {
    return (
      <figure className={cx("nre", "nre-metric-scatter", className)}>
        <p className="nre-missing">{MISSING_TEXT}</p>
        {missingNote}
      </figure>
    );
  }

  const xScale = axisScale(drawableRows.map((r) => r.x.value as number), data.x.better, PLOT.left, PLOT.right);
  // y 像素轴向下增长:better:"higher" 高值在上 → 映射到 [bottom, top];"lower" 由 axisScale 反向后同样落到上方
  const yScale = axisScale(drawableRows.map((r) => r.y.value as number), data.y.better, PLOT.bottom, PLOT.top);

  const points: DrawablePoint[] = drawableRows.map((r) => {
    const xValue = r.x.value as number;
    const yValue = r.y.value as number;
    return {
      key: r.key,
      series: r.series,
      xValue,
      yValue,
      xDisplay: r.x.display,
      yDisplay: r.y.display,
      // hover 内容:display 与 samples/total(docs/reports.md 行为清单)
      title: `${r.key}\n${data.x.label}: ${r.x.display}(${r.x.samples}/${r.x.total})\n${data.y.label}: ${r.y.display}(${r.y.samples}/${r.y.total})`,
      px: xScale.scale(xValue),
      py: yScale.scale(yValue),
    };
  });

  // 同系列的点按 x 值排序连线;无系列的点只画点不连线
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, DrawablePoint[]>();
  for (const p of points) {
    if (p.series === undefined) continue;
    if (!bySeries.has(p.series)) {
      bySeries.set(p.series, []);
      seriesOrder.push(p.series);
    }
    bySeries.get(p.series)!.push(p);
  }
  for (const list of bySeries.values()) list.sort((a, b) => a.xValue - b.xValue);

  // 轴端刻度打在真实极值点的位置上(值域有 padding,角落不等于极值)
  const xTicks = xScale.lo === xScale.hi ? [xScale.lo] : [xScale.lo, xScale.hi];
  const yTicks = yScale.lo === yScale.hi ? [yScale.lo] : [yScale.lo, yScale.hi];
  const displayFor = (axis: "x" | "y", value: number) =>
    points.find((p) => (axis === "x" ? p.xValue : p.yValue) === value)?.[axis === "x" ? "xDisplay" : "yDisplay"] ??
    String(value);

  const axisLabel = (col: MetricColumn) => `${col.label}${col.unit ? `(${col.unit})` : ""}`;

  return (
    <figure className={cx("nre", "nre-metric-scatter", className)}>
      <svg
        className="nre-scatter-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${axisLabel(data.x)} × ${axisLabel(data.y)}`}
      >
        {/* 坐标框 */}
        <rect
          className="nre-scatter-plot"
          x={PLOT.left}
          y={PLOT.top}
          width={PLOT.right - PLOT.left}
          height={PLOT.bottom - PLOT.top}
          fill="none"
          stroke="#d4d4d4"
        />
        {/* 「好」的角落恒在右上:轴向已按 better 反转,这里只是把这句契约写在图上 */}
        <text className="nre-scatter-better-hint" x={PLOT.right - 6} y={PLOT.top + 14} textAnchor="end" fontSize={11} fill="#9ca3af">
          better ↗
        </text>

        {/* 轴标签 */}
        <text className="nre-scatter-xlabel" x={(PLOT.left + PLOT.right) / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill="#525252">
          {axisLabel(data.x)}
        </text>
        <text
          className="nre-scatter-ylabel"
          x={16}
          y={(PLOT.top + PLOT.bottom) / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#525252"
          transform={`rotate(-90 16 ${(PLOT.top + PLOT.bottom) / 2})`}
        >
          {axisLabel(data.y)}
        </text>

        {/* 轴端刻度:标在真实极值的位置上,文案用该点已格式化的 display */}
        {xTicks.map((v) => (
          <text key={`x${v}`} className="nre-scatter-tick" x={xScale.scale(v)} y={PLOT.bottom + 16} textAnchor="middle" fontSize={11} fill="#737373">
            {displayFor("x", v)}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={`y${v}`} className="nre-scatter-tick" x={PLOT.left - 6} y={yScale.scale(v) + 4} textAnchor="end" fontSize={11} fill="#737373">
            {displayFor("y", v)}
          </text>
        ))}

        {/* 系列连线 + 线旁的系列名(标在视觉上最靠右的点旁) */}
        {seriesOrder.map((series) => {
          const list = bySeries.get(series)!;
          const color = colorHexForKey(series);
          const labelAt = list.reduce((a, b) => (b.px > a.px ? b : a));
          return (
            <g key={series} className="nre-scatter-series" data-series={series}>
              {list.length > 1 && (
                <polyline
                  className="nre-scatter-line"
                  points={list.map((p) => `${p.px},${p.py}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                />
              )}
              <text className="nre-scatter-series-label" x={labelAt.px + 8} y={labelAt.py + 4} fontSize={12} fill={color}>
                {series}
              </text>
            </g>
          );
        })}

        {/* 点(带 <title> 的 hover;pointHref 时包普通 <a>,静态导出也能下钻) */}
        {points.map((p, i) => {
          const circle = (
            <circle
              className="nre-scatter-point"
              data-key={p.key}
              cx={p.px}
              cy={p.py}
              r={4.5}
              fill={p.series !== undefined ? colorHexForKey(p.series) : "#525252"}
            >
              <title>{p.title}</title>
            </circle>
          );
          const row = drawableRows[i];
          return pointHref ? (
            <a key={p.key} className="nre-scatter-point-link" href={pointHref(row)}>
              {circle}
            </a>
          ) : (
            <g key={p.key}>{circle}</g>
          );
        })}
      </svg>
      {missingNote}
    </figure>
  );
}
