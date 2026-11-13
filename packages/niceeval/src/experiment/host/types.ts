import type { IdentityExplanation } from "../../runner/manifest.ts";
import type { ResolvedModelRoles } from "../../model-roles.ts";
import { Data, type Effect } from "effect";

import type { Config } from "../../types.ts";
import type { FeedbackCoordinator } from "../../runner/feedback/coordinator.ts";
import type { InvocationCompletion } from "../../runner/types.ts";
import type { SessionListDocument, SessionShowDocument } from "../../runner/session.ts";
import type { CurrentReuseReadbackSnapshot } from "../../runner/reuse-readback.ts";
import type { BeforeCachePreparationSummary } from "../../runner/before-cache-preparation.ts";

/** Restricts Host protocol data to JSON values; functions, undefined and live service instances cannot cross this boundary. */
export type ExperimentHostJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ExperimentHostJsonValue[]
  | { readonly [key: string]: ExperimentHostJsonValue };

/** Identifies the Host operation associated with execution or failure; planning and apply operations remain distinct. */
export type ExperimentHostOperation =
  | "catalog"
  | "check"
  | "debug"
  | "invocation-plan"
  | "invocation-run"
  | "rename-plan"
  | "rename-apply"
  | "accept"
  | "invocation-status-list"
  | "invocation-status-show"
  | "teardown-inspect"
  | "teardown-run";

/** Stable typed failure boundary; defects and interruption remain separate. */
export class ExperimentHostError extends Data.TaggedError("ExperimentHostError")<{
  readonly operation: ExperimentHostOperation;
  readonly code: string;
  readonly message: string;
  /** Structured typed failure retained for application/CLI attribution. */
  readonly cause?: unknown;
  readonly comparisons?: readonly import("../../runner/reuse-plan.ts").ExecutionComparison[];
}> {}

/** Inputs shared by discovery, link checking, and invocation planning. */
export interface ExperimentHostSelectionInput {
  readonly cwd: string;
  readonly experimentSelector?: string;
  /** Non-empty exact Experiment ID set; mutually exclusive with experimentSelector. */
  readonly experimentIds?: readonly string[];
  readonly evalSelectors?: readonly string[];
  readonly tag?: string;
}

/** Describes a discovered Eval's identity, tags and evaluation kind; Score and Pass results require different quality interpretations. */
export interface ExperimentHostEvalSummary {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly evaluationKind: "pass" | "score";
}

/** Summarizes discovered execution settings and Eval membership; hasBefore and hasAfter describe declared lifecycle hooks rather than completed work. */
export interface ExperimentHostExperimentSummary {
  readonly models?: ResolvedModelRoles;
  readonly id: string;
  readonly description?: string;
  readonly adapter: string | null;
  readonly model?: string;
  readonly attempts: number;
  readonly evalIds: readonly string[];
  readonly labels: Readonly<Record<string, string | number>>;
  readonly hasBefore: boolean;
  readonly hasAfter: boolean;
  readonly sharedStateKey?: string;
}

/** Lists discovered Evals and Experiments without executing them; catalog membership does not prove that the selected pairs can link. */
export interface ExperimentHostCatalog {
  readonly status: "listed";
  readonly evals: readonly ExperimentHostEvalSummary[];
  readonly experimentIds: readonly string[];
  readonly experiments: readonly ExperimentHostExperimentSummary[];
}

/** Explains an unmatched or empty Experiment and Eval selection with candidate IDs; absence of matches is not a successful zero-work plan. */
export type ExperimentHostSelectionProblem =
  | {
      readonly status: "experiment-no-match";
      readonly selector: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "eval-no-match";
      readonly selector: string;
      readonly experimentIds: readonly string[];
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "empty-selection";
      readonly experimentIds: readonly string[];
      readonly candidates: readonly string[];
    };

/** Supplies per-invocation execution overrides; timeoutMs uses milliseconds, and rerun policy does not change historical reuse eligibility. */
export interface ExperimentHostRunOverrides {
  readonly attempts?: number;
  readonly earlyExit?: boolean;
  readonly timeoutMs?: number;
  readonly budget?: number;
  readonly rerun?: "failed" | "all";
  readonly keepSandbox?: "failed" | "all";
  readonly pauseOnFailure?: boolean;
  readonly maxConcurrency?: number;
  readonly maxBuildConcurrency?: number;
  readonly maxBeforeCacheConcurrency?: number;
}

