// 官方表格数据协议的单元格类型。
// TableContentView 与 entity-lists 共用这份判别联合；输入必须已经闭合，组件不会
// 读取 Sample、Analysis、SQLite snapshot 或 repository。

import type { MetricFormat } from "../model/format.ts";
import {
  formatMetricScalar,
  formatPlainNumber,
  metricStateText,
  missingText,
  verdictMark,
} from "../model/format.ts";
import {
  countText,
  DEFAULT_REPORT_LOCALE,
  localeText,
  type LocalizedText,
  type ReportLocale,
} from "../model/locale.ts";

/** Plain closed locator identity used by the old table props. */
export type AttemptLocator = string;
export type Verdict = "passed" | "failed" | "errored" | "skipped";

export type MetricState =
  | "available"
  | "partial"
  | "failed"
  | "unavailable"
  | "empty"
  | "unsupported"
  | "migration-required";

export type MetricBasis = "attempt" | "eval" | "run" | "pair" | "slot";

export interface EvidenceRef {
  readonly identity: {
    readonly kind: "attempt";
    readonly locator: AttemptLocator;
  };
}

/** Inspection issues are closed JSON and deliberately remain producer-owned opaque evidence. */
export type MetricIssue =
  | null
  | boolean
  | number
  | string
  | readonly MetricIssue[]
  | { readonly [key: string]: MetricIssue };

/** A closed metric cell. Extra producer-owned fields remain structurally compatible. */
export interface MetricValue<Value = number> {
  readonly value: Value | null;
  readonly state: MetricState;
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricBasis;
  readonly issues: readonly MetricIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MetricFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly bounds?: { readonly min?: number; readonly max?: number };
}

/** 判定计票:passed / failed / errored / skipped。 */
export interface VerdictCounts {
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
}

/**
 * 官方表格一格。三条不变量:
 * - metric 格永远带闭合值(不得压成 text);
 * - notApplicable 与 missing 不合并;
 * - summary 的文本已在上游折好。
 */
export type Cell =
  | {
      /** 同一格内按顺序组合多个中立 Cell；不得嵌套 stack。 */
      readonly kind: "stack";
      readonly cells: readonly [Cell, ...Cell[]];
    }
  | {
      readonly kind: "metric";
      readonly metric: MetricValue;
      /** Hide the compact samples/total suffix only when an adjacent region presents coverage. */
      readonly showCoverage?: boolean;
    }
  | {
      readonly kind: "verdict";
      readonly verdict?: Verdict;
      readonly counts?: VerdictCounts;
      readonly refs?: readonly AttemptLocator[];
      /** 单判定形态省略判定词、只留判定符。 */
      readonly bare?: boolean;
    }
  | {
      readonly kind: "score";
      readonly earned: number;
      readonly possible?: number;
      readonly missedScoreItems?: number;
    }
  | { readonly kind: "summary"; readonly text: string; readonly more?: number }
  | {
      readonly kind: "locator";
      readonly locator: AttemptLocator;
      readonly verdict?: Verdict;
    }
  | { readonly kind: "text"; readonly text: string; readonly detail?: string }
  | { readonly kind: "notApplicable" }
  | {
      readonly kind: "missing";
      readonly code: string;
      /** 补上这一格的命令,可直接复制。 */
      readonly detail?: string;
    };

export interface ColumnSpec {
  readonly key: string;
  readonly unit?: string;
  readonly better?: "higher" | "lower";
  /** 列表头；省略时按 key 原样显示。 */
  readonly header?: LocalizedText;
}

/**
 * 表行 Content。placeholder 行照常渲染,但不进任何列的聚合读数；group 行的
 * 读数已经由输入闭合，不由 React renderer 重算。
 */
export interface TableContentRow {
  readonly key: string;
  readonly cells: Readonly<globalThis.Record<string, Cell>>;
  readonly subRows?: readonly TableContentRow[];
  readonly variant?: "normal" | "placeholder" | "group";
}

export interface TableContent {
  readonly columns: readonly ColumnSpec[];
  readonly rows: readonly TableContentRow[];
}

interface CostProjectionLike {
  readonly state: "available" | "partial" | "unavailable" | "migration-required";
  readonly combined: { readonly amount: string } | null;
}

