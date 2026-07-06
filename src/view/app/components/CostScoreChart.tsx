import { useState } from "react";
import type { T } from "../shared.ts";
import type { ViewRow } from "../types.ts";
import { formatCost, formatPercent } from "../lib/format.ts";
import { layoutLabelOffsets, niceTicks, seriesColor } from "../lib/chart.ts";

const WIDTH = 640;
const HEIGHT = 300;
const MARGIN = { top: 16, right: 24, bottom: 34, left: 46 };

/** formatCost(0) 显示 "—"(表示"没测出成本"),但坐标轴原点确实就是 $0,不能沿用那个语义。 */
function formatAxisCost(value: number): string {
  return value === 0 ? "$0" : formatCost(value);
}

/**
 * 一个 group 内「成本 vs 通过率」散点图:一行(一个实验/config)= 一个点。
 * 只在 group 内至少两条 row 有 estimatedCostUSD 时渲染,否则没有比较意义。
 */
export function CostScoreChart({ rows, t }: { rows: ViewRow[]; t: T }) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const points = rows.filter((r): r is ViewRow & { estimatedCostUSD: number } => typeof r.estimatedCostUSD === "number" && Number.isFinite(r.estimatedCostUSD));
  if (points.length < 2) return null;

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const xTicks = niceTicks(0, Math.max(...points.map((p) => p.estimatedCostUSD)), 5);
  const xMax = xTicks[xTicks.length - 1] || 1;

  const rates = points.map((p) => p.passRate);
  const rateMin = Math.min(...rates);
  const rateMax = Math.max(...rates);
  const pad = Math.max(0.03, (rateMax - rateMin) * 0.25);
  const yTicksRaw = niceTicks(Math.max(0, rateMin - pad), Math.min(1, rateMax + pad), 5);
  const yMin = Math.max(0, yTicksRaw[0] ?? 0);
  const yMax = Math.min(1, yTicksRaw[yTicksRaw.length - 1] ?? 1);
  const yTicks = yTicksRaw.filter((v) => v >= yMin - 1e-9 && v <= yMax + 1e-9);

  const xScale = (cost: number) => MARGIN.left + (cost / xMax) * plotW;
  const yScale = (rate: number) => MARGIN.top + (1 - (rate - yMin) / (yMax - yMin)) * plotH;

  const hovered = points.find((p) => p.key === hoverKey);

  const positions = points.map((p) => {
    const cx = xScale(p.estimatedCostUSD);
    const cy = yScale(p.passRate);
    const anchorLeft = cx >= MARGIN.left + plotW * 0.72;
    return { cx, cy, anchorLeft, width: p.label.length * 6.4 + 10 };
  });
  const labelOffsets = layoutLabelOffsets(positions);

  return (
    <div className="cost-score-chart">
      <div className="csc-head">{t("chart.costVsScore")}</div>
      <div className="csc-svg-wrap">
        <svg className="csc-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("chart.costVsScore")}>
          <g className="csc-grid">
            {yTicks.map((tick) => (
              <line key={`gy-${tick}`} x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(tick)} y2={yScale(tick)} />
            ))}
            {xTicks.map((tick) => (
              <line key={`gx-${tick}`} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} x1={xScale(tick)} x2={xScale(tick)} />
            ))}
          </g>
          <g className="csc-axis csc-axis-y">
            {yTicks.map((tick) => (
              <text key={`ay-${tick}`} x={MARGIN.left - 8} y={yScale(tick)} textAnchor="end" dominantBaseline="middle">
                {formatPercent(tick)}
              </text>
            ))}
          </g>
          <g className="csc-axis csc-axis-x">
            {xTicks.map((tick) => (
              <text key={`ax-${tick}`} x={xScale(tick)} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle">
                {formatAxisCost(tick)}
              </text>
            ))}
            <text x={MARGIN.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle">
              {t("chart.axisCost")}
            </text>
          </g>
          <g className="csc-points">
            {points.map((p, i) => {
              const { cx, cy, anchorLeft } = positions[i]!;
              const labelY = cy + 4 + labelOffsets[i]!;
              const color = seriesColor(i);
              const labelX = cx + (anchorLeft ? -10 : 10);
              return (
                <g
                  key={p.key}
                  className="csc-point"
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.label}: ${formatCost(p.estimatedCostUSD)}, ${formatPercent(p.passRate)}`}
                  onMouseEnter={() => setHoverKey(p.key)}
                  onMouseLeave={() => setHoverKey((k) => (k === p.key ? null : k))}
                  onFocus={() => setHoverKey(p.key)}
                  onBlur={() => setHoverKey((k) => (k === p.key ? null : k))}
                >
                  {/* 标签被挤开时补一条 leader line,避免脱离原点看不出对应关系。 */}
                  {labelOffsets[i] ? <line className="csc-leader" x1={cx} y1={cy} x2={labelX} y2={labelY - 4} /> : null}
                  <circle className="csc-hit" cx={cx} cy={cy} r={13} />
                  <circle className="csc-dot" cx={cx} cy={cy} r={5} style={{ fill: color }} />
                  <text x={labelX} y={labelY} textAnchor={anchorLeft ? "end" : "start"}>
                    {p.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        {hovered ? (
          <div
            className="csc-tooltip"
            style={{ left: `${(xScale(hovered.estimatedCostUSD) / WIDTH) * 100}%`, top: `${(yScale(hovered.passRate) / HEIGHT) * 100}%` }}
          >
            <b>{formatPercent(hovered.passRate)}</b> {t("chart.axisScore")}
            <div className="csc-tooltip-meta">
              {formatCost(hovered.estimatedCostUSD)} · {hovered.model || hovered.agent}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