/** Validates Experiment and Eval linking with explicit Config and optional execution overrides; checking does not run Attempts. */
export interface ExperimentHostCheckRequest extends ExperimentHostSelectionInput {
  readonly config: Config;
  readonly overrides?: ExperimentHostRunOverrides;
}

/** Reports linked pairs or a selection problem; handle non-linked statuses instead of assuming an empty selection succeeded. */
export type ExperimentHostCheckResult =
  | ExperimentHostSelectionProblem
  | {
      readonly status: "linked";
      readonly experimentIds: readonly string[];
      readonly evalIds: readonly string[];
      readonly pairCount: number;
    };

declare const invocationPlanBrand: unique symbol;

/**
 * Opaque in-memory authority issued by `experimentHost.invocation.plan`.
 * Its Runner graph is held in Host-private storage and cannot be forged or
 * reconstructed by a CLI.
 */
export interface ExperimentHostInvocationPlan {
  readonly [invocationPlanBrand]: typeof invocationPlanBrand;
}

/** Summarizes planned workload and concurrency limits; build, before-cache and Attempt concurrency are separate budgets. */
export interface ExperimentHostInvocationShape {
  readonly experiments: number;
  readonly evals: number;
  readonly configurations: number;
  readonly totalAttempts: number;
  readonly attempts: number;
  readonly maxConcurrency: number;
  readonly maxBuildConcurrency: number;
  readonly maxBeforeCacheConcurrency: number;
  readonly experimentConcurrency: Readonly<Record<string, number>>;
}

/** Identifies an exact planned slot, execution identity and zero-based attempt index; preserve group identity when present. */
export interface ExperimentHostDrySlotTarget {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly executionIdentityDigest: string;
  readonly evalGroupId?: string;
  readonly evalGroupIndex?: number;
  readonly attempt: number;
}

/** Explains one recorded identity claim's reuse comparison; display strings are diagnostic summaries rather than executable comparison rules. */
export interface ExperimentHostDryComparison {
  readonly explanation?: IdentityExplanation;
  readonly attachment: string;
  readonly recordedClaim: string;
  readonly sourceState: string;
  readonly result: string;
  readonly reason: string;
}

/** Reports whether one target slot can reuse a source or has a gap; a gap is missing applicable evidence rather than a failed Attempt. */
export type ExperimentHostDrySlot =
  | {
      readonly state: "reuse";
      readonly target: ExperimentHostDrySlotTarget;
      readonly source: {
        readonly attemptId: string;
        readonly originRunId: string;
        readonly originSlotId: string;
        readonly sourceRunId: string;
      };
      readonly comparisons: readonly ExperimentHostDryComparison[];
    }
  | {
      readonly state: "gap";
      readonly target: ExperimentHostDrySlotTarget;
      readonly reason: string;
      readonly scope: "slot" | "experiment" | "target";
      readonly issues: readonly ExperimentHostJsonValue[];
      readonly comparisons: readonly ExperimentHostDryComparison[];
    };

/** Describes current target reuse and gaps with pinned readbacks; it is a preview of applicability rather than a new Run result. */
export interface ExperimentHostDryPlan {
  readonly policy: { readonly name: "project-target"; readonly version: 1 };
  readonly slots: readonly ExperimentHostDrySlot[];
  readonly readbacks: readonly CurrentReuseReadbackSnapshot[];
  readonly lockedPairs: readonly string[];
}

/** Returns a ready executable plan or an explicit selection problem; only a ready result may be passed to invocation execution. */
export type ExperimentHostInvocationPlanResult =
  | ExperimentHostSelectionProblem
  | {
      readonly status: "ready";
      readonly plan: ExperimentHostInvocationPlan;
      readonly shape: ExperimentHostInvocationShape;
      readonly experimentIds: readonly string[];
      readonly evalIds: readonly string[];
      readonly pluginAudit: {
        readonly occurrences: readonly ExperimentHostJsonValue[];
      };
      readonly dry?: ExperimentHostDryPlan;
    };

