// Experiment aggregate 的质量 × 成本散点图。Recharts 负责坐标、交互和可访问性；
// 本组件只把已闭合的 ExperimentListItem aggregate 投影为图表数据。

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { ReportLocale } from "../../components/locale.ts";
import type { ExperimentListItem } from "./compute.ts";

interface ScatterPoint {
  readonly experimentId: string;
  readonly cost: number;
  readonly quality: number;
  readonly partial: boolean;
  readonly coverage: string;
  readonly href: string;
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
  const { t } = useTranslation();
  const series: ScatterSeries[] = items.flatMap((item) => {
    if (kind === "pass" && item.evaluationKind !== "pass") return [];
    if (kind === "points" && item.evaluationKind === "pass") return [];
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
            href: item.href,
          })],
        }];
  });
  const points = series.flatMap(({ points: values }) => values);
  const pointLabels = uniqueExperimentLabels(series.map(({ experimentId }) => experimentId));
  const qualityLabel = t(kind === "pass" ? "insight.chart.passRate" : "insight.chart.score");
  const costLabel = t("insight.chart.cost");
  const title = `${costLabel} × ${qualityLabel}`;
  if (points.length === 0) {
    return (
      <figure className="niceeval-chart niceeval-chart--scatter">
        <h3 className="niceeval-chart-title">{title}</h3>
        <p className="niceeval-chart-empty">{t("insight.chart.noData")}</p>
      </figure>
    );
  }

  const observedMaxCost = Math.max(...points.map(({ cost }) => cost));
  const maxCost = observedMaxCost > 0 ? observedMaxCost * 1.12 : 1;
  const maxQuality = kind === "pass"
    ? 1.05
    : Math.max(...points.map(({ quality }) => quality), 1) * 1.1;
  const partialLabel = t("insight.chart.partial");
  const costFractionDigits = adaptiveCostFractionDigits(observedMaxCost);
  const formatter = new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.min(2, costFractionDigits),
    maximumFractionDigits: costFractionDigits,
  });
  const qualityText = (value: number): string => kind === "pass"
    ? `${Math.round(value * 100)}%`
    : value.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en", { maximumFractionDigits: 2 });

  return (
    <figure className="niceeval-chart niceeval-chart--scatter">
      <h3 className="niceeval-chart-title">{title}</h3>
      <div className="niceeval-scatter-canvas" role="group" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: kind === "pass" ? 28 : 20, right: 52, bottom: 40, left: 16 }} accessibilityLayer>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              type="number"
              dataKey="cost"
              domain={[0, maxCost]}
              tickCount={5}
              tickFormatter={(value: number) => formatter.format(value)}
              name={costLabel}
              label={{ value: `${costLabel} (USD)`, position: "insideBottom", offset: -22 }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--line-strong)" }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="quality"
              domain={[0, maxQuality]}
              ticks={kind === "pass" ? [0, 0.25, 0.5, 0.75, 1] : undefined}
              tickCount={kind === "pass" ? undefined : 5}
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
                return point === null
                  ? ""
                  : `${point.experimentId}${point.partial ? ` · ${partialLabel}` : ""}`;
              }}
              formatter={(value, name) => [
                name === "cost" ? formatter.format(Number(value)) : qualityText(Number(value)),
                name === "cost" ? costLabel : qualityLabel,
              ]}
            />
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
                  <ExperimentPoint
                    {...shapeProps}
                    label={pointLabels.get(entry.experimentId) ?? entry.experimentId}
                    openLabel={t("insight.chart.openExperiment")}
                  />
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

function ExperimentPoint({
  cx,
  cy,
  payload,
  fill,
  stroke,
  label,
  openLabel,
}: PointShapeProps & { readonly label: string; readonly openLabel: string }) {
  const point = scatterPoint(payload);
  if (point === null || cx === undefined || cy === undefined) return <g />;
  const activate = () => {
    window.location.hash = point.href.startsWith("#") ? point.href.slice(1) : point.href;
  };
  return (
    <g
      className="niceeval-scatter-point"
      role="link"
      tabIndex={0}
      aria-label={`${openLabel}: ${point.experimentId}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      <circle className="niceeval-scatter-point-target" cx={cx} cy={cy} r={14} />
      <circle
        className="niceeval-scatter-point-dot"
        cx={cx}
        cy={cy}
        r={7}
        fill={fill}
        stroke={stroke}
        aria-hidden="true"
      />
      <text className="niceeval-scatter-point-label" x={cx + 10} y={cy - 9}>{label}</text>
    </g>
  );
}

function scatterPoint(value: unknown): ScatterPoint | null {
  if (typeof value !== "object" || value === null) return null;
  const point = value as Partial<ScatterPoint>;
  return typeof point.experimentId === "string" &&
      typeof point.cost === "number" &&
      typeof point.quality === "number" && typeof point.partial === "boolean" &&
      typeof point.coverage === "string" && typeof point.href === "string"
    ? point as ScatterPoint
    : null;
}

function adaptiveCostFractionDigits(maxCost: number): number {
  if (!Number.isFinite(maxCost) || maxCost <= 0) return 2;
  return Math.min(8, Math.max(2, Math.ceil(-Math.log10(maxCost)) + 2));
}

function uniqueExperimentLabels(experimentIds: readonly string[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const experimentId of experimentIds) {
    const segments = experimentId.split("/");
    let label = experimentId;
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const candidate = segments.slice(-depth).join("/");
      label = candidate;
      if (experimentIds.every((other) => other === experimentId || !other.endsWith(`/${candidate}`))) break;
    }
    labels.set(experimentId, label);
  }
  return labels;
}
