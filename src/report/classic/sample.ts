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
 * A deep-frozen, callback-free projection of the four official classic
 * attachments. Author callbacks receive this value as `ctx.scope`.
 */
export interface ClassicSample {
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
