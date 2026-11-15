import type { ResolvedModelRoles } from "../model-roles.ts";
import type { ExperimentFlags } from "../shared/types.ts";
import type { AdapterIdentity } from "../record/model/run-context.ts";
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
  readonly adapter: AdapterIdentity;
  readonly model: string | undefined;
  readonly models: ResolvedModelRoles | undefined;
  readonly reasoningEffort: string | undefined;
  readonly flags: ExperimentFlags;
  readonly labels: globalThis.Record<string, string | number> | undefined;
  readonly description: string | undefined;
  readonly evals: readonly ProjectCurrentEvalTarget[];
}

/** The complete current target proven by one no-dispatch planning pass. */
export interface ProjectCurrentTarget {
  readonly plannedAt: string;
  readonly experiments: readonly ProjectCurrentExperimentTarget[];
}
