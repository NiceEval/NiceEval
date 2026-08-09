// Scatter / Line / Bars / Area：接 points 的显示形状原语。
// 内部落到 Dataset + Chart 内核；作者面不暴露 Dataset。
// 契约见 docs/feature/reports/README.md「图表」、components/charts/README.md。

import type { ReactNode } from "react";
import { COMPONENT_FACES, defineComponent, type ReportComponent } from "../tree.ts";
import type { ReportLocale } from "../../model/locale.ts";
import type { ReportTarget } from "../report.ts";
import { isMetricValue, type EvidenceRow, type MetricValue } from "../../model/calculation.ts";
import { Chart, Series, type ChartTargetPoint } from "./chart.tsx";
import { pointsToDataset, type ExternalPoint } from "./points-dataset.ts";

type Mark = "scatter" | "line" | "bar" | "area";

type KeysMatching<Row, Value> = Extract<
  {
    [Key in keyof Row]-?: Row[Key] extends Value ? Key : never;
  }[keyof Row],
  string
>;

/** Sample 证据行可作坐标的字段：读数与字符串 / 布尔维度，排除 refs 与对象。 */
export type EvidenceAxisKey<Row> = KeysMatching<Row, MetricValue | string | boolean>;
/** Sample 证据行可标识系列 / 点的维度字段。 */
export type EvidenceDimensionKey<Row> = KeysMatching<Row, string | number | boolean>;
/** external 图表只接收 JSON 标量字段。 */
export type ExternalAxisKey<Row> = KeysMatching<Row, ExternalPoint[keyof ExternalPoint]>;
type EvidenceSortableKey<Row> = KeysMatching<Row, MetricValue | string | boolean>;

export interface BarsSort<Field extends string = string> {
  field: Field;
  direction?: "asc" | "desc";
}

interface BaseMarkProps<Row extends object, AxisKey extends string, DimensionKey extends string> {
  points: readonly Row[];
  x: AxisKey;
  y: AxisKey;
  /** docs: color / series — 拆成可见系列。 */
  color?: DimensionKey;
  series?: DimensionKey;
  /** 点身份键。 */
  point?: DimensionKey;
  connect?: boolean;
  connectNulls?: boolean;
  legend?: boolean;
  locale?: ReportLocale;
  className?: string;
}

/**
 * Sample 派生图表才有下钻目标可言(外部标量序列的 `refs` 恒为空,`external: true` 图表因此
 * 没有这个 prop——不是省略,是这个组合天生就没有可下钻的证据)。省略时全库唯一默认规则
 * `targetOfRefs(point.refs)` 生效(见 chart.tsx `ChartPresentation.pointTarget`)。
 */
interface DrillDownMarkProps {
  pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
}

type EvidenceMarkProps<Row extends EvidenceRow> = BaseMarkProps<
  Row,
  EvidenceAxisKey<Row>,
  EvidenceDimensionKey<Row>
> & {
  /** Sample 派生点必须保留证据；不能声明为 external。 */
  external?: false;
};
type ExternalMarkProps<Row extends object> = BaseMarkProps<
  Row,
  ExternalAxisKey<Row>,
  ExternalAxisKey<Row>
>;

export type ScatterProps<Row extends EvidenceRow = EvidenceRow> = EvidenceMarkProps<Row> & DrillDownMarkProps;
export type ExternalScatterProps<Row extends object = ExternalPoint> = ExternalMarkProps<Row> & {
  external: true;
};

export type LineProps<Row extends EvidenceRow = EvidenceRow> = EvidenceMarkProps<Row> & DrillDownMarkProps;
export type ExternalLineProps<Row extends object = ExternalPoint> = ExternalMarkProps<Row> & {
  external: true;
};

export type BarsProps<Row extends EvidenceRow = EvidenceRow> = EvidenceMarkProps<Row> &
  DrillDownMarkProps & {
    /** 显示排序；在 limit 之前生效，不重新聚合。 */
    sort?: BarsSort<EvidenceSortableKey<Row>>;
    /** 排序后只保留前 N 行；不生成“其他”桶。 */
    limit?: number;
    /** web 面柱形方向；text 面始终使用适合终端阅读的横向排行。 */
    layout?: "horizontal" | "vertical";
  };
export type ExternalBarsProps<Row extends object = ExternalPoint> = ExternalMarkProps<Row> & {
  external: true;
  sort?: BarsSort<ExternalAxisKey<Row>>;
  limit?: number;
  layout?: "horizontal" | "vertical";
};

export type AreaProps<Row extends EvidenceRow = EvidenceRow> = EvidenceMarkProps<Row> & DrillDownMarkProps;
export type ExternalAreaProps<Row extends object = ExternalPoint> = ExternalMarkProps<Row> & {
  external: true;
};

type AnyMarkProps = {
  points: readonly object[];
  x: string;
  y: string;
  color?: string;
  series?: string;
  point?: string;
  connect?: boolean;
  connectNulls?: boolean;
  legend?: boolean;
  locale?: ReportLocale;
  className?: string;
  external?: boolean;
  pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
  sort?: BarsSort;
  limit?: number;
  layout?: "horizontal" | "vertical";
};

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
 * 契约：docs/feature/reports/README.md「Bars」。
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
      layout={props.layout}
      locale={props.locale}
      className={props.className}
      pointTarget={props.pointTarget}
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

type MarkComponentBase = Pick<ReportComponent<AnyMarkProps>, typeof COMPONENT_FACES | "displayName">;

type ScatterComponent = MarkComponentBase & {
  <Row extends EvidenceRow>(props: ScatterProps<Row>): ReactNode;
  <Row extends object>(props: ExternalScatterProps<Row>): ReactNode;
};
type LineComponent = MarkComponentBase & {
  <Row extends EvidenceRow>(props: LineProps<Row>): ReactNode;
  <Row extends object>(props: ExternalLineProps<Row>): ReactNode;
};
type BarsComponent = MarkComponentBase & {
  <Row extends EvidenceRow>(props: BarsProps<Row>): ReactNode;
  <Row extends object>(props: ExternalBarsProps<Row>): ReactNode;
};
type AreaComponent = MarkComponentBase & {
  <Row extends EvidenceRow>(props: AreaProps<Row>): ReactNode;
  <Row extends object>(props: ExternalAreaProps<Row>): ReactNode;
};

export const Scatter = defineComponent<AnyMarkProps>((props) => markChart("scatter", props)) as unknown as ScatterComponent;
Scatter.displayName = "Scatter";

export const Line = defineComponent<AnyMarkProps>((props) => markChart("line", props)) as unknown as LineComponent;
Line.displayName = "Line";

export const Bars = defineComponent<AnyMarkProps>((props) => markChart("bar", props)) as unknown as BarsComponent;
Bars.displayName = "Bars";

export const Area = defineComponent<AnyMarkProps>((props) => markChart("area", props)) as unknown as AreaComponent;
Area.displayName = "Area";
