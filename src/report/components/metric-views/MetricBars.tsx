// MetricBars:分组柱状——同一份矩阵数据的另一种摆法(MetricBars.data = MetricMatrix.data)。
// 组维度一组条、系列维度一根条、条长是指标值;竖向分组柱,柱顶标数值,系列颜色与
// 其它组件的稳定配色一致(类名 nre-series-cN 由 CSS 上色,深色主题跟随),图例自动生成。
// 组内按值排序,方向随 better;缺数据的系列不画柱、不编 0(与 text 面的 — 同口径)。

import type { ReactElement } from "react";
import type { MatrixData, MetricCell } from "../../model/types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, resolveLocalizedText, resolveMetricLabel, type ReportLocale } from "../../model/locale.ts";
import { colorClassForKey, seriesClassForKey } from "../../assets/colors.ts";
import { cx } from "../shared.ts";

const WIDTH = 640;
const HEIGHT = 320;
const PLOT = { left: 16, right: WIDTH - 16, top: 28, bottom: HEIGHT - 40 };

export function MetricBars({
  data,
  attemptHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: MatrixData;
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  // 稀疏 cells → 首次出现顺序的组/系列键 + 查找表
  const groupKeys: string[] = [];
  const seriesKeys: string[] = [];
  const byPosition = new Map<string, MetricCell>();
  for (const entry of data.cells) {
    if (!groupKeys.includes(entry.row)) groupKeys.push(entry.row);
    if (!seriesKeys.includes(entry.column)) seriesKeys.push(entry.column);
    byPosition.set(JSON.stringify([entry.row, entry.column]), entry.cell);
  }

  const metricLabel = resolveMetricLabel(data.metric.label, locale, data.metric.key);
  const better = data.metric.better ?? "higher";
  const values = data.cells.map((c) => c.cell.value).filter((v): v is number => v !== null);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  // 条高刻度:% 的天然域是 [0,1],其余以全图最大值为满条
  const ratioOf = (value: number) => (data.metric.unit === "%" ? Math.min(1, Math.max(0, value)) : maxValue === 0 ? 0 : value / maxValue);

  const groupWidth = (PLOT.right - PLOT.left) / Math.max(1, groupKeys.length);
  const barWidth = Math.min(36, (groupWidth - 16) / Math.max(1, seriesKeys.length));
  const plotHeight = PLOT.bottom - PLOT.top;

  return (
    <figure className={cx("nre", "nre-metric-bars", className)}>
      <svg
        className="nre-bars-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${metricLabel} by ${data.rowDimension} × ${data.columnDimension}`}
      >
        {groupKeys.map((group, gi) => {
          const x0 = PLOT.left + gi * groupWidth;
          // 组内按值排序,方向随 better(缺数据的系列不画柱)
          const entries = seriesKeys
            .map((series) => ({ series, cell: byPosition.get(JSON.stringify([group, series])) }))
            .filter((e): e is { series: string; cell: MetricCell } => e.cell !== undefined && e.cell.value !== null)
            .sort((a, b) =>
              better === "lower" ? (a.cell.value as number) - (b.cell.value as number) : (b.cell.value as number) - (a.cell.value as number),
            );
          const innerWidth = entries.length * barWidth;
          const startX = x0 + (groupWidth - innerWidth) / 2;
          return (
            <g key={group} className="nre-bars-group" data-group={group}>
              {entries.map(({ series, cell }, si) => {
                const h = Math.max(1, ratioOf(cell.value as number) * plotHeight);
                const x = startX + si * barWidth;
                const y = PLOT.bottom - h;
                const display = resolveLocalizedText(cell.display, locale);
                const title = `${group} · ${series}: ${display}(${cell.samples}/${cell.total})`;
                const rect = (
                  <rect
                    className={cx("nre-bar", seriesClassForKey(series))}
                    x={x + 2}
                    y={y}
                    width={barWidth - 4}
                    height={h}
                  >
                    <title>{title}</title>
                  </rect>
                );
                const locator = cell.refs[0];
                return (
                  <g key={series}>
                    {attemptHref && locator ? <a href={attemptHref(locator)}>{rect}</a> : rect}
                    {/* 柱顶标数值;覆盖不全时把 samples/total 一并标出,不藏 */}
                    <text className="nre-bar-value" x={x + barWidth / 2} y={y - 4} textAnchor="middle">
                      {cell.samples < cell.total ? `${display} ${cell.samples}/${cell.total}` : display}
                    </text>
                  </g>
                );
              })}
              <text className="nre-bars-group-label" x={x0 + groupWidth / 2} y={HEIGHT - 20} textAnchor="middle">
                {group}
              </text>
            </g>
          );
        })}
        {/* 基线 */}
        <line className="nre-bars-baseline" x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} />
      </svg>
      {/* 图例:系列 → 稳定配色,跨块同键同色 */}
      <figcaption className="nre-bars-legend">
        <span className="nre-bars-metric">
          {metricLabel}
          {data.metric.unit && <span className="nre-unit">({data.metric.unit})</span>}
        </span>
        {seriesKeys.map((series) => (
          <span key={series} className={cx("nre-legend-key", "nre-key", colorClassForKey(series))}>
            {series}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
