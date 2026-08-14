import { classicAttemptLocator, type ClassicVerdict, type Sample } from "./sample.ts";
import type { MetricValue } from "./metric.ts";

export type AttemptLocator = string;

export interface AttemptAssertionView {
  readonly severity?: "soft" | "hard" | string;
  readonly outcome?: "passed" | "failed" | "unavailable" | string;
  readonly points?: number;
  readonly score: number;
}

/**
 * Closed Attempt view for `rollup` and `page.render(attempt)`.
 * Host builds it from the declared classic projection plan; it has no reader.
 */
export interface ClassicAttemptHandle {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly evalId: string;
  readonly agent?: string;
  readonly result: {
    readonly verdict?: ClassicVerdict | "unreadable";
    readonly assertions: readonly AttemptAssertionView[];
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
  readonly agent: string;
  readonly evaluationKind: "pass" | "points";
  readonly verdict: ClassicVerdict;
  readonly failureSummary: string | null;
  readonly moreFailures: number;
  readonly durationMs: number | null;
  readonly costUSD: number | null;
  readonly historical: boolean;
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
  sample: Sample,
  row: Sample["attempts"][number],
): ClassicAttemptHandle | undefined {
  const locator = classicAttemptLocator(row);
  if (locator === undefined) {
    return undefined;
  }
  const profile = sample.profiles[row.experimentId];
  return Object.freeze({
    locator,
    experimentId: row.experimentId,
    evalId: row.evalId,
    result: Object.freeze({
      verdict: row.verdict ?? "unreadable",
      assertions: Object.freeze([]),
      durationMs: row.durationMs,
      costUSD: row.costUSD,
    }),
    agent: profile?.agent,
  });
}
