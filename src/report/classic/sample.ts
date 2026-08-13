import type { AttemptId, RunId, UtcMillis } from "../../analysis/index.ts";
import type { ReportDocument, ReportLinkTarget } from "../semantic/document.ts";
import type { ClassicLocale } from "./localize.ts";
import type { ClassicExperimentProfile } from "./origin.ts";

export type ClassicMetadataOrigin = NonNullable<ReportDocument["metadataOrigin"]>;

export type ClassicAttemptTarget = Extract<ReportLinkTarget, { readonly kind: "attempt" }>;

export type ClassicVerdict = "passed" | "failed" | "errored" | "skipped";

export interface ClassicRunView {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
}

export interface ClassicExperimentView {
  readonly agent?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags?: Readonly<Record<string, unknown>>;
  readonly labels?: Readonly<Record<string, string | number>>;
  readonly description?: string;
}

export interface AggregationSubject {
  readonly experimentId: string;
  readonly evalId: string;
  readonly run: ClassicRunView & {
    readonly experiment?: ClassicExperimentView;
  };
}

export interface ClassicAttemptRow {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly attemptId?: AttemptId;
  readonly target?: ClassicAttemptTarget;
  readonly verdict?: ClassicVerdict;
  readonly durationMs: number | null;
  readonly costUSD: number | null;
  readonly tokens: number | null;
}

export interface ClassicEvalUnit {
  readonly experimentId: string;
  readonly evalId: string;
  readonly subject: AggregationSubject;
  readonly attempts: readonly ClassicAttemptRow[];
}

/**
 * Closed, callback-free Sample for classic `render(sample)`.
 * Host builds it from the declared classic projection plan before any page
 * callback runs. It has no reader, path, or Record I/O capability.
 */
export interface Sample {
  readonly metadataOrigin: ClassicMetadataOrigin;
  readonly locale: ClassicLocale;
  readonly runCount: number;
  readonly earliestRunAt: UtcMillis | null;
  readonly latestRunAt: UtcMillis | null;
  readonly runs: readonly ClassicRunView[];
  readonly profiles: Readonly<Record<string, ClassicExperimentProfile>>;
  readonly units: readonly ClassicEvalUnit[];
  readonly attempts: readonly ClassicAttemptRow[];
}

/** @internal Implementation name. Public author type is `Sample`. */
export type ClassicSample = Sample;

export function classicAttemptTarget(attemptId: AttemptId): ClassicAttemptTarget {
  return Object.freeze({
    kind: "attempt" as const,
    locator: `@${attemptId}`,
  });
}

export function unitKey(experimentId: string, evalId: string): string {
  return JSON.stringify([experimentId, evalId]);
}

export function slotKey(runId: string, slotId: string): string {
  return JSON.stringify([runId, slotId]);
}
