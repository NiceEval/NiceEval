// Experiment aggregate 的质量 × 成本散点图。Recharts 负责坐标、交互和可访问性；
// 本组件只把已闭合的 ExperimentListItem aggregate 投影为图表数据。

import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportLocale } from "../../components/locale.ts";
import type { ExperimentListItem } from "./compute.ts";

interface ScatterPoint {
  readonly experimentId: string;
  readonly cost: number;
  readonly quality: number;
  readonly partial: boolean;
  readonly coverage: string;
}

interface ScatterSeries {
  readonly experimentId: string;
  readonly points: readonly ScatterPoint[];
}

interface PointShapeProps {
  readonly cx?: number;
  readonly cy?: number;
  readonly payload?: unknown;
  readonly fill?: string;
  readonly stroke?: string;
}

export interface QualityCostScatterProps {
  readonly items: readonly ExperimentListItem[];
  readonly kind: "pass" | "points";
  readonly locale: ReportLocale;
}

export default function QualityCostScatter({
  items,
  kind,
  locale,
}: QualityCostScatterProps) {
  const series: ScatterSeries[] = items.flatMap((item) => {
    if (kind === "pass" && item.evaluationKind !== "pass") return [];
    if (kind === "points" && item.evaluationKind !== "points") return [];
    const qualityMetric = kind === "pass" ? item.endToEndPassRate : item.score;
    const costMetric = item.costUSD;
    const quality = qualityMetric?.value;
    const cost = costMetric?.value;
    return qualityMetric === undefined || costMetric === undefined ||
        quality === null || quality === undefined || cost === null || cost === undefined
      ? []
      : [{
          experimentId: item.experimentId,
          points: [Object.freeze({
            experimentId: item.experimentId,
            cost,
            quality,
            partial: qualityMetric.state !== "available" || costMetric.state !== "available",
            coverage: `${costMetric.samples}/${costMetric.total}; ${qualityMetric.samples}/${qualityMetric.total}`,
          })],
        }];
  });
  const points = series.flatMap(({ points: values }) => values);
  const qualityLabel = locale === "zh-CN"
    ? kind === "pass" ? "通过率" : "分数"
    : kind === "pass" ? "Pass rate" : "Score";
  const costLabel = locale === "zh-CN" ? "成本" : "Cost";
  const title = `${costLabel} × ${qualityLabel}`;
  if (points.length === 0) {
    return (
      <figure className="niceeval-chart niceeval-chart--scatter">
        <h3 className="niceeval-chart-title">{title}</h3>
        <p className="niceeval-empty">{locale === "zh-CN" ? "暂无可绘制的数据" : "No chartable data"}</p>
      </figure>
    );
  }

  const observedMaxCost = Math.max(...points.map(({ cost }) => cost));
  const maxCost = observedMaxCost > 0 ? observedMaxCost * 1.12 : 1;
  const maxQuality = kind === "pass"
    ? 1
    : Math.max(...points.map(({ quality }) => quality), 1) * 1.08;
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
      <div className="niceeval-scatter-canvas" role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 18, right: 24, bottom: 34, left: 22 }} accessibilityLayer>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              type="number"
              dataKey="cost"
              domain={[0, maxCost]}
              tickFormatter={(value: number) => formatter.format(value)}
              name={costLabel}
              unit=" USD"
              label={{ value: `${costLabel} (USD)`, position: "insideBottom", offset: -22 }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--line-strong)" }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="quality"
              domain={[0, maxQuality]}
              tickFormatter={qualityText}
              name={qualityLabel}
              label={{ value: qualityLabel, angle: -90, position: "insideLeft" }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={58}
            />
            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }}
              contentStyle={{
                border: "1px solid var(--line-strong)",
                borderRadius: "var(--radius)",
                background: "var(--panel)",
                color: "var(--text)",
              }}
              labelStyle={{ color: "var(--text)", fontWeight: 650 }}
              labelFormatter={(_label, tooltipPayload) => {
                const point = scatterPoint(tooltipPayload[0]?.payload);
                return point?.experimentId ?? "";
              }}
              formatter={(value, name) => [
                name === "cost" ? formatter.format(Number(value)) : qualityText(Number(value)),
                name === "cost" ? costLabel : qualityLabel,
              ]}
            />
            <Legend verticalAlign="top" align="right" iconSize={10} />
            {series.map((entry, index) => (
              <Scatter
                key={entry.experimentId}
                name={entry.experimentId}
                data={entry.points}
                className={`niceeval-series-c${index % 6}`}
                fill="var(--series)"
                stroke={entry.points[0]?.partial ? "var(--warn)" : "var(--panel)"}
                strokeWidth={2}
                strokeDasharray={entry.points[0]?.partial ? "2 2" : undefined}
                shape={(shapeProps: PointShapeProps) => (
                  <ExperimentPoint {...shapeProps} locale={locale} />
                )}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="niceeval-view-sr-only">
        <ul>
          {points.map((point) => (
            <li key={point.experimentId}>
              {`${point.experimentId}: ${costLabel} ${formatter.format(point.cost)}, ${qualityLabel} ${qualityText(point.quality)}${point.partial ? `, ${partialLabel} ${point.coverage}` : ""}`}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function ExperimentPoint({ cx, cy, payload, fill, stroke, locale }: PointShapeProps & { readonly locale: ReportLocale }) {
  const point = scatterPoint(payload);
  if (point === null || cx === undefined || cy === undefined) return <g />;
  const activate = () => {
    window.location.hash = `/experiment/${encodeURIComponent(point.experimentId)}`;
  };
  return (
    <circle
      cx={cx}
      cy={cy}
      r={7}
      fill={fill}
      stroke={stroke}
      role="link"
      tabIndex={0}
      aria-label={`${point.experimentId}, ${locale === "zh-CN" ? "打开实验" : "open experiment"}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    />
  );
}

function scatterPoint(value: unknown): ScatterPoint | null {
  if (typeof value !== "object" || value === null) return null;
  const point = value as Partial<ScatterPoint>;
  return typeof point.experimentId === "string" &&
      typeof point.cost === "number" &&
      typeof point.quality === "number" && typeof point.partial === "boolean" &&
      typeof point.coverage === "string"
    ? point as ScatterPoint
    : null;
}