/** Plans selected targets with explicit Config, overrides and optional dry preview; coordinationRoot is a host path rather than a result locator. */
export interface ExperimentHostInvocationPlanRequest extends ExperimentHostSelectionInput {
  readonly config: Config;
  /** Host path to process coordination state; defaults to cwd/.niceeval. */
  readonly coordinationRoot?: string;
  readonly overrides?: ExperimentHostRunOverrides;
  readonly preview?: boolean;
}

/** Lossless Experiment presentation owned by the calling Host surface. */
export interface ExperimentHostInvocationFeedback {
  readonly coordinator: FeedbackCoordinator;
}

/** Executes an already prepared Host plan with optional cancellation and feedback; do not reconstruct the opaque plan from display output. */
export interface ExperimentHostInvocationRunRequest {
  readonly plan: ExperimentHostInvocationPlan;
  readonly signal?: AbortSignal;
  readonly feedback?: ExperimentHostInvocationFeedback;
  /** Optional required JUnit reporter target, owned and invoked inside Host. */
  readonly junitPath?: string;
}

/**
 * Invocation status is project-local and ephemeral.  It is an observation of
 * the coordination directory, not recoverable Record fact data.
 */
export interface ExperimentHostInvocationStatusListRequest {
  readonly cwd: string;
  readonly all?: boolean;
  readonly experimentSelector?: string;
}

/** Selects an Invocation Session relative to an explicit project cwd; the selector targets an Invocation rather than an Attempt locator. */
export interface ExperimentHostInvocationStatusShowRequest {
  readonly cwd: string;
  readonly invocationSelector: string;
}

/** Lists Invocation Sessions for status inspection; Session status is distinct from durable Run publication state. */
export type ExperimentHostInvocationStatusList = SessionListDocument;

/** Describes one selected Invocation Session; use its Run references to read published evaluation facts. */
export type ExperimentHostInvocationStatusShow = SessionShowDocument;

/** Records every Run created by an Invocation and its publication cutoff; published Attempts may be readable before a Run closes. */
export interface ExperimentHostInvocationReceipt {
  readonly invocationId: string;
  readonly createdRunIds: readonly string[];
  readonly publicationCutoff: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}

/** Summarizes Attempt Verdict counts and elapsed milliseconds; optional token and estimated USD fields must not be treated as complete usage when absent. */
export interface ExperimentHostInvocationSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly errored: number;
  readonly durationMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCostUSD?: number;
  readonly beforeCaches: BeforeCachePreparationSummary;
}

/** Returns a finished invocation receipt and summary; completion describes execution completion, while quality remains in individual Verdicts and scores. */
export interface ExperimentHostInvocationResult {
  readonly status: "finished";
  readonly receipt: ExperimentHostInvocationReceipt;
  readonly summary: ExperimentHostInvocationSummary;
  /** Present when the caller supplied the one feedback reducer/presentation. */
  readonly completion?: InvocationCompletion;
  /** Exact CLI exit fold for the supplied presentation. */
  readonly exitCode?: number;
}

