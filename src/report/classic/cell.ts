import { formatMetricValue } from "./format.ts";
import { isMetricValue, type MetricValue } from "./metric.ts";
import type { ClassicVerdict } from "./sample.ts";

export interface VerdictCounts {
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
}

export type Cell =
  | { readonly kind: "metric"; readonly metric: MetricValue }
  | {
      readonly kind: "verdict";
      readonly verdict?: ClassicVerdict;
      readonly counts?: VerdictCounts;
      readonly refs?: readonly string[];
      readonly staleSinceMs?: number;
      readonly bare?: boolean;
    }
  | { readonly kind: "score"; readonly earned: number; readonly possible?: number }
  | { readonly kind: "summary"; readonly text: string; readonly more?: number }
  | {
      readonly kind: "locator";
      readonly locator: string;
      readonly staleSinceMs?: number;
      readonly verdict?: ClassicVerdict;
    }
  | { readonly kind: "text"; readonly text: string; readonly detail?: string }
  | { readonly kind: "notApplicable" }
  | {
      readonly kind: "missing";
      readonly code: string;
      readonly detail?: string;
    }
  | {
      readonly kind: "composition";
      readonly segments: readonly { readonly label: string; readonly count: number }[];
    };

export function isCell(value: unknown): value is Cell {
  return typeof value === "object" && value !== null && "kind" in value && typeof (value as Cell).kind === "string";
}

export function formatCellText(cell: Cell | null | undefined): string {
  if (cell == null) return "—";
  switch (cell.kind) {
    case "notApplicable":
    case "missing":
      return "—";
    case "text":
      return cell.detail === undefined ? cell.text : `${cell.text}\n  ${cell.detail}`;
    case "locator":
      return cell.locator;
    case "summary":
      return cell.more !== undefined && cell.more > 0 ? `${cell.text} +${cell.more} more` : cell.text;
    case "score":
      return cell.possible === undefined ? String(cell.earned) : `${cell.earned} / ${cell.possible}`;
    case "verdict":
      if (cell.counts !== undefined) {
        const parts = (["passed", "failed", "errored", "skipped"] as const)
          .filter((key) => cell.counts![key] > 0)
          .map((key) => `${cell.counts![key]} ${key}`);
        return parts.join(" · ") || "—";
      }
      return cell.verdict ?? "—";
    case "metric":
      return formatMetricValue(cell.metric.value, cell.metric.unit, cell.metric.format);
    case "composition": {
      const parts = cell.segments
        .filter((segment) => segment.count > 0)
        .map((segment) => `${segment.count} ${segment.label}`);
      return parts.join(" · ") || "—";
    }
  }
}

export function cellFromUnknown(value: unknown): Cell {
  if (isCell(value)) return value;
  if (isMetricValue(value)) return { kind: "metric", metric: value };
  if (value === null || value === undefined) return { kind: "notApplicable" };
  return { kind: "text", text: String(value) };
}
