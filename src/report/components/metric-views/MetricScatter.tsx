// MetricScatter:质量 × 成本 frontier 的积木,内联 SVG、零图表库、零 hooks。
// 轴向随 better:"lower" 的轴反向画(值大在左/下),「更好」恒指向右上;方向提示恒为
// 「越靠右上越好」且仅当两轴都声明 better 时显示;刻度显示真实值。
// niceTicks 刻度 + 网格线;每个点直接标注(placePointLabels 候选位择优:避开其它标签、
// 数据点与画布边界,离开左右紧邻位时补 leader line);
// 默认不连线,`connect` 显式开启时同系列的点按 x 升序连折线(lineage series),
// 系列图例按显示键字典序列在图下。x 或 y 为 null 的点不画,
// 底部注脚如实报「n 个点缺数据」;hover 信息退化为 SVG <title>,不 hydrate 也在
// (enhance.js 在场时升级为样式化 tooltip)。配色走类名(nre-series-cN)由 CSS 上色,
// 深色主题下图表随令牌切换,不留内联 hex;同图 series 撞色按图例顺序线性探测消解
// (colorIndicesForKeys),跨图稳定让位给图内可辨。

import type { ReactElement } from "react";
import type { MetricColumn, ScatterData } from "../../model/types.ts";
import { formatMetricValue, shortestUniqueLabels } from "../../model/format.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, resolveLocalizedText, resolveMetricLabel, type ReportLocale } from "../../model/locale.ts";
import { axisScale, placePointLabels } from "./chart-math.ts";
import { colorIndicesForKeys } from "../../assets/colors.ts";
import { cx } from "../shared.ts";

