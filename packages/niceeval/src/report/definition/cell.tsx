// 官方表格数据协议的单元格类型(docs/feature/reports/library.md「单元格类型」)。
// Table / Grid / Stat 共用这份判别联合;自定义 Source 要交给这些原语必须适配成这个形状。

import type { AttemptLocator } from "../../attempt-locator.ts";
import type { LocalizedText } from "../../shared/types.ts";
import type { Verdict } from "../../shared/types.ts";
import type { MetricValue } from "../../analysis/index.ts";
import {
  formatMetricScalar,
  formatPlainNumber,
  missingText,
  verdictMark,
} from "../model/format.ts";
import { formatCostProjectionCellText, isCostMetricValue } from "../model/pricing.ts";
import {
  DEFAULT_REPORT_LOCALE,
  countText,
  localeText,
  resolveLocalizedText,
  type ReportLocale,
} from "../model/locale.ts";

/** 判定计票:passed / failed / errored / skipped。 */
export interface VerdictCounts {
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
}

/**
 * 官方表格一格。三条不变量:
 * - metric 格永远带证据(不得压成 text);
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
      readonly verdict?: Verdict | "skipped";
      readonly counts?: VerdictCounts;
      /** 计票覆盖的 attempt 引用(有证据可下钻的计票格才携带,如稳定性矩阵)。 */
      readonly refs?: readonly AttemptLocator[];
      // 两种形态:counts = 判定构成计票(experiment / Eval 行);verdict = 单判定(attempt 行)。
      // 格子只带值,计票怎么来的(折叠、分桶)在实体投影侧,渲染面不算数。
      /** 单判定形态省略判定词、只留判定符(如对照矩阵逐格只放得下一个符号的场景)。 */
      readonly bare?: boolean;
    }
  | {
      readonly kind: "score";
      readonly earned: number;
      readonly possible?: number;
      /** Fully evaluated score contributions whose earned value is below their declared points. */
      readonly missedScoreItems?: number;
    }
  | { readonly kind: "summary"; readonly text: string; readonly more?: number }
  | {
      readonly kind: "locator";
      readonly locator: AttemptLocator;
      /** 有判定的 attempt 行:判定长在 locator 上(判定符 + 语义色),没有判定就省略。 */
      readonly verdict?: Verdict | "skipped";
    }
  | { readonly kind: "text"; readonly text: string; readonly detail?: string }
  | { readonly kind: "notApplicable" }
  | {
      readonly kind: "missing";
      readonly code: string;
      /** 补上这一格的命令,可直接复制(如 `niceeval exp <experimentId>`)。 */
      readonly detail?: string;
    };

export interface ColumnSpec {
  readonly key: string;
  readonly unit?: string;
  readonly better?: "higher" | "lower";
  /**
   * 列表头。text / web 两面按当前 locale 解析同一份;省略时按 key 原样显示
   * (维度值列——条件名、实验 id 这类列名即数据的列——用这一支)。
   * Table 原语自己不携带列名词表,表头只来自这里
   * (docs/feature/reports/library.md「Content 协议」)。
   */
  readonly header?: LocalizedText;
}

/**
 * 表行 Content。与布局原语 `Row` 组件不同名。
 * placeholder 行照常渲染,但不进任何列的聚合读数。
 * group 行的读数由自己的 subRows 聚合而来,不是一条独立事实。
 */
export interface TableContentRow {
  readonly key: string;
  readonly cells: Readonly<Record<string, Cell>>;
  readonly subRows?: readonly TableContentRow[];
  /** group 行的读数由自己的 subRows 聚合而来，不是一条独立事实。 */
  readonly variant?: "normal" | "placeholder" | "group";
}

export interface TableContent {
  readonly columns: readonly ColumnSpec[];
  readonly rows: readonly TableContentRow[];
}

/** 把 Cell 折成 text 面可见字符串(缺数据 / 不适用统一不补成 0)。 */
function formatMetricCellText(
  cell: Extract<Cell, { readonly kind: "metric" }>,
  locale: ReportLocale,
  coverageDetail = false,
): string {
  if (isCostMetricValue(cell.metric)) {
    const closed = formatCostProjectionCellText(cell.metric, locale);
    return closed.detail ? `${closed.text}\n  ${closed.detail}` : closed.text;
  }
  const display = formatMetricScalar(
    cell.metric.value,
    cell.metric.unit,
    cell.metric.format,
    locale,
  );
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
            : formatCellText(entry, locale))
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
      const mark = cell.verdict !== undefined ? `${verdictMark(cell.verdict === "skipped" ? "skipped" : cell.verdict)} ` : "";
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
          .filter((k) => cell.counts![k] > 0)
          .map((k) => `${cell.counts![k]} ${localeText(loc, `verdict.${k === "skipped" ? "skipped" : k}`)}`);
        return parts.join(" · ") || "—";
      }
      if (cell.verdict !== undefined) {
        const v = cell.verdict === "skipped" ? "skipped" : cell.verdict;
        // 判定符与判定词同场,与 locator 格、web 面同一条纪律:单色打印下照样读得出。
        // bare 省略判定词,只留判定符,供逐格空间紧张的场景(如对照矩阵)使用。
        if (cell.bare) return verdictMark(v);
        return `${verdictMark(v)} ${localeText(loc, `verdict.${v}`)}`;
      }
      return "—";
    }
    case "metric": {
      return formatMetricCellText(cell, locale ?? DEFAULT_REPORT_LOCALE);
    }
    default: {
      const _exhaustive: never = cell;
      return _exhaustive;
    }
  }
}

/** 把 TableContent 展平为 text 排版器用的预格式化行(含 subRows 缩进前缀)。 */
export function flattenTableContentForText(
  content: TableContent,
  locale?: string,
): {
  columns: Array<{ key: string; header: string; align?: "left" | "right" }>;
  /** depth 是行树里的层数(顶层 0);text 面按它画组边界横线,不认识具体实体。 */
  rows: Array<{ key: string; cells: Record<string, string | null>; variant?: string; depth: number }>;
} {
  // 表头与 web 面同源:走列声明的 header,缺省才回落 key。
  const columns = content.columns.map((c) => ({
    key: c.key,
    header: c.header !== undefined ? resolveLocalizedText(c.header, locale ?? DEFAULT_REPORT_LOCALE) : c.key,
    align: (c.better ? "right" : "left") as "left" | "right",
  }));
  const rows: Array<{ key: string; cells: Record<string, string | null>; variant?: string; depth: number }> = [];
  const walk = (row: TableContentRow, depth: number, ancestorLast: readonly boolean[], isLast: boolean): void => {
    const cells: Record<string, string | null> = {};
    for (const col of content.columns) {
      const cell = row.cells[col.key];
      let text = formatCellText(cell, locale);
      if (depth > 0 && col === content.columns[0] && text !== "—") {
        const rails = ancestorLast.map((last) => last ? "   " : "│  ").join("");
        text = `${rails}${isLast ? "└─ " : "├─ "}${text}`;
      }
      cells[col.key] = text;
    }
    rows.push({ key: row.key, cells, variant: row.variant, depth });
    const children = row.subRows ?? [];
    const childAncestors = depth === 0 ? ancestorLast : [...ancestorLast, isLast];
    children.forEach((child, index) =>
      walk(child, depth + 1, childAncestors, index === children.length - 1));
  };
  content.rows.forEach((row, index) => walk(row, 0, [], index === content.rows.length - 1));
  return { columns, rows };
}
