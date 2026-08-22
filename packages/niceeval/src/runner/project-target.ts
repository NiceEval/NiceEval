import type { JsonValue } from "../shared/types.ts";
import type { EvaluationKind } from "./types.ts";

/** The planned identity of one Eval in the current project. */
export interface ProjectCurrentEvalTarget {
  readonly id: string;
  readonly resultConfigHash: string;
  readonly fingerprint: string;
  readonly evaluationKind: EvaluationKind;
}

/**
 * The current identity of one Experiment after discovery and physical planning.
 * It is runner-owned planning data, not a durable Record model.
 */
export interface ProjectCurrentExperimentTarget {
  readonly id: string;
  readonly runConfigHash: string;
  readonly attempts: number;
  readonly agent: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: globalThis.Record<string, JsonValue>;
  readonly labels?: globalThis.Record<string, string | number>;
  readonly description?: string;
  readonly evals: readonly ProjectCurrentEvalTarget[];
}

/** The complete current target proven by one no-dispatch planning pass. */
export interface ProjectCurrentTarget {
  readonly plannedAt: string;
  readonly experiments: readonly ProjectCurrentExperimentTarget[];
}