const WIDTH = 760;
const HEIGHT = 400;
const MARGIN = { top: 28, right: 32, bottom: 48, left: 64 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/** 可画的点:x/y 都有值。组件内部的整理结果,不改数据。 */
interface DrawablePoint {
  key: string;
  series?: string;
  label: string;
  xValue: number;
  yValue: number;
  title: string;
  px: number;
  py: number;
}

export function MetricScatter({
  data,
  connect = false,
  pointHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: ScatterData;
  /** series 内按 x 升序连折线;默认 false,只给「线 = 同族变体」的 lineage series 用。 */
  connect?: boolean;
  pointHref?: (row: ScatterData["rows"][number]) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const missing = data.rows.filter((r) => r.x.value === null || r.y.value === null);
  const drawableRows = data.rows.filter((r) => r.x.value !== null && r.y.value !== null);

  const missingNote =
    missing.length > 0 ? (
      <p className="nre-scatter-missing" title={missing.map((r) => r.key).join(", ")}>
        {countText(locale, "pointsMissing", missing.length)}
      </p>
    ) : null;

  const xLabel = resolveMetricLabel(data.x.label, locale, data.x.key);
  const yLabel = resolveMetricLabel(data.y.label, locale, data.y.key);

  // 0 个可画点:x/y 指标没有可用数据 —— 明确说缺哪两个指标,不画一张空坐标系
  // (与表格的「绝不画 0」同态度)。
  if (drawableRows.length === 0) {
    return (
      <figure className={cx("nre", "nre-metric-scatter", className)}>
        <p className="nre-scatter-empty nre-missing">{localeText(locale, "scatter.noData", { x: xLabel, y: yLabel })}</p>
        {missingNote}
      </figure>
    );
  }

  const axisLabel = (label: string, col: MetricColumn) => `${label}${col.unit ? `(${col.unit})` : ""}`;

  // 轴方向跟随 better:lower 反向(值大在左 / 下),higher 与未声明正向。
  const xScale = axisScale(
    drawableRows.map((r) => r.x.value as number),
    data.x.bounds,
    MARGIN.left,
    MARGIN.left + PLOT_W,
    data.x.better === "lower",
  );
  // y 像素轴向下增长:正向 = 高值在上 → 映射到 [bottom, top];lower 反向 = 高值在下。
  const yScale = axisScale(
    drawableRows.map((r) => r.y.value as number),
    data.y.bounds,
    MARGIN.top + PLOT_H,
    MARGIN.top,
    data.y.better === "lower",
  );
  const labelByKey = shortestUniqueLabels(drawableRows.map((r) => r.key));
  // 方向提示恒为「越靠右上越好」,仅当两轴都声明 better 时显示——任一轴未声明,
  // 组件不猜「更好」朝哪边,整图无提示。
  const showBetterHint = data.x.better !== undefined && data.y.better !== undefined;

  const points: DrawablePoint[] = drawableRows.map((r) => {
    const xValue = r.x.value as number;
    const yValue = r.y.value as number;
    return {
      key: r.key,
      series: r.series,
      label: labelByKey.get(r.key) ?? r.key,
      xValue,
      yValue,
      // hover 内容:experiment(点键)+ 系列(有则加一行)+ 两轴 display 与 samples/total
      title: `${r.key}${r.series !== undefined ? `\n${r.series}` : ""}\n${xLabel}: ${resolveLocalizedText(r.x.display, locale)}(${r.x.samples}/${r.x.total})\n${yLabel}: ${resolveLocalizedText(r.y.display, locale)}(${r.y.samples}/${r.y.total})`,
      px: xScale.scale(xValue),
      py: yScale.scale(yValue),
    };
  });

  // 系列分组:图例与配色按显示键字典序;connect 时 series 内按 x 升序连折线
  const bySeries = new Map<string, DrawablePoint[]>();
  for (const p of points) {
    if (p.series === undefined) continue;
    const list = bySeries.get(p.series) ?? [];
    list.push(p);
    bySeries.set(p.series, list);
  }
  const seriesOrder = [...bySeries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const list of bySeries.values()) list.sort((a, b) => a.xValue - b.xValue);
  // 同图撞色消解:散列格作起点,按图例顺序线性探测空格(colors.ts 的契约注释)
  const colorIdx = colorIndicesForKeys(seriesOrder);
  const seriesClassOf = (series: string) => `nre-series-c${colorIdx.get(series) ?? 0}`;
  const keyClassOf = (series: string) => `nre-c${colorIdx.get(series) ?? 0}`;

  // 直接标签的候选位择优布局:锚向、避让方向都由布局按空间决定,画布边界含边距
  const labels = placePointLabels(
    points.map((p) => ({ cx: p.px, cy: p.py, width: p.label.length * 6.4 + 10 })),
    { x0: 2, y0: 2, x1: WIDTH - 2, y1: HEIGHT - 2 },
  );

  return (
    <figure className={cx("nre", "nre-metric-scatter", className)}>
      <svg
        className="nre-scatter-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${axisLabel(xLabel, data.x)} × ${axisLabel(yLabel, data.y)}`}
      >
        {/* 网格:niceTicks 的整齐刻度线,颜色走 CSS(var(--line)) */}
        <g className="nre-scatter-grid">
          {yScale.ticks.map((tick) => (
            <line key={`gy${tick}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={yScale.scale(tick)} y2={yScale.scale(tick)} />
          ))}
          {xScale.ticks.map((tick) => (
            <line key={`gx${tick}`} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} x1={xScale.scale(tick)} x2={xScale.scale(tick)} />
          ))}
        </g>

        {/* 轴向已随 better 反正,「更好」恒指向右上;提示只在两轴都声明 better 时出现 */}
        {showBetterHint && (
          <text
            className="nre-scatter-better-hint"
            x={MARGIN.left + PLOT_W - 6}
            y={MARGIN.top + 14}
            textAnchor="end"
          >
            {localeText(locale, "scatter.betterUpperRight")}
          </text>
        )}

        {/* 刻度:已格式化的整齐值(formatMetricValue 与计算侧同一套) */}
        <g className="nre-scatter-axis nre-scatter-axis-y">
          {yScale.ticks.map((tick) => (
            <text key={`ay${tick}`} className="nre-scatter-tick" x={MARGIN.left - 8} y={yScale.scale(tick) + 3} textAnchor="end">
              {formatMetricValue(tick, data.y.unit)}
            </text>
          ))}
        </g>
        <g className="nre-scatter-axis nre-scatter-axis-x">
          {xScale.ticks.map((tick) => (
            <text key={`ax${tick}`} className="nre-scatter-tick" x={xScale.scale(tick)} y={MARGIN.top + PLOT_H + 16} textAnchor="middle">
              {formatMetricValue(tick, data.x.unit)}
            </text>
          ))}
        </g>

        {/* 轴标签 */}
        <text className="nre-scatter-xlabel" x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle">
          {axisLabel(xLabel, data.x)}
        </text>
        <text
          className="nre-scatter-ylabel"
          x={14}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${MARGIN.top + PLOT_H / 2})`}
        >
          {axisLabel(yLabel, data.y)}
        </text>

        {/* 系列折线:仅 connect 显式开启时画(lineage series 的位移),按 x 升序;类名上色,深色主题跟随 */}
        {connect &&
          seriesOrder.map((series) => {
            const list = bySeries.get(series)!;
            if (list.length < 2) return null;
            return (
              <polyline
                key={series}
                className={cx("nre-scatter-line", seriesClassOf(series))}
                data-series={series}
                points={list.map((p) => `${p.px},${p.py}`).join(" ")}
                fill="none"
              />
            );
          })}

        {/* 点:g 内带 <title>(无 JS 的原生 hover)、直接标签与 leader line;
            pointHref 时包普通 <a>,静态导出也能下钻 */}
        {points.map((p, i) => {
          const label = labels[i];
          const group = (
            <g
              className={cx("nre-scatter-point", p.series !== undefined ? seriesClassOf(p.series) : "nre-series-none")}
              data-key={p.key}
            >
              <title>{p.title}</title>
              {/* 标签不在紧邻位时补一条 leader line,避免脱离原点看不出对应关系 */}
              {label.leader && <line className="nre-leader" x1={p.px} y1={p.py} x2={label.x} y2={label.y - 4} />}
              <circle className="nre-scatter-hit" cx={p.px} cy={p.py} r={12} />
              <circle className="nre-scatter-dot" cx={p.px} cy={p.py} r={4.5} />
              <text className="nre-scatter-point-label" x={label.x} y={label.y} textAnchor={label.anchor}>
                {p.label}
              </text>
            </g>
          );
          const row = drawableRows[i];
          return pointHref ? (
            <a key={p.key} className="nre-scatter-point-link" href={pointHref(row)}>
              {group}
            </a>
          ) : (
            <g key={p.key}>{group}</g>
          );
        })}
      </svg>

      {/* 系列图例:同键同色(与其它块的稳定散列一致) */}
      {seriesOrder.length > 0 && (
        <figcaption className="nre-scatter-legend">
          {seriesOrder.map((series) => (
            <span key={series} className={cx("nre-legend-key", "nre-key", keyClassOf(series))}>
              {series}
            </span>
          ))}
        </figcaption>
      )}
      {missingNote}
    </figure>
  );
}
