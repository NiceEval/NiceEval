import type { EvaluationKind } from "../../eval/record/evaluation.ts";
import type { Score } from "../../eval/record/score.ts";
import {
  classicAttemptLocator,
  type ClassicAssertionView,
  type ClassicEvidence,
  type ClassicVerdict,
  type Sample,
} from "./sample.ts";
import type { MetricValue } from "./metric.ts";

export type { ClassicEvidence };

export type AttemptLocator = string;

export type AttemptAssertionView = ClassicAssertionView;

/**
 * Closed Attempt view for `rollup` and `page.render(attempt)`.
 * Host builds it from the declared classic projection plan; it has no reader.
 */
export interface ClassicAttemptHandle {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly evalId: string;
  readonly agent?: string;
  readonly evaluationKind: EvaluationKind | "unavailable";
  readonly historical: boolean | null;
  readonly result: {
    readonly verdict?: ClassicVerdict | "unreadable";
    readonly assertions: ClassicEvidence<readonly AttemptAssertionView[]>;
    readonly score: ClassicEvidence<Score>;
    readonly durationMs?: number | null;
    readonly costUSD?: number | null;
  };
}

/** Public AttemptEvidence seam: a closed projected Attempt, not Record I/O. */
export type AttemptEvidence = ClassicAttemptHandle;

export interface AttemptEvidenceCapabilities {
  readonly source: boolean;
  readonly execution: boolean;
  readonly timing: boolean;
  readonly diff: boolean;
}

export interface AttemptListItem {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly agent: string | null;
  readonly evaluationKind: EvaluationKind;
  readonly verdict: ClassicVerdict | "unavailable";
  readonly failureSummary: string | null;
  readonly moreFailures: number | null;
  readonly durationMs: number | null;
  readonly costUSD: number | null;
  readonly historical: boolean | null;
  readonly locator: AttemptLocator;
}

export interface SampleSummaryContent {
  readonly range: {
    readonly earliestStartedAt: string | null;
    readonly latestStartedAt: string | null;
  };
  readonly experiments: number;
  readonly evals: number;
  readonly attempts: number;
  readonly endToEndPassRate: MetricValue;
  readonly totalCostUSD: MetricValue;
}

export interface AttemptSummaryData {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly evalId: string;
  readonly verdict: ClassicVerdict | "unreadable" | "unknown";
}

export type CopyBlockContent = string | { readonly text: string };

export function copyBlockText(content: CopyBlockContent): string {
  return typeof content === "string" ? content : content.text;
}

export function classicAttemptHandleFromRow(
  sample: Sample | undefined,
  row: Sample["attempts"][number],
): ClassicAttemptHandle | undefined {
  const locator = classicAttemptLocator(row);
  if (locator === undefined) {
    return undefined;
  }
  const agent = sample?.profiles[row.experimentId]?.agent;
  return Object.freeze({
    locator,
    experimentId: row.experimentId,
    evalId: row.evalId,
    evaluationKind: row.evaluationKind,
    historical: row.historical,
    result: Object.freeze({
      verdict: row.verdict ?? "unreadable",
      assertions: row.assertions,
      score: row.scoreEvidence,
      durationMs: row.durationMs,
      costUSD: row.costUSD,
    }),
    ...(agent === undefined ? {} : { agent }),
  });
}

export function unavailableAttemptEvidence(): ClassicAttemptHandle {
  return Object.freeze({
    locator: "",
    experimentId: "",
    evalId: "",
    evaluationKind: "unavailable" as const,
    historical: null,
    result: Object.freeze({
      verdict: "unreadable" as const,
      assertions: Object.freeze({ state: "unavailable" as const }),
      score: Object.freeze({ state: "unavailable" as const }),
    }),
  });
}