/** Structural narrowing for old closed cost metrics without reviving pricing wrappers. */
export function costProjectionOf(metric: MetricValue): CostProjectionLike | undefined {
  const candidate = (metric as MetricValue & { readonly projection?: unknown }).projection;
  if (candidate === null || typeof candidate !== "object") return undefined;
  const projection = candidate as {
    readonly state?: unknown;
    readonly combined?: unknown;
  };
  if (
    projection.state !== "available" &&
    projection.state !== "partial" &&
    projection.state !== "unavailable" &&
    projection.state !== "migration-required"
  ) return undefined;
  if (projection.combined === null) {
    return { state: projection.state, combined: null };
  }
  if (
    typeof projection.combined !== "object" ||
    typeof (projection.combined as { readonly amount?: unknown }).amount !== "string"
  ) return undefined;
  return {
    state: projection.state,
    combined: { amount: (projection.combined as { readonly amount: string }).amount },
  };
}

/** 把 Cell 折成可见字符串(缺数据 / 不适用统一不补成 0)。 */
function formatMetricCellText(
  cell: Extract<Cell, { readonly kind: "metric" }>,
  locale: ReportLocale,
  coverageDetail = false,
): string {
  const projection = costProjectionOf(cell.metric);
  const display = projection?.combined !== null && projection?.combined !== undefined
    ? `$${projection.combined.amount}`
    : cell.metric.value === null
    ? metricStateText(cell.metric.state, locale)
    : formatMetricScalar(cell.metric.value, cell.metric.unit, cell.metric.format, locale);
  if (cell.showCoverage === false) return display;
  if (coverageDetail && cell.metric.value !== null && cell.metric.samples < cell.metric.total) {
    return `${display}\n  ${localeText(locale, "cell.coverageDetail", {
      samples: cell.metric.samples,
      total: cell.metric.total,
    })}`;
  }
  return `${display} · ${cell.metric.state}`;
}

export function formatCellText(cell: Cell | null | undefined, locale?: ReportLocale): string {
  if (cell == null) return "—";
  switch (cell.kind) {
    case "stack": {
      const loc = locale ?? DEFAULT_REPORT_LOCALE;
      const entries = cell.cells
        .map((entry, index) =>
          index === 0 && entry.kind === "metric"
            ? formatMetricCellText(entry, loc, true)
            : formatCellText(entry, locale)
        )
        .filter((entry) => entry !== "—");
      if (entries.length === 0) return "—";
      const primary: string[] = [];
      const details: string[] = [];
      for (const entry of entries) {
        const [head, ...tail] = entry.split("\n");
        if (head) primary.push(head);
        details.push(...tail.map((line) => line.trimStart()).filter(Boolean));
      }
      const detail = details.length > 0
        ? `\n${details.map((line) => `  ${line}`).join("\n")}`
        : "";
      return `${primary.join(" · ")}${detail}`;
    }
    case "notApplicable":
      return "—";
    case "missing": {
      const loc = locale ?? DEFAULT_REPORT_LOCALE;
      const reason = missingText(cell.code, loc);
      return cell.detail ? `${reason} · ${cell.detail}` : reason;
    }
    case "text":
      return cell.detail ? `${cell.text}\n  ${cell.detail}` : cell.text;
    case "locator": {
      const mark = cell.verdict !== undefined ? `${verdictMark(cell.verdict)} ` : "";
      return `${mark}${cell.locator}`;
    }
    case "summary": {
      const more = cell.more && cell.more > 0 ? ` +${cell.more} more` : "";
      return `${cell.text}${more}`;
    }
    case "score": {
      const earned = formatPlainNumber(cell.earned);
      const score = cell.possible !== undefined
        ? `${earned} / ${formatPlainNumber(cell.possible)}`
        : earned;
      if (cell.missedScoreItems === undefined) return score;
      const loc = locale ?? DEFAULT_REPORT_LOCALE;
      return `${score} · ${countText(loc, "experimentList.missedScoreItems", cell.missedScoreItems)}`;
    }
    case "verdict": {
      const loc = locale ?? DEFAULT_REPORT_LOCALE;
      if (cell.counts) {
        const parts = (["passed", "failed", "errored", "skipped"] as const)
          .filter((kind) => cell.counts![kind] > 0)
          .map((kind) => `${cell.counts![kind]} ${localeText(loc, `verdict.${kind}`)}`);
        return parts.join(" · ") || "—";
      }
      if (cell.verdict !== undefined) {
        if (cell.bare) return verdictMark(cell.verdict);
        return `${verdictMark(cell.verdict)} ${localeText(loc, `verdict.${cell.verdict}`)}`;
      }
      return "—";
    }
    case "metric":
      return formatMetricCellText(cell, locale ?? DEFAULT_REPORT_LOCALE);
  }
}