/** Adopt one exact historical Run into one current Experiment. */
export interface ExperimentHostRenameRequest {
  readonly cwd: string;
  readonly sourceRunId: string;
  readonly newId: string;
  readonly config?: Config;
  readonly operatorReason?: string;
}
/** Names a failed explicit-adoption eligibility check; a rename must not bypass it by rewriting historical Attempt identities. */
export type ExperimentHostRenameReason = import("../../runner/adoption.ts").ExplicitAdoptionFailureCode;
/** Previews adopting a source Run under another Experiment identity; blocked records explain why apply cannot safely proceed. */
export interface ExperimentHostRenamePlan {
  readonly status: "plan";
  readonly sourceRunId: string;
  readonly oldId: string | null;
  readonly newId: string;
  readonly migrations: readonly {
    readonly evalId: string;
    readonly attempt: number;
    readonly sourceLocator: string;
    readonly targetExperimentId: string;
    readonly fingerprint: string;
  }[];
  readonly blocked?: { readonly reason: ExperimentHostRenameReason; readonly detail: string };
}
/** Reports a rejected rename or a newly published adoption Run; successful migration references source Attempts without rerunning them. */
export type ExperimentHostRenameResult =
  | {
      readonly status: "rejected";
      readonly sourceRunId: string;
      readonly oldId: string | null;
      readonly newId: string;
      readonly reason: ExperimentHostRenameReason;
      readonly detail: string;
    }
  | {
      readonly status: "done";
      readonly invocationId: string;
      readonly runId: string;
      readonly sourceRunId: string;
      readonly oldId: string;
      readonly newId: string;
      readonly migrated: readonly {
        readonly evalId: string;
        readonly attempt: number;
        readonly sourceLocator: string;
        readonly locator: string;
        readonly fingerprint: string;
        readonly verdict: "passed" | "failed";
      }[];
    };

/** Requests explicit adoption of exact Attempt locators into the current target; accepting a result does not rerun or rewrite its origin evidence. */
export interface ExperimentHostAcceptRequest {
  readonly cwd: string;
  readonly locators: readonly string[];
  readonly config?: Config;
  readonly operatorReason?: string;
}

/** Identifies the new reference member and its unchanged source Attempt locator; adoption preserves the original execution evidence. */
export interface ExperimentHostAcceptedAttempt {
  readonly invocationId: string;
  readonly runId: string;
  readonly slotId: string;
  readonly locator: string;
  readonly sourceLocator: string;
  readonly fingerprint: string;
}

/** Selects one exact source Run for adoption; its ID is not an Experiment prefix selector. */
export interface ExperimentHostAcceptRunRequest extends Omit<ExperimentHostAcceptRequest, "locators"> {
  readonly runId: string;
}

/** Lists source Run members and identity comparisons proposed for adoption; inspect the plan before applying an explicit acceptance. */
export interface ExperimentHostAcceptRunPlan {
  readonly sourceRunId: string;
  readonly members: readonly {
    readonly locator: string;
    readonly experimentId: string;
    readonly evalId: string;
    readonly attempt: number;
    readonly fingerprint: string;
    readonly comparisons: readonly import("../../runner/reuse-plan.ts").ExecutionComparison[];
  }[];
}

/** Identifies a shared lifecycle owner and its last heartbeat; stale heartbeat alone does not prove a local or remote process has terminated. */
export interface ExperimentHostSharedStateEvidence {
  readonly key: string;
  readonly experimentId: string;
  readonly ownerToken: string;
  readonly host: string;
  readonly pid: number;
  readonly processIdentity: string;
  readonly heartbeatAt: string;
}

/** Selects shared Experiment lifecycle evidence for teardown inspection; currentHost identifies the caller rather than proving a remote owner has stopped. */
export interface ExperimentHostAfterInspectRequest {
  readonly cwd: string;
  readonly experimentSelector?: string;
  readonly coordinationRoot?: string;
  readonly currentHost: string;
  readonly recoveryKey?: string;
}

/** Reports whether teardown evidence is absent, ambiguous, mismatched or ready; inspect status before attempting cleanup. */
export type ExperimentHostAfterInspection =
  | { readonly status: "no-evidence"; readonly key: string }
  | ExperimentHostSelectionProblem
  | {
      readonly status: "selection-not-unique";
      readonly experimentIds: readonly string[];
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "experiment-mismatch";
      readonly selectedExperimentId: string;
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "after-required";
      readonly experimentId: string;
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "ready";
      readonly experimentIds: readonly string[];
      readonly orphanedRegistrations: number;
      readonly evidence?: ExperimentHostSharedStateEvidence;
    };

/** Requests teardown or recovery with optional cancellation and ownership confirmations; confirm termination or remote quiescence only from real evidence. */
export interface ExperimentHostAfterRequest extends ExperimentHostAfterInspectRequest {
  readonly observer?: ExperimentHostAfterObserver;
  readonly signal?: AbortSignal;
  readonly ownerToken?: string;
  readonly confirmOwnerTerminated?: boolean;
  readonly confirmRemoteQuiesced?: boolean;
}

