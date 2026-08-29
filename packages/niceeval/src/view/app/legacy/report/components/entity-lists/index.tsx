// 旧 Experiment / Eval / Attempt 层级表的 plain React 入口。
// 不读取 Sample、repository、SQL、router 或 authoring context；integrator 只需传入
// 已闭合的 old-shape ExperimentListItem[] 与 selection title。

import type { ReactNode } from "react";
import { TableContentView } from "../../definition/primitives.tsx";
import {
  resolveLocalizedText,
  type LocalizedText,
  type ReportLocale,
} from "../../model/locale.ts";
import {
  sortExperimentListItems,
  type ExperimentListItem,
} from "./compute.ts";
import { experimentListContent } from "./content.ts";

export interface ExperimentOverviewData {
  readonly selectionTitle: LocalizedText;
  readonly experiments: readonly ExperimentListItem[];
}

/** Integrator-facing closed props. */
export interface ExperimentOverviewProps {
  readonly data: ExperimentOverviewData;
  readonly locale: ReportLocale;
  /** 显示排序列；旧 ExperimentTable 默认 summary。 */
  readonly sort?: string;
  readonly searchable?: boolean;
  /** 保留旧 ExperimentTable 的 table className 传递位置。 */
  readonly className?: string;
}

interface ScatterPoint {
  readonly id: string;
  readonly cost: number;
  readonly quality: number;
  readonly partial: boolean;
  readonly coverage: string;
}

const SCATTER_WIDTH = 760;
const SCATTER_HEIGHT = 340;
const SCATTER_MARGIN = { top: 24, right: 36, bottom: 50, left: 64 } as const;

