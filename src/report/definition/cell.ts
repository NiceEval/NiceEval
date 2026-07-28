// 官方表格数据协议的单元格类型(docs/feature/reports/components/primitives/table.md「单元格类型」)。
// Table / Grid / Stat 共用这份判别联合;自定义 Source 要交给这些原语必须适配成这个形状。

import type { AttemptLocator } from "../../record/locator.ts";
import type { LocalizedText } from "../../shared/types.ts";
import type { Verdict } from "../../scoring/types.ts";
import type { MeasureCell } from "../model/types.ts";

/** 判定计票:passed / failed / errored / skipped。 */
export interface VerdictCounts {
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
}

/**
 * 官方表格一格。三条不变量:
 * - measure 格永远带证据(不得压成 text);
 * - notApplicable 与 missing 不合并;
 * - summary 的文本已在 Source 里折好。
 */
export type Cell =
  | { readonly kind: "measure"; readonly measure: MeasureCell }
  | { readonly kind: "verdict"; readonly verdict?: Verdict | "skipped"; readonly counts?: VerdictCounts }
  | { readonly kind: "score"; readonly earned: number; readonly possible?: number }
  | { readonly kind: "summary"; readonly text: string; readonly more?: number }
  | { readonly kind: "locator"; readonly locator: AttemptLocator; readonly staleSinceMs?: number }
  | { readonly kind: "text"; readonly text: string; readonly detail?: string }
  | { readonly kind: "notApplicable" }
  | { readonly kind: "missing"; readonly code: string; readonly data?: unknown };

export interface ColumnSpec {
  readonly key: string;
  readonly unit?: string;
  readonly better?: "higher" | "lower";
}

/**
 * 表行 Content。与布局原语 `Row` 组件不同名。
 * placeholder 行照常渲染,但不进任何列的聚合读数。
 */
export interface TableContentRow {
  readonly key: string;
  readonly cells: Readonly<Record<string, Cell>>;
  readonly subRows?: readonly TableContentRow[];
  readonly variant?: "normal" | "placeholder";
}

export interface TableContent {
  readonly columns: readonly ColumnSpec[];
  readonly rows: readonly TableContentRow[];
}

/** 把 Cell 折成 text 面可见字符串(缺数据 / 不适用统一不补成 0)。 */
export function formatCellText(cell: Cell | null | undefined, locale?: string): string {
  if (cell == null) return "—";
  switch (cell.kind) {
    case "notApplicable":
      return "—";
    case "missing":
      return cell.code;
    case "text":
      return cell.detail ? `${cell.text}\n  ${cell.detail}` : cell.text;
    case "locator": {
      const stale = cell.staleSinceMs !== undefined ? ` ↩ ${formatStale(cell.staleSinceMs)}` : "";
      return `${cell.locator}${stale}`;
    }
    case "summary": {
      const more = cell.more && cell.more > 0 ? ` +${cell.more} more` : "";
      return `${cell.text}${more}`;
    }
    case "score":
      return cell.possible !== undefined ? `${cell.earned} / ${cell.possible}` : String(cell.earned);
    case "verdict":
      if (cell.counts) {
        const parts = (["passed", "failed", "errored", "skipped"] as const)
          .filter((k) => cell.counts![k] > 0)
          .map((k) => `${cell.counts![k]} ${k}`);
        return parts.join(" · ") || "—";
      }
      return cell.verdict ?? "—";
    case "measure": {
      const m = cell.measure;
      return resolveDisplay(m.display, locale) || (m.value === null ? "—" : String(m.value));
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
): { columns: Array<{ key: string; header: string; align?: "left" | "right" }>; rows: Array<{ key: string; cells: Record<string, string | null>; variant?: string }> } {
  const columns = content.columns.map((c) => ({
    key: c.key,
    header: c.key,
    align: (c.better ? "right" : "left") as "left" | "right",
  }));
  const rows: Array<{ key: string; cells: Record<string, string | null>; variant?: string }> = [];
  const walk = (row: TableContentRow, depth: number): void => {
    const cells: Record<string, string | null> = {};
    for (const col of content.columns) {
      const cell = row.cells[col.key];
      let text = formatCellText(cell, locale);
      if (depth > 0 && col === content.columns[0] && text !== "—") {
        text = `${"  ".repeat(depth)}${text}`;
      }
      cells[col.key] = text;
    }
    rows.push({ key: row.key, cells, variant: row.variant });
    for (const child of row.subRows ?? []) walk(child, depth + 1);
  };
  for (const row of content.rows) walk(row, 0);
  return { columns, rows };
}

function resolveDisplay(display: LocalizedText, locale?: string): string {
  if (typeof display === "string") return display;
  if (locale && typeof display[locale] === "string") return display[locale]!;
  if (typeof display.en === "string") return display.en;
  const first = Object.values(display)[0];
  return typeof first === "string" ? first : "";
}

function formatStale(ms: number): string {
  const days = Math.max(1, Math.round(ms / 86_400_000));
  return `${days}d`;
}