/** Reports teardown progress, diagnostics and hook completion; these events do not replace the final recovery result. */
export type ExperimentHostAfterEvent =
  | {
      readonly type: "experiment-progress";
      readonly experimentId: string;
      readonly detail: string;
    }
  | {
      readonly type: "diagnostic";
      readonly code: string;
      readonly level: "info" | "warning" | "error";
      readonly message: string;
      readonly data?: Readonly<Record<string, ExperimentHostJsonValue>>;
    }
  | {
      readonly type: "experiment-hook";
      readonly experimentId: string;
      readonly hook: "teardown";
      readonly status: "started" | "done" | "failed";
      readonly durationMs?: number;
      readonly recovery?: true;
    };

/** Receives structured teardown events for presentation; it must not reinterpret them as authorization to recover an owner. */
export interface ExperimentHostAfterObserver {
  readonly observe: (event: ExperimentHostAfterEvent) => void;
}

/** Reports teardown or recovery status and any required confirmation; a completed operation may still contain failed experiment teardown outcomes. */
export type ExperimentHostAfterResult =
  | ExperimentHostAfterInspection
  | {
      readonly status: "completed";
      readonly experiments: readonly {
        readonly experimentId: string;
        readonly executions: number;
        readonly outcome: "succeeded" | "failed" | "not-configured";
        readonly error?: string;
      }[];
    }
  | {
      readonly status: "recovered" | "already-released";
      readonly key: string;
      readonly experimentId: string;
      readonly ownerToken: string;
    }
  | {
      readonly status: "recovery-confirmation-required";
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "recovery-teardown-failed";
      readonly evidence: ExperimentHostSharedStateEvidence;
      readonly error: string;
    };

/** Provides supported catalog, planning, execution, adoption and recovery operations; effects must be run by the integrating host. */
export interface ExperimentHostHighLevelSDK {
  readonly catalog: (
    input: ExperimentHostSelectionInput,
  ) => Effect.Effect<ExperimentHostCatalog, ExperimentHostError>;
  readonly check: (
    input: ExperimentHostCheckRequest,
  ) => Effect.Effect<ExperimentHostCheckResult, ExperimentHostError>;
  readonly invocation: {
    readonly plan: (
      input: ExperimentHostInvocationPlanRequest,
    ) => Effect.Effect<ExperimentHostInvocationPlanResult, ExperimentHostError>;
    readonly run: (
      input: ExperimentHostInvocationRunRequest,
    ) => Effect.Effect<ExperimentHostInvocationResult, ExperimentHostError>;
  };
  readonly invocationStatus: {
    readonly list: (
      input: ExperimentHostInvocationStatusListRequest,
    ) => Effect.Effect<ExperimentHostInvocationStatusList, ExperimentHostError>;
    readonly show: (
      input: ExperimentHostInvocationStatusShowRequest,
    ) => Effect.Effect<ExperimentHostInvocationStatusShow, ExperimentHostError>;
  };
  readonly rename: {
    readonly plan: (
      input: ExperimentHostRenameRequest,
    ) => Effect.Effect<ExperimentHostRenamePlan, ExperimentHostError>;
    readonly apply: (
      input: ExperimentHostRenameRequest,
    ) => Effect.Effect<ExperimentHostRenameResult, ExperimentHostError>;
  };
  readonly after: {
    readonly inspect: (
      input: ExperimentHostAfterInspectRequest,
    ) => Effect.Effect<ExperimentHostAfterInspection, ExperimentHostError>;
    readonly run: (
      input: ExperimentHostAfterRequest,
    ) => Effect.Effect<ExperimentHostAfterResult, ExperimentHostError>;
  };
  readonly accept: (
    input: ExperimentHostAcceptRequest,
  ) => Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError>;
  readonly acceptRun: {
    readonly plan: (input: ExperimentHostAcceptRunRequest) => Effect.Effect<ExperimentHostAcceptRunPlan, ExperimentHostError>;
    readonly apply: (input: ExperimentHostAcceptRunRequest) => Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError>;
  };
}
