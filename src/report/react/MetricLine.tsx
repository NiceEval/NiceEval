// MetricLine:趋势线——x 是 experiment 声明的 flag(有序变量),每个系列一条线。
// 与 MetricScatter 的分工:scatter 的两轴都是测出来的指标(找 frontier),
// line 的 x 是你配置的变量(看趋势)。x 轴正常升序;y 轴向随 better;
// x 或 y 缺数据的点不画,注脚如实报数;每个点带 <title> hover,可经 pointHref 下钻。

import type { ReactElement } from "react";
import type { LineData } from "../types.ts";
import { colorHexForKey } from "./colors.ts";
import { MISSING_TEXT, cx } from "./format.ts";

const WIDTH = 640;
const HEIGHT = 360;
const PLOT = { left: 64, right: WIDTH - 140, top: 24, bottom: HEIGHT - 56 };

interface DrawablePoint {
  key: string;
  series?: string;
  xValue: number;
  yValue: number;
  title: string;
  px: number;
  py: number;
}

function linearScale(values: number[], pixelLo: number, pixelHi: number, invert: boolean) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 2;
  const padded = { lo: lo - (hi - lo ? span * 0.08 : 1), hi: hi + (hi - lo ? span * 0.08 : 1) };
  const scale = (v: number) => {
    let t = (v - padded.lo) / (padded.hi - padded.lo);
    if (invert) t = 1 - t;
    return pixelLo + t * (pixelHi - pixelLo);
  };
  return { lo, hi, scale };
}

export function MetricLine({
  data,
  pointHref,
  className,
}: {
  data: LineData;
  pointHref?: (row: LineData["rows"][number]) => string;
  className?: string;
}): ReactElement {
  const missing = data.rows.filter((r) => r.x === null || r.y.value === null);
  const drawableRows = data.rows.filter((r) => r.x !== null && r.y.value !== null);

  const missingNote =
    missing.length > 0 ? (
      <p className="nre-line-missing" title={missing.map((r) => r.key).join(", ")}>
        {missing.length} {missing.length === 1 ? "point" : "points"} missing data
      </p>
    ) : null;

  if (drawableRows.length === 0) {
    return (
      <figure className={cx("nre", "nre-metric-line", className)}>
        <p className="nre-missing">{MISSING_TEXT}</p>
        {missingNote}
      </figure>
    );
  }

  const xScale = linearScale(drawableRows.map((r) => r.x as number), PLOT.left, PLOT.right, false);
  // y 像素轴向下增长:higher 高值在上;lower 反向后「好」的一端同样在上
  const yScale = linearScale(
    drawableRows.map((r) => r.y.value as number),
    PLOT.bottom,
    PLOT.top,
    data.y.better === "lower",
  );

  const points: DrawablePoint[] = drawableRows.map((r) => ({
    key: r.key,
    series: r.series,
    xValue: r.x as number,
    yValue: r.y.value as number,
    title: `${r.key}\n${data.x.label}: ${r.xDisplay}\n${data.y.label}: ${r.y.display}(${r.y.samples}/${r.y.total})`,
    px: xScale.scale(r.x as number),
    py: yScale.scale(r.y.value as number),
  }));

  // 同系列的点按 x 排序连线;系列名标在最右点旁
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, DrawablePoint[]>();
  for (const p of points) {
    const key = p.series ?? "";
    if (!bySeries.has(key)) {
      bySeries.set(key, []);
      seriesOrder.push(key);
    }
    bySeries.get(key)!.push(p);
  }
  for (const list of bySeries.values()) list.sort((a, b) => a.xValue - b.xValue);

  const xTicks = xScale.lo === xScale.hi ? [xScale.lo] : [xScale.lo, xScale.hi];
  const yTicks = yScale.lo === yScale.hi ? [yScale.lo] : [yScale.lo, yScale.hi];
  const xDisplayFor = (value: number) =>
    drawableRows.find((r) => r.x === value)?.xDisplay ?? String(value);
  const yDisplayFor = (value: number) =>
    drawableRows.find((r) => r.y.value === value)?.y.display ?? String(value);

  return (
    <figure className={cx("nre", "nre-metric-line", className)}>
      <svg
        className="nre-line-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${data.y.label} by ${data.x.label}`}
      >
        <rect
          className="nre-line-plot"
          x={PLOT.left}
          y={PLOT.top}
          width={PLOT.right - PLOT.left}
          height={PLOT.bottom - PLOT.top}
          fill="none"
          stroke="#d4d4d4"
        />
        <text className="nre-line-xlabel" x={(PLOT.left + PLOT.right) / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill="#525252">
          {data.x.label}
          {data.x.unit ? `(${data.x.unit})` : ""}
        </text>
        <text
          className="nre-line-ylabel"
          x={16}
          y={(PLOT.top + PLOT.bottom) / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#525252"
          transform={`rotate(-90 16 ${(PLOT.top + PLOT.bottom) / 2})`}
        >
          {data.y.label}
          {data.y.unit ? `(${data.y.unit})` : ""}
        </text>

        {xTicks.map((v) => (
          <text key={`x${v}`} className="nre-line-tick" x={xScale.scale(v)} y={PLOT.bottom + 16} textAnchor="middle" fontSize={11} fill="#737373">
            {xDisplayFor(v)}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={`y${v}`} className="nre-line-tick" x={PLOT.left - 6} y={yScale.scale(v) + 4} textAnchor="end" fontSize={11} fill="#737373">
            {yDisplayFor(v)}
          </text>
        ))}

        {seriesOrder.map((series) => {
          const list = bySeries.get(series)!;
          const color = series === "" ? "#525252" : colorHexForKey(series);
          const labelAt = list.reduce((a, b) => (b.px > a.px ? b : a));
          return (
            <g key={series || "(single)"} className="nre-line-series" data-series={series || undefined}>
              {list.length > 1 && (
                <polyline
                  className="nre-line-path"
                  points={list.map((p) => `${p.px},${p.py}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                />
              )}
              {series !== "" && (
                <text className="nre-line-series-label" x={labelAt.px + 8} y={labelAt.py + 4} fontSize={12} fill={color}>
                  {series}
                </text>
              )}
            </g>
          );
        })}

        {points.map((p, i) => {
          const circle = (
            <circle
              className="nre-line-point"
              data-key={p.key}
              cx={p.px}
              cy={p.py}
              r={4}
              fill={p.series !== undefined ? colorHexForKey(p.series) : "#525252"}
            >
              <title>{p.title}</title>
            </circle>
          );
          const row = drawableRows[i];
          return pointHref ? (
            <a key={`${p.key}:${i}`} className="nre-line-point-link" href={pointHref(row)}>
              {circle}
            </a>
          ) : (
            <g key={`${p.key}:${i}`}>{circle}</g>
          );
        })}
      </svg>
      {missingNote}
    </figure>
  );
}
