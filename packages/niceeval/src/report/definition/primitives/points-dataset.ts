// EvidenceRow / external points → Dataset，供 Chart 内核绘制。
// 契约见 docs/feature/reports/library.md「图表」、components/charts/README.md。

import type { Dataset, DatasetField, DatasetValue } from "../../model/types.ts";
import { isMetricValue, type EvidenceRow } from "../../model/metrics.ts";
import type { EvidenceRef } from "../../../analysis/index.ts";
import { attemptLocatorOfEvidenceRef } from "./shared.ts";

export type ExternalScalar = string | number | boolean | null;
export type ExternalPoint = Readonly<globalThis.Record<string, ExternalScalar>>;

export interface PointsChartFields {
  x: string;
  y: string;
  /** 系列拆分键（docs 的 color / series）。 */
  series?: string;
  /** 点身份键（docs 的 point）。 */
  point?: string;
  external?: boolean;
}

type AxisKind = "metric" | "dimension";

function readAxisField(
  row: globalThis.Record<string, unknown>,
  field: string,
  path: string,
  external: boolean,
): {
  kind: AxisKind;
  cell: DatasetValue;
  meta: Pick<DatasetField, "unit" | "format" | "better" | "bounds">;
} {
  const raw = row[field];
  if (isMetricValue(raw)) {
    if (external) {
      throw new Error(
        `Chart field "${field}" at ${path} is a MetricValue but this chart declared external: true — external points only accept JSON scalars.`,
      );
    }
    return {
      kind: "metric",
      cell: raw,
      meta: {
        ...(raw.unit !== undefined ? { unit: raw.unit } : {}),
        ...(raw.format !== undefined ? { format: raw.format } : {}),
        ...(raw.better !== undefined ? { better: raw.better } : {}),
        ...(raw.bounds !== undefined ? { bounds: raw.bounds } : {}),
      },
    };
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (!external) {
      throw new Error(
        `Chart field "${field}" at ${path} is a bare number — Sample-derived charts require MetricValue (with refs). ` +
          `Pass MetricValue from aggregate()/rollup(), or declare external: true for non-Sample series.`,
      );
    }
    return { kind: "metric", cell: raw, meta: {} };
  }
  if (typeof raw === "string" || typeof raw === "boolean") {
    return { kind: "dimension", cell: String(raw), meta: {} };
  }
  if (raw === null && external) {
    // External data has no Analysis provenance. Preserve null as a neutral
    // Dataset scalar so the chart records a missing coordinate without
    // manufacturing a Report-owned MetricValue.
    return { kind: "metric", cell: null, meta: {} };
  }
  throw new Error(
    `Chart field "${field}" at ${path} must be a MetricValue` +
      (external ? ", finite number, or category string" : " or category string") +
      `, got ${raw === null ? "null" : typeof raw}.`,
  );
}

function evidenceRefs(row: globalThis.Record<string, unknown>): readonly EvidenceRef[] | undefined {
  if (Array.isArray((row as Partial<EvidenceRow>).refs)) {
    return (row as Partial<EvidenceRow>).refs as readonly EvidenceRef[];
  }
  const metrics = Object.values(row).filter(isMetricValue);
  if (metrics.length === 0) return undefined;
  return metrics.flatMap((metric) => metric.refs);
}

function assertEvidenceRow(row: unknown, path: string): asserts row is globalThis.Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${path} must be an object EvidenceRow`);
  }
  // aggregate() rows keep refs on their Analysis-owned MetricValues. A
  // presentation EvidenceRow may additionally hoist their union to `refs`.
  if (evidenceRefs(row as globalThis.Record<string, unknown>) === undefined) {
    throw new Error(
      `${path} has neither EvidenceRow.refs nor an Analysis MetricValue — Sample-derived chart points must carry evidence, or declare external: true.`,
    );
  }
}

/** closed EvidenceRow 第一条 ref 的 attempt locator;ref 不是 attempt 时退回 undefined。 */
function firstEvidenceLocator(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const refs = evidenceRefs(row as globalThis.Record<string, unknown>);
  if (refs === undefined || refs.length === 0) return undefined;
  const first = refs[0];
  if (!first || typeof first !== "object") return undefined;
  return attemptLocatorOfEvidenceRef(first as EvidenceRef);
}

/**
 * 把普通 points 行转成 Chart 内核消费的 Dataset。
 * 非 external：校验 EvidenceRow.refs 与 MetricValue；external：只收 JSON 标量。
 */
export function pointsToDataset(
  points: readonly object[],
  fields: PointsChartFields,
): Dataset {
  const external = fields.external === true;
  if (!Array.isArray(points)) {
    throw new Error('Chart "points" must be an array');
  }

  const xMetaAcc: Pick<DatasetField, "unit" | "format" | "better" | "bounds"> = {};
  const yMetaAcc: Pick<DatasetField, "unit" | "format" | "better" | "bounds"> = {};
  let xKind: AxisKind = "metric";
  let yKind: AxisKind = "metric";
  const dimNames = new Set<string>();
  if (fields.series) dimNames.add(fields.series);
  if (fields.point) dimNames.add(fields.point);

  const rows: Array<Dataset["rows"][number]> = [];
  for (let i = 0; i < points.length; i++) {
    const path = `points[${i}]`;
    const row = points[i]!;
    if (!external) assertEvidenceRow(row, path);
    else if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${path} must be an object`);
    }

    const record = row as globalThis.Record<string, unknown>;
    const x = readAxisField(record, fields.x, path, external);
    const y = readAxisField(record, fields.y, path, external);
    xKind = x.kind;
    yKind = y.kind;
    Object.assign(xMetaAcc, x.meta);
    Object.assign(yMetaAcc, y.meta);
    if (x.kind === "dimension") dimNames.add(fields.x);
    if (y.kind === "dimension") dimNames.add(fields.y);

    const values: globalThis.Record<string, DatasetValue> = {
      [fields.x]: x.cell,
      [fields.y]: y.cell,
    };

    for (const dim of dimNames) {
      if (dim === fields.x || dim === fields.y) continue;
      const raw = (row as globalThis.Record<string, unknown>)[dim];
      if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean" && raw !== null) {
        throw new Error(`${path}.${dim} must be a string/number/boolean dimension value`);
      }
      values[dim] = String(raw);
    }

    // 语义适配:行身份优先取显式 point 字段;缺失时落到第一条 evidence ref 的
    // attempt locator;再缺才退回行序。
    const key =
      fields.point !== undefined
        ? String((row as globalThis.Record<string, unknown>)[fields.point])
        : !external
          ? (firstEvidenceLocator(row) ?? `row-${i}`)
          : `row-${i}`;

    rows.push({ key, values });
  }

  const fieldList: DatasetField[] = [];
  for (const dim of dimNames) {
    if (dim === fields.x || dim === fields.y) continue;
    fieldList.push({ name: dim, kind: "dimension", valueType: "string" });
  }
  fieldList.push(
    xKind === "dimension"
      ? { name: fields.x, kind: "dimension", valueType: "string" }
      : { name: fields.x, kind: "metric", valueType: "number", ...xMetaAcc },
  );
  fieldList.push(
    yKind === "dimension"
      ? { name: fields.y, kind: "dimension", valueType: "string" }
      : { name: fields.y, kind: "metric", valueType: "number", ...yMetaAcc },
  );

  return { fields: fieldList, rows };
}