function qualityCostScatter(
  items: readonly ExperimentListItem[],
  kind: "pass" | "points",
  locale: ReportLocale,
): ReactNode {
  const points: ScatterPoint[] = items.flatMap((item) => {
    if (kind === "pass" && item.evaluationKind === "points") return [];
    if (kind === "points" && item.evaluationKind === "pass") return [];
    const qualityMetric = kind === "pass" ? item.endToEndPassRate : item.score;
    const costMetric = item.costUSD;
    const quality = qualityMetric?.value;
    const cost = costMetric?.value;
    return qualityMetric === undefined || costMetric === undefined ||
        quality === null || quality === undefined || cost === null || cost === undefined
      ? []
      : [{
          id: item.experimentId,
          cost,
          quality,
          partial: qualityMetric.state !== "available" || costMetric.state !== "available",
          coverage: `${costMetric.samples}/${costMetric.total}; ${qualityMetric.samples}/${qualityMetric.total}`,
        }];
  });
  if (points.length === 0) return null;

  const plotWidth = SCATTER_WIDTH - SCATTER_MARGIN.left - SCATTER_MARGIN.right;
  const plotHeight = SCATTER_HEIGHT - SCATTER_MARGIN.top - SCATTER_MARGIN.bottom;
  const maxCost = Math.max(...points.map(({ cost }) => cost), 0.001);
  const maxQuality = kind === "pass"
    ? 1
    : Math.max(...points.map(({ quality }) => quality), 1);
  const x = (value: number): number => SCATTER_MARGIN.left + (value / maxCost) * plotWidth;
  const y = (value: number): number =>
    SCATTER_MARGIN.top + plotHeight - (value / maxQuality) * plotHeight;
  const qualityLabel = locale === "zh-CN"
    ? kind === "pass" ? "通过率" : "分数"
    : kind === "pass" ? "Pass rate" : "Score";
  const costLabel = locale === "zh-CN" ? "成本" : "Cost";
  const title = `${costLabel} × ${qualityLabel}`;
  const partialLabel = locale === "zh-CN" ? "部分数据" : "partial data";
  const formatter = new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  const qualityText = (value: number): string => kind === "pass"
    ? `${Math.round(value * 100)}%`
    : value.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en", { maximumFractionDigits: 2 });

  return (
    <figure className="niceeval-chart niceeval-chart--scatter">
      <h3 className="niceeval-chart-title">{title}</h3>
      <svg
        className="niceeval-chart-svg"
        viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`}
        role="img"
        aria-label={title}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const py = SCATTER_MARGIN.top + plotHeight - ratio * plotHeight;
          return (
            <g key={`y:${ratio}`} className="niceeval-chart-grid">
              <line x1={SCATTER_MARGIN.left} x2={SCATTER_MARGIN.left + plotWidth} y1={py} y2={py} />
              <text className="niceeval-chart-tick" x={SCATTER_MARGIN.left - 10} y={py + 4} textAnchor="end">
                {qualityText(maxQuality * ratio)}
              </text>
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const px = SCATTER_MARGIN.left + ratio * plotWidth;
          return (
            <g key={`x:${ratio}`} className="niceeval-chart-grid">
              <line x1={px} x2={px} y1={SCATTER_MARGIN.top} y2={SCATTER_MARGIN.top + plotHeight} />
              <text className="niceeval-chart-tick" x={px} y={SCATTER_MARGIN.top + plotHeight + 20} textAnchor="middle">
                {formatter.format(maxCost * ratio)}
              </text>
            </g>
          );
        })}
        <text className="niceeval-chart-xlabel" x={SCATTER_MARGIN.left + plotWidth / 2} y={SCATTER_HEIGHT - 8} textAnchor="middle">
          {costLabel} (USD)
        </text>
        <text className="niceeval-chart-ylabel" transform={`translate(16 ${SCATTER_MARGIN.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">
          {qualityLabel}
        </text>
        {points.map((point, index) => {
          const px = x(point.cost);
          const py = y(point.quality);
          const anchor = px > SCATTER_WIDTH * 0.72 ? "end" : "start";
          const dx = anchor === "end" ? -9 : 9;
          return (
            <g
              key={point.id}
              className={`niceeval-scatter-point niceeval-series-c${index % 6}${point.partial ? " niceeval-scatter-point--partial" : ""}`}
            >
              <circle className="niceeval-chart-dot" cx={px} cy={py} r={6}>
                <title>{`${point.id}\n${costLabel}: ${formatter.format(point.cost)}\n${qualityLabel}: ${qualityText(point.quality)}${point.partial ? `\n${partialLabel}: ${point.coverage}` : ""}`}</title>
              </circle>
              <text className="niceeval-chart-point-label" x={px + dx} y={py - 8} textAnchor={anchor}>
                {point.id}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="niceeval-view-sr-only">
        <ul>
          {points.map((point) => (
            <li key={point.id}>
              {`${point.id}: ${costLabel} ${formatter.format(point.cost)}, ${qualityLabel} ${qualityText(point.quality)}${point.partial ? `, ${partialLabel} ${point.coverage}` : ""}`}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/**
 * selection title 使用旧 Section 的 DOM/class；表本体保持旧 TableContentView 的
 * hierarchy、sort/filter 属性与原生 details/summary。
 */
export function ExperimentOverview({
  data,
  locale,
  sort = "summary",
  searchable = true,
  className,
}: ExperimentOverviewProps): ReactNode {
  const items = sortExperimentListItems(data.experiments);
  return (
    <section className="niceeval-report niceeval-section">
      <h2 className="niceeval-section-title">
        {resolveLocalizedText(data.selectionTitle, locale)}
      </h2>
      <div className="niceeval-quality-cost-comparison">
        {qualityCostScatter(items, "pass", locale)}
        {qualityCostScatter(items, "points", locale)}
      </div>
      <TableContentView
        data={experimentListContent(items)}
        sort={sort}
        searchable={searchable}
        locale={locale}
        className={className}
      />
    </section>
  );
}

ExperimentOverview.displayName = "ExperimentOverview";

export {
  experimentEvalLayout,
  experimentListEvaluationKindComposition,
  relativeEvalLabel,
  sortExperimentListItems,
} from "./compute.ts";
export type {
  AttemptListItem,
  EvalLayoutNode,
  EvaluationKindComposition,
  ExperimentListEvalRow,
  ExperimentListItem,
  ExperimentMetrics,
} from "./compute.ts";
export {
  attemptCells,
  attemptListContent,
  evalRow,
  experimentListContent,
  experimentRow,
  groupRow,
  measureCell,
} from "./content.ts";
export type {
  Cell,
  ColumnSpec,
  MetricBasis,
  MetricState,
  MetricValue,
  TableContent,
  TableContentRow,
  Verdict,
} from "../../definition/cell.tsx";
export {
  canonicalAttemptHref,
  MetricCellView,
  renderHierarchyRowsWeb,
  TableContentView,
} from "../../definition/primitives.tsx";
export type {
  MetricCellViewProps,
  TableContentViewProps,
  TablePresentation,
  TableWebContext,
} from "../../definition/primitives.tsx";
export type {
  LocalizedText,
  ReportLocale,
} from "../../model/locale.ts";
