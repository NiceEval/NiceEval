// Scatter / Line / Bars / Area：接 points 的显示形状原语。
// 内部落到 Dataset + Chart 内核；作者面不暴露 Dataset。
// 契约见 docs/feature/reports/library.md「图表」、components/charts/README.md。

import { defineComponent } from "../tree.ts";
import type { ReportLocale } from "../../model/locale.ts";
import type { AttemptLocator } from "../../../record/locator.ts";
import { isMetricValue, type EvidenceRow } from "../../model/calculation.ts";
import { Chart, Series } from "./chart.tsx";
import { pointsToDataset, type ExternalPoint } from "./points-dataset.ts";

type Mark = "scatter" | "line" | "bar" | "area";

export interface BarsSort {
  field: string;
  direction?: "asc" | "desc";
}

interface BaseMarkProps<Row extends object> {
  points: readonly Row[];
  x: string;
  y: string;
  /** docs: color / series — 拆成可见系列。 */
  color?: string;
  series?: string;
  /** 点身份键。 */
  point?: string;
  connect?: boolean;
  connectNulls?: boolean;
  legend?: boolean;
  locale?: ReportLocale;
  className?: string;
  attemptHref?: (locator: AttemptLocator) => string;
  /**
   * Sample 派生默认校验 EvidenceRow / MetricValue。
   * `true` 只退出证据校验，接受 JSON 标量，不伪造 Attempt 下钻。
   */
  external?: boolean;
}

export type ScatterProps<Row extends EvidenceRow = EvidenceRow> = BaseMarkProps<Row>;
export type ExternalScatterProps<Row extends ExternalPoint = ExternalPoint> = BaseMarkProps<Row> & {
  external: true;
};

export type LineProps<Row extends EvidenceRow = EvidenceRow> = BaseMarkProps<Row>;
export type ExternalLineProps<Row extends ExternalPoint = ExternalPoint> = BaseMarkProps<Row> & {
  external: true;
};

export type BarsProps<Row extends EvidenceRow = EvidenceRow> = BaseMarkProps<Row> & {
  /** 显示排序；在 limit 之前生效，不重新聚合。 */
  sort?: BarsSort;
  /** 排序后只保留前 N 行；不生成“其他”桶。 */
  limit?: number;
};
export type ExternalBarsProps<Row extends ExternalPoint = ExternalPoint> = BaseMarkProps<Row> & {
  external: true;
  sort?: BarsSort;
  limit?: number;
};

export type AreaProps<Row extends EvidenceRow = EvidenceRow> = BaseMarkProps<Row>;
export type ExternalAreaProps<Row extends ExternalPoint = ExternalPoint> = BaseMarkProps<Row> & {
  external: true;
};

type AnyMarkProps = BaseMarkProps<object> & { sort?: BarsSort; limit?: number };

function sortValue(raw: unknown, path: string, external: boolean): number | string | null {
  if (isMetricValue(raw)) {
    if (external) {
      throw new Error(
        `Bars sort field at ${path} is a MetricValue but this chart declared external: true — external points only accept JSON scalars.`,
      );
    }
    return raw.value;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (!external) {
      throw new Error(
        `Bars sort field at ${path} is a bare number — Sample-derived charts require MetricValue, or declare external: true.`,
      );
    }
    return raw;
  }
  if (typeof raw === "string" || typeof raw === "boolean") return String(raw);
  if (raw === null) return null;
  throw new Error(`Bars sort field at ${path} must be a MetricValue, number, string, or boolean`);
}

/**
 * Bars 的显示层排序与截断：只改可见行序与数量，不聚合长尾。
 * 契约：docs/feature/reports/components/charts/README.md「Bars」。
 */
export function applyBarsSortLimit(
  points: readonly object[],
  options: { sort?: BarsSort; limit?: number; external?: boolean },
): object[] {
  const external = options.external === true;
  let rows = [...points];
  if (options.sort !== undefined) {
    const { field, direction } = options.sort;
    if (typeof field !== "string" || field.length === 0) {
      throw new Error('Bars sort.field must be a non-empty string field name on each point');
    }
    const dir = direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const aRec = a as globalThis.Record<string, unknown>;
      const bRec = b as globalThis.Record<string, unknown>;
      if (!(field in aRec)) throw new Error(`Bars sort field "${field}" is missing on a point`);
      if (!(field in bRec)) throw new Error(`Bars sort field "${field}" is missing on a point`);
      const av = sortValue(aRec[field], `sort.${field}`, external);
      const bv = sortValue(bRec[field], `sort.${field}`, external);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // 缺数据沉底
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 0) {
      throw new Error(`Bars limit must be a non-negative integer; got ${String(options.limit)}`);
    }
    rows = rows.slice(0, options.limit);
  }
  return rows;
}

function markChart(mark: Mark, props: AnyMarkProps) {
  const seriesKey = props.series ?? props.color;
  const points =
    mark === "bar"
      ? applyBarsSortLimit(props.points, {
          ...(props.sort !== undefined ? { sort: props.sort } : {}),
          ...(props.limit !== undefined ? { limit: props.limit } : {}),
          ...(props.external === true ? { external: true } : {}),
        })
      : props.points;
  const dataset = pointsToDataset(points, {
    x: props.x,
    y: props.y,
    ...(seriesKey !== undefined ? { series: seriesKey } : {}),
    ...(props.point !== undefined ? { point: props.point } : {}),
    ...(props.external === true ? { external: true } : {}),
  });
  return (
    <Chart
      data={dataset}
      x={props.x}
      y={props.y}
      legend={props.legend ?? seriesKey !== undefined}
      locale={props.locale}
      className={props.className}
      attemptHref={props.attemptHref}
    >
      <Series
        id={mark}
        mark={mark === "bar" ? "bar" : mark}
        {...(props.point !== undefined ? { points: props.point } : {})}
        {...(seriesKey !== undefined ? { by: seriesKey } : {})}
        connect={props.connect ?? (mark === "line" || mark === "area")}
        connectNulls={props.connectNulls}
      />
    </Chart>
  );
}

export const Scatter = defineComponent<ScatterProps>((props) => markChart("scatter", props));
Scatter.displayName = "Scatter";

export const Line = defineComponent<LineProps>((props) => markChart("line", props));
Line.displayName = "Line";

export const Bars = defineComponent<BarsProps>((props) => markChart("bar", props));
Bars.displayName = "Bars";

export const Area = defineComponent<AreaProps>((props) => markChart("area", props));
Area.displayName = "Area";
